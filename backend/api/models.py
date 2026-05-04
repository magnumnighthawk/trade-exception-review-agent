"""
Pydantic models for API request/response contracts.

LEARNING: Keeping API models in one file enforces a clean boundary between
your agent's internal TypedDict state and what the HTTP layer exposes.
Never expose your raw LangGraph state over the wire — the API contract
should be stable even as the internal state schema evolves.

Two categories:
- Request models: what the frontend sends IN
- Response models: what the backend sends OUT (including SSE event shapes)
"""

from typing import Optional, Literal
from pydantic import BaseModel, Field


# ── Request models ─────────────────────────────────────────────────────────────

class StartReviewRequest(BaseModel):
    """
    POST /review/start — kick off a new agent run for a trade exception.
    """
    trade_id: str = Field(..., description="Trade ID to review, e.g. TRD-9821")
    operator_id: str = Field(default="operator_001", description="ID of the reviewing operator")


class HumanDecisionRequest(BaseModel):
    """
    POST /review/{thread_id}/decision — submit a human decision to resume
    the paused agent.

    LEARNING: This is the resume payload. The shape here must match exactly
    what propose_resolution_node expects back from interrupt().
    If you change this shape you must also update the interrupt() call in nodes.py.

    HITL: This is the contract between the UI's DecisionSurface and the backend.
    """
    action: Literal["approve", "reject", "modify", "escalate"]
    modification: Optional[str] = Field(
        default=None,
        description="Required when action is 'modify', optional context for 'reject'"
    )
    operator_id: str = Field(..., description="ID of the operator making this decision")


# ── SSE event models ───────────────────────────────────────────────────────────
# LEARNING: SSE events are just JSON strings sent over a text/event-stream response.
# We define their shapes here so both the backend (sender) and frontend (receiver)
# agree on the contract. The 'type' field acts as a discriminator — your frontend
# switch statement will branch on this.

class SSEEvent(BaseModel):
    """Base SSE event — every event has a type discriminator."""
    type: str


class TokenEvent(SSEEvent):
    """
    Emitted for each LLM token as it streams.
    LEARNING: This is the lowest-level streaming event. The frontend accumulates
    these into a string to show the agent "thinking" in real time.
    """
    type: Literal["token"] = "token"
    content: str
    node: str       # Which node is currently streaming


class NodeStartEvent(SSEEvent):
    """
    Emitted when a node begins executing.
    LEARNING: Use this to update a "current step" indicator in the UI.
    """
    type: Literal["node_start"] = "node_start"
    node: str
    message: str    # Human-readable description of what this node does


class NodeCompleteEvent(SSEEvent):
    """
    Emitted when a node finishes executing.
    """
    type: Literal["node_complete"] = "node_complete"
    node: str
    state_snapshot: Optional[dict] = None   # Partial state for the UI to display


class HitlInterruptEvent(SSEEvent):
    """
    Emitted when the agent hits interrupt() and is waiting for human input.

    HITL: This is the most important SSE event. When the frontend receives this,
    it MUST change status to "waiting_human" and render the DecisionSurface.
    The interrupt_payload contains everything the human needs to make a decision.
    """
    type: Literal["hitl_interrupt"] = "hitl_interrupt"
    thread_id: str
    interrupt_payload: dict     # The dict passed to interrupt() in propose_resolution_node


class CompleteEvent(SSEEvent):
    """
    Emitted when the agent finishes (complete, escalated, or error).
    """
    type: Literal["complete"] = "complete"
    status: str
    final_state: dict


class ErrorEvent(SSEEvent):
    """
    Emitted when the agent encounters an unrecoverable error.
    PRODUCTION: This should trigger an alert and surface a manual resolution path.
    """
    type: Literal["error"] = "error"
    message: str
    recoverable: bool = False


# ── Response models ────────────────────────────────────────────────────────────

class StartReviewResponse(BaseModel):
    thread_id: str
    trade_id: str
    message: str = "Agent started. Connect to /review/{thread_id}/stream for real-time updates."


class DecisionResponse(BaseModel):
    thread_id: str
    action: str
    status: str     # The new agent status after the decision was processed
    message: str


class QueueItem(BaseModel):
    """
    One entry in the paused-agents queue.

    LEARNING: This is what Panel 1 (ExceptionQueue) in the supervision UI
    renders for each paused agent. Sort by risk_level + confidence to give
    operators the most urgent cases first.
    """
    thread_id: str
    trade_id: str
    status: str
    risk_level: Optional[str] = None
    confidence: Optional[float] = None
    amount: Optional[float] = None
    counterparty: Optional[str] = None
    proposal_action: Optional[str] = None
    interrupt_payload: Optional[dict] = None    # Full payload for DecisionSurface
    paused_at: Optional[str] = None


class QueueResponse(BaseModel):
    items: list[QueueItem]
    total: int


class CheckpointStateResponse(BaseModel):
    """
    Lightweight checkpoint inspection payload.

    LEARNING: This response exposes a safe subset of LangGraph checkpoint
    internals so operators (and learners) can see whether a thread is paused,
    what node it was on, and which state keys currently exist.
    """
    thread_id: str
    has_checkpoint: bool
    has_interrupt: bool
    interrupt_count: int
    next_node: Optional[str] = None
    status: Optional[str] = None
    state_keys: list[str] = Field(default_factory=list)
    checkpointer_backend: str
