"""
LangGraph graph definition for the Trade Exception Review Agent.

LEARNING: This file is the "wiring diagram" of the agent.
The actual work happens in nodes.py. This file defines:
1. Which nodes exist
2. What order they run in (edges)
3. Where conditional branching happens (conditional edges)
4. How the graph is compiled with a checkpointer (enabling HITL)

Read this file after you've read state.py and nodes.py.
The graph is the last thing to write — once you understand state and nodes,
the graph structure becomes obvious.

KEY CONCEPT — The graph is a directed graph:
  Nodes = functions that transform state
  Edges = transitions between nodes
  Conditional edges = branches based on state values

LangGraph compiles this into a runnable that you invoke like:
  result = graph.invoke(initial_state, config={"configurable": {"thread_id": "..."}})
"""

import logging
from langgraph.graph import StateGraph, END

from backend.agent.state import TradeExceptionState
from backend.agent.nodes import (
    receive_exception_node,
    investigate_node,
    propose_resolution_node,
    execute_resolution_node,
)
from backend.checkpointer import build_checkpointer, checkpointer_backend

logger = logging.getLogger(__name__)


# ── Routing logic ──────────────────────────────────────────────────────────────

def route_after_execution(state: TradeExceptionState) -> str:
    """
    LEARNING: This is a conditional edge function. LangGraph calls it after
    execute_resolution_node completes and uses the return value to decide
    which node to go to next (or whether to end).

    Conditional edges are how you implement:
    - Retry loops (reject → investigate again)
    - Early exit (escalate → END)
    - Happy path (approve/modify + execute → END)

    The return value must be one of the keys registered in add_conditional_edges().

    TRADE-OFF: We could put this logic inside execute_resolution_node by
    returning a "next_node" key in the state. Using a routing function is
    cleaner because it keeps routing logic separate from node logic —
    nodes transform state, routers decide flow.
    """
    status = state["status"]

    if status == "rejected":
        # Human rejected the proposal — loop back to re-investigate.
        # The rejection reason is in state["human_decision"]["modification"]
        # and will be picked up by the investigate prompt on the next attempt.
        logger.info(f"[route] Rejection detected — looping back to investigate")
        return "investigate"

    if status in ("complete", "escalated", "error"):
        logger.info(f"[route] Terminal status '{status}' — ending graph")
        return "end"

    # Defensive fallback — should never reach here in normal flow
    logger.warning(f"[route] Unexpected status '{status}' after execution — ending")
    return "end"


# ── Graph construction ─────────────────────────────────────────────────────────

def build_graph():
    """
    Build and compile the Trade Exception Review agent graph.

    LEARNING: We use StateGraph[TradeExceptionState] — this tells LangGraph
    the exact shape of state that will flow through the graph.
    Type checking at graph definition time catches state key mismatches early.

    The compilation step (workflow.compile()) is where you attach the
    checkpointer — this is the core of HITL pause/resume in Phase 3.

    We intentionally use interrupt() inside propose_resolution_node rather than
    graph-level interrupt_before. The in-node pattern lets us provide rich
    proposal context in the interrupt payload and accept the human decision
    as the direct return value of interrupt().
    """
    workflow = StateGraph(TradeExceptionState)

    # ── Add nodes ──────────────────────────────────────────────────────────────
    # LEARNING: node names become the graph's node identifiers.
    # Keep them short and descriptive — they appear in LangSmith traces,
    # streaming events, and your audit log.
    workflow.add_node("receive_exception", receive_exception_node)
    workflow.add_node("investigate", investigate_node)
    workflow.add_node("propose_resolution", propose_resolution_node)
    workflow.add_node("execute_resolution", execute_resolution_node)

    # ── Entry point ────────────────────────────────────────────────────────────
    workflow.set_entry_point("receive_exception")

    # ── Linear edges ──────────────────────────────────────────────────────────
    # These are unconditional — after node A, always go to node B.
    workflow.add_edge("receive_exception", "investigate")
    workflow.add_edge("investigate", "propose_resolution")
    workflow.add_edge("propose_resolution", "execute_resolution")

    # ── Conditional edge ───────────────────────────────────────────────────────
    # After execute_resolution, the route depends on the human's decision.
    # LEARNING: The dict maps return values from route_after_execution()
    # to actual node names. "end" maps to the special END sentinel.
    workflow.add_conditional_edges(
        "execute_resolution",
        route_after_execution,
        {
            "investigate": "investigate",   # Rejection → retry
            "end": END,                     # Complete / escalated / error → done
        }
    )

    # ── Compile with checkpointer ──────────────────────────────────────────────
    # LEARNING: The checkpointer is what makes HITL possible.
    # Phase 3 keeps this behind a factory so we can switch storage backend via env.
    checkpointer = build_checkpointer()

    graph = workflow.compile(checkpointer=checkpointer)
    logger.info("[graph] Trade Exception Review Agent graph compiled (checkpointer=%s)", checkpointer_backend())
    return graph


# ── Singleton graph instance ───────────────────────────────────────────────────
# LEARNING: We compile once and reuse. Compilation is expensive.
# In production you'd use dependency injection to pass this into your
# FastAPI app at startup rather than importing a module-level global.
graph = build_graph()
