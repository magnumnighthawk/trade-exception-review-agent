# Trade Exception Review Agent

A production-grade AI agent with Human-in-the-Loop (HITL) patterns, built to teach agent architecture through a real-world financial use case.

---

## What This Builds

```
[receive_exception] → [investigate] → [propose_resolution] →★ [execute_resolution]
                                              ↑                      |
                                              └── (if rejected) ─────┘
```

★ = HITL interrupt — agent pauses, human approves/rejects/modifies/escalates

By Phase 4, you'll have a three-panel supervision cockpit where operators see agent reasoning in real-time and steer agent decisions.

---

## Quick Start — Phase 1

### 1. Set up Python environment

```bash
cd trade-exception-review-agent
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

### 2. Add your OpenAI key

```bash
cp backend/.env.example backend/.env
# Edit backend/.env and set OPENAI_API_KEY
```

### 3. Run the agent interactively

```bash
python -m backend.scripts.run_phase1 TRD-9821
```

Try the four decisions: `a` (approve), `r` (reject), `m` (modify), `e` (escalate).

Available trade IDs: `TRD-9821`, `TRD-9834`, `TRD-9841`, `TRD-9855`

---

## Learning Path

| Phase | Start here | Time |
|---|---|---|
| **Phase 1** — Agent core | [`docs/phases/phase-1-agent-core.md`](docs/phases/phase-1-agent-core.md) | 1 day |
| Phase 2 — Streaming | `docs/phases/phase-2-streaming.md` | 1 day |
| Phase 3 — HITL Interrupts | `docs/phases/phase-3-hitl-interrupts.md` | 1–2 days |
| Phase 4 — Supervision UI | `docs/phases/phase-4-supervision-ui.md` | 1–2 days |
| Phase 5 — Failure paths | `docs/phases/phase-5-failure-paths.md` | 1 day |
| Phase 6 — Vercel AI SDK | `docs/phases/phase-6-vercel-ai-sdk.md` | 1 day |

**Start with [`docs/phases/phase-1-agent-core.md`](docs/phases/phase-1-agent-core.md).**

---

## Architecture

```
backend/
├── agent/
│   ├── state.py       ← Read first — the data contract
│   ├── prompts.py     ← Read second — what the LLM sees
│   ├── nodes.py       ← Read third — the actual agent logic
│   ├── graph.py       ← Read last — the wiring
│   └── fixtures.py    ← Sample trade exceptions for development
├── scripts/
│   └── run_phase1.py  ← Interactive test harness
└── main.py            ← FastAPI app (grows in Phase 2)
```

---

## Comment Legend

| Tag | Meaning |
|---|---|
| `# HITL:` | Human-in-the-loop decision point |
| `# LEARNING:` | Explains why something is done this way |
| `# TRADE-OFF:` | What we gave up for what we gained |
| `# PRODUCTION:` | What would change in a real production system |
