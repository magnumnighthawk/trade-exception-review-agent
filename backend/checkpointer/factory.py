"""
Checkpointer factory for LangGraph compilation.

LEARNING: The checkpointer is the persistence boundary for HITL pause/resume.
By centralising creation in one module, Phase 3 keeps the graph runtime
decoupled from storage choices (memory vs postgres).

Supported backends:
- memory   (default) : in-process, development only
- postgres (optional): requires langgraph-checkpoint-postgres + DB URL
"""

import logging
import os

from langgraph.checkpoint.memory import MemorySaver

logger = logging.getLogger(__name__)


def checkpointer_backend() -> str:
    """Return configured checkpointer backend name."""
    return os.getenv("LANGGRAPH_CHECKPOINTER", "memory").strip().lower() or "memory"


def build_checkpointer():
    """
    Build and return the configured checkpointer.

    PRODUCTION: Use postgres to persist checkpoint state across process restarts
    and horizontal scaling. MemorySaver is process-local and ephemeral.
    """
    backend = checkpointer_backend()

    if backend == "postgres":
        database_url = os.getenv("LANGGRAPH_CHECKPOINTER_POSTGRES_URL", "").strip()
        if not database_url:
            logger.warning(
                "[checkpointer] postgres backend requested but LANGGRAPH_CHECKPOINTER_POSTGRES_URL is missing; falling back to memory"
            )
            return MemorySaver()

        try:
            from langgraph.checkpoint.postgres import PostgresSaver

            # LEARNING: Using context-managed PostgresSaver at app startup is
            # recommended in production. For this learning project we keep a
            # simple constructor path with fallback behavior.
            logger.info("[checkpointer] Using postgres checkpointer backend")
            return PostgresSaver.from_conn_string(database_url)
        except Exception as error:
            logger.warning(
                "[checkpointer] Could not initialise postgres checkpointer (%s); falling back to memory",
                error,
            )
            return MemorySaver()

    logger.info("[checkpointer] Using memory checkpointer backend")
    return MemorySaver()
