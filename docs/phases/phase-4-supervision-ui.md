# Phase 4 — Supervision Interface: The Operator's Cockpit

## The Mental Model

By Phase 3, we built a **single-threaded agent supervision flow**: start an exception → stream reasoning → hit interrupt → checkpoint → human decision → resume.

Phase 4 zooms out. In a real settlement operations team (JPMC, BNY, etc.), there are **dozens of exceptions under review simultaneously**. Some are paused waiting for human decisions. Some are in-flight. Some just completed. Some failed and escalated.

The operator's job is to:
1. **Triage**: See all paused exceptions, sorted by urgency and confidence
2. **Investigate**: Stream the agent's reasoning for the selected exception
3. **Decide**: Approve, reject, modify, or escalate with full context
4. **Audit**: Every decision is logged with operator ID, timestamp, and rationale

This phase builds the **multi-threaded supervision cockpit** — the Three-Panel UI married to backend endpoints that make it work.

```
┌──────────────────────────────────────────────────────────────┐
│ PANEL 1: QUEUE          │ PANEL 2: TIMELINE & REASONING      │
│ All paused exceptions   │ Workflow visualization + streaming │
│ Sorted by confidence    │ node status + tool calls           │
│ + urgency + amount      │                                    │
├─────────────────────────┴────────────────────────────────────┤
│ PANEL 3: DECISION SURFACE                                    │
│ Proposal + confidence bar + four actions + audit fields      │
└──────────────────────────────────────────────────────────────┘
```

---

## Key Insights

### 1. **Confidence is a Gate**

The agent assigns a confidence score (0.0–1.0) to every proposal.

- **High confidence (>0.85)**: Operator can approve with a glance
- **Medium confidence (0.70–0.85)**: Operator must review reasoning
- **Low confidence (<0.70)**: Red warning; operator should modify or escalate

This is **policy**, not hardcoded. It lives in `CONFIDENCE_THRESHOLDS` config so settlement teams can tune it.

### 2. **The Modify Path is Steering**

Most HITL designs support: Approve | Reject | Escalate.

The **modify path** is more powerful:

```
[Agent proposes] → [Human reviews] → [Human modifies] → 
[Modification becomes state] → [Agent re-evaluates] → [New proposal]
```

This is **steering** — the human doesn't just gate; they co-author the resolution mid-flight. The agent learns from the feedback.

In code:

```python
# backend/api/routes/decision.py
@router.post("/{thread_id}/decision")
async def submit_decision(thread_id: str, decision: HumanDecision):
    if decision.action == "modify":
        # Modification becomes part of the agent state
        command = Command(resume=decision.modification)
        # Agent's next invocation sees the modification
```

### 3. **Audit Trail is Non-Negotiable**

Every decision is logged:

```python
# backend/checkpointer/audit_log.py
@dataclass
class AuditEntry:
    timestamp: datetime
    operator_id: str
    thread_id: str
    exception_id: str
    decision: str  # "approve" | "reject" | "modify" | "escalate"
    modification: Optional[str]
    confidence_before: float
    reason: str
    agent_proposal: str
```

In production, this lives in a regulated system (Postgres, AWS S3) with immutable writes. Settlements teams are audited by regulators (OCC, CFTC). If a settlement failed, auditors ask: "Who approved this exception? When? Why?"

### 4. **Queue Sorting is Policy**

Operators see paused exceptions sorted by:

- **Urgency**: Amount at risk (higher = more urgent)
- **Confidence**: Low confidence first (needs more review)
- **Age**: Older exceptions first (stale = risky)

This is the **triage order**. It's not hardcoded; it's computed in the backend so teams can adjust.

```python
# Pseudo-code for queue sorting
def sort_queue(exceptions):
    return sorted(
        exceptions,
        key=lambda e: (
            -1 if e.confidence < 0.7 else 0,  # Low confidence first
            -e.amount,  # Higher amount first
            e.created_at  # Older first
        )
    )
```

---

## API Additions for Phase 4

### 1. **GET /queue/waiting** — All Paused Exceptions

```http
GET /queue/waiting?sort=confidence&limit=50

Response:
{
  "total": 12,
  "exceptions": [
    {
      "thread_id": "d1ac027c-...",
      "trade_id": "TRD-9821",
      "exception_type": "IBAN Mismatch",
      "counterparty": "Goldman Sachs",
      "amount": 2_400_000,
      "status": "waiting_human",
      "created_at": "2026-05-04T14:23:00Z",
      "confidence": 0.72,
      "urgency_score": 850,  # Composite: amount + age + confidence
      "agent_proposal": "Update IBAN to GB29... and retry",
      "investigation_summary": "Counterparty IBAN changed in 2025"
    },
    ...
  ]
}
```

**What the UI does**:
- Polls this endpoint every 2 seconds
- Displays as a sortable table with risk badges
- Click a row to load that `thread_id` into the inspection panels
- Shows visual indicators: 🔴 high risk, 🟡 medium, 🟢 low

### 2. **GET /queue/audit** — Decision History

```http
GET /queue/audit?thread_id=d1ac027c-...&limit=20

Response:
{
  "thread_id": "d1ac027c-...",
  "audit_entries": [
    {
      "timestamp": "2026-05-04T14:35:00Z",
      "operator_id": "ops_johndoe",
      "decision": "modify",
      "modification": "Change IBAN to GB29 and log in comment field",
      "reason": "Counterparty sent updated IBAN via email",
      "confidence_before": 0.72,
      "agent_proposal_before": "Update IBAN to GB29..."
    }
  ]
}
```

### 3. **POST /queue/audit** — Log a Decision

```http
POST /queue/audit
{
  "thread_id": "d1ac027c-...",
  "operator_id": "ops_johndoe",
  "decision": "approve",
  "modification": null,
  "reason": "Confidence is 82%, counterparty confirmed, safe to proceed",
  "confidence_before": 0.82,
  "agent_proposal": "Update IBAN to GB29... and retry"
}

Response:
{
  "audit_entry_id": "audit_20260504_14350000",
  "timestamp": "2026-05-04T14:35:00Z"
}
```

---

## Frontend Components (Phase 4)

### 1. **ExceptionQueue** (Enhanced)

**Responsibilities**:
- Display paused exceptions with visual urgency badges
- Real-time polling of `/queue/waiting`
- Sort and filter controls (by confidence, amount, age)
- Click to select and load into inspection panels

**Key Props**:
```typescript
interface ExceptionQueueProps {
  selectedThreadId: string | null
  onSelectThread: (threadId: string) => void
  refreshInterval?: number  // Poll every N ms
}

interface QueueItem {
  thread_id: string
  trade_id: string
  exception_type: string
  counterparty: string
  amount: number
  confidence: number
  urgency_score: number
  status: AgentStatus
  created_at: string
}
```

**What it looks like**:
```
┌─ PAUSED EXCEPTIONS (12) ──────────────────────────┐
│ Trade ID  Type              Amount      Conf Risk │
├───────────────────────────────────────────────────┤
│ TRD-9821 🔴 IBAN Mismatch  $2.4M       72% HIGH │ ← Selected
│ TRD-9834 🟡 Amount Disc.   $875K       68% CRIT │
│ TRD-9841 🟢 Settlement     $45K        91% LOW  │
└───────────────────────────────────────────────────┘
```

### 2. **WorkflowTimeline** (New)

**Responsibility**: Visualize the agent's execution path with node status and timing.

**Key Props**:
```typescript
interface WorkflowTimelineProps {
  nodes: NodeExecution[]
  currentNode?: string
  isRunning: boolean
}

interface NodeExecution {
  node_id: string
  status: "pending" | "running" | "complete" | "interrupted" | "error"
  started_at?: string
  completed_at?: string
  duration_ms?: number
  error_message?: string
}
```

**What it looks like**:
```
┌─ WORKFLOW EXECUTION ────────────────────────────┐
│                                                 │
│ ⏱ 0ms   ✓ Receive Exception (42ms)             │
│ ⏱ 42ms  ✓ Investigate (1240ms)                 │
│ ⏱ 1282ms ⧗ Propose Resolution (★ WAITING)     │
│                                                 │
│ Last Event: waiting_human                      │
│ Next Expected: human decision                  │
└─────────────────────────────────────────────────┘
```

### 3. **DecisionSurface** (Enhanced)

**Responsibility**: Present the agent's proposal + confidence + decision controls.

**Key additions**:
- Confidence bar with threshold warnings
- Modification text input (for steering)
- Escalation category dropdown
- Operator ID input (audit capture)
- Decision rationale field (audit logging)
- Undo/redo for modifications

**Decision Types**:
- **Approve**: Proceed with agent's proposal
- **Reject**: Send back to agent for re-investigation
- **Modify**: Change the proposal, send modification to agent
- **Escalate**: Send to senior operator, mark case as escalated

---

## State Changes for Phase 4

### Backend: `TradeExceptionState`

```python
class TradeExceptionState(TypedDict):
    # Existing fields from Phases 1-3
    thread_id: str
    exception: dict
    investigation: str
    investigation_attempts: int
    status: str
    
    # NEW Phase 4: Audit trail
    audit_log: list[dict]  # [{"timestamp": ..., "operator_id": ..., "decision": ...}, ...]
    human_decision: Optional[dict]  # {"operator_id": ..., "action": ..., "reason": ...}
    human_modification: Optional[str]  # If action == "modify", the modification text
    escalated_to: Optional[str]  # If action == "escalate", who/where
    
    # Confidence tracking
    confidence_score: float
    confidence_updated_at: str
```

### Frontend: Queue State

```typescript
// hooks/useExceptionQueue.ts
interface UseExceptionQueueReturn {
  exceptions: QueueItem[]
  selectedThreadId: string | null
  isLoading: boolean
  error?: string
  
  selectThread: (threadId: string) => Promise<void>
  refreshQueue: () => Promise<void>
  sortBy: (field: "confidence" | "amount" | "age") => void
}
```

---

## How Confidence Gates Decision Flow

```
Agent proposes resolution with confidence score
       ↓
┌─ confidence > 0.85? ────┐
│ LOW FRICTION APPROVE    │  Operator can glance, click ✓
├─ 0.70 < confidence < 0.85? ─┐
│ REVIEW REQUIRED         │  Operator MUST read reasoning
├─ confidence < 0.70? ────┐
│ RED ALERT + MODIFY      │  Operator MUST modify or escalate
└─────────────────────────┘
       ↓
   Decision logged in audit_log
       ↓
   Modified state sent back to agent (if modify)
       ↓
   Agent continues with human input
```

In code:

```typescript
// frontend/components/DecisionSurface.tsx
function DecisionSurface({ proposal, confidence }) {
  const [requiresModification, setRequiresModification] = useState(false)
  
  useEffect(() => {
    if (confidence < 0.70) {
      setRequiresModification(true)  // Force operator to interact
    }
  }, [confidence])
  
  const canApprove = confidence > 0.70  // Require review at least
  
  return (
    <>
      <ConfidenceBar value={confidence} />
      {confidence < 0.70 && (
        <WarningBox>
          Agent confidence is low. Modify proposal or escalate.
        </WarningBox>
      )}
      <button disabled={!canApprove && !requiresModification}>
        Approve
      </button>
    </>
  )
}
```

---

## The Modify → Re-Invoke Path (Steering)

This is the most interesting pattern. Here's how it works end-to-end:

**Backend**:
```python
# decision.py
@router.post("/{thread_id}/decision")
async def submit_decision(thread_id: str, decision: HumanDecision):
    config = {"configurable": {"thread_id": thread_id}}
    
    # Log the decision first
    audit_entry = {
        "timestamp": datetime.now(),
        "operator_id": decision.operator_id,
        "action": decision.action,
        "modification": decision.modification,
        "reason": decision.reason,
    }
    
    if decision.action == "approve":
        # Resume without changes
        graph.invoke(Command(resume=True), config=config)
    
    elif decision.action == "modify":
        # Modification becomes part of next invocation
        # The agent sees: "Human modified to: {modification}"
        # The agent can then re-evaluate with this constraint
        graph.invoke(
            Command(resume={"human_modification": decision.modification}),
            config=config
        )
    
    elif decision.action == "reject":
        # Send agent back to investigation
        graph.invoke(
            Command(resume={"retry_investigation": True}),
            config=config
        )
    
    elif decision.action == "escalate":
        # Mark for senior review, don't resume
        state = graph.get_state(config)
        state["escalated_to"] = decision.escalation_category
        # Checkpointer persists; case goes to escalation queue
```

**Frontend**:
```typescript
// DecisionSurface.tsx
async function submitModification(modificationText: string) {
  const response = await fetch(`/decision/${threadId}`, {
    method: "POST",
    body: JSON.stringify({
      action: "modify",
      modification: modificationText,
      operator_id: operatorId,
      reason: "Agent should reconsider with this constraint",
    }),
  })
  
  // The decision is logged
  // The agent's next invocation reads the modification
  // UI streams new reasoning
  startStreamingAgentReasoning(threadId)
}
```

**Agent**:
```python
# In propose_resolution_node
def propose_resolution_node(state: TradeExceptionState):
    if state.get("human_modification"):
        # Agent has received human steering
        prompt = f"""
        The operator has modified your proposal:
        "{state['human_modification']}"
        
        Consider this modification and propose a resolution
        that respects the operator's constraint.
        """
    else:
        prompt = "Propose a resolution based on your investigation."
    
    # Agent re-evaluates with the modification in mind
```

This is **steering**. The human and agent are co-authoring the resolution.

---

## Audit Trail Best Practices

Every decision is immutable. In production:

```sql
CREATE TABLE audit_log (
    id SERIAL PRIMARY KEY,
    thread_id UUID,
    trade_id VARCHAR,
    timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    operator_id VARCHAR NOT NULL,
    decision VARCHAR NOT NULL CHECK (decision IN ('approve', 'reject', 'modify', 'escalate')),
    modification TEXT,
    reason TEXT,
    confidence_before FLOAT,
    agent_proposal TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Immutable: no UPDATE or DELETE on audit_log
-- This is what auditors review
```

For Phase 4, we'll use in-memory storage (list of dicts), with a TODO to migrate to Postgres.

---

## Concept Checks for Interview Prep

1. **Why is confidence a gate, not just a display?**
   - Low confidence means the agent is uncertain. Automation at low confidence is dangerous. Confidence gates the UI behavior (approval buttons, warnings).

2. **What does modify do that approve/reject don't?**
   - Modify sends human feedback back into the agent's next invocation. The agent can then re-evaluate with the human's constraint. That's **steering**, not just gating.

3. **Why log every decision with operator ID and timestamp?**
   - Auditability. If a settlement fails, regulators ask "who approved this? when? why?" The audit trail is the answer.

4. **What's the difference between "waiting_human" and "escalated"?**
   - waiting_human: paused in the queue, waiting for operator decision. Operator can approve/reject/modify.
   - escalated: case left the primary queue, sent to senior operator or external system. Out of scope for this agent.

5. **How does the UI know when to refresh the queue?**
   - Polling GET /queue/waiting every 2–5 seconds. In production, this would be WebSocket (real-time) to avoid polling overhead at scale.

---

## End-to-End Flow

```
1. QUEUE
   Operator sees paused exceptions
   TRD-9821 | $2.4M | 72% confidence | HIGH RISK
   
2. SELECT
   Operator clicks TRD-9821
   Frontend makes GET /review/{thread_id}/stream
   
3. STREAM
   WebSocket/SSE streams agent reasoning in real-time
   "Investigating IBAN..."
   "Found mismatch: expected GB29..., got GB28..."
   "Confidence: 72%"
   
4. TIMELINE
   WorkflowTimeline shows execution path
   Receive Exception (42ms) → Investigate (1240ms) → Propose (★ waiting)
   
5. PROPOSAL
   Agent proposes: "Update IBAN to GB29... and retry settlement"
   Confidence bar shows 72% (yellow, requires review)
   
6. DECIDE
   Operator reads reasoning
   Clicks MODIFY (because confidence is low)
   Types: "Confirm with counterparty first, then update IBAN"
   
7. SUBMIT
   Modification sent to POST /decision/{thread_id}
   - action: "modify"
   - modification: "Confirm with counterparty first, then update IBAN"
   - operator_id: "ops_johndoe"
   - reason: "Need explicit counterparty consent"
   
8. AUDIT
   Decision logged in audit_log
   timestamp: 2026-05-04T14:35:00Z
   operator_id: ops_johndoe
   decision: modify
   
9. RESUME
   Graph invokes with modification in state
   Agent reads: "Human modified to: Confirm with counterparty first..."
   Agent re-evaluates
   New proposal: "Contact counterparty to confirm new IBAN, then update..."
   
10. STREAM AGAIN
    New reasoning streams to UI
    Operator reviews new proposal
    Clicks APPROVE
    
11. EXECUTE
    Agent executes modified resolution
    Case closed, logged
```

---

## What to Build in Phase 4

### Backend
1. `GET /queue/waiting` — Return all paused exceptions with sorting
2. `GET /queue/audit` — Return audit history for a thread
3. `POST /queue/audit` — Log a decision
4. Enhance `TradeExceptionState` with `audit_log` and `human_decision` fields
5. Update `decision.py` to log decisions to audit trail

### Frontend
1. **ExceptionQueue.tsx** — Enhanced with polling, risk badges, click-to-select
2. **WorkflowTimeline.tsx** — Show node execution timeline
3. **DecisionSurface.tsx** — Add confidence gate, modification input, audit fields
4. **useExceptionQueue.ts** — Hook for polling `/queue/waiting`
5. **hooks/useAuditLog.ts** — Hook for submitting decision to `/queue/audit`

### Documentation
1. **phase-4-supervision-ui.md** — This file (conceptual walkthrough)
2. **concept checks** in docs for interview prep

---

## Key Takeaway

Phase 4 is about **scale and auditability**.

Phase 3 was: one agent, one human, one decision.
Phase 4 is: many agents, one operator, supervised fleet.

The operator triages by confidence and urgency.
The operator steers by modifying proposals.
Every decision is logged for auditors.

This is what production HITL looks like.
