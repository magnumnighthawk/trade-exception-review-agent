import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from langgraph.types import Command

from backend.agent.graph import graph
from backend.agent.policy import approval_locked
from backend.api.audit_store import audit_store
from backend.api.models import DecisionResponse, HumanDecisionRequest
from backend.api.state_store import state_store

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/review", tags=["review"])


def _validate_decision(kind: str | None, req: HumanDecisionRequest, interrupt_payload: dict) -> None:
    allowed_actions = {
        "proposal_review": {"approve", "reject", "modify", "escalate"},
        "information_request": {"provide_context", "escalate"},
        "failure_recovery": {"retry", "manual_takeover", "escalate"},
    }

    if kind not in allowed_actions:
        raise HTTPException(status_code=409, detail=f"Unsupported intervention kind: {kind}")

    if req.action not in allowed_actions[kind]:
        raise HTTPException(
            status_code=409,
            detail=f"Action '{req.action}' is not valid for intervention kind '{kind}'",
        )

    if kind == "proposal_review" and req.action == "approve":
        confidence = interrupt_payload.get("confidence", 1.0)
        if approval_locked(confidence):
            raise HTTPException(
                status_code=409,
                detail="Approval is policy-locked below the low-confidence threshold.",
            )

    if kind == "proposal_review" and req.action in {"modify", "reject"} and not req.modification:
        raise HTTPException(
            status_code=422,
            detail=f"Action '{req.action}' requires guidance in the modification field.",
        )

    if kind == "information_request" and req.action == "provide_context" and not req.context_fields:
        raise HTTPException(
            status_code=422,
            detail="Providing context requires at least one context field.",
        )

    if kind == "failure_recovery" and req.action == "retry" and not interrupt_payload.get("retry_available", False):
        raise HTTPException(
            status_code=409,
            detail="Retry is no longer available for this recovery path.",
        )

    if kind == "failure_recovery" and req.action == "manual_takeover" and not (req.reason or req.modification):
        raise HTTPException(
            status_code=422,
            detail="Manual takeover requires an operator note explaining the handoff.",
        )


@router.post("/{thread_id}/decision", response_model=DecisionResponse)
async def submit_decision(thread_id: str, req: HumanDecisionRequest):
    """Submit a human intervention for a paused agent thread."""

    entry = state_store.get(thread_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Thread {thread_id} not found")

    if entry["status"] != "waiting_human":
        raise HTTPException(
            status_code=409,
            detail=f"Thread {thread_id} is not waiting for human input (status: {entry['status']})",
        )

    config = {"configurable": {"thread_id": thread_id}}
    interrupt_payload = entry.get("interrupt_payload") or {}
    intervention_kind = interrupt_payload.get("kind")
    _validate_decision(intervention_kind, req, interrupt_payload)

    decision_payload = {
        "action": req.action,
        "modification": req.modification,
        "operator_id": req.operator_id,
        "decided_at": datetime.now(timezone.utc).isoformat(),
        "reason": req.reason,
        "confidence_before": req.confidence_before,
        "escalation_category": req.escalation_category,
        "context_fields": req.context_fields,
    }

    logger.info(
        "[decision] Thread %s: operator %s → %s (%s)",
        thread_id,
        req.operator_id,
        req.action,
        intervention_kind,
    )

    proposal = interrupt_payload.get("proposal") or interrupt_payload.get("latest_proposal") or {}
    audit_store.log_decision(
        thread_id=thread_id,
        trade_id=entry["trade_id"],
        operator_id=req.operator_id,
        decision=req.action,
        modification=req.modification,
        reason=req.reason,
        confidence_before=req.confidence_before or interrupt_payload.get("confidence"),
        agent_proposal_before=proposal.get("action"),
        escalation_category=req.escalation_category,
        context_fields=req.context_fields,
    )

    state_store.set_resuming(thread_id)

    try:
        result = graph.invoke(
            Command(resume=decision_payload),
            config=config,
        )

        snapshot = graph.get_state(config)
        interrupt_payload = None
        tasks = getattr(snapshot, "tasks", None) or []
        for task in tasks:
            interrupts = getattr(task, "interrupts", None) or []
            if interrupts:
                interrupt_payload = interrupts[0].value
                break

        if interrupt_payload:
            state_store.set_interrupt(thread_id, interrupt_payload)
            new_status = "waiting_human"
        else:
            result = result or {}
            new_status = result.get("status", "complete")
            state_store.set_final(thread_id, new_status, result)

        return DecisionResponse(
            thread_id=thread_id,
            action=req.action,
            status=new_status,
            message=f"Decision '{req.action}' processed. Agent status: {new_status}",
        )

    except Exception as error:
        logger.error("[decision] Error resuming thread %s: %s", thread_id, error)
        state_store.set_error(thread_id, str(error))
        raise HTTPException(status_code=500, detail=f"Error processing decision: {str(error)}")
