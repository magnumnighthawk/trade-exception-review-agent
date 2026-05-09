from typing import Optional, Literal, TypedDict, NotRequired


class Phase5Scenario(TypedDict, total=False):
    requires_information_request: bool
    information_request_question: str
    information_request_fields: list[str]
    force_low_confidence_proposal: float
    simulate_recoverable_execution_failure: bool
    recoverable_failure_message: str


class TradeException(TypedDict):
    trade_id: str
    type: Literal["settlement_fail", "iban_mismatch", "amount_discrepancy", "counterparty_mismatch"]
    amount: float
    counterparty: str
    reason: str
    flagged_at: str
    scenario: NotRequired[Phase5Scenario]


class InvestigationResult(TypedDict):
    root_cause: str
    evidence: list[str]
    suggested_action: str
    confidence: float


class ResolutionProposal(TypedDict):
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
    category: Literal["insufficient_information", "retry_limit", "execution_error", "manual_takeover"]
    failed_node: str
    message: str
    recoverable: bool
    retry_available: bool
    retry_count: int


class AuditEntry(TypedDict):
    timestamp: str
    event_type: str
    node: Optional[str]
    details: str


class TradeExceptionState(TypedDict):
    # ── Input ─────────────────────────────────────────────────────────────────
    exception: TradeException

    # ── Investigation phase ───────────────────────────────────────────────────
    investigation: Optional[InvestigationResult]
    investigation_attempts: int
    additional_context: Optional[dict[str, str]]

    # ── Proposal phase ────────────────────────────────────────────────────────
    proposal: Optional[ResolutionProposal]

    # ── Human decision phase ──────────────────────────────────────────────────
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
