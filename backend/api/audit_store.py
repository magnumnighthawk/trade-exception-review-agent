import threading
import uuid
from datetime import datetime, timezone
from typing import Optional
from dataclasses import dataclass


@dataclass
class AuditEntry:
    """One immutable decision log entry."""
    audit_entry_id: str
    timestamp: str
    operator_id: str
    thread_id: str
    trade_id: str
    decision: str  # "approve" | "reject" | "modify" | "escalate"
    modification: Optional[str] = None
    reason: Optional[str] = None
    confidence_before: Optional[float] = None
    agent_proposal_before: Optional[str] = None
    escalation_category: Optional[str] = None
    context_fields: Optional[dict[str, str]] = None

    def to_dict(self) -> dict:
        return {
            "audit_entry_id": self.audit_entry_id,
            "timestamp": self.timestamp,
            "operator_id": self.operator_id,
            "thread_id": self.thread_id,
            "trade_id": self.trade_id,
            "decision": self.decision,
            "modification": self.modification,
            "reason": self.reason,
            "confidence_before": self.confidence_before,
            "agent_proposal_before": self.agent_proposal_before,
            "escalation_category": self.escalation_category,
            "context_fields": self.context_fields,
        }


class AuditTrailStore:
    """Thread-safe append-only audit log."""

    def __init__(self):
        self._entries: list[AuditEntry] = []
        self._lock = threading.Lock()

    def log_decision(
        self,
        thread_id: str,
        trade_id: str,
        operator_id: str,
        decision: str,
        modification: Optional[str] = None,
        reason: Optional[str] = None,
        confidence_before: Optional[float] = None,
        agent_proposal_before: Optional[str] = None,
        escalation_category: Optional[str] = None,
        context_fields: Optional[dict[str, str]] = None,
    ) -> AuditEntry:
        """
        Log a human decision. Returns the audit entry that was recorded.
        This is an append-only operation — entries are never modified.
        """
        entry = AuditEntry(
            audit_entry_id=f"audit_{uuid.uuid4().hex[:12]}",
            timestamp=datetime.now(timezone.utc).isoformat(),
            operator_id=operator_id,
            thread_id=thread_id,
            trade_id=trade_id,
            decision=decision,
            modification=modification,
            reason=reason,
            confidence_before=confidence_before,
            agent_proposal_before=agent_proposal_before,
            escalation_category=escalation_category,
            context_fields=context_fields,
        )

        with self._lock:
            self._entries.append(entry)

        return entry

    def get_entries_for_thread(self, thread_id: str) -> list[AuditEntry]:
        """Get all audit entries for a specific thread, in chronological order."""
        with self._lock:
            return [e for e in self._entries if e.thread_id == thread_id]

    def get_entries_for_trade(self, trade_id: str) -> list[AuditEntry]:
        """Get all audit entries for a specific trade ID (across all runs)."""
        with self._lock:
            return [e for e in self._entries if e.trade_id == trade_id]

    def get_all_entries(self, limit: Optional[int] = None) -> list[AuditEntry]:
        """Get all entries, optionally limited to most recent N."""
        with self._lock:
            if limit is None:
                return list(self._entries)
            return list(self._entries[-limit:])

    def entry_count(self) -> int:
        """Return total number of audit entries (for metrics)."""
        with self._lock:
            return len(self._entries)


# Singleton instance
audit_store = AuditTrailStore()
