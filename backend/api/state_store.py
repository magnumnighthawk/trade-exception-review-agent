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
                "intervention_kind": None,
                "interrupt_payload": None,
                "paused_at": None,
                "stage_history": [],
                "final_state": None,
                "error": None,
                "failure_context": None,
                "manual_takeover_note": None,
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
        with self._lock:
            if thread_id in self._store:
                self._store[thread_id]["status"] = "waiting_human"
                self._store[thread_id]["intervention_kind"] = interrupt_payload.get("kind")
                self._store[thread_id]["interrupt_payload"] = interrupt_payload
                self._store[thread_id]["paused_at"] = datetime.now(timezone.utc).isoformat()

    def set_resuming(self, thread_id: str):
        with self._lock:
            if thread_id in self._store:
                self._store[thread_id]["status"] = "resuming"
                self._store[thread_id]["intervention_kind"] = None
                self._store[thread_id]["interrupt_payload"] = None
                self._store[thread_id]["current_node"] = None

    def set_final(self, thread_id: str, status: str, final_state: Optional[dict] = None):
        with self._lock:
            if thread_id in self._store:
                self._store[thread_id]["status"] = status
                self._store[thread_id]["final_state"] = final_state
                self._store[thread_id]["current_node"] = None
                self._store[thread_id]["intervention_kind"] = None
                self._store[thread_id]["interrupt_payload"] = None
                self._store[thread_id]["failure_context"] = (final_state or {}).get("failure_context")
                self._store[thread_id]["manual_takeover_note"] = (final_state or {}).get("manual_takeover_note")

    def set_error(self, thread_id: str, error: str):
        with self._lock:
            if thread_id in self._store:
                failed_node = self._store[thread_id].get("current_node") or "unknown"
                self._store[thread_id]["status"] = "error"
                self._store[thread_id]["error"] = error
                self._store[thread_id]["current_node"] = None
                self._store[thread_id]["intervention_kind"] = None
                self._store[thread_id]["failure_context"] = {
                    "category": "execution_error",
                    "failed_node": failed_node,
                    "message": error,
                    "recoverable": False,
                    "retry_available": False,
                    "retry_count": 0,
                }

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
