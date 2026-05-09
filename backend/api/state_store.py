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
                "stage_history": [],
                "final_state": None,
                "error": None,
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

    def start_stage(self, thread_id: str, node: str, message: str):
        with self._lock:
            if thread_id not in self._store:
                return

            history = self._store[thread_id].setdefault("stage_history", [])
            attempt = sum(1 for stage in history if stage.get("node") == node) + 1
            stage_id = f"{node}-{attempt}"

            history.append({
                "stage_id": stage_id,
                "node": node,
                "message": message,
                "attempt": attempt,
                "status": "running",
                "tokens": "",
                "state_snapshot": None,
                "started_at": datetime.now(timezone.utc).isoformat(),
                "completed_at": None,
            })

            self._store[thread_id]["current_node"] = node

    def append_stage_token(self, thread_id: str, token: str):
        with self._lock:
            if thread_id not in self._store or not token:
                return

            history = self._store[thread_id].get("stage_history") or []
            if not history:
                return

            history[-1]["tokens"] = f"{history[-1].get('tokens', '')}{token}"

    def complete_stage(self, thread_id: str, node: str, state_snapshot: Optional[dict] = None):
        with self._lock:
            if thread_id not in self._store:
                return

            history = self._store[thread_id].get("stage_history") or []
            for stage in reversed(history):
                if stage.get("node") == node and stage.get("status") == "running":
                    stage["status"] = "complete"
                    stage["state_snapshot"] = state_snapshot
                    stage["completed_at"] = datetime.now(timezone.utc).isoformat()
                    break

            self._store[thread_id]["current_node"] = None

    def fail_current_stage(self, thread_id: str):
        with self._lock:
            if thread_id not in self._store:
                return

            history = self._store[thread_id].get("stage_history") or []
            if not history:
                return

            current_stage = history[-1]
            if current_stage.get("status") == "running":
                current_stage["status"] = "error"
                current_stage["completed_at"] = datetime.now(timezone.utc).isoformat()

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
                self._store[thread_id]["current_node"] = None

    def set_final(self, thread_id: str, status: str, final_state: Optional[dict] = None):
        with self._lock:
            if thread_id in self._store:
                self._store[thread_id]["status"] = status
                self._store[thread_id]["final_state"] = final_state
                self._store[thread_id]["current_node"] = None

    def set_error(self, thread_id: str, error: str):
        with self._lock:
            if thread_id in self._store:
                self._store[thread_id]["status"] = "error"
                self._store[thread_id]["error"] = error
                self._store[thread_id]["current_node"] = None

                history = self._store[thread_id].get("stage_history") or []
                if history and history[-1].get("status") == "running":
                    history[-1]["status"] = "error"
                    history[-1]["completed_at"] = datetime.now(timezone.utc).isoformat()

    def paused_threads(self) -> list[dict]:
        """Return all threads currently waiting for human input."""
        with self._lock:
            return [v for v in self._store.values() if v["status"] == "waiting_human"]


# Singleton — imported by all route handlers
state_store = AgentStateStore()
