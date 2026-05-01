# Phase 2 — Streaming & The Supervision Cockpit

## What You Built

A live supervision cockpit where:
1. You select a trade exception → agent starts on the backend
2. LLM tokens stream into Panel 2 in real time as the agent reasons
3. When the agent hits `interrupt()`, Panel 3 activates with the proposal
4. You approve/reject/modify → agent resumes and streams the rest
5. Case reaches a terminal state → panels update accordingly

---

## The Architecture in One Diagram

```
Browser                          FastAPI                     LangGraph
──────────                       ───────                     ──────────
[click TRD-9821]
  │
  ├─ POST /review/start ────────► registers thread_id
  │◄──────────────────────────── { thread_id }
  │
  ├─ GET /review/{id}/stream ───► astream_events() ────────► node start
  │◄── node_start ─────────────────────────────────────────── 
  │◄── token ──────────────────────────────────────────────── LLM token
  │◄── token ...
  │◄── node_complete ──────────────────────────────────────── 
  │◄── hitl_interrupt ─────────────────────────────────────── interrupt()
  │
  [DecisionSurface renders]
  │
  ├─ POST /review/{id}/decision ► Command(resume=...)  ─────► resumes graph
  │◄──────────────────────────── { status: "waiting_human" or "complete" }
  │
  ├─ GET /review/{id}/stream/resume ──────────────────────── ► continues from checkpoint
  │◄── node_start, tokens, node_complete ...
  │◄── complete ───────────────────────────────────────────── terminal state
```

---

## File-by-File Learning Guide

### `backend/api/state_store.py` — Read first

The state store bridges three endpoints that don't share a request context.
It's process-local memory of all active agent threads.

Key insight: **the checkpointer (LangGraph) holds the agent state; the state_store holds the UI metadata** (which thread is waiting, what the interrupt payload was, which node is running). These are separate concerns.

### `backend/api/models.py` — Read second

Every SSE event has a `type` field. This is a discriminated union — both Python (Pydantic `Literal`) and TypeScript (`type` field) use it to narrow the type in each handler.

Pattern to remember: **if you're switching on a string to decide what data is present, model it as a discriminated union, not as an interface with optional fields.**

### `backend/api/routes/stream.py` — Read third

The `generate()` async generator is the heart of Phase 2.

```python
async for event in graph.astream_events(initial_state, config=config, version="v2"):
    kind = event.get("event")
    if kind == "on_chat_model_stream":
        yield _sse(TokenEvent(content=chunk.content, node=current_node).model_dump())
```

This fires for every token the LLM produces. FastAPI's `StreamingResponse` flushes each `yield` immediately. The browser's `EventSource` receives it.

The **interrupt detection** is in the `except` block. LangGraph raises an internal exception when `interrupt()` is called. We catch it, extract the payload from the checkpointer, and emit `hitl_interrupt` as the last SSE event before the stream closes.

### `frontend/hooks/useAgentStream.ts` — The frontend brain

The hook is a state machine. `status` is the discriminated union that drives everything:

```
"idle" → startReview() → "starting" → SSE open → "streaming"
                                                      ↓
                                           agent hits interrupt()
                                                      ↓
                                               "waiting_human"   ← DecisionSurface renders
                                                      ↓
                                          submitDecision()
                                                      ↓
                                               "resuming" → SSE resume → "streaming"
                                                                              ↓
                                                                        "complete"
```

The key line:
```typescript
case "hitl_interrupt":
  setInterruptPayload(event.interrupt_payload)
  setStatus("waiting_human")   // ← This is what makes DecisionSurface appear
  es.close()
  break
```

**The UI did not decide to show DecisionSurface. The agent told the UI to show it.**

### `frontend/components/DecisionSurface.tsx` — The HITL action surface

The four buttons implement the full HITL contract. Study the **Modify** path:

1. Operator types a modification instruction
2. `onDecision({ action: "modify", modification: "..." })` is called
3. Hook POSTs to `/review/{id}/decision` with the modification
4. Backend calls `graph.invoke(Command(resume=payload))` — the agent resumes
5. `propose_resolution_node` returns `human_decision` with the modification in state
6. `execute_resolution_node` sees `action="modify"` → builds confirmation with modification context
7. `build_execution_confirmation_prompt` includes: `"Modification from operator: ..."`

The agent doesn't just try again. It incorporates your instruction.

---

## Run It

```bash
# Terminal 1 — backend
cd trade-exception-review-agent
source .venv/bin/activate
uvicorn backend.main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend
npm run dev
```

Open http://localhost:3000 — you'll be redirected to `/dashboard`.

- Click any exception in Panel 1
- Watch tokens stream in Panel 2
- When Panel 3 activates with a proposal, try each action
- Try **Modify** — type "Prioritise contacting the counterparty's ops desk directly" and submit
- Check the execution result — your instruction will be woven into the confirmation

---

## Concept Check

1. Why do we separate POST /review/start from GET /stream? Why not start streaming on POST?
2. What does `es.close()` on `hitl_interrupt` achieve? What would happen if we didn't close it?
3. What's the difference between the stream endpoint and stream/resume? Why are they separate?
4. The `state_store` and the LangGraph checkpointer both hold state. What belongs in each?
5. Why is `status` a discriminated union rather than a series of booleans (isStreaming, isWaiting, etc.)?
