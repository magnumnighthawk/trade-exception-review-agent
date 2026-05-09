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
from backend.agent.fixtures import SAMPLE_EXCEPTIONS
from backend.api.models import (
    QueueItem, QueueResponse, ThreadDetailResponse, ThreadStageResponse,
    AuditEntryResponse, AuditLogResponse, SubmitDecisionRequest, SubmitDecisionResponse
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
    status_order = {
        "waiting_human": 0,
        "resuming": 1,
        "running": 2,
        "starting": 2,
        "idle": 3,
        "complete": 4,
        "escalated": 5,
        "manual_takeover": 6,
        "error": 7,
    }

    entries = state_store.all()
    latest_by_trade: dict[str, dict] = {}
    for entry in entries:
        trade_id = entry["trade_id"]
        previous = latest_by_trade.get(trade_id)
        if not previous or (entry.get("created_at") or "") > (previous.get("created_at") or ""):
            latest_by_trade[trade_id] = entry

    entries = list(latest_by_trade.values())
    items: list[QueueItem] = []
    active_trade_ids = set()

    for entry in entries:
        payload = entry.get("interrupt_payload") or {}
        proposal = payload.get("proposal") or {}
        active_trade_ids.add(entry["trade_id"])

        items.append(QueueItem(
            thread_id=entry["thread_id"],
            trade_id=entry["trade_id"],
            status=entry["status"],
            risk_level=proposal.get("risk_level"),
            confidence=payload.get("confidence"),
            amount=payload.get("amount") or _get_amount(entry["trade_id"]),
            counterparty=_get_counterparty(entry["trade_id"]),
            proposal_action=proposal.get("action"),
            intervention_kind=payload.get("kind"),
            interrupt_payload=payload if entry["status"] == "waiting_human" else None,
            paused_at=entry.get("paused_at"),
        ))

    # HITL: Pending exceptions are visible before a run starts, so operators can
    # launch multiple reviews concurrently from the supervision queue.
    for trade_id, exception in SAMPLE_EXCEPTIONS.items():
        if trade_id in active_trade_ids:
            continue
        items.append(QueueItem(
            thread_id=None,
            trade_id=trade_id,
            status="idle",
            risk_level=None,
            confidence=None,
            amount=exception.get("amount"),
            counterparty=exception.get("counterparty"),
            proposal_action=None,
            intervention_kind=None,
            interrupt_payload=None,
            paused_at=None,
        ))

    # Queue policy: actionable items first, then by confidence, then by amount, then age.
    items.sort(key=lambda item: (
        status_order.get(item.status, 99),
        item.confidence if item.confidence is not None else 1.0,
        -(item.amount or 0.0),
        item.paused_at or "",
        risk_order.get(item.risk_level, 4),
    ))

    return QueueResponse(items=items, total=len(items))


@router.get("/waiting", response_model=QueueResponse)
async def get_waiting_queue():
    """Return only threads actively waiting for human input."""
    full = await get_queue()
    waiting = [item for item in full.items if item.status == "waiting_human"]
    return QueueResponse(items=waiting, total=len(waiting))


@router.get("/{thread_id}", response_model=ThreadDetailResponse)
async def get_thread_status(thread_id: str):
    """
    Get full detail for a specific supervised thread.

    LEARNING: The queue list stays compact, but once an operator selects a
    thread we hydrate the workstation with its persisted stage history and
    final/checkpoint-visible state. This powers historical reasoning review.
    """
    from fastapi import HTTPException
    entry = state_store.get(thread_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Thread {thread_id} not found")

    return ThreadDetailResponse(
        thread_id=entry["thread_id"],
        trade_id=entry["trade_id"],
        status=entry["status"],
        current_node=entry.get("current_node"),
        intervention_kind=entry.get("intervention_kind"),
        interrupt_payload=entry.get("interrupt_payload"),
        final_state=entry.get("final_state"),
        error=entry.get("error"),
        failure_context=entry.get("failure_context"),
        manual_takeover_note=entry.get("manual_takeover_note"),
        paused_at=entry.get("paused_at"),
        stage_history=[
            ThreadStageResponse(
                stage_id=stage.get("stage_id"),
                node=stage.get("node"),
                message=stage.get("message"),
                attempt=stage.get("attempt"),
                status=stage.get("status"),
                tokens=stage.get("tokens", ""),
                state_snapshot=stage.get("state_snapshot"),
                started_at=stage.get("started_at"),
                completed_at=stage.get("completed_at"),
            )
            for stage in entry.get("stage_history", [])
        ],
    )


def _get_counterparty(trade_id: str) -> str | None:
    """Look up counterparty from fixtures — avoids circular imports."""
    try:
        from backend.agent.fixtures import get_exception
        return get_exception(trade_id).get("counterparty")
    except Exception:
        return None


def _get_amount(trade_id: str) -> float | None:
    try:
        return float(SAMPLE_EXCEPTIONS.get(trade_id, {}).get("amount"))
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
            context_fields=e.context_fields,
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
        context_fields=req.context_fields,
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
            context_fields=e.context_fields,
        )
        for e in audit_entries
    ]
