"""
State definition for the Trade Exception Review Agent.

LEARNING: In LangGraph, state is the single source of truth that flows
through every node. Think of it as the "memory" of one agent run.
Every node reads from state and returns a partial dict to merge back into it.

This file is intentionally the first thing you read and understand before
touching any node or graph code. If the state is well-designed, everything
else falls into place.
"""

from typing import Optional, Literal, TypedDict


class TradeException(TypedDict):
    """
    A raw trade exception as it arrives from the upstream system.

    LEARNING: In a real system this would come from a settlement platform
    (e.g. DTCC, Euroclear). Here we define it explicitly so the agent
    has a typed contract on what it can expect to receive.
    """
    trade_id: str
    type: Literal["settlement_fail", "iban_mismatch", "amount_discrepancy", "counterparty_mismatch"]
    amount: float               # USD value of the trade
    counterparty: str           # The other side of the trade
    reason: str                 # Human-readable description of why it was flagged
    flagged_at: str             # ISO 8601 timestamp


class InvestigationResult(TypedDict):
    """
    The output of the investigate_node.

    LEARNING: Breaking compound outputs into sub-TypedDicts keeps your
    state readable. You could flatten everything into TradeExceptionState,
    but nested types document intent better.
    """
    root_cause: str             # What the agent determined caused the exception
    evidence: list[str]         # Specific facts gathered during investigation
    suggested_action: str       # Initial suggested fix (not the final proposal)
    confidence: float           # 0.0–1.0 — how sure the agent is of its finding


class ResolutionProposal(TypedDict):
    """
    The formal proposal the agent makes before asking for human approval.

    LEARNING: This is what gets shown in the UI's DecisionSurface.
    Every field here maps to something the human sees and can act on.
    """
    action: str                 # e.g. "Update IBAN and retry settlement"
    details: str                # Step-by-step breakdown of what will happen
    confidence: float           # Confidence in this specific resolution
    requires_human_approval: bool   # Derived from confidence + amount threshold
    risk_level: Literal["low", "medium", "high", "critical"]


class HumanDecision(TypedDict):
    """
    The decision returned by the human operator after reviewing the proposal.

    LEARNING: This is the output of the HITL interrupt. The agent
    receives exactly this shape back when execution resumes.
    Notice we include `modification` — this is the steering pattern.
    The human doesn't just say yes/no; they can change what happens next.
    """
    action: Literal["approve", "reject", "modify", "escalate"]
    modification: Optional[str]     # Only set if action == "modify"
    operator_id: str                # PRODUCTION: who made this decision
    decided_at: str                 # ISO 8601 timestamp — audit trail


class AuditEntry(TypedDict):
    """
    An immutable record of a state transition or decision.

    PRODUCTION: In a real system, audit entries would be written to an
    append-only store (e.g. Postgres with no UPDATE permissions for the
    agent service account). This is non-negotiable in regulated environments.
    """
    timestamp: str
    event_type: str             # "node_entered", "hitl_interrupt", "decision_received", etc.
    node: Optional[str]
    details: str


class TradeExceptionState(TypedDict):
    """
    The full state of one Trade Exception Review agent run.

    LEARNING: This is the most important type in the codebase.
    Every node function receives this as input and returns a subset of
    these keys as output. LangGraph merges the returned dict back into
    this state — fields not returned by a node are left unchanged.

    TRADE-OFF: We could split this into separate state objects per phase
    (investigation state, proposal state, etc.) using LangGraph's
    Send/subgraph patterns. We use a flat structure here to keep the
    learning curve manageable in Phase 1. In production, you'd likely
    split after the complexity grows.
    """

    # ── Input ─────────────────────────────────────────────────────────────────
    exception: TradeException           # The flagged trade — set once, never mutated

    # ── Investigation phase ───────────────────────────────────────────────────
    investigation: Optional[InvestigationResult]    # Set by investigate_node
    investigation_attempts: int                     # Track retries (starts at 0)

    # ── Proposal phase ────────────────────────────────────────────────────────
    proposal: Optional[ResolutionProposal]          # Set by propose_resolution_node

    # ── HITL phase ────────────────────────────────────────────────────────────
    # HITL: This field is written by the human via the decision endpoint
    # and read by every downstream node to determine what happens next.
    human_decision: Optional[HumanDecision]

    # ── Execution phase ───────────────────────────────────────────────────────
    execution_result: Optional[str]     # Confirmation / error message from execution
    escalation_reason: Optional[str]    # Set when escalated — explains why

    # ── Metadata ──────────────────────────────────────────────────────────────
    thread_id: str                      # LangGraph thread — the reconnection key
    status: Literal[
        "received",         # Exception received, not yet investigated
        "investigating",    # investigate_node is running
        "awaiting_human",   # Proposal ready, waiting for human decision
        "executing",        # execute_resolution_node is running
        "complete",         # Happy path end state
        "rejected",         # Human rejected — may trigger re-investigation
        "escalated",        # Human escalated — out of this agent's hands
        "error",            # Something went wrong
    ]
    audit_log: list[AuditEntry]         # Full immutable record of this run
