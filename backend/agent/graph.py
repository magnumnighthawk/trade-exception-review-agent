import logging
from langgraph.graph import END, StateGraph

from backend.agent.state import TradeExceptionState
from backend.agent.nodes import (
    receive_exception_node,
    investigate_node,
    propose_resolution_node,
    execute_resolution_node,
)
from backend.checkpointer import build_checkpointer, checkpointer_backend

logger = logging.getLogger(__name__)


def route_after_investigation(state: TradeExceptionState) -> str:
    status = state["status"]

    if status in ("escalated", "manual_takeover", "error"):
        logger.info("[route] Investigation ended with terminal status '%s'", status)
        return "end"

    return "propose"


def route_after_execution(state: TradeExceptionState) -> str:
    status = state["status"]

    if status == "rejected":
        logger.info(f"[route] Rejection detected — looping back to investigate")
        return "investigate"

    if status in ("complete", "escalated", "manual_takeover", "error"):
        logger.info(f"[route] Terminal status '{status}' — ending graph")
        return "end"

    logger.warning(f"[route] Unexpected status '{status}' after execution — ending")
    return "end"

def build_graph():
    workflow = StateGraph(TradeExceptionState)

    workflow.add_node("receive_exception", receive_exception_node)
    workflow.add_node("investigate", investigate_node)
    workflow.add_node("propose_resolution", propose_resolution_node)
    workflow.add_node("execute_resolution", execute_resolution_node)

    workflow.set_entry_point("receive_exception")

    workflow.add_edge("receive_exception", "investigate")
    workflow.add_edge("propose_resolution", "execute_resolution")

    workflow.add_conditional_edges(
        "investigate",
        route_after_investigation,
        {
            "propose": "propose_resolution",
            "end": END,
        },
    )

    workflow.add_conditional_edges(
        "execute_resolution",
        route_after_execution,
        {
            "investigate": "investigate",   # Rejection → retry
            "end": END,                     # Complete / escalated / error → done
        }
    )

    checkpointer = build_checkpointer()

    graph = workflow.compile(checkpointer=checkpointer)
    logger.info("[graph] Trade Exception Review Agent graph compiled (checkpointer=%s)", checkpointer_backend())
    return graph


graph = build_graph()
