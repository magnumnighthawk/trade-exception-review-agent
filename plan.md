## Your HITL Learning Thread — Build To Understand

This is the right instinct. Building it yourself is 10x more effective than reading docs. Let me map this out completely.

---

## Time Estimate — Honest Assessment

Given your background (React, TypeScript, LangGraph, Python already solid):

| Phase | Time Needed |
|---|---|
| Phase 1 — Agent core | 1 day |
| Phase 2 — Streaming UI | 1 day |
| Phase 3 — HITL interrupts | 1–2 days |
| Phase 4 — Supervision interface | 1–2 days |
| Phase 5 — Failure handling | 1 day |
| Phase 6 — CopilotKit/Vercel AI SDK layer | 1 day |
| **Total** | **6–8 days focused** |

If you get 3–4 hours per day, **this is achievable in 2 weeks.** The interview-readiness payoff starts from Day 3 — you don't need to finish everything to speak confidently.

---

## The Thread — One Build, Six Phases

### The Scenario You'll Build

**A Trade Exception Review Agent** — deliberately chosen because it mirrors what JPMC actually does in this role (settlements, reconciliation, margin calls).

The agent reviews flagged trade exceptions, investigates them, proposes a resolution — and a human operator supervises, steers, approves, or overrides at key points.

This is your story. By the end you can say:

> "I built a trade exception review system specifically to understand HITL patterns — let me walk you through the architecture."

That's a powerful interview moment.

---

## Phase 1 — Build The Agent Core
### Goal: Have a working LangGraph agent before touching any UI
### Time: 1 day

**What you're building:**

A LangGraph agent with 4 nodes:

```
[Receive Exception] → [Investigate] → [Propose Resolution] → [Execute Resolution]
```

**Concrete example to implement:**

```python
# The scenario
exception = {
    "trade_id": "TRD-9821",
    "type": "settlement_fail",
    "amount": 2_400_000,
    "counterparty": "Goldman Sachs",
    "reason": "IBAN mismatch"
}
```

```python
# LangGraph state
class TradeExceptionState(TypedDict):
    exception: dict
    investigation_notes: str
    proposed_resolution: str
    resolution_confidence: float  # 0.0 - 1.0
    human_decision: str           # "approve" | "reject" | "modify"
    final_resolution: str
    status: str
```

```python
# Nodes
def investigate_node(state):
    # LLM looks at the exception and investigates
    # Returns investigation_notes + proposed_resolution + confidence
    
def propose_resolution_node(state):
    # Based on investigation, proposes what to do
    # e.g. "Update IBAN to GB29NWBK60161331926819 and retry settlement"
    
def execute_resolution_node(state):
    # Actually executes — but ONLY after human approval
```

**What you learn in Phase 1:**
- How state flows through nodes
- How to attach confidence scores to agent outputs — critical for HITL
- Where the natural human intervention point is (before execution)

**The key insight to absorb:**

> The agent should never reach `execute_resolution_node` without a human decision in the state. That's your first HITL gate. Design it in from day one.

---

## Phase 2 — Streaming The Agent To A React UI
### Goal: See the agent "thinking" in real time in your browser
### Time: 1 day

This is where most engineers go wrong — they wait for the full response. Streaming is fundamental to HITL because operators need to see reasoning as it happens, not just the conclusion.

**Backend — FastAPI + LangGraph streaming:**

```python
@app.get("/stream/{trade_id}")
async def stream_exception_review(trade_id: str):
    async def generate():
        async for event in graph.astream_events(
            {"exception": get_exception(trade_id)},
            version="v2"
        ):
            # Stream each node's output as it happens
            if event["event"] == "on_chat_model_stream":
                chunk = event["data"]["chunk"].content
                yield f"data: {json.dumps({'type': 'token', 'content': chunk})}\n\n"
            
            elif event["event"] == "on_chain_end":
                node = event["name"]
                yield f"data: {json.dumps({'type': 'node_complete', 'node': node})}\n\n"
    
    return StreamingResponse(generate(), media_type="text/event-stream")
```

**Frontend — React streaming hook:**

```typescript
function useAgentStream(tradeId: string) {
  const [tokens, setTokens] = useState<string>("")
  const [currentNode, setCurrentNode] = useState<string>("")
  const [status, setStatus] = useState<"idle"|"streaming"|"waiting_human"|"complete">()

  useEffect(() => {
    const es = new EventSource(`/stream/${tradeId}`)
    
    es.onmessage = (e) => {
      const event = JSON.parse(e.data)
      
      if (event.type === "token") {
        setTokens(prev => prev + event.content)
      }
      if (event.type === "node_complete") {
        setCurrentNode(event.node)
        // When agent reaches HITL gate:
        if (event.node === "propose_resolution") {
          setStatus("waiting_human")  // UI now shows approval interface
        }
      }
    }
    
    return () => es.close()
  }, [tradeId])

  return { tokens, currentNode, status }
}
```

**What you learn in Phase 2:**
- SSE (Server-Sent Events) — the foundation of all streaming UIs
- How to translate agent events into UI state changes
- The moment `status` switches to `"waiting_human"` — that's your HITL gate in the UI
- Why Vercel AI SDK exists — it wraps exactly this pattern

**The key insight to absorb:**

> The UI status is driven by agent events, not by timers or polling. When the agent hits its interrupt point, the UI must know and must change. That's the contract between agent runtime and supervision surface.

---

## Phase 3 — LangGraph Human-In-The-Loop Interrupts
### Goal: Agent actually pauses and waits for human input
### Time: 1–2 days

This is the most important phase. LangGraph has built-in interrupt support — this is what makes it the right tool for this role.

**The interrupt pattern:**

```python
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import interrupt

# Add checkpointer — this is what enables pause/resume
checkpointer = MemorySaver()

def propose_resolution_node(state):
    # Agent has done its work, now it pauses
    proposed = generate_proposal(state["investigation_notes"])
    
    # THIS is the HITL interrupt
    # Execution stops here and waits
    human_decision = interrupt({
        "proposed_resolution": proposed["resolution"],
        "confidence": proposed["confidence"],
        "reasoning": proposed["reasoning"],
        "requires_approval": proposed["confidence"] < 0.85  # Gate based on confidence
    })
    
    return {
        "proposed_resolution": proposed["resolution"],
        "human_decision": human_decision["action"],  # comes back from UI
        "modification": human_decision.get("modified_resolution")
    }

# Build graph WITH checkpointer
graph = workflow.compile(
    checkpointer=checkpointer,
    interrupt_before=["execute_resolution"]  # Always interrupt before execution
)
```

**Resume endpoint — when human makes a decision:**

```python
@app.post("/decision/{thread_id}")
async def submit_decision(thread_id: str, decision: HumanDecision):
    config = {"configurable": {"thread_id": thread_id}}
    
    # Resume the graph with human's input
    result = await graph.ainvoke(
        Command(resume={"action": decision.action, 
                        "modified_resolution": decision.modification}),
        config=config
    )
    return result
```

**What you learn in Phase 3:**
- How `interrupt()` pauses execution and serialises state to the checkpointer
- How `thread_id` lets you resume the exact right agent instance
- The difference between `interrupt_before` (always gate) and confidence-based gating
- How the backend holds state between human interactions — this is non-trivial

**The key insight to absorb:**

> The agent isn't "waiting" — it's checkpointed. The thread_id is how you reconnect the human's decision to the right agent instance. At JPMC scale, thousands of these could be paused simultaneously. Your UI needs to manage this queue — that's the supervision surface.

---

## Phase 4 — The Supervision Interface
### Goal: Build the actual HITL UI — the cockpit
### Time: 1–2 days
### Status: ✅ BUILT

This is what the role is actually about. Three panels:

```
┌─────────────────────────────────────────────────────┐
│  PANEL 1: QUEUE          │  PANEL 2: AGENT REASONING│
│  All exceptions (pending │  Streaming thought process│
│  + in-flight + paused)   │  per selected thread      │
│  ▶ Run  ↺ Reset per row  │  Node pipeline status     │
├──────────────────────────┤                           │
│  TRD-9821 🔴 HIGH       │  "Investigating IBAN...   │
│  ⚡ Awaiting Review      │   Found mismatch in...    │
│  TRD-9834 🟡 MEDIUM     │   Confidence: 72%"        │
│  Investigating…          │                           │
│  TRD-9841 🟢 LOW        │                           │
│  Awaiting Run            │                           │
└──────────────────────────┴───────────────────────────┘
│  PANEL 3: DECISION SURFACE                           │
│  Proposed: Update IBAN to GB29... and retry          │
│  [APPROVE]  [REJECT]  [MODIFY ▼]  [ESCALATE]        │
└──────────────────────────────────────────────────────┘
```

**The key architectural shift from single- to multi-thread supervision:**

Phase 2/3 used `useAgentStream` — a single-session hook that tracked one active review at a time. Selecting a different trade reset all state.

Phase 4 replaces this with `useSupervisionThreads`, which:
- Maintains independent per-thread sessions keyed by `thread_id`
- Opens concurrent SSE streams (multiple exceptions run in parallel)
- Selecting a thread only changes the *view* — not the thread's state
- Each thread independently progresses: `idle → starting → streaming → waiting_human → complete`

```typescript
// hooks/useSupervisionThreads.ts
// Each session is independently tracked in a Record<threadId, ThreadSession>
type ThreadSession = {
  threadId: string
  status: AgentStatus | "running"
  tokens: string          // that thread's streaming output
  nodeHistory: string[]
  interruptPayload: InterruptPayload | null  // set when waiting_human
  finalState: Partial<AgentStateSnapshot> | null
}

// Multiple SSE streams open simultaneously:
const streamRefs = useRef<Record<string, EventSource>>({})

// Switching threads only changes selectedThreadId — does NOT close/reset others
const selectQueueItem = (item: QueueItem) => {
  setSelectedTradeId(item.trade_id)
  if (item.thread_id) setSelectedThreadId(item.thread_id)
}
```

**Queue is real, not mocked — fed from the backend:**

```
GET /queue/       → returns pending exceptions (from fixtures) + active threads
                    deduplicated to latest thread per trade
                    sorted: waiting_human → streaming → idle → complete

POST /review/start → idempotent: reuses active thread for same trade
                     creates new thread only if previous is complete/error

POST /review/{thread_id}/reset → removes thread from state_store,
                                  trade returns to idle/pending in queue
```

**Per-row `▶ Run` / `↺ Reset` controls:**
- `▶ Run` is only enabled for `idle` (pending) exceptions — clicking it calls `POST /review/start`, registers a thread, opens an SSE stream
- `↺ Reset` calls `POST /review/{thread_id}/reset`, tears down the session, returns trade to pending
- Both are independent per-row — resetting TRD-9821 does not affect TRD-9834's in-flight stream

**What you learn in Phase 4:**
- The difference between single-session and fleet supervision — one hook manages many concurrent SSE streams
- How `thread_id` is used as a session key to keep per-thread state isolated in the frontend
- How confidence scores drive UI behaviour — not just display (approval gating at 0.70)
- The four human actions (approve/reject/modify/escalate) and what each means downstream
- How a queue of pending + paused + in-flight agents is managed — this is the "fleet supervision" the JD mentions
- Why audit trail matters in regulated environments — log every decision with timestamp + operator ID

**The key insight to absorb:**

> The modify path is the most interesting HITL pattern. The human isn't just approving or rejecting — they're steering the agent mid-flight. That modified input goes back into the agent's state and changes what it does next. That's steering, not just oversight.

> The second key insight: switching threads in a multi-agent supervision UI must be stateless from the agent's perspective. The agent doesn't know you're looking at it. `thread_id` is the only connection between the UI and the checkpointed agent. The UI can switch views freely without disturbing any running stream.

---

## Phase 5 — Happy Path, Sad Path, Failures
### Goal: Handle everything that goes wrong
### Time: 1 day
### Status: ✅ BUILT

Phase 5 is now implemented as a typed intervention system rather than a generic error path.

- `proposal_review` keeps the existing approve / reject / modify / escalate contract
- `information_request` lets the agent pause for missing source-of-truth inputs
- `failure_recovery` lets operators retry, escalate, or take manual ownership after recoverable failures

Concrete implementation notes:

- backend policy now enforces low-confidence approval locks and retry ceilings
- repeated rejection can end in `manual_takeover` instead of looping forever
- recoverable execution failures checkpoint into a human recovery decision instead of silently failing
- the right rail adapts to the intervention mode rather than assuming every pause is proposal review

See [`docs/phases/phase-5-failure-paths.md`](docs/phases/phase-5-failure-paths.md) for the full Phase 5 walkthrough.

**Happy Path:**
```
Exception received → Agent investigates → High confidence (>85%) → 
Human reviews streaming reasoning → Approves → Agent executes → 
Resolution logged → Case closed
```
Everything works, confidence is high, human agrees with agent.

**Sad Path 1 — Low Confidence:**
```
Exception received → Agent investigates → Low confidence (< 70%) →
UI shows warning → Human reviews extra carefully →
Human modifies proposal → Modified resolution sent back →
Agent re-evaluates with modification → Executes modified resolution
```

```python
# In your agent
def propose_resolution_node(state):
    proposal = generate_proposal(state)
    
    # Always interrupt if confidence is low
    # Optionally interrupt if high — based on policy
    if proposal["confidence"] < 0.85 or state["exception"]["amount"] > 1_000_000:
        human_input = interrupt({...})
```

**Sad Path 2 — Agent Gets Stuck:**
```
Exception received → Agent investigates → 
Cannot determine root cause → Agent signals "insufficient information" →
UI shows escalation required → Human adds context →
Agent resumes with additional context
```

```python
def investigate_node(state):
    result = llm.invoke(investigation_prompt)
    
    if "insufficient information" in result.content.lower():
        # Agent signals it needs help — this is a HITL trigger too
        additional_context = interrupt({
            "type": "information_request",
            "question": "Cannot determine counterparty IBAN. Please provide correct IBAN.",
            "fields_needed": ["correct_iban", "source_of_truth"]
        })
        # Resume with human-provided context
        state["additional_context"] = additional_context
```

**Sad Path 3 — Human Rejects:**
```
Agent proposes → Human rejects → 
Agent asked to re-investigate with rejection reason →
Second proposal generated → Human reviews again
```

```python
def execute_resolution_node(state):
    if state["human_decision"] == "reject":
        # Loop back to investigation with rejection context
        return {"status": "rejected", "next": "investigate"}
    
    if state["human_decision"] == "escalate":
        # Route to senior operator queue — out of agent's hands
        notify_senior_operator(state)
        return {"status": "escalated"}
```

**Failure Path — Agent Errors Mid-Flight:**
```
Agent running → LLM API timeout / tool call fails →
Agent state preserved in checkpoint →
UI shows "Agent interrupted - error" →
Human can retry or take manual control
```

```typescript
// In your streaming hook
es.onerror = (e) => {
  setStatus("error")
  // Don't lose context — show what agent had done up to this point
  // Give human option to retry or manually resolve
}
```

**The key insight to absorb:**

> Every sad path and failure path is a HITL opportunity. The question isn't "what do we do when it fails?" — it's "how does the human take control gracefully when it fails?" That's what this role is designing. A system that fails silently or loses state is dangerous in a financial context.

---

## Phase 6 — Layer Vercel AI SDK / CopilotKit On Top
### Goal: Understand what these frameworks abstract — from a position of knowledge
### Time: 1 day

By now you've built everything manually. Now when you look at these frameworks, you'll recognise exactly what they're doing.

**Vercel AI SDK — replace your manual SSE hook:**

```typescript
// What you built manually in Phase 2
// Now with Vercel AI SDK
import { useChat } from "ai/react"

function AgentReasoningPanel({ tradeId }) {
  const { messages, isLoading, data } = useChat({
    api: `/api/review/${tradeId}`,
    // data channel carries structured events alongside tokens
    onFinish: (message) => {
      if (message.annotations?.includes("awaiting_human")) {
        setStatus("waiting_human")
      }
    }
  })
}
```

**The interview moment this creates:**

> "I built the streaming layer manually first using SSE and custom React hooks, which gave me a deep understanding of the event flow. When I then looked at Vercel AI SDK, I could immediately see what `useChat` abstracts — the SSE connection management, message state accumulation, and the data channel for structured events alongside tokens. I'd adopt it in production because it's well-maintained and handles edge cases I'd otherwise have to build myself."

That's an answer that earns respect.

---

## Your Day-By-Day Plan

```
Day 1   → Phase 1: LangGraph agent, state design, confidence scores          ✅ DONE
Day 2   → Phase 2: FastAPI streaming, React SSE hook, status machine          ✅ DONE
Day 3   → Phase 3: LangGraph interrupts, checkpointer, resume endpoint        ✅ DONE
Day 4   → Phase 4: Multi-thread supervision UI                                ✅ DONE
            - useSupervisionThreads: per-thread sessions, concurrent SSE streams
            - ExceptionQueue: real backend queue, ▶ Run / ↺ Reset per row
            - Queue API: pending + active exceptions, dedup, idempotent start
            - DecisionSurface: confidence gating, modify/reject/escalate/approve
Day 5   → Phase 5: Sad paths and failure handling                              ✅ DONE
            - Typed intervention modes: proposal review / information request / failure recovery
            - Backend-enforced approval locks, retry ceilings, and manual takeover
            - Deterministic Phase 5 validation script and dedicated docs
Day 6   → Phase 6: Vercel AI SDK / CopilotKit exploration on top
Day 7-8 → Polish + practice explaining it out loud
```

---

## The Interview Story This Creates

By the end of this build, you can say:

> "I built a trade exception review system to understand HITL patterns end to end. I started with a LangGraph agent that investigated and proposed resolutions, then built a streaming supervision UI in React where operators could see reasoning in real time. The most interesting part was designing the interrupt and resume pattern — the agent checkpoints its state, the UI surfaces the proposal with a confidence indicator, and the human can approve, reject, modify, or escalate. I handled low confidence paths, information-request interrupts where the agent signals it needs human input to proceed, and failure recovery. That gave me a solid foundation to then look at CopilotKit and Vercel AI SDK — I could immediately see what they were abstracting and why."

**That's a VP-level answer.** Grounded, specific, shows system thinking, honest about the learning journey.

---

Want me to give you the **exact starter code** for Phase 1 right now so you can begin today?
