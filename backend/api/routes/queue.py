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

Phase 4: Added audit endpoints (GET /queue/audit, POST /queue/audit)
to log and retrieve operator decisions for compliance.
"""

import logging
from fastapi import APIRouter, HTTPException
from backend.agent.graph import graph
from backend.api.models import (
    QueueItem, QueueResponse, AuditEntryResponse, AuditLogResponse,
    SubmitDecisionRequest, SubmitDecisionResponse
)
from backend.api.state_store import state_store
from backend.api.audit_store import audit_store

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


# ── Audit endpoints (Phase 4) ──────────────────────────────────────────────

@router.get("/audit/{thread_id}", response_model=AuditLogResponse)
async def get_audit_log(thread_id: str, limit: int = 50):
    """
    GET /queue/audit/{thread_id} — retrieve decision history for a thread.

    HITL: Operators see this when they click into a thread. It shows:
    - All previous decisions on this thread
    - Why each operator decided (the reason field)
    - If it was modified, what the modification was
    This is full traceability for compliance.
    """
    entry = state_store.get(thread_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Thread {thread_id} not found")

    audit_entries = audit_store.get_entries_for_thread(thread_id)
    if limit:
        audit_entries = audit_entries[-limit:]

    audit_responses = [
        AuditEntryResponse(
            audit_entry_id=e.audit_entry_id,
            timestamp=e.timestamp,
            operator_id=e.operator_id,
            thread_id=e.thread_id,
            trade_id=e.trade_id,
            decision=e.decision,
            modification=e.modification,
            reason=e.reason,
            confidence_before=e.confidence_before,
            agent_proposal_before=e.agent_proposal_before,
            escalation_category=e.escalation_category,
        )
        for e in audit_entries
    ]

    return AuditLogResponse(
        thread_id=thread_id,
        trade_id=entry["trade_id"],
        audit_entries=audit_responses,
        total_entries=len(audit_responses),
    )


@router.post("/audit", response_model=SubmitDecisionResponse)
async def submit_audit_entry(req: SubmitDecisionRequest):
    """
    POST /queue/audit — log a human decision to the audit trail.

    Phase 4: When a human submits a decision via DecisionSurface,
    this endpoint logs it to the immutable audit trail.

    PRODUCTION: This would write to an append-only database table
    with no UPDATE/DELETE permissions for the agent service account.
    Regulators audit this table during compliance reviews.
    """
    entry = state_store.get(req.thread_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Thread {req.thread_id} not found")

    trade_id = entry.get("trade_id", "unknown")

    # Log to audit trail (append-only)
    audit_entry = audit_store.log_decision(
        thread_id=req.thread_id,
        trade_id=trade_id,
        operator_id=req.operator_id,
        decision=req.decision,
        modification=req.modification,
        reason=req.reason,
        confidence_before=req.confidence_before,
        agent_proposal_before=req.agent_proposal_before,
        escalation_category=req.escalation_category,
    )

    logger.info(
        f"[audit] Logged decision: thread={req.thread_id} decision={req.decision} "
        f"operator={req.operator_id}"
    )

    return SubmitDecisionResponse(
        audit_entry_id=audit_entry.audit_entry_id,
        timestamp=audit_entry.timestamp,
        message=f"Decision logged: {req.decision}",
    )


@router.get("/audit/trade/{trade_id}", response_model=list[AuditEntryResponse])
async def get_audit_history_for_trade(trade_id: str, limit: int = 100):
    """
    GET /queue/audit/trade/{trade_id} — retrieve all decisions for a trade.

    LEARNING: This is different from thread audit log. A single trade_id
    may have multiple threads (multiple agents retried it). This endpoint
    shows the full decision history across all runs of that trade.

    Useful for: compliance audit, understanding why a trade got escalated,
    seeing operator notes over time.
    """
    audit_entries = audit_store.get_entries_for_trade(trade_id)
    if limit:
        audit_entries = audit_entries[-limit:]

    return [
        AuditEntryResponse(
            audit_entry_id=e.audit_entry_id,
            timestamp=e.timestamp,
            operator_id=e.operator_id,
            thread_id=e.thread_id,
            trade_id=e.trade_id,
            decision=e.decision,
            modification=e.modification,
            reason=e.reason,
            confidence_before=e.confidence_before,
            agent_proposal_before=e.agent_proposal_before,
            escalation_category=e.escalation_category,
        )
        for e in audit_entries
    ]