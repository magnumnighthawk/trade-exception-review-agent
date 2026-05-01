"""
Queue endpoint — surfaces all paused agent threads to operators.

LEARNING: This is what feeds Panel 1 (ExceptionQueue) in the supervision UI.
The queue is the entry point for human operators — they see all threads
currently waiting for their input, sorted by urgency.

In a real system at scale, this endpoint would:
- Query Postgres for all threads with status='waiting_human'
- Join with trade data for enrichment
- Apply role-based access (operator only sees their assigned trades)
- Support pagination and filtering

For Phase 2, we query the in-memory state_store.

HITL: The queue is the supervision surface's first panel. Without it,
operators have no visibility into which agents need their attention.
This is the fleet management view.
"""

import logging
from fastapi import APIRouter
from backend.agent.graph import graph
from backend.api.models import QueueItem, QueueResponse
from backend.api.state_store import state_store

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/queue", tags=["queue"])


@router.get("/", response_model=QueueResponse)
async def get_queue():
    """
    Return all agent threads currently waiting for human input.

    LEARNING: We enrich state_store entries with interrupt_payload data
    (risk_level, confidence, amount, counterparty) so the UI can sort
    and prioritise without making additional requests.

    Sort order: critical → high → medium → low, then by paused_at (oldest first).
    This means the most dangerous cases bubble to the top.
    """
    risk_order = {"critical": 0, "high": 1, "medium": 2, "low": 3, None: 4}

    entries = state_store.all()
    items = []

    for entry in entries:
        payload = entry.get("interrupt_payload") or {}
        proposal = payload.get("proposal") or {}

        items.append(QueueItem(
            thread_id=entry["thread_id"],
            trade_id=entry["trade_id"],
            status=entry["status"],
            risk_level=proposal.get("risk_level"),
            confidence=payload.get("confidence"),
            amount=payload.get("amount"),
            counterparty=_get_counterparty(entry["trade_id"]),
            proposal_action=proposal.get("action"),
            interrupt_payload=payload if entry["status"] == "waiting_human" else None,
            paused_at=entry.get("paused_at"),
        ))

    # Sort: waiting_human first, then by risk level
    items.sort(key=lambda x: (
        0 if x.status == "waiting_human" else 1,
        risk_order.get(x.risk_level, 4),
        x.paused_at or "",
    ))

    return QueueResponse(items=items, total=len(items))


@router.get("/waiting", response_model=QueueResponse)
async def get_waiting_queue():
    """Return only threads actively waiting for human input."""
    full = await get_queue()
    waiting = [item for item in full.items if item.status == "waiting_human"]
    return QueueResponse(items=waiting, total=len(waiting))


@router.get("/{thread_id}", response_model=QueueItem)
async def get_thread_status(thread_id: str):
    """Get status of a specific thread — used by the frontend to poll after decision."""
    from fastapi import HTTPException
    entry = state_store.get(thread_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Thread {thread_id} not found")

    payload = entry.get("interrupt_payload") or {}
    proposal = payload.get("proposal") or {}

    return QueueItem(
        thread_id=entry["thread_id"],
        trade_id=entry["trade_id"],
        status=entry["status"],
        risk_level=proposal.get("risk_level"),
        confidence=payload.get("confidence"),
        amount=payload.get("amount"),
        counterparty=_get_counterparty(entry["trade_id"]),
        proposal_action=proposal.get("action"),
        interrupt_payload=payload if entry["status"] == "waiting_human" else None,
        paused_at=entry.get("paused_at"),
    )


def _get_counterparty(trade_id: str) -> str | None:
    """Look up counterparty from fixtures — avoids circular imports."""
    try:
        from backend.agent.fixtures import get_exception
        return get_exception(trade_id).get("counterparty")
    except Exception:
        return None
