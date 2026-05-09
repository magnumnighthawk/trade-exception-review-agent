# Phase 5 — Failure Paths: Graceful Human Takeover

> **Status: ✅ Built.** Phase 5 turns the supervision surface from "review proposals" into "handle uncertainty and failure safely." The key product shift is that every sad path now becomes a typed human intervention mode instead of collapsing into a generic error.

---

## What Changed

Phase 4 already supported:

- proposal review with `approve / reject / modify / escalate`
- queue + reasoning + inspector surfaces
- audit logging for human decisions

Phase 5 adds three production-critical behaviours that were missing:

1. **Typed intervention modes**
   - `proposal_review`
   - `information_request`
   - `failure_recovery`

2. **Backend-enforced policy**
   - low-confidence approval is now blocked by backend policy, not just frontend UI
   - retry ceilings stop the agent from looping indefinitely

3. **Graceful recovery / takeover**
   - the agent can pause to ask for missing source-of-truth inputs
   - recoverable execution failures become retry/manual-takeover decisions
   - repeated rejection or exhausted retries leave autonomous flow cleanly

---

## The Mental Model

The important Phase 5 insight is:

> **Every sad path is another HITL mode.**

The question is not "did the agent fail?" but:

- **What kind of help does the human need to provide?**
- **Can the agent resume safely after that help?**
- **If not, how does the human take control without losing state or auditability?**

That leads to a typed contract between backend and frontend:

```text
proposal_review     -> approve | reject | modify | escalate
information_request -> provide_context | escalate
failure_recovery    -> retry | manual_takeover | escalate
```

The queue and right rail now respond to the intervention kind, not just the coarse thread status.

---

## What Was Implemented

### 1. Backend policy layer

`backend/agent/policy.py`

- `LOW_CONFIDENCE_THRESHOLD = 0.70`
- `HIGH_CONFIDENCE_THRESHOLD = 0.85`
- `MAX_INVESTIGATION_ATTEMPTS = 3`
- `MAX_EXECUTION_RETRIES = 2`

**Why this matters:** policy now lives in one place and is attached to intervention payloads, so backend and frontend reason from the same thresholds.

### 2. Richer agent state

`backend/agent/state.py`

Added Phase 5 state for:

- `additional_context`
- `execution_attempts`
- `failure_context`
- `manual_takeover_note`
- `manual_takeover` terminal status

This is what makes pause/resume/recovery legible instead of ad hoc.

### 3. Information-request interrupt

`backend/agent/nodes.py`

The investigate node can now pause before proposal generation and ask for missing source-of-truth data:

```python
# HITL: The agent cannot safely investigate further without a human
# supplying a source-of-truth answer, so execution is checkpointed here.
human_response = interrupt({
    "kind": "information_request",
    ...
})
```

If the operator supplies context, investigation continues. If they escalate, the graph ends cleanly.

### 4. Retry ceiling / stuck-agent handling

The agent no longer loops forever on rejection.

If the investigation retry ceiling is exhausted:

- the case stops autonomous flow,
- `failure_context` is populated,
- the thread transitions to `manual_takeover`.

This is a safety mechanism: "try forever" is dangerous in an ops workflow.

### 5. Recoverable execution failure flow

Execution can now hit a typed recovery interrupt instead of falling straight into a generic error:

```python
# HITL: A recoverable execution failure does not silently flip to error.
# The human is asked whether to retry, take manual control, or escalate.
recovery_decision = interrupt({
    "kind": "failure_recovery",
    ...
})
```

The operator can:

- retry,
- take manual ownership,
- escalate.

### 6. Expanded API contracts

`backend/api/models.py`

Added discriminated payloads for:

- `ProposalReviewInterruptPayload`
- `InformationRequestInterruptPayload`
- `FailureRecoveryInterruptPayload`

And expanded decision actions to include:

- `provide_context`
- `retry`
- `manual_takeover`

### 7. Supervision UI upgrade

Frontend now treats the action rail as a **multi-mode intervention surface**:

- proposal review surface
- information request form with requested fields
- recovery surface with retry / takeover / escalate paths

Queue and inspector now also distinguish:

- awaiting review,
- awaiting source-of-truth input,
- recovery required,
- manual resolution.

---

## Deterministic Learning Scenarios

To make Phase 5 testable without relying on the LLM to randomly produce the right failure, sample exceptions now carry scenario metadata:

- `TRD-9834` → forced low-confidence proposal
- `TRD-9841` → recoverable execution failure on first execution attempt
- `TRD-9855` → information request before investigation can continue

This is deliberate.

> **LEARNING:** When you want to understand agent failure handling, build deterministic fixtures for it. Otherwise you spend your time waiting for random behaviour instead of studying the pattern.

---

## What to Study

If you want the Phase 5 learning path, read these in order:

1. `backend/agent/policy.py`
2. `backend/agent/state.py`
3. `backend/agent/nodes.py`
4. `backend/api/models.py`
5. `frontend/lib/types.ts`
6. `frontend/components/DecisionSurface.tsx`

That sequence shows how a policy decision becomes:

`backend state -> interrupt payload -> API model -> TS union -> UI action surface`

---

## Validation

`backend/scripts/validate_phase5.py` exercises:

- low-confidence approval lock
- information-request interrupt and resume
- recoverable execution failure → retry
- reject loop → manual takeover after retry ceiling

This keeps Phase 5 demonstrable even when you do not have a live LLM available.
