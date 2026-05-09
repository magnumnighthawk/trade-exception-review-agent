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

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.types import interrupt

from backend.agent.policy import (
    MAX_EXECUTION_RETRIES,
    MAX_INVESTIGATION_ATTEMPTS,
    approval_locked,
    build_review_policy,
)
from backend.agent.prompts import (
    build_execution_confirmation_prompt,
    build_investigation_prompt,
    build_proposal_prompt,
)
from backend.agent.state import AuditEntry, FailureContext, TradeExceptionState

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _get_llm() -> ChatOpenAI:
    """
    LEARNING: We use lazy initialisation via lru_cache rather than a module-level
    global. This means the LLM client is only created the first time a node runs,
    not at import time. This makes the module importable even without an API key
    set — useful for testing, CI, and import-time graph compilation.
    """

    from dotenv import load_dotenv

    load_dotenv("backend/.env")
    return ChatOpenAI(model="gpt-4o", temperature=0)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _audit(event_type: str, node: str | None, details: str) -> AuditEntry:
    return AuditEntry(
        timestamp=_now(),
        event_type=event_type,
        node=node,
        details=details,
    )


def _parse_llm_json(raw: str, node_name: str) -> dict:
    try:
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            cleaned = "\n".join(lines[1:-1])
        return json.loads(cleaned)
    except json.JSONDecodeError as error:
        logger.error("[%s] Failed to parse LLM JSON: %s\nRaw output: %s", node_name, error, raw)
        raise ValueError(f"LLM returned invalid JSON in {node_name}") from error


def _scenario(state: TradeExceptionState) -> dict:
    return state["exception"].get("scenario") or {}


def _format_context_summary(context_fields: dict[str, str]) -> str:
    return ", ".join(f"{key}={value}" for key, value in context_fields.items())


def _build_failure_context(
    *,
    category: str,
    failed_node: str,
    message: str,
    recoverable: bool,
    retry_available: bool,
    retry_count: int,
) -> FailureContext:
    return FailureContext(
        category=category,
        failed_node=failed_node,
        message=message,
        recoverable=recoverable,
        retry_available=retry_available,
        retry_count=retry_count,
    )


def _needs_information_request(state: TradeExceptionState) -> bool:
    scenario = _scenario(state)
    return bool(scenario.get("requires_information_request")) and not state.get("additional_context")


def _build_information_request_payload(state: TradeExceptionState, attempt: int) -> dict:
    scenario = _scenario(state)
    fields_needed = scenario.get("information_request_fields") or ["source_of_truth"]
    question = scenario.get("information_request_question") or (
        "The agent cannot resolve this exception safely. Please provide the source-of-truth details needed to continue."
    )

    return {
        "kind": "information_request",
        "trade_id": state["exception"]["trade_id"],
        "question": question,
        "fields_needed": fields_needed,
        "attempt": attempt,
        "context_summary": state["exception"]["reason"],
        "policy": build_review_policy(),
    }


def _apply_proposal_policy(state: TradeExceptionState, proposal: dict) -> dict:
    scenario = _scenario(state)
    forced_confidence = scenario.get("force_low_confidence_proposal")
    if forced_confidence is not None:
        proposal["confidence"] = forced_confidence

    proposal["requires_human_approval"] = True
    return proposal


def _build_proposal_interrupt_payload(state: TradeExceptionState, proposal: dict) -> dict:
    exc = state["exception"]
    investigation = state["investigation"]

    return {
        "kind": "proposal_review",
        "trade_id": exc["trade_id"],
        "proposal": proposal,
        "investigation_summary": investigation["root_cause"],
        "confidence": proposal["confidence"],
        "risk_level": proposal["risk_level"],
        "amount": exc["amount"],
        "policy": build_review_policy(),
    }


def _build_failure_recovery_payload(
    state: TradeExceptionState,
    *,
    failure_context: FailureContext,
) -> dict:
    exc = state["exception"]
    latest_proposal = state.get("proposal")

    return {
        "kind": "failure_recovery",
        "trade_id": exc["trade_id"],
        "failed_node": failure_context["failed_node"],
        "error_message": failure_context["message"],
        "recoverable": failure_context["recoverable"],
        "retry_available": failure_context["retry_available"],
        "retry_count": failure_context["retry_count"],
        "latest_proposal": latest_proposal,
        "policy": build_review_policy(),
    }


# ── Node 1: Receive Exception ──────────────────────────────────────────────────

def receive_exception_node(state: TradeExceptionState) -> dict:
    exc = state["exception"]
    logger.info("[receive_exception] Received exception %s", exc["trade_id"])

    audit_entry = _audit(
        event_type="exception_received",
        node="receive_exception",
        details=f"Exception {exc['trade_id']} received — type: {exc['type']}, amount: {exc['amount']:,.2f}",
    )

    return {
        "status": "received",
        "investigation_attempts": 0,
        "execution_attempts": 0,
        "investigation": state.get("investigation"),
        "proposal": state.get("proposal"),
        "human_decision": state.get("human_decision"),
        "additional_context": state.get("additional_context"),
        "execution_result": state.get("execution_result"),
        "escalation_reason": state.get("escalation_reason"),
        "failure_context": state.get("failure_context"),
        "manual_takeover_note": state.get("manual_takeover_note"),
        "audit_log": state.get("audit_log", []) + [audit_entry],
    }


# ── Node 2: Investigate ────────────────────────────────────────────────────────

def investigate_node(state: TradeExceptionState) -> dict:
    exc = state["exception"]
    attempt = state.get("investigation_attempts", 0) + 1
    logger.info("[investigate] Starting investigation attempt %s for %s", attempt, exc["trade_id"])

    if attempt > MAX_INVESTIGATION_ATTEMPTS:
        reason = f"Retry ceiling reached after {state.get('investigation_attempts', 0)} investigation attempts."
        failure_context = _build_failure_context(
            category="retry_limit",
            failed_node="investigate",
            message=reason,
            recoverable=False,
            retry_available=False,
            retry_count=state.get("investigation_attempts", 0),
        )
        audit_entry = _audit(
            event_type="manual_takeover_required",
            node="investigate",
            details=reason,
        )
        return {
            "status": "manual_takeover",
            "failure_context": failure_context,
            "manual_takeover_note": reason,
            "audit_log": state.get("audit_log", []) + [audit_entry],
        }

    audit_entries: list[AuditEntry] = []
    additional_context = dict(state.get("additional_context") or {})

    if _needs_information_request(state):
        request_payload = _build_information_request_payload(state, attempt)
        request_audit = _audit(
            event_type="information_requested",
            node="investigate",
            details=f"Agent requested additional context: {request_payload['question']}",
        )

        # HITL: The agent cannot safely investigate further without a human
        # supplying a source-of-truth answer, so execution is checkpointed here.
        human_response = interrupt(request_payload)

        if human_response["action"] == "escalate":
            reason = human_response.get("reason") or "Escalated during information request."
            failure_context = _build_failure_context(
                category="insufficient_information",
                failed_node="investigate",
                message=reason,
                recoverable=False,
                retry_available=False,
                retry_count=attempt - 1,
            )
            response_audit = _audit(
                event_type="information_request_escalated",
                node="investigate",
                details=reason,
            )
            return {
                "status": "escalated",
                "escalation_reason": reason,
                "failure_context": failure_context,
                "audit_log": state.get("audit_log", []) + [request_audit, response_audit],
            }

        context_fields = human_response.get("context_fields") or {}
        additional_context.update(context_fields)
        response_audit = _audit(
            event_type="information_received",
            node="investigate",
            details=f"Operator provided context: {_format_context_summary(context_fields)}",
        )
        audit_entries.extend([request_audit, response_audit])

    working_state: TradeExceptionState = {
        **state,
        "additional_context": additional_context or None,
        "investigation_attempts": attempt,
    }

    prompt = build_investigation_prompt(working_state)
    response = _get_llm().invoke(
        [
            SystemMessage(content="You are a trade exception specialist. Respond with valid JSON only."),
            HumanMessage(content=prompt),
        ]
    )

    result = _parse_llm_json(response.content, "investigate_node")

    audit_entry = _audit(
        event_type="investigation_complete",
        node="investigate",
        details=f"Attempt {attempt} — root cause: {result['root_cause'][:80]} — confidence: {result['confidence']}",
    )

    logger.info("[investigate] Confidence: %s — %s", result["confidence"], result["root_cause"][:60])

    return {
        "status": "investigating",
        "investigation": result,
        "investigation_attempts": attempt,
        "additional_context": additional_context or None,
        "failure_context": None,
        "manual_takeover_note": None,
        "audit_log": state.get("audit_log", []) + audit_entries + [audit_entry],
    }


# ── Node 3: Propose Resolution ─────────────────────────────────────────────────

def propose_resolution_node(state: TradeExceptionState) -> dict:
    exc = state["exception"]
    logger.info("[propose_resolution] Building proposal for %s", exc["trade_id"])

    prompt = build_proposal_prompt(state)
    response = _get_llm().invoke(
        [
            SystemMessage(content="You are a trade exception specialist. Respond with valid JSON only."),
            HumanMessage(content=prompt),
        ]
    )

    proposal = _apply_proposal_policy(state, _parse_llm_json(response.content, "propose_resolution_node"))

    audit_entry = _audit(
        event_type="proposal_ready",
        node="propose_resolution",
        details=f"Proposal: {proposal['action']} — confidence: {proposal['confidence']} — risk: {proposal['risk_level']}",
    )

    logger.info("[propose_resolution] Proposal ready — confidence: %s", proposal["confidence"])

    # HITL: Proposal review remains the primary approval gate, but Phase 5 now
    # attaches typed policy metadata so the frontend and backend enforce the same rules.
    human_decision = interrupt(_build_proposal_interrupt_payload(state, proposal))

    decision_audit = _audit(
        event_type="human_decision_received",
        node="propose_resolution",
        details=f"Operator {human_decision.get('operator_id', 'unknown')} decided: {human_decision['action']}",
    )

    return {
        "proposal": proposal,
        "human_decision": human_decision,
        "status": "awaiting_human",
        "failure_context": None,
        "audit_log": state.get("audit_log", []) + [audit_entry, decision_audit],
    }


# ── Node 4: Execute Resolution ─────────────────────────────────────────────────

def execute_resolution_node(state: TradeExceptionState) -> dict:
    decision = state["human_decision"]
    exc = state["exception"]
    action = decision["action"]

    logger.info("[execute_resolution] Action: %s for %s", action, exc["trade_id"])

    if action == "reject":
        if state.get("investigation_attempts", 0) >= MAX_INVESTIGATION_ATTEMPTS:
            reason = (
                f"Proposal rejected after {state.get('investigation_attempts', 0)} investigation attempts. "
                "Case handed to human operator for manual resolution."
            )
            failure_context = _build_failure_context(
                category="retry_limit",
                failed_node="execute_resolution",
                message=reason,
                recoverable=False,
                retry_available=False,
                retry_count=state.get("investigation_attempts", 0),
            )
            audit_entry = _audit(
                event_type="manual_takeover_required",
                node="execute_resolution",
                details=reason,
            )
            return {
                "status": "manual_takeover",
                "failure_context": failure_context,
                "manual_takeover_note": reason,
                "audit_log": state.get("audit_log", []) + [audit_entry],
            }

        audit_entry = _audit(
            event_type="resolution_rejected",
            node="execute_resolution",
            details=f"Operator rejected proposal. Re-investigation triggered. Reason: {decision.get('modification', 'Not specified')}",
        )
        return {
            "status": "rejected",
            "failure_context": None,
            "audit_log": state.get("audit_log", []) + [audit_entry],
        }

    if action == "escalate":
        reason = decision.get("reason") or decision.get("modification") or (
            f"Escalated by {decision['operator_id']} — no additional note"
        )
        audit_entry = _audit(
            event_type="case_escalated",
            node="execute_resolution",
            details=f"Case escalated to senior queue. Reason: {reason}",
        )
        return {
            "status": "escalated",
            "escalation_reason": reason,
            "failure_context": None,
            "audit_log": state.get("audit_log", []) + [audit_entry],
        }

    execution_attempt = state.get("execution_attempts", 0) + 1
    audit_entries: list[AuditEntry] = []
    scenario = _scenario(state)

    if scenario.get("simulate_recoverable_execution_failure") and execution_attempt == 1:
        failure_message = scenario.get("recoverable_failure_message") or (
            "Execution confirmation step failed before settlement could be confirmed."
        )
        failure_context = _build_failure_context(
            category="execution_error",
            failed_node="execute_resolution",
            message=failure_message,
            recoverable=True,
            retry_available=execution_attempt < MAX_EXECUTION_RETRIES,
            retry_count=execution_attempt,
        )
        request_audit = _audit(
            event_type="recovery_requested",
            node="execute_resolution",
            details=failure_message,
        )

        # HITL: A recoverable execution failure does not silently flip to error.
        # The human is asked whether to retry, take manual control, or escalate.
        recovery_decision = interrupt(
            _build_failure_recovery_payload(
                state,
                failure_context=failure_context,
            )
        )

        if recovery_decision["action"] == "manual_takeover":
            note = recovery_decision.get("reason") or recovery_decision.get("modification") or (
                "Operator took manual ownership after recoverable execution failure."
            )
            response_audit = _audit(
                event_type="manual_takeover_confirmed",
                node="execute_resolution",
                details=note,
            )
            return {
                "status": "manual_takeover",
                "execution_attempts": execution_attempt,
                "failure_context": {
                    **failure_context,
                    "category": "manual_takeover",
                    "recoverable": False,
                    "retry_available": False,
                },
                "manual_takeover_note": note,
                "audit_log": state.get("audit_log", []) + [request_audit, response_audit],
            }

        if recovery_decision["action"] == "escalate":
            reason = recovery_decision.get("reason") or "Escalated after recoverable execution failure."
            response_audit = _audit(
                event_type="recovery_escalated",
                node="execute_resolution",
                details=reason,
            )
            return {
                "status": "escalated",
                "execution_attempts": execution_attempt,
                "escalation_reason": reason,
                "failure_context": {
                    **failure_context,
                    "recoverable": False,
                    "retry_available": False,
                },
                "audit_log": state.get("audit_log", []) + [request_audit, response_audit],
            }

        response_audit = _audit(
            event_type="recovery_retry_approved",
            node="execute_resolution",
            details=f"Operator {recovery_decision.get('operator_id', 'unknown')} approved retry.",
        )
        audit_entries.extend([request_audit, response_audit])

    prompt = build_execution_confirmation_prompt(state)
    response = _get_llm().invoke(
        [
            SystemMessage(content="You are confirming a trade exception resolution. Be concise and precise."),
            HumanMessage(content=prompt),
        ]
    )

    execution_result = response.content.strip()

    audit_entry = _audit(
        event_type="resolution_executed",
        node="execute_resolution",
        details=f"Resolution executed — action: {action} — result: {execution_result[:100]}",
    )

    logger.info("[execute_resolution] Complete for %s", exc["trade_id"])

    return {
        "status": "complete",
        "execution_result": execution_result,
        "execution_attempts": execution_attempt,
        "failure_context": None,
        "manual_takeover_note": None,
        "audit_log": state.get("audit_log", []) + audit_entries + [audit_entry],
    }
