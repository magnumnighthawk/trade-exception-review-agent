import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from langgraph.types import Command

from backend.agent.graph import graph
from backend.agent.fixtures import get_exception
from backend.api.models import (
    StartReviewRequest, StartReviewResponse,
    TokenEvent, NodeStartEvent, NodeCompleteEvent, HitlInterruptEvent, CompleteEvent, ErrorEvent,
    CheckpointStateResponse,
)
from backend.api.state_store import state_store
from backend.checkpointer import checkpointer_backend

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/review", tags=["review"])

NODE_DESCRIPTIONS = {
    "receive_exception":  "📥 Receiving and validating trade exception",
    "investigate":        "🔍 Investigating root cause",
    "propose_resolution": "💡 Formulating resolution proposal",
    "execute_resolution": "⚙️  Executing approved resolution",
}


def _sse(event: dict) -> str:
    """Format a dict as an SSE event."""
    return f"data: {json.dumps(event)}\n\n"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _extract_interrupt_payload(config: dict) -> dict:
    """Read the latest interrupt payload from checkpoint state."""
    snapshot = graph.get_state(config)
    tasks = getattr(snapshot, "tasks", None) or []
    for task in tasks:
        interrupts = getattr(task, "interrupts", None) or []
        if interrupts:
            return interrupts[0].value
    return {}

@router.post("/start", response_model=StartReviewResponse)
async def start_review(req: StartReviewRequest):
    """Start a new agent run for a trade exception."""
    try:
        exception = get_exception(req.trade_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    existing = state_store.latest_for_trade(req.trade_id)
    if existing and existing.get("status") not in {"complete", "escalated", "error"}:
        thread_id = existing["thread_id"]
        logger.info(f"[start_review] Reusing active thread {thread_id} for {req.trade_id}")
        return StartReviewResponse(
            thread_id=thread_id,
            trade_id=req.trade_id,
            message="Existing active thread reused for this trade.",
        )

    import uuid
    thread_id = str(uuid.uuid4())

    state_store.register(
        thread_id=thread_id,
        trade_id=req.trade_id,
        operator_id=req.operator_id,
    )

    logger.info(f"[start_review] New thread {thread_id} for {req.trade_id}")
    return StartReviewResponse(thread_id=thread_id, trade_id=req.trade_id)


@router.post("/{thread_id}/reset")
async def reset_thread(thread_id: str):
    """Reset one queue thread entry so the trade can be run again from scratch."""
    entry = state_store.get(thread_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Thread {thread_id} not found")

    trade_id = entry.get("trade_id")
    state_store.remove(thread_id)
    logger.info(f"[reset_thread] Removed thread {thread_id} for trade {trade_id}")
    return {
        "thread_id": thread_id,
        "trade_id": trade_id,
        "status": "idle",
        "message": "Thread reset. Trade returned to pending queue.",
    }


@router.get("/{thread_id}/checkpoint", response_model=CheckpointStateResponse)
async def checkpoint_state(thread_id: str):
    """Inspect checkpoint metadata for a specific thread."""
    entry = state_store.get(thread_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Thread {thread_id} not found")

    config = {"configurable": {"thread_id": thread_id}}
    snapshot = graph.get_state(config)
    values = getattr(snapshot, "values", None) or {}
    next_node = getattr(snapshot, "next", None)
    tasks = getattr(snapshot, "tasks", None) or []

    interrupt_count = 0
    for task in tasks:
        interrupt_count += len(getattr(task, "interrupts", None) or [])

    has_checkpoint = bool(values) or bool(tasks) or bool(next_node)

    normalized_next_node = next_node
    if isinstance(next_node, (tuple, list)):
        normalized_next_node = next_node[0] if len(next_node) > 0 else None

    return CheckpointStateResponse(
        thread_id=thread_id,
        has_checkpoint=has_checkpoint,
        has_interrupt=interrupt_count > 0,
        interrupt_count=interrupt_count,
        next_node=normalized_next_node,
        status=values.get("status"),
        state_keys=sorted(list(values.keys())),
        checkpointer_backend=checkpointer_backend(),
    )

@router.get("/{thread_id}/stream")
async def stream_review(thread_id: str):
    """Stream a trade exception review over SSE."""
    entry = state_store.get(thread_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Thread {thread_id} not found")

    config = {"configurable": {"thread_id": thread_id}}

    async def generate():
        exception = get_exception(entry["trade_id"])
        initial_state = {
            "exception": exception,
            "thread_id": thread_id,
            "investigation": None,
            "investigation_attempts": 0,
            "additional_context": None,
            "proposal": None,
            "human_decision": None,
            "execution_result": None,
            "execution_attempts": 0,
            "escalation_reason": None,
            "failure_context": None,
            "manual_takeover_note": None,
            "audit_log": [],
        }

        current_node = None
        terminal_event_emitted = False

        try:
            async for event in graph.astream_events(initial_state, config=config, version="v2"):
                kind = event.get("event")
                name = event.get("name", "")

                if kind == "on_chain_start" and name in NODE_DESCRIPTIONS:
                    current_node = name
                    state_store.start_stage(
                        thread_id=thread_id,
                        node=name,
                        message=NODE_DESCRIPTIONS.get(name, name),
                    )
                    yield _sse(NodeStartEvent(
                        node=name,
                        message=NODE_DESCRIPTIONS.get(name, name),
                    ).model_dump())

                elif kind == "on_chat_model_stream":
                    chunk = event.get("data", {}).get("chunk")
                    if chunk and hasattr(chunk, "content") and chunk.content:
                        state_store.append_stage_token(thread_id, chunk.content)
                        yield _sse(TokenEvent(
                            content=chunk.content,
                            node=current_node or "unknown",
                        ).model_dump())

                elif kind == "on_chain_end" and name in NODE_DESCRIPTIONS:
                    output = event.get("data", {}).get("output", {})
                    snapshot = {
                        k: v for k, v in (output or {}).items()
                        if k
                        in (
                            "status",
                            "investigation",
                            "proposal",
                            "investigation_attempts",
                            "failure_context",
                            "manual_takeover_note",
                        )
                    }
                    state_store.complete_stage(thread_id, name, snapshot)
                    yield _sse(NodeCompleteEvent(
                        node=name,
                        state_snapshot=snapshot,
                    ).model_dump())

        except Exception as e:
            if "Interrupt" in type(e).__name__ or "GraphInterrupt" in type(e).__name__:
                interrupt_payload = _extract_interrupt_payload(config)

                state_store.set_interrupt(thread_id, interrupt_payload)

                yield _sse(HitlInterruptEvent(
                    thread_id=thread_id,
                    interrupt_payload=interrupt_payload,
                ).model_dump())
                terminal_event_emitted = True

            else:
                logger.error(f"[stream] Error in thread {thread_id}: {e}")
                state_store.set_error(thread_id, str(e))
                yield _sse(
                    ErrorEvent(
                        message=str(e),
                        recoverable=False,
                        failure_context=state_store.get(thread_id).get("failure_context"),
                    ).model_dump()
                )
                terminal_event_emitted = True

        if not terminal_event_emitted:
            interrupt_payload = _extract_interrupt_payload(config)
            if interrupt_payload:
                state_store.set_interrupt(thread_id, interrupt_payload)
                yield _sse(HitlInterruptEvent(
                    thread_id=thread_id,
                    interrupt_payload=interrupt_payload,
                ).model_dump())
            else:
                final_state = graph.get_state(config)
                final_values = final_state.values if hasattr(final_state, "values") else {}
                final_snapshot = {
                    k: v for k, v in final_values.items()
                    if k not in ("audit_log",)
                }
                state_store.set_final(
                    thread_id,
                    final_values.get("status", "complete"),
                    final_snapshot,
                )
                yield _sse(CompleteEvent(
                    status=final_values.get("status", "complete"),
                    final_state=final_snapshot,
                ).model_dump())

    return StreamingResponse(generate(), media_type="text/event-stream")

@router.get("/{thread_id}/stream/resume")
async def stream_resume(thread_id: str):
    """Re-attach the SSE stream after a human decision was submitted."""
    entry = state_store.get(thread_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Thread {thread_id} not found")

    config = {"configurable": {"thread_id": thread_id}}

    async def generate():
        current_node = None
        terminal_event_emitted = False
        try:
            async for event in graph.astream_events(None, config=config, version="v2"):
                kind = event.get("event")
                name = event.get("name", "")

                if kind == "on_chain_start" and name in NODE_DESCRIPTIONS:
                    current_node = name
                    state_store.start_stage(
                        thread_id=thread_id,
                        node=name,
                        message=NODE_DESCRIPTIONS.get(name, name),
                    )
                    yield _sse(NodeStartEvent(
                        node=name,
                        message=NODE_DESCRIPTIONS.get(name, name),
                    ).model_dump())

                elif kind == "on_chat_model_stream":
                    chunk = event.get("data", {}).get("chunk")
                    if chunk and hasattr(chunk, "content") and chunk.content:
                        state_store.append_stage_token(thread_id, chunk.content)
                        yield _sse(TokenEvent(
                            content=chunk.content,
                            node=current_node or "unknown",
                        ).model_dump())

                elif kind == "on_chain_end" and name in NODE_DESCRIPTIONS:
                    output = event.get("data", {}).get("output", {})
                    snapshot = {
                        k: v for k, v in (output or {}).items()
                        if k
                        in (
                            "status",
                            "investigation",
                            "proposal",
                            "execution_result",
                            "execution_attempts",
                            "escalation_reason",
                            "failure_context",
                            "manual_takeover_note",
                        )
                    }
                    state_store.complete_stage(thread_id, name, snapshot)
                    yield _sse(NodeCompleteEvent(
                        node=name,
                        state_snapshot=snapshot,
                    ).model_dump())

            interrupt_payload = _extract_interrupt_payload(config)
            if interrupt_payload:
                state_store.set_interrupt(thread_id, interrupt_payload)
                yield _sse(HitlInterruptEvent(
                    thread_id=thread_id,
                    interrupt_payload=interrupt_payload,
                ).model_dump())
            else:
                final_state = graph.get_state(config)
                final_values = final_state.values if hasattr(final_state, "values") else {}
                final_snapshot = {
                    k: v for k, v in final_values.items()
                    if k not in ("audit_log",)  # Don't send full audit over SSE
                }
                state_store.set_final(
                    thread_id,
                    final_values.get("status", "complete"),
                    final_snapshot,
                )
                yield _sse(CompleteEvent(
                    status=final_values.get("status", "complete"),
                    final_state=final_snapshot,
                ).model_dump())
            terminal_event_emitted = True

        except Exception as e:
            if "Interrupt" in type(e).__name__ or "GraphInterrupt" in type(e).__name__:
                interrupt_payload = _extract_interrupt_payload(config)

                state_store.set_interrupt(thread_id, interrupt_payload)
                yield _sse(HitlInterruptEvent(
                    thread_id=thread_id,
                    interrupt_payload=interrupt_payload,
                ).model_dump())
                terminal_event_emitted = True
            else:
                logger.error(f"[stream/resume] Error in thread {thread_id}: {e}")
                state_store.set_error(thread_id, str(e))
                yield _sse(
                    ErrorEvent(
                        message=str(e),
                        recoverable=False,
                        failure_context=state_store.get(thread_id).get("failure_context"),
                    ).model_dump()
                )
                terminal_event_emitted = True

        if not terminal_event_emitted:
            interrupt_payload = _extract_interrupt_payload(config)
            if interrupt_payload:
                state_store.set_interrupt(thread_id, interrupt_payload)
                yield _sse(HitlInterruptEvent(
                    thread_id=thread_id,
                    interrupt_payload=interrupt_payload,
                ).model_dump())
            else:
                final_state = graph.get_state(config)
                final_values = final_state.values if hasattr(final_state, "values") else {}
                final_snapshot = {
                    k: v for k, v in final_values.items()
                    if k not in ("audit_log",)
                }
                state_store.set_final(
                    thread_id,
                    final_values.get("status", "complete"),
                    final_snapshot,
                )
                yield _sse(CompleteEvent(
                    status=final_values.get("status", "complete"),
                    final_state=final_snapshot,
                ).model_dump())

    return StreamingResponse(generate(), media_type="text/event-stream")
