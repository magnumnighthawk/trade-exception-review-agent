"""
State definition for the Trade Exception Review Agent.

LEARNING: In LangGraph, state is the single source of truth that flows
through every node. Think of it as the "memory" of one agent run.
Every node reads from state and returns a partial dict to merge back into it.

This file is intentionally the first thing you read and understand before
touching any node or graph code. If the state is well-designed, everything
else falls into place.
"""

from typing import Optional, Literal, TypedDict, NotRequired


class Phase5Scenario(TypedDict, total=False):
    """
    Deterministic learning scenarios used by fixtures and validation scripts.

    LEARNING: We keep these hooks data-driven so Phase 5 paths can be exercised
    predictably without relying on the LLM to "happen" to fail in the right way.
    """

    requires_information_request: bool
    information_request_question: str
    information_request_fields: list[str]
    force_low_confidence_proposal: float
    simulate_recoverable_execution_failure: bool
    recoverable_failure_message: str


class TradeException(TypedDict):
    """
    A raw trade exception as it arrives from the upstream system.

    LEARNING: In a real system this would come from a settlement platform
    (e.g. DTCC, Euroclear). Here we define it explicitly so the agent
    has a typed contract on what it can expect to receive.
    """

    trade_id: str
    type: Literal["settlement_fail", "iban_mismatch", "amount_discrepancy", "counterparty_mismatch"]
    amount: float
    counterparty: str
    reason: str
    flagged_at: str
    scenario: NotRequired[Phase5Scenario]


class InvestigationResult(TypedDict):
    """
    The output of the investigate_node.

    LEARNING: Breaking compound outputs into sub-TypedDicts keeps your
    state readable. You could flatten everything into TradeExceptionState,
    but nested types document intent better.
    """

    root_cause: str
    evidence: list[str]
    suggested_action: str
    confidence: float


class ResolutionProposal(TypedDict):
    """
    The formal proposal the agent makes before asking for human approval.

    LEARNING: This is what gets shown in the UI's DecisionSurface.
    Every field here maps to something the human sees and can act on.
    """

    action: str
    details: str
    confidence: float
    requires_human_approval: bool
    risk_level: Literal["low", "medium", "high", "critical"]


class ReviewPolicy(TypedDict):
    """Policy thresholds surfaced to the supervision UI."""

    low_confidence_threshold: float
    high_confidence_threshold: float
    max_investigation_attempts: int
    max_execution_retries: int


class HumanDecision(TypedDict):
    """
    The decision returned by the human operator after reviewing an intervention.

    LEARNING: Phase 5 broadens human input beyond proposal review. The same
    interrupt/resume contract now supports proposal review, information supply,
    and recovery/manual takeover decisions.
    """

    action: Literal[
        "approve",
        "reject",
        "modify",
        "escalate",
        "provide_context",
        "retry",
        "manual_takeover",
    ]
    operator_id: str
    decided_at: str
    modification: NotRequired[Optional[str]]
    reason: NotRequired[Optional[str]]
    confidence_before: NotRequired[Optional[float]]
    escalation_category: NotRequired[Optional[str]]
    context_fields: NotRequired[Optional[dict[str, str]]]


class FailureContext(TypedDict):
    """
    Structured explanation of why the agent stopped or handed off.

    PRODUCTION: This is the kernel of the failure record you'd persist to your
    incident / ops database so humans know whether the agent is safe to retry.
    """

    category: Literal["insufficient_information", "retry_limit", "execution_error", "manual_takeover"]
    failed_node: str
    message: str
    recoverable: bool
    retry_available: bool
    retry_count: int


class AuditEntry(TypedDict):
    """
    An immutable record of a state transition or decision.

    PRODUCTION: In a real system, audit entries would be written to an
    append-only store (e.g. Postgres with no UPDATE permissions for the
    agent service account). This is non-negotiable in regulated environments.
    """

    timestamp: str
    event_type: str
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
    learning curve manageable. In production, you'd likely split after
    the complexity grows.
    """

    # ── Input ─────────────────────────────────────────────────────────────────
    exception: TradeException

    # ── Investigation phase ───────────────────────────────────────────────────
    investigation: Optional[InvestigationResult]
    investigation_attempts: int
    additional_context: Optional[dict[str, str]]

    # ── Proposal phase ────────────────────────────────────────────────────────
    proposal: Optional[ResolutionProposal]

    # ── HITL phase ────────────────────────────────────────────────────────────
    # HITL: This field stores the proposal-review decision that governs the
    # main execution branch. Information-request and recovery decisions are
    # handled locally in their nodes but still audited separately.
    human_decision: Optional[HumanDecision]

    # ── Execution / recovery phase ────────────────────────────────────────────
    execution_result: Optional[str]
    execution_attempts: int
    escalation_reason: Optional[str]
    failure_context: Optional[FailureContext]
    manual_takeover_note: Optional[str]

    # ── Metadata ──────────────────────────────────────────────────────────────
    thread_id: str
    status: Literal[
        "received",
        "investigating",
        "awaiting_human",
        "executing",
        "complete",
        "rejected",
        "escalated",
        "manual_takeover",
        "error",
    ]
    audit_log: list[AuditEntry]
