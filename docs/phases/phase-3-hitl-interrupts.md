# Phase 3 — HITL Interrupts, Checkpoints, and Resume

## What You Build In Phase 3

Phase 2 gave you streaming. Phase 3 gives you **true pause/resume semantics**.

At the end of this phase, you can prove all three are true:

1. The agent **pauses** at `interrupt()` and does not continue autonomously.
2. The pause is tied to a durable runtime identity: `thread_id`.
3. A human decision resumes the **same** checkpointed thread.

---

## Core Mental Model

The agent is not "sleeping".
It is **checkpointed**.

That means:
- graph execution is halted
- checkpoint state is stored by the configured checkpointer backend
- the UI/ops layer can reconnect by `thread_id`

In this project, the default backend is `memory`.
Phase 3 introduces a checkpointer factory so backend choice can be swapped later.

---

## What Changed In Code

### 1) Checkpointer abstraction

`backend/checkpointer/factory.py`

- Adds `build_checkpointer()` and `checkpointer_backend()`
- Supports env-driven backend selection:
  - `LANGGRAPH_CHECKPOINTER=memory` (default)
  - `LANGGRAPH_CHECKPOINTER=postgres` (optional, with fallback to memory)

### 2) Graph compilation uses the factory

`backend/agent/graph.py`

- Replaced inline `MemorySaver()` with `build_checkpointer()`
- Graph startup logs the active backend

### 3) Checkpoint inspection endpoint

`GET /review/{thread_id}/checkpoint`

Implemented in `backend/api/routes/stream.py` with model in `backend/api/models.py`.

This endpoint returns a safe checkpoint view:
- `has_checkpoint`
- `has_interrupt`
- `interrupt_count`
- `next_node`
- `status`
- `state_keys`
- `checkpointer_backend`

This is a key learning and supervision tool in Phase 3.

---

## End-to-End HITL Lifecycle (Phase 3)

```
POST /review/start
   -> returns thread_id

GET /review/{thread_id}/stream
   -> node_start/token/node_complete events
   -> hitl_interrupt event when propose_resolution calls interrupt()
   -> stream closes

GET /review/{thread_id}/checkpoint
   -> confirms thread is checkpointed and waiting

POST /review/{thread_id}/decision
   -> graph.invoke(Command(resume=...))
   -> resumes same checkpointed thread

GET /review/{thread_id}/stream/resume
   -> streams remaining execution or another interrupt cycle
```

---

## Run It (Phase 3 Verification)

```bash
# Terminal 1 — backend
cd trade-exception-review-agent
source .venv/bin/activate
uvicorn backend.main:app --reload --port 8000
```

```bash
# Terminal 2 — create a thread and inspect checkpoint state after interrupt
BASE="http://localhost:8000"

THREAD=$(curl -sS -X POST "$BASE/review/start" \
  -H 'Content-Type: application/json' \
  -d '{"trade_id":"TRD-9821","operator_id":"operator_001"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["thread_id"])')

echo "thread=$THREAD"

# Drive until first terminal event (interrupt/error/complete)
curl -sS -N "$BASE/review/$THREAD/stream" \
  | sed -n 's/.*"type": "\([^"]*\)".*/\1/p' \
  | grep -v '^token$' \
  | awk '{print; if ($0=="hitl_interrupt" || $0=="error" || $0=="complete") exit}'

# Inspect checkpoint
curl -sS "$BASE/review/$THREAD/checkpoint"
```

If interrupt worked, you should see:
- stream includes `hitl_interrupt`
- checkpoint endpoint returns `has_interrupt: true`

---

## Why This Phase Matters

In regulated operations, confidence in automation comes from control:
- deterministic pause points
- resumable execution identity
- inspectable state at decision time
- auditable human intervention

Phase 3 is where your agent becomes operationally governable.

---

## Concept Check

1. Why is `thread_id` required for resume? What breaks if it is lost?
2. What is the difference between `state_store` and checkpointer state?
3. Why can an interrupt appear as graceful stream end (without thrown exception)?
4. Which fields from checkpoint state are safe to expose to UI?
5. What should change when moving from memory to postgres checkpointer?
