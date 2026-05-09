from typing import Literal, Optional

from pydantic import BaseModel, Field


DecisionAction = Literal[
    "approve",
    "reject",
    "modify",
    "escalate",
    "provide_context",
    "retry",
    "manual_takeover",
]

InterventionKind = Literal["proposal_review", "information_request", "failure_recovery"]


# ── Request models ─────────────────────────────────────────────────────────────

class StartReviewRequest(BaseModel):
    """POST /review/start — kick off a new agent run for a trade exception."""

    trade_id: str = Field(..., description="Trade ID to review, e.g. TRD-9821")
    operator_id: str = Field(default="operator_001", description="ID of the reviewing operator")


class HumanDecisionRequest(BaseModel):
    """POST /review/{thread_id}/decision payload."""

    action: DecisionAction
    modification: Optional[str] = Field(
        default=None,
        description="Freeform steering / rejection / manual-takeover note",
    )
    operator_id: str = Field(..., description="ID of the operator making this decision")
    reason: Optional[str] = Field(default=None, description="Why the operator made this decision")
    confidence_before: Optional[float] = Field(default=None, description="Agent confidence before decision")
    escalation_category: Optional[str] = Field(default=None, description="Where to escalate the case")
    context_fields: Optional[dict[str, str]] = Field(
        default=None,
        description="Structured source-of-truth fields supplied during an information request",
    )


# ── Shared payload models ──────────────────────────────────────────────────────

class ReviewPolicyPayload(BaseModel):
    low_confidence_threshold: float
    high_confidence_threshold: float
    max_investigation_attempts: int
    max_execution_retries: int


class ProposalPayload(BaseModel):
    action: str
    details: str
    confidence: float
    requires_human_approval: bool
    risk_level: Literal["low", "medium", "high", "critical"]


class ProposalReviewInterruptPayload(BaseModel):
    kind: Literal["proposal_review"] = "proposal_review"
    trade_id: str
    proposal: ProposalPayload
    investigation_summary: str
    confidence: float
    risk_level: Literal["low", "medium", "high", "critical"]
    amount: float
    policy: ReviewPolicyPayload


class InformationRequestInterruptPayload(BaseModel):
    kind: Literal["information_request"] = "information_request"
    trade_id: str
    question: str
    fields_needed: list[str]
    attempt: int
    context_summary: str
    policy: ReviewPolicyPayload


class FailureRecoveryInterruptPayload(BaseModel):
    kind: Literal["failure_recovery"] = "failure_recovery"
    trade_id: str
    failed_node: str
    error_message: str
    recoverable: bool
    retry_available: bool
    retry_count: int
    latest_proposal: Optional[ProposalPayload] = None
    policy: ReviewPolicyPayload


InterruptPayload = (
    ProposalReviewInterruptPayload | InformationRequestInterruptPayload | FailureRecoveryInterruptPayload
)


# ── SSE event models ───────────────────────────────────────────────────────────

class SSEEvent(BaseModel):
    """Base SSE event — every event has a type discriminator."""

    type: str


class TokenEvent(SSEEvent):
    type: Literal["token"] = "token"
    content: str
    node: str


class NodeStartEvent(SSEEvent):
    type: Literal["node_start"] = "node_start"
    node: str
    message: str


class NodeCompleteEvent(SSEEvent):
    type: Literal["node_complete"] = "node_complete"
    node: str
    state_snapshot: Optional[dict] = None


class HitlInterruptEvent(SSEEvent):
    """Emitted when the agent pauses for human intervention."""

    type: Literal["hitl_interrupt"] = "hitl_interrupt"
    thread_id: str
    interrupt_payload: InterruptPayload


class CompleteEvent(SSEEvent):
    type: Literal["complete"] = "complete"
    status: str
    final_state: dict


class ErrorEvent(SSEEvent):
    type: Literal["error"] = "error"
    message: str
    recoverable: bool = False
    failure_context: Optional[dict] = None


# ── Response models ────────────────────────────────────────────────────────────

class StartReviewResponse(BaseModel):
    thread_id: str
    trade_id: str
    message: str = "Agent started. Connect to /review/{thread_id}/stream for real-time updates."


class DecisionResponse(BaseModel):
    thread_id: str
    action: str
    status: str
    message: str


class QueueItem(BaseModel):
    """One entry in the supervision queue."""

    thread_id: Optional[str] = None
    trade_id: str
    status: str
    risk_level: Optional[str] = None
    confidence: Optional[float] = None
    amount: Optional[float] = None
    counterparty: Optional[str] = None
    proposal_action: Optional[str] = None
    intervention_kind: Optional[InterventionKind] = None
    interrupt_payload: Optional[InterruptPayload] = None
    paused_at: Optional[str] = None


class QueueResponse(BaseModel):
    items: list[QueueItem]
    total: int


class ThreadStageResponse(BaseModel):
    stage_id: str
    node: str
    message: str
    attempt: int
    status: Literal["running", "complete", "error"]
    tokens: str = ""
    state_snapshot: Optional[dict] = None
    started_at: str
    completed_at: Optional[str] = None


class ThreadDetailResponse(BaseModel):
    thread_id: str
    trade_id: str
    status: str
    current_node: Optional[str] = None
    intervention_kind: Optional[InterventionKind] = None
    interrupt_payload: Optional[InterruptPayload] = None
    final_state: Optional[dict] = None
    error: Optional[str] = None
    failure_context: Optional[dict] = None
    manual_takeover_note: Optional[str] = None
    paused_at: Optional[str] = None
    stage_history: list[ThreadStageResponse] = Field(default_factory=list)


class CheckpointStateResponse(BaseModel):
    thread_id: str
    has_checkpoint: bool
    has_interrupt: bool
    interrupt_count: int
    next_node: Optional[str] = None
    status: Optional[str] = None
    state_keys: list[str] = Field(default_factory=list)
    checkpointer_backend: str


# ── Audit trail models ────────────────────────────────────────────────────────

class AuditEntryResponse(BaseModel):
    audit_entry_id: str
    timestamp: str
    operator_id: str
    thread_id: str
    trade_id: str
    decision: DecisionAction
    modification: Optional[str] = None
    reason: Optional[str] = None
    confidence_before: Optional[float] = None
    agent_proposal_before: Optional[str] = None
    escalation_category: Optional[str] = None
    context_fields: Optional[dict[str, str]] = None


class AuditLogResponse(BaseModel):
    thread_id: str
    trade_id: str
    audit_entries: list[AuditEntryResponse]
    total_entries: int


class SubmitDecisionRequest(BaseModel):
    thread_id: str
    operator_id: str
    decision: DecisionAction
    modification: Optional[str] = None
    reason: Optional[str] = None
    confidence_before: Optional[float] = None
    agent_proposal_before: Optional[str] = None
    escalation_category: Optional[str] = None
    context_fields: Optional[dict[str, str]] = None


class SubmitDecisionResponse(BaseModel):
    audit_entry_id: str
    timestamp: str
    message: str = "Decision logged"
