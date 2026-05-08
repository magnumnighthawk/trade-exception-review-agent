"""
In-memory state store for active agent threads.

LEARNING: This is the bridge between the stream and decision endpoints.
When an agent starts, we register it here. When it hits an interrupt, we
store the payload. When a human decides, decision.py reads it from here.
The queue endpoint reads all entries to build the paused-agents list.

Think of this as a lightweight process-local registry of "live" agent runs.

PRODUCTION: Replace with Redis or Postgres.
- Redis: use thread_id as key, store JSON, set TTL (e.g. 24h)
- Postgres: a `threads` table with status + interrupt_payload column
With multiple FastAPI workers (Gunicorn/uvicorn), in-memory won't work.
The in-memory version here is correct for single-worker dev.

TRADE-OFF: We could store everything in the LangGraph checkpointer and
query it directly. But checkpointer state is opaque — we'd have to
deserialise LangGraph's internal snapshot format. The state_store gives
us a clean, queryable view of what the UI needs.
"""

import threading
from datetime import datetime, timezone
from typing import Optional


class AgentStateStore:
    """Thread-safe in-memory store of all active agent threads."""

    def __init__(self):
        self._store: dict[str, dict] = {}
        self._lock = threading.Lock()

    def register(self, thread_id: str, trade_id: str, operator_id: str):
        with self._lock:
            self._store[thread_id] = {
                "thread_id": thread_id,
                "trade_id": trade_id,
                "operator_id": operator_id,
                "status": "running",
                "current_node": None,
                "interrupt_payload": None,
                "paused_at": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }

    def get(self, thread_id: str) -> Optional[dict]:
        with self._lock:
            return self._store.get(thread_id)

    def get_by_trade(self, trade_id: str) -> list[dict]:
        with self._lock:
            return [entry for entry in self._store.values() if entry.get("trade_id") == trade_id]

    def latest_for_trade(self, trade_id: str) -> Optional[dict]:
        with self._lock:
            matches = [entry for entry in self._store.values() if entry.get("trade_id") == trade_id]
            if not matches:
                return None
            matches.sort(key=lambda entry: entry.get("created_at") or "", reverse=True)
            return matches[0]

    def all(self) -> list[dict]:
        with self._lock:
            return list(self._store.values())

    def remove(self, thread_id: str):
        with self._lock:
            self._store.pop(thread_id, None)

    def set_current_node(self, thread_id: str, node: str):
        with self._lock:
            if thread_id in self._store:
                self._store[thread_id]["current_node"] = node

    def set_interrupt(self, thread_id: str, interrupt_payload: dict):
        """
        HITL: Mark this thread as paused and store the interrupt payload.
        The queue endpoint will surface this to operators.
        """
        with self._lock:
            if thread_id in self._store:
                self._store[thread_id]["status"] = "waiting_human"
                self._store[thread_id]["interrupt_payload"] = interrupt_payload
                self._store[thread_id]["paused_at"] = datetime.now(timezone.utc).isoformat()

    def set_resuming(self, thread_id: str):
        with self._lock:
            if thread_id in self._store:
                self._store[thread_id]["status"] = "resuming"
                self._store[thread_id]["interrupt_payload"] = None

    def set_final(self, thread_id: str, status: str):
        with self._lock:
            if thread_id in self._store:
                self._store[thread_id]["status"] = status

    def set_error(self, thread_id: str, error: str):
        with self._lock:
            if thread_id in self._store:
                self._store[thread_id]["status"] = "error"
                self._store[thread_id]["error"] = error

    def paused_threads(self) -> list[dict]:
        """Return all threads currently waiting for human input."""
        with self._lock:
            return [v for v in self._store.values() if v["status"] == "waiting_human"]


# Singleton — imported by all route handlers
state_store = AgentStateStore()
