"""
Human decision endpoint — resumes a paused agent.

LEARNING: This endpoint is the second half of the HITL contract.
When the frontend's DecisionSurface submits a decision:
  1. This endpoint receives the HumanDecisionRequest
  2. It calls graph.invoke(Command(resume=...)) with the thread_id
  3. The checkpointed agent resumes from where interrupt() paused it
  4. The frontend then connects to /stream/resume to see what happens next

Notice the separation: the decision endpoint does NOT stream.
It submits the decision and returns immediately with a status acknowledgement.
Streaming is always a separate concern (stream.py).

HITL: This endpoint is the human's "write" action. Every call here is
logged in the agent's audit trail via the human_decision state field.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from langgraph.types import Command

from backend.agent.graph import graph
from backend.api.models import HumanDecisionRequest, DecisionResponse
from backend.api.state_store import state_store

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/review", tags=["review"])


@router.post("/{thread_id}/decision", response_model=DecisionResponse)
async def submit_decision(thread_id: str, req: HumanDecisionRequest):
    """
    Submit a human decision for a paused agent thread.

    LEARNING: graph.invoke(Command(resume=value), config=config) is the
    LangGraph API for resuming an interrupted graph. The `value` here becomes
    the return value of interrupt() inside propose_resolution_node.

    The graph runs synchronously from the resume point until it either:
    - Completes (returns final state)
    - Hits another interrupt() (another HITL cycle, e.g. after reject+reinvestigate)
    - Errors

    We handle all three outcomes and update state_store accordingly.
    """
    entry = state_store.get(thread_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Thread {thread_id} not found")

    if entry["status"] != "waiting_human":
        raise HTTPException(
            status_code=409,
            detail=f"Thread {thread_id} is not waiting for human input (status: {entry['status']})"
        )

    config = {"configurable": {"thread_id": thread_id}}

    # Build the decision payload — this is what interrupt() returns in the agent
    decision_payload = {
        "action": req.action,
        "modification": req.modification,
        "operator_id": req.operator_id,
        "decided_at": datetime.now(timezone.utc).isoformat(),
    }

    logger.info(f"[decision] Thread {thread_id}: operator {req.operator_id} → {req.action}")

    # Mark as resuming before invoking so the queue shows the right status
    state_store.set_resuming(thread_id)

    try:
        # HITL: Resume the checkpointed agent with the human's decision.
        # This is a synchronous call — it runs until the next interrupt or terminal state.
        result = graph.invoke(
            Command(resume=decision_payload),
            config=config,
        )

        # Check if we hit another interrupt (reject loop)
        snapshot = graph.get_state(config)
        interrupt_payload = None
        tasks = getattr(snapshot, "tasks", None) or []
        for task in tasks:
            interrupts = getattr(task, "interrupts", None) or []
            if interrupts:
                interrupt_payload = interrupts[0].value
                break

        if interrupt_payload:
            # Another HITL cycle — agent re-investigated and has a new proposal
            state_store.set_interrupt(thread_id, interrupt_payload)
            new_status = "waiting_human"
        else:
            new_status = result.get("status", "complete") if result else "complete"
            state_store.set_final(thread_id, new_status)

        return DecisionResponse(
            thread_id=thread_id,
            action=req.action,
            status=new_status,
            message=f"Decision '{req.action}' processed. Agent status: {new_status}",
        )

    except Exception as e:
        logger.error(f"[decision] Error resuming thread {thread_id}: {e}")
        state_store.set_error(thread_id, str(e))
        raise HTTPException(status_code=500, detail=f"Error processing decision: {str(e)}")
