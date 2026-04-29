"""
Phase 1 test script — run the agent interactively from the terminal.

LEARNING: Before building any API or UI, test your agent directly.
This script lets you run the full HITL loop from the command line:
  1. Agent investigates a trade exception
  2. Agent proposes a resolution and pauses (interrupt)
  3. You type your decision in the terminal (approve/reject/modify/escalate)
  4. Agent resumes and executes (or loops back)

Running this script will teach you:
- What state looks like at each node transition
- What the interrupt payload looks like (what your UI will receive)
- How the thread_id connects the two halves of execution
- How the audit log grows as the agent runs

Usage:
    python -m backend.scripts.run_phase1 [trade_id]

Example:
    python -m backend.scripts.run_phase1 TRD-9821
"""

import sys
import json
import uuid
import asyncio
import logging
from datetime import datetime, timezone

# Enable INFO logging so you can see what each node is doing
logging.basicConfig(level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s")

from langgraph.types import Command
from backend.agent.graph import graph
from backend.agent.fixtures import get_exception, SAMPLE_EXCEPTIONS


def print_divider(label: str = ""):
    width = 70
    if label:
        side = (width - len(label) - 2) // 2
        print("\n" + "─" * side + f" {label} " + "─" * side)
    else:
        print("\n" + "─" * width)


def print_state_snapshot(state: dict):
    """Print a readable snapshot of the current agent state."""
    print_divider("STATE SNAPSHOT")
    print(f"  Status     : {state.get('status', 'unknown')}")
    print(f"  Trade ID   : {state.get('exception', {}).get('trade_id', '?')}")
    print(f"  Attempts   : {state.get('investigation_attempts', 0)}")

    investigation = state.get("investigation")
    if investigation:
        print(f"\n  INVESTIGATION:")
        print(f"    Root cause : {investigation.get('root_cause', '?')}")
        print(f"    Confidence : {investigation.get('confidence', '?')}")
        for e in investigation.get("evidence", []):
            print(f"    Evidence   : {e}")

    proposal = state.get("proposal")
    if proposal:
        print(f"\n  PROPOSAL:")
        print(f"    Action     : {proposal.get('action', '?')}")
        print(f"    Details    : {proposal.get('details', '?')[:120]}...")
        print(f"    Confidence : {proposal.get('confidence', '?')}")
        print(f"    Risk Level : {proposal.get('risk_level', '?')}")

    human_decision = state.get("human_decision")
    if human_decision:
        print(f"\n  HUMAN DECISION:")
        print(f"    Action     : {human_decision.get('action', '?')}")
        print(f"    Operator   : {human_decision.get('operator_id', '?')}")
        if human_decision.get("modification"):
            print(f"    Mod note   : {human_decision.get('modification')}")

    audit_log = state.get("audit_log", [])
    if audit_log:
        print(f"\n  AUDIT LOG ({len(audit_log)} entries):")
        for entry in audit_log:
            print(f"    [{entry.get('timestamp', '?')[:19]}] {entry.get('event_type')} — {entry.get('details', '')[:60]}")

    if state.get("execution_result"):
        print(f"\n  EXECUTION RESULT:")
        print(f"    {state['execution_result']}")

    if state.get("escalation_reason"):
        print(f"\n  ESCALATION REASON:")
        print(f"    {state['escalation_reason']}")


def _get_checkpoint_state(config: dict) -> tuple[dict, dict]:
    """
    Return (state_values, interrupt_payload) from the latest checkpoint.

    LEARNING: When interrupt() is hit inside a node, that node has not returned
    yet, so fields like `proposal` may not be merged into state.values.
    The interrupt payload is stored on checkpoint tasks[*].interrupts[*].value.
    """
    snapshot = graph.get_state(config)
    values = snapshot.values if hasattr(snapshot, "values") else {}
    interrupt_payload = {}

    tasks = getattr(snapshot, "tasks", None) or []
    for task in tasks:
        interrupts = getattr(task, "interrupts", None) or []
        if interrupts:
            interrupt_payload = interrupts[0].value
            break

    return values, interrupt_payload


def get_human_decision(interrupt_payload: dict) -> dict:
    """
    LEARNING: This function simulates what the frontend DecisionSurface
    will do in Phase 4. Here we collect input from the terminal.
    The exact same dict shape will be submitted by the React UI later.

    The interrupt_payload is what was passed to interrupt() in
    propose_resolution_node. Your UI would render this.
    """
    print_divider("HUMAN REVIEW REQUIRED")
    print(f"\n  Trade ID   : {interrupt_payload.get('trade_id')}")
    print(f"  Amount     : ${interrupt_payload.get('amount', 0):,.2f}")
    print(f"  Risk Level : {interrupt_payload.get('risk_level', '?').upper()}")
    print(f"  Confidence : {interrupt_payload.get('confidence', 0):.0%}")

    proposal = interrupt_payload.get("proposal", {})
    print(f"\n  PROPOSED ACTION: {proposal.get('action', '?')}")
    print(f"  DETAILS: {proposal.get('details', '?')}")

    if interrupt_payload.get("confidence", 1.0) < 0.70:
        print("\n  ⚠️  WARNING: Agent confidence is below 70%. Review reasoning carefully.")

    print("\n  Available actions:")
    print("    [a] approve  — proceed with proposal as-is")
    print("    [r] reject   — send back for re-investigation (you'll be asked for a reason)")
    print("    [m] modify   — steer the agent (you provide modified instructions)")
    print("    [e] escalate — send to senior operator queue")

    action_map = {"a": "approve", "r": "reject", "m": "modify", "e": "escalate"}
    while True:
        choice = input("\n  Your decision [a/r/m/e]: ").strip().lower()
        if choice in action_map:
            action = action_map[choice]
            break
        print("  Invalid choice. Enter a, r, m, or e.")

    modification = None
    if action in ("reject", "modify"):
        modification = input(f"  {'Rejection reason' if action == 'reject' else 'Modification instruction'}: ").strip()

    return {
        "action": action,
        "modification": modification,
        "operator_id": "dev_operator_001",
        "decided_at": datetime.now(timezone.utc).isoformat(),
    }


def run_agent(trade_id: str, auto_approve: bool = False):
    """
    Run the agent for one trade exception, handling the HITL interrupt.

    LEARNING: Notice the two-phase invocation pattern:
      Phase A: graph.invoke() → hits interrupt() → returns interrupt data
      Phase B: graph.invoke(Command(resume=...)) → resumes from checkpoint

    The thread_id is what links Phase A to Phase B. Without it, LangGraph
    wouldn't know which checkpointed state to resume.

    In Phase 2, Phase A will be triggered by the stream endpoint, and
    Phase B will be triggered by the decision endpoint. Same pattern,
    just split across two HTTP requests from a browser.

    Args:
        trade_id: The trade ID to review
        auto_approve: If True, automatically approve proposals (for testing)
    """
    print_divider("TRADE EXCEPTION REVIEW AGENT — Phase 1")

    # Load the exception
    try:
        exception = get_exception(trade_id)
    except ValueError as e:
        print(f"\n  Error: {e}")
        print(f"  Available trades: {list(SAMPLE_EXCEPTIONS.keys())}")
        return

    print(f"\n  Reviewing exception: {trade_id}")
    print(f"  Type     : {exception['type']}")
    print(f"  Amount   : ${exception['amount']:,.2f}")
    print(f"  Party    : {exception['counterparty']}")
    print(f"  Reason   : {exception['reason']}")

    # Each run needs a unique thread_id so the checkpointer knows which
    # state to save and resume. In production, this maps to a case ID.
    thread_id = str(uuid.uuid4())
    config = {"configurable": {"thread_id": thread_id}}

    print(f"\n  Thread ID : {thread_id}")
    if auto_approve:
        print(f"  Mode      : AUTO-APPROVE (testing mode)")
    print(f"\n  Starting agent... (this will call OpenAI — give it a moment)")

    # ── Run + resume loop ─────────────────────────────────────────────────────
    # LEARNING: We keep looping until no interrupt payload exists.
    # This supports multiple HITL cycles (e.g., reject -> re-investigate -> interrupt again).
    initial_state = {
        "exception": exception,
        "thread_id": thread_id,
        "audit_log": [],
    }

    result = graph.invoke(initial_state, config=config)

    while True:
        current_state, interrupt_payload = _get_checkpoint_state(config)

        if not interrupt_payload:
            # No pending interrupt means graph reached a terminal state.
            if current_state:
                result = current_state
            break

        print()
        print_state_snapshot(current_state)

        if auto_approve:
            proposal = interrupt_payload.get("proposal", {})
            human_decision = {
                "action": "approve",
                "modification": None,
                "operator_id": "auto_tester",
                "decided_at": datetime.now(timezone.utc).isoformat(),
            }
            print(f"\n  ✅ AUTO-APPROVING proposal: {proposal.get('action', '?')}")
        else:
            human_decision = get_human_decision(interrupt_payload)

        print(f"\n  Resuming agent with decision: {human_decision['action']}...")
        result = graph.invoke(Command(resume=human_decision), config=config)

    # ── Final state ────────────────────────────────────────────────────────────
    if result:
        print_state_snapshot(result)
        print_divider()
        status = result.get("status", "unknown")
        if status == "complete":
            print(f"\n  ✅ Exception {trade_id} resolved successfully.")
        elif status == "rejected":
            print(f"\n  🔄 Proposal rejected — agent would re-investigate on next invocation.")
        elif status == "escalated":
            print(f"\n  ↑  Exception escalated to senior queue.")
        elif status == "error":
            print(f"\n  ❌ Agent encountered an error.")
        else:
            print(f"\n  Status: {status}")

        print(f"\n  Full audit trail has {len(result.get('audit_log', []))} entries.")
        print(f"  Thread ID (save this for Phase 3 learning): {thread_id}\n")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Run Phase 1 agent interactively")
    parser.add_argument("trade_id", nargs="?", default="TRD-9821", help="Trade ID to review")
    parser.add_argument("--auto-approve", "-a", action="store_true", help="Auto-approve proposals (testing mode)")
    args = parser.parse_args()
    run_agent(args.trade_id, auto_approve=args.auto_approve)
