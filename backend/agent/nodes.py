"""
Agent nodes for the Trade Exception Review Agent.

LEARNING: In LangGraph, a "node" is just a Python function.
It receives the full state, does some work (calls an LLM, calls a tool,
runs logic), and returns a dict of state updates to merge back in.

The key rule: nodes must be pure with respect to state — never mutate
the state object directly. Always return a new dict.

Every node in this file has the same signature:
    def node_name(state: TradeExceptionState) -> dict

This predictability is what makes LangGraph graphs composable and testable.
"""

import json
import logging
from datetime import datetime, timezone
from functools import lru_cache

from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from langgraph.types import interrupt

from backend.agent.state import TradeExceptionState, AuditEntry
from backend.agent.prompts import (
    build_investigation_prompt,
    build_proposal_prompt,
    build_execution_confirmation_prompt,
)

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _get_llm() -> ChatOpenAI:
    """
    LEARNING: We use lazy initialisation via lru_cache rather than a module-level
    global. This means the LLM client is only created the first time a node runs,
    not at import time. This makes the module importable even without an API key
    set — useful for testing, CI, and import-time graph compilation.

    TRADE-OFF: lru_cache means the LLM is a singleton per process. If you need
    per-request model config (e.g. different temperature per node), create the
    LLM inside each node call instead.
    """
    from dotenv import load_dotenv
    load_dotenv("backend/.env")
    return ChatOpenAI(model="gpt-4o", temperature=0)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _now() -> str:
    """Return current UTC time as ISO 8601 string."""
    return datetime.now(timezone.utc).isoformat()


def _audit(event_type: str, node: str | None, details: str) -> AuditEntry:
    """
    LEARNING: Every significant event gets an audit entry.
    We use a helper so the shape is consistent everywhere.

    PRODUCTION: In a real system you'd also include: operator_id (for human
    events), session_id, environment, and a hash of the state at that point
    for tamper detection.
    """
    return AuditEntry(
        timestamp=_now(),
        event_type=event_type,
        node=node,
        details=details,
    )


def _parse_llm_json(raw: str, node_name: str) -> dict:
    """
    Parse JSON from an LLM response. Handles models that sometimes wrap
    JSON in markdown code fences despite being told not to.

    PRODUCTION: You'd use a structured output / response_format approach
    in production (OpenAI supports JSON mode and function calling).
    We parse manually here to understand the mechanism before abstracting it.
    """
    try:
        # Strip markdown fences if model added them anyway
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            cleaned = "\n".join(lines[1:-1])
        return json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.error(f"[{node_name}] Failed to parse LLM JSON: {e}\nRaw output: {raw}")
        raise ValueError(f"LLM returned invalid JSON in {node_name}") from e


# ── Node 1: Receive Exception ──────────────────────────────────────────────────

def receive_exception_node(state: TradeExceptionState) -> dict:
    """
    LEARNING: This node does almost no work — it just validates the incoming
    exception and initialises bookkeeping fields. Its value is as a clear
    entry point in the graph. Every run starts here.

    In a production system, this node would:
    - Validate the exception schema (Pydantic)
    - Enrich it with data from upstream systems (trade date, settlement date, etc.)
    - Assign a priority based on amount and exception type
    - Write the initial record to the database

    Pattern to remember: the first node is always an ingestion/validation node.
    Never start processing without a clean input boundary.
    """
    exc = state["exception"]
    logger.info(f"[receive_exception] Received exception {exc['trade_id']}")

    audit_entry = _audit(
        event_type="exception_received",
        node="receive_exception",
        details=f"Exception {exc['trade_id']} received — type: {exc['type']}, amount: {exc['amount']:,.2f}",
    )

    return {
        "status": "received",
        "investigation_attempts": 0,
        "audit_log": state.get("audit_log", []) + [audit_entry],
    }


# ── Node 2: Investigate ────────────────────────────────────────────────────────

def investigate_node(state: TradeExceptionState) -> dict:
    """
    LEARNING: This is the core "thinking" node. The agent reads the exception,
    reasons about root cause, and produces structured investigation output.

    Notice the pattern:
    1. Build a prompt using state (prompts.py keeps this logic separate)
    2. Call the LLM
    3. Parse the structured output
    4. Return state updates

    The investigation_attempts counter is important — it lets us detect
    infinite loops if the agent keeps getting rejected. In Phase 5
    (failure handling), we'll add a max-retry guard here.
    """
    exc = state["exception"]
    attempt = state.get("investigation_attempts", 0) + 1
    logger.info(f"[investigate] Starting investigation attempt {attempt} for {exc['trade_id']}")

    prompt = build_investigation_prompt(state)
    response = _get_llm().invoke([
        SystemMessage(content="You are a trade exception specialist. Respond with valid JSON only."),
        HumanMessage(content=prompt),
    ])

    raw = response.content
    result = _parse_llm_json(raw, "investigate_node")

    audit_entry = _audit(
        event_type="investigation_complete",
        node="investigate",
        details=f"Attempt {attempt} — root cause: {result['root_cause'][:80]} — confidence: {result['confidence']}",
    )

    logger.info(f"[investigate] Confidence: {result['confidence']} — {result['root_cause'][:60]}")

    return {
        "status": "investigating",
        "investigation": result,
        "investigation_attempts": attempt,
        "audit_log": state.get("audit_log", []) + [audit_entry],
    }


# ── Node 3: Propose Resolution ─────────────────────────────────────────────────

def propose_resolution_node(state: TradeExceptionState) -> dict:
    """
    LEARNING: This node does two distinct things:
    1. Generates the resolution proposal using the LLM
    2. Hits the HITL interrupt — pausing execution and surfacing the proposal to a human

    The interrupt() call is the pivotal moment in this entire codebase.
    When Python execution reaches interrupt(), LangGraph:
    - Serialises the current state to the checkpointer
    - Returns control to the caller (your API or test harness)
    - Waits — indefinitely — until Command(resume=...) is called with this thread_id

    The agent is NOT running during this time. It is checkpointed.
    The thread_id is your reconnection key.

    HITL: This is the primary human approval gate. The agent has done its
    analysis and is now asking: "Is my proposal correct?"

    TRADE-OFF: We could auto-approve if confidence > 0.85. That's a policy
    decision. For Phase 1 we always interrupt so you can see the mechanism.
    In Phase 3, we'll add the confidence-based bypass.
    """
    exc = state["exception"]
    logger.info(f"[propose_resolution] Building proposal for {exc['trade_id']}")

    prompt = build_proposal_prompt(state)
    response = _get_llm().invoke([
        SystemMessage(content="You are a trade exception specialist. Respond with valid JSON only."),
        HumanMessage(content=prompt),
    ])

    proposal = _parse_llm_json(response.content, "propose_resolution_node")

    audit_entry = _audit(
        event_type="proposal_ready",
        node="propose_resolution",
        details=f"Proposal: {proposal['action']} — confidence: {proposal['confidence']} — risk: {proposal['risk_level']}",
    )

    logger.info(f"[propose_resolution] Proposal ready — confidence: {proposal['confidence']}")

    # HITL: Pause execution here. The dict passed to interrupt() is what
    # your frontend will receive to render the DecisionSurface.
    # This call does not return until a human submits a decision.
    human_decision = interrupt({
        "trade_id": exc["trade_id"],
        "proposal": proposal,
        "investigation_summary": state["investigation"]["root_cause"],
        "confidence": proposal["confidence"],
        "risk_level": proposal["risk_level"],
        "amount": exc["amount"],
    })

    # Execution resumes here after the human has decided.
    # human_decision is the dict the operator submitted.
    decision_audit = _audit(
        event_type="human_decision_received",
        node="propose_resolution",
        details=f"Operator {human_decision.get('operator_id', 'unknown')} decided: {human_decision['action']}",
    )

    return {
        "proposal": proposal,
        "human_decision": human_decision,
        "status": "awaiting_human",    # Will be updated by the next node
        "audit_log": state.get("audit_log", []) + [audit_entry, decision_audit],
    }


# ── Node 4: Execute Resolution ─────────────────────────────────────────────────

def execute_resolution_node(state: TradeExceptionState) -> dict:
    """
    LEARNING: This node only runs after a human decision is in state.
    It branches on the decision action:
    - approve → execute the proposal as-is
    - modify  → execute the modified version (steering pattern)
    - reject  → do NOT execute; the graph will loop back to investigate
    - escalate → do NOT execute; route to senior queue

    The reject and escalate branches return early without executing.
    The graph routing logic (in graph.py) reads the returned status
    to decide which node to go to next.

    PRODUCTION: The actual "execution" here would be API calls to:
    - Settlement system (DTCC, Euroclear)
    - Internal trade management system
    - Notification service (to alert counterparty)
    These would be LangGraph tools in a later phase.
    """
    decision = state["human_decision"]
    exc = state["exception"]
    action = decision["action"]

    logger.info(f"[execute_resolution] Action: {action} for {exc['trade_id']}")

    # ── Reject path ────────────────────────────────────────────────────────────
    if action == "reject":
        audit_entry = _audit(
            event_type="resolution_rejected",
            node="execute_resolution",
            details=f"Operator rejected proposal. Re-investigation triggered. Reason: {decision.get('modification', 'Not specified')}",
        )
        return {
            "status": "rejected",
            "audit_log": state.get("audit_log", []) + [audit_entry],
        }

    # ── Escalate path ──────────────────────────────────────────────────────────
    if action == "escalate":
        reason = decision.get("modification") or f"Escalated by {decision['operator_id']} — no modification note"
        audit_entry = _audit(
            event_type="case_escalated",
            node="execute_resolution",
            details=f"Case escalated to senior queue. Reason: {reason}",
        )
        return {
            "status": "escalated",
            "escalation_reason": reason,
            "audit_log": state.get("audit_log", []) + [audit_entry],
        }

    # ── Approve / Modify path ──────────────────────────────────────────────────
    # Both "approve" and "modify" result in execution.
    # For "modify", the modified_resolution from the operator is used instead.
    # HITL: This is the "steering" pattern — the human's modification is
    # treated as part of the agent's operating context.

    prompt = build_execution_confirmation_prompt(state)
    response = _get_llm().invoke([
        SystemMessage(content="You are confirming a trade exception resolution. Be concise and precise."),
        HumanMessage(content=prompt),
    ])

    execution_result = response.content.strip()

    audit_entry = _audit(
        event_type="resolution_executed",
        node="execute_resolution",
        details=f"Resolution executed — action: {action} — result: {execution_result[:100]}",
    )

    logger.info(f"[execute_resolution] Complete for {exc['trade_id']}")

    return {
        "status": "complete",
        "execution_result": execution_result,
        "audit_log": state.get("audit_log", []) + [audit_entry],
    }
