"""
SSE streaming endpoint — the backbone of Phase 2.

LEARNING: This is where LangGraph's astream_events() connects to the browser
via Server-Sent Events (SSE). Understand this file and you understand the
entire streaming architecture.

The flow:
  1. POST /review/start  → starts the agent, returns thread_id
  2. GET  /review/{thread_id}/stream → SSE stream of agent events
  3. Agent hits interrupt() → backend emits hitl_interrupt event
  4. Frontend shows DecisionSurface
  5. POST /review/{thread_id}/decision → resumes agent (see decision.py)
  6. Backend re-attaches to the same thread and streams the rest

KEY CONCEPT — SSE vs WebSockets:
  SSE is unidirectional (server → client). The client sends decisions back
  over a separate POST request. This is the right pattern for HITL because:
  - It's simpler (plain HTTP, no upgrade handshake)
  - It survives load balancers that don't support WS
  - The decision endpoint has a clear, auditable HTTP trace
  - PRODUCTION: With WebSockets, you'd mix control and data on one socket —
    harder to audit, harder to scale.
"""

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


# ── Node descriptions for the UI ───────────────────────────────────────────────
# LEARNING: These are the human-readable labels that Panel 2 (AgentReasoning)
# shows as the agent moves through its nodes. Map internal node names → UI text.
NODE_DESCRIPTIONS = {
    "receive_exception":  "📥 Receiving and validating trade exception",
    "investigate":        "🔍 Investigating root cause",
    "propose_resolution": "💡 Formulating resolution proposal",
    "execute_resolution": "⚙️  Executing approved resolution",
}


def _sse(event: dict) -> str:
    """
    Format a dict as an SSE data line.

    LEARNING: SSE format is very simple:
        data: <json string>\\n\\n
    The double newline signals the end of one event to the browser's EventSource.
    Your frontend's es.onmessage handler receives the JSON string in e.data.
    """
    return f"data: {json.dumps(event)}\n\n"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _extract_interrupt_payload(config: dict) -> dict:
    """
    Read the latest interrupt payload from the LangGraph checkpoint state.

    LEARNING: Depending on LangGraph execution mode, an interrupt may surface
    as an exception OR as a graceful stream termination with pending interrupts
    in checkpoint tasks. This helper normalises payload retrieval for both.
    """
    snapshot = graph.get_state(config)
    tasks = getattr(snapshot, "tasks", None) or []
    for task in tasks:
        interrupts = getattr(task, "interrupts", None) or []
        if interrupts:
            return interrupts[0].value
    return {}


# ── Start a new review ─────────────────────────────────────────────────────────

@router.post("/start", response_model=StartReviewResponse)
async def start_review(req: StartReviewRequest):
    """
    Start a new agent run for a trade exception.
    Returns a thread_id — save this, it's the key to the SSE stream and decision endpoint.

    LEARNING: We deliberately separate 'start' from 'stream'. The client gets
    a thread_id first, then opens the SSE connection. This makes the handshake
    explicit and lets the frontend manage reconnection independently.
    """
    try:
        exception = get_exception(req.trade_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    # LEARNING: make start idempotent per trade while the trade is still active,
    # so repeated "Run" clicks don't create duplicate thread rows in the queue.
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

    # Store initial state so the queue endpoint can see all active threads
    state_store.register(
        thread_id=thread_id,
        trade_id=req.trade_id,
        operator_id=req.operator_id,
    )

    logger.info(f"[start_review] New thread {thread_id} for {req.trade_id}")
    return StartReviewResponse(thread_id=thread_id, trade_id=req.trade_id)


@router.post("/{thread_id}/reset")
async def reset_thread(thread_id: str):
    """
    Reset one queue thread entry so the trade can be run again from scratch.

    LEARNING: this clears UI-visible state for one thread only; other running
    threads are unaffected, which is essential for multi-thread supervision.
    """
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
    """
    Inspect checkpoint metadata for a specific thread.

    LEARNING: This endpoint is Phase 3's visibility surface for pause/resume.
    It helps answer: "Is this thread actually checkpointed and waiting?"
    """
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


# ── SSE stream ─────────────────────────────────────────────────────────────────

@router.get("/{thread_id}/stream")
async def stream_review(thread_id: str):
    """
    SSE stream for a trade exception review.

    LEARNING: StreamingResponse with media_type="text/event-stream" is how
    FastAPI serves SSE. The generator function yields event strings as they
    are produced — FastAPI flushes each yield to the client immediately.

    The browser connects with:
        const es = new EventSource('/review/<thread_id>/stream')
        es.onmessage = (e) => { ... JSON.parse(e.data) ... }

    TRADE-OFF: We use astream_events() (v2) rather than astream() because
    astream_events gives us fine-grained events per node and per LLM token.
    astream() only gives you full node outputs — no token-by-token streaming.
    """
    entry = state_store.get(thread_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Thread {thread_id} not found")

    config = {"configurable": {"thread_id": thread_id}}

    async def generate():
        """
        LEARNING: This is an async generator. Each `yield` sends one SSE event
        to the browser. The generator runs until the agent finishes or hits interrupt.

        The key line is:
            async for event in graph.astream_events(initial_state, version="v2"):
        
        LangGraph fires these event types (among others):
        - on_chain_start / on_chain_end  → node entered/exited
        - on_chat_model_stream           → one LLM token
        - on_chat_model_end              → LLM call finished

        We translate each into our SSE event shapes (models.py).
        """
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

                # ── Node started ───────────────────────────────────────────────
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

                # ── LLM token streamed ─────────────────────────────────────────
                # LEARNING: This fires once per token from the LLM. Accumulated
                # client-side, this creates the "typing" effect in AgentReasoning.
                elif kind == "on_chat_model_stream":
                    chunk = event.get("data", {}).get("chunk")
                    if chunk and hasattr(chunk, "content") and chunk.content:
                        state_store.append_stage_token(thread_id, chunk.content)
                        yield _sse(TokenEvent(
                            content=chunk.content,
                            node=current_node or "unknown",
                        ).model_dump())

                # ── Node completed ─────────────────────────────────────────────
                elif kind == "on_chain_end" and name in NODE_DESCRIPTIONS:
                    output = event.get("data", {}).get("output", {})
                    # Only send safe, serialisable subset of state to UI
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
            # HITL: interrupt() raises an internal exception in LangGraph.
            # We detect it here and emit the hitl_interrupt SSE event.
            # The frontend will switch to "waiting_human" status on receipt.
            if "Interrupt" in type(e).__name__ or "GraphInterrupt" in type(e).__name__:
                interrupt_payload = _extract_interrupt_payload(config)

                state_store.set_interrupt(thread_id, interrupt_payload)

                # HITL: This event is the UI's signal to show DecisionSurface
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
            # HITL: In some runs, interrupt() ends streaming gracefully without
            # raising GraphInterrupt. We must still emit hitl_interrupt so the
            # frontend can switch to waiting_human instead of treating close as error.
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


# ── Stream after resume (re-attach after human decision) ──────────────────────

@router.get("/{thread_id}/stream/resume")
async def stream_resume(thread_id: str):
    """
    Re-attach SSE stream after human decision was submitted.

    LEARNING: After the human POSTs to /decision, the agent is resumed.
    The frontend reconnects here to see the rest of the execution streamed.
    Same pattern as the initial stream, just continuing from checkpoint state.

    TRADE-OFF: We could do this in a single long-lived SSE connection using
    a queue. We split it into two connections (initial + resume) to keep
    the implementation simple and teachable. In production, a message queue
    (Redis pub/sub) between the decision handler and the stream would allow
    one continuous connection.
    """
    entry = state_store.get(thread_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Thread {thread_id} not found")

    config = {"configurable": {"thread_id": thread_id}}

    async def generate():
        current_node = None
        terminal_event_emitted = False
        try:
            # LEARNING: We pass None as input here because we're resuming from
            # a checkpoint — LangGraph loads the state from MemorySaver.
            # The Command(resume=...) was already submitted via the decision endpoint.
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

            # Agent reached a terminal state — emit final event
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
                # Another interrupt — another rejection cycle
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
