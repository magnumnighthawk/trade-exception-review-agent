# Trade Exception Review Agent — Copilot Instructions

## What This Repo Is

This is a **learning-by-building** project. The goal is to deeply understand how to build production-grade AI agents with Human-in-the-Loop (HITL) patterns, using a real-world financial use case as the vehicle.

The system we are building: a **Trade Exception Review Agent** that mirrors what settlement and operations teams do at firms like JPMC. The agent reviews flagged trade exceptions, investigates root causes, proposes resolutions — and a human operator supervises, steers, approves, or overrides at key decision points.

**This is not just a demo. The code should be written as if it will run in production.**

---

## The Learning Intent

Every decision in this codebase is an opportunity to understand:

1. **How state flows through an agent graph** — LangGraph nodes, typed state, reducers
2. **How confidence scores gate human intervention** — not every action needs human review; the agent earns autonomy
3. **How streaming works end to end** — from LLM token to React UI update
4. **How interrupts and checkpoints enable pause/resume** — the backbone of HITL
5. **How to build a supervision surface** — a professional UI for humans overseeing agents
6. **How failure and uncertainty surface gracefully** — an agent that fails silently is dangerous

When Copilot generates code in this repo, it should:
- **Always explain the design decision** in an inline comment when something is non-obvious
- **Flag HITL-relevant moments** with `# HITL:` or `// HITL:` comments so they are easy to spot
- **Surface trade-offs** — e.g. why we use `interrupt()` vs a conditional branch
- **Point out where the pattern is reusable** — beyond this specific use case

---

## Architecture Overview

```
trade-exception-review-agent/
├── backend/                    # FastAPI + LangGraph agent
│   ├── agent/
│   │   ├── graph.py            # LangGraph graph definition
│   │   ├── nodes.py            # Individual agent node functions
│   │   ├── state.py            # TypedDict state definition
│   │   ├── prompts.py          # LLM prompt templates
│   │   └── tools.py            # Agent tools (IBAN lookup, trade history, etc.)
│   ├── api/
│   │   ├── routes/
│   │   │   ├── stream.py       # SSE streaming endpoint
│   │   │   ├── decision.py     # Human decision submission endpoint
│   │   │   └── queue.py        # Paused agent queue endpoint
│   │   └── models.py           # Pydantic request/response models
│   ├── checkpointer/           # State persistence layer
│   └── main.py
├── frontend/                   # Next.js 14 + TypeScript supervision UI
│   ├── app/
│   │   └── dashboard/
│   │       └── page.tsx        # Main supervision surface
│   ├── components/
│   │   ├── ExceptionQueue.tsx  # Panel 1 — queue of paused agents
│   │   ├── AgentReasoning.tsx  # Panel 2 — streaming thought process
│   │   └── DecisionSurface.tsx # Panel 3 — approve/reject/modify/escalate
│   └── hooks/
│       └── useAgentStream.ts   # SSE streaming hook
├── docs/
│   ├── phases/
│   │   ├── phase-1-agent-core.md
│   │   ├── phase-2-streaming.md
│   │   ├── phase-3-hitl-interrupts.md
│   │   ├── phase-4-supervision-ui.md
│   │   ├── phase-5-failure-paths.md
│   │   └── phase-6-vercel-ai-sdk.md
│   └── concepts/
│       ├── hitl-patterns.md
│       ├── langgraph-internals.md
│       └── confidence-scoring.md
└── plan.md
```

---

## Build Phases

| Phase | What | Key Learning |
|---|---|---|
| 1 | Agent core — LangGraph graph, state, nodes | State design, confidence gates, HITL insertion points |
| 2 | Streaming — FastAPI SSE + React hook | Event-driven UI state, streaming architecture |
| 3 | HITL Interrupts — pause/resume with checkpointer | `interrupt()`, `thread_id`, state serialisation |
| 4 | Supervision UI — three-panel cockpit | Queue management, decision surface, fleet oversight |
| 5 | Failure paths — sad paths, errors, escalation | Graceful degradation, human takeover |
| 6 | Vercel AI SDK / CopilotKit layer | Framework abstraction, production adoption |

Build and understand Phase 1 before touching Phase 2. The depth compounds.

---

## Technical Stack

| Layer | Technology | Why |
|---|---|---|
| Agent runtime | LangGraph (Python) | Built-in interrupt/resume, checkpointing, graph visualisation |
| LLM | OpenAI GPT-4o | Reliable, well-documented, good for financial text |
| API layer | FastAPI | Async, SSE support, clean Pydantic integration |
| State persistence | LangGraph MemorySaver → Postgres | Start in-memory, graduate to persistent |
| Frontend | Next.js 14 + TypeScript | App router, server components, good for dashboards |
| Streaming | EventSource API → Vercel AI SDK | Build manually first to understand, then adopt SDK |
| Styling | Tailwind CSS + shadcn/ui | Fast, professional, accessible |

---

## Coding Standards for This Repo

### Python (backend)
- Use `TypedDict` for all LangGraph state — never raw dicts
- Every node function must have a type signature: `def node(state: TradeExceptionState) -> dict`
- Mark all HITL gates with `# HITL: [reason for human intervention]`
- Use `interrupt()` from LangGraph — never build pause/resume manually
- Log every state transition — in a financial system, audit trail is non-negotiable

### TypeScript (frontend)
- Use strict TypeScript — no `any`
- Agent status is a discriminated union: `"idle" | "streaming" | "waiting_human" | "complete" | "error"`
- Every HITL-triggered UI state change must be driven by an agent event, not a timer
- Decision submissions must be optimistically updated in UI but confirmed from backend

### Comments
- `# HITL:` — marks a human-in-the-loop decision point
- `# LEARNING:` — explains why something is done this way, for educational context
- `# TRADE-OFF:` — explains what we gave up for what we gained
- `# PRODUCTION:` — marks what would change in a real production system

---

## Key Concepts to Internalize

### The HITL Contract
The agent and the UI have a contract: **when the agent hits an interrupt point, the UI must know and must change.** The agent is not "waiting" — it is checkpointed. The `thread_id` is the reconnection mechanism. Never lose a thread_id.

### Confidence as a Gate
The agent assigns a confidence score (0.0–1.0) to every proposal. This score drives whether and how urgently a human is invoked. A score >0.85 on a low-value exception may auto-approve; a score <0.70 always triggers mandatory human review. This is policy, and policy belongs in config, not hardcoded.

### The Four Human Actions
Every HITL decision point supports exactly four responses:
- **Approve** — agent proceeds as proposed
- **Reject** — agent loops back to re-investigate
- **Modify** — human steers the agent's next action (the most powerful pattern)
- **Escalate** — case leaves this agent entirely, goes to senior queue

### Steering vs. Oversight
Most people think HITL = oversight (human watches, approves or rejects). The more powerful pattern is **steering** — the human modifies the agent's proposal and the agent continues with the human's input as part of its state. That's a different cognitive model of human-AI collaboration.

---

## What Good Looks Like

By the time Phase 4 is complete, a human operator should be able to:
1. See a live queue of all paused agent threads, sorted by urgency and confidence
2. Click into any thread and see the agent's streaming reasoning from the start
3. Understand what the agent proposes and why, with a confidence indicator
4. Approve, reject, modify, or escalate with one action
5. Have every decision logged with timestamp, operator ID, and full state at decision time

That is a professional supervision surface. That is what this role is about.
