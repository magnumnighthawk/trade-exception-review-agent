# Phase 1 — Agent Core

## What You Built

A fully functional LangGraph agent with:

```
[receive_exception] → [investigate] → [propose_resolution] →★ [execute_resolution]
                                              ↑                      |
                                              └── (if rejected) ─────┘
```

★ = HITL interrupt point

---

## File-by-File Learning Guide

### 1. `state.py` — Read this first

The state is the contract that every node honours. Before writing any node,
ask: *"what does this node need from state, and what does it put back?"*

Key insight: `TradeExceptionState` is a `TypedDict`, not a class. There's no `__init__`.
LangGraph merges dicts. Every node returns a partial dict — only the keys it
updates. Keys not returned are left unchanged.

```
Node A returns {"status": "investigating", "investigation": {...}}
               ↓
LangGraph merges this into the existing state.
"exception", "thread_id", "audit_log" etc. are untouched.
```

### 2. `prompts.py` — Read second

Prompts are code. They take state and return strings. They're testable:

```python
from backend.agent.prompts import build_investigation_prompt
from backend.agent.fixtures import get_exception

exc = get_exception("TRD-9821")
state = {"exception": exc, "investigation_attempts": 0, "human_decision": None}
print(build_investigation_prompt(state))
```

Run that. Read the output. That's what the LLM sees.

### 3. `nodes.py` — Read third

Each node is a function: `state in → dict out`.

The most important line in the whole codebase is in `propose_resolution_node`:

```python
human_decision = interrupt({...})
```

When Python hits this line:
1. LangGraph serialises the entire current state to the checkpointer
2. `graph.invoke()` returns to the caller
3. The process can restart, crash, wait — it doesn't matter
4. When `graph.invoke(Command(resume=human_decision), config=config)` is called
   with the same `thread_id`, execution resumes at the next line
5. `human_decision` is now the value passed to `Command(resume=...)`

This is the entire HITL mechanism. Everything else is UI plumbing.

### 4. `graph.py` — Read last

The graph is just wiring. Nodes → edges → conditional edges → compile.

The conditional edge `route_after_execution` is how the retry loop works.
If status is `"rejected"`, the graph routes back to `investigate`.
The next investigation will pick up the rejection reason from state.

---

## Run It

```bash
cd trade-exception-review-agent
source backend/.venv/bin/activate
python -m backend.scripts.run_phase1 TRD-9821
```

Try each decision:
- `a` (approve) → see the happy path complete
- `r` (reject) → watch the agent loop back and re-investigate
- `m` (modify) → give the agent a steering instruction and see it incorporated
- `e` (escalate) → see the escalation path

---

## Things to Notice

**Audit log growth**: Run with `r` twice then `a`. Count the audit entries.
Each rejection adds entries. This is your tamper-evident trail.

**State at interrupt**: After the first `graph.invoke()` hits the interrupt,
check `graph.get_state(config).values`. The full state is there — serialised.
That's the checkpointer working.

**Retry with context**: After a rejection, read the investigation prompt that
gets built on the next attempt. Notice how it includes the rejection reason.
The agent learns from human feedback within a single run.

---

## What's Missing (Phase 2+)

| What | Where it's built |
|---|---|
| HTTP endpoint to start a review | Phase 2 — `api/routes/stream.py` |
| SSE streaming of agent reasoning | Phase 2 — `api/routes/stream.py` |
| Endpoint to submit human decision | Phase 3 — `api/routes/decision.py` |
| Queue of all paused threads | Phase 3 — `api/routes/queue.py` |
| React UI — all three panels | Phase 4 — `frontend/` |
| Failure handling + max retries | Phase 5 — update `nodes.py` and `graph.py` |

---

## Concept Check

Before moving to Phase 2, make sure you can answer:

1. What does `interrupt()` do exactly? (Not "it pauses" — the precise mechanism)
2. Why does every node return a dict instead of mutating state?
3. What would happen if you lost the `thread_id`?
4. Where in the code would you add a max-retry guard?
5. What's the difference between approving and modifying from the agent's perspective?
