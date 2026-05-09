#!/usr/bin/env python3
"""
Phase 5 deterministic validation.

This script patches the LLM layer so Phase 5 failure paths can be exercised
without network access or model credentials.
"""

import json
import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from fastapi.testclient import TestClient

from backend.main import app


class FakeResponse:
    def __init__(self, content: str):
        self.content = content


class FakeLLM:
    def invoke(self, messages):
        prompt = messages[-1].content

        if "Investigate this exception" in prompt:
            trade_id = _extract_trade_id(prompt)
            content = {
                "root_cause": f"{trade_id} root cause established from fixture evidence",
                "evidence": ["Trade confirmation reviewed", "Static data compared", "Operator guidance considered"],
                "suggested_action": "Prepare a controlled resolution plan",
                "confidence": 0.78,
            }
            return FakeResponse(json.dumps(content))

        if "Produce a formal resolution proposal" in prompt:
            trade_id = _extract_trade_id(prompt)
            content = {
                "action": f"Resolve {trade_id}",
                "details": f"Apply the approved resolution path for {trade_id} and record the confirmation trail.",
                "confidence": 0.82,
                "requires_human_approval": True,
                "risk_level": "medium",
            }
            return FakeResponse(json.dumps(content))

        if "Generate a brief execution confirmation" in prompt:
            trade_id = _extract_trade_id(prompt)
            return FakeResponse(f"Execution confirmed for {trade_id}. Operator approval recorded and the trade can proceed.")

        raise AssertionError(f"Unexpected prompt:\n{prompt}")


def _extract_trade_id(prompt: str) -> str:
    for line in prompt.splitlines():
        if "Trade ID:" in line:
            return line.split("Trade ID:", 1)[1].strip()
    return "UNKNOWN"


client = TestClient(app)


def _start_review(trade_id: str) -> str:
    response = client.post("/review/start", json={"trade_id": trade_id, "operator_id": "ops_test"})
    assert response.status_code == 200, response.text
    return response.json()["thread_id"]


def _stream_to_interrupt(thread_id: str) -> dict:
    response = client.get(f"/review/{thread_id}/stream")
    assert response.status_code == 200, response.text

    for line in response.iter_lines():
        if line.startswith("data: "):
            event = json.loads(line[6:])
            if event.get("type") == "hitl_interrupt":
                return event["interrupt_payload"]

    raise AssertionError("No interrupt payload received")


def _thread_detail(thread_id: str) -> dict:
    response = client.get(f"/queue/{thread_id}")
    assert response.status_code == 200, response.text
    return response.json()


def _submit(thread_id: str, body: dict, expected_status: int = 200) -> dict:
    response = client.post(f"/review/{thread_id}/decision", json=body)
    assert response.status_code == expected_status, response.text
    return response.json() if response.content else {}


def validate_low_confidence_policy():
    print("[1] Validating low-confidence approval lock...")
    thread_id = _start_review("TRD-9834")
    interrupt_payload = _stream_to_interrupt(thread_id)

    assert interrupt_payload["kind"] == "proposal_review"
    assert interrupt_payload["confidence"] < interrupt_payload["policy"]["low_confidence_threshold"]

    denial = client.post(
        f"/review/{thread_id}/decision",
        json={"action": "approve", "operator_id": "ops_test"},
    )
    assert denial.status_code == 409, denial.text

    result = _submit(
        thread_id,
        {
            "action": "modify",
            "operator_id": "ops_test",
            "modification": "Use the confirmed accrued-interest amount before executing.",
            "reason": "Need the modified controlled path.",
            "confidence_before": interrupt_payload["confidence"],
        },
    )
    assert result["status"] == "complete"
    print("✓ Low-confidence proposals are backend-locked from direct approval")


def validate_information_request_flow():
    print("[2] Validating information-request interrupt...")
    thread_id = _start_review("TRD-9855")
    interrupt_payload = _stream_to_interrupt(thread_id)

    assert interrupt_payload["kind"] == "information_request"
    assert len(interrupt_payload["fields_needed"]) == 2

    result = _submit(
        thread_id,
        {
            "action": "provide_context",
            "operator_id": "ops_test",
            "context_fields": {
                "source_of_truth_entity": "Deutsche Bank AG Frankfurt",
                "approved_settlement_account": "DB-SETTLE-4451",
            },
            "reason": "Confirmed with static data operations book.",
        },
    )
    assert result["status"] == "waiting_human"

    detail = _thread_detail(thread_id)
    assert detail["intervention_kind"] == "proposal_review"
    print("✓ Information request resumes into the next proposal-review checkpoint")


def validate_recoverable_failure_retry():
    print("[3] Validating recoverable execution failure...")
    thread_id = _start_review("TRD-9841")
    interrupt_payload = _stream_to_interrupt(thread_id)
    assert interrupt_payload["kind"] == "proposal_review"

    result = _submit(
        thread_id,
        {
            "action": "approve",
            "operator_id": "ops_test",
            "confidence_before": interrupt_payload["confidence"],
        },
    )
    assert result["status"] == "waiting_human"

    detail = _thread_detail(thread_id)
    assert detail["intervention_kind"] == "failure_recovery"
    assert detail["interrupt_payload"]["kind"] == "failure_recovery"

    retry = _submit(
        thread_id,
        {
            "action": "retry",
            "operator_id": "ops_test",
            "reason": "Retry once after the transient downstream timeout.",
        },
    )
    assert retry["status"] == "complete"
    print("✓ Recoverable execution failures can be retried from human supervision")


def validate_retry_ceiling_manual_takeover():
    print("[4] Validating retry ceiling / manual takeover...")
    thread_id = _start_review("TRD-9821")
    _stream_to_interrupt(thread_id)

    for attempt in range(1, 4):
        result = _submit(
            thread_id,
            {
                "action": "reject",
                "operator_id": "ops_test",
                "modification": f"Attempt {attempt}: the proposal is still not safe enough.",
                "reason": "Need a different resolution path.",
            },
        )
        if attempt < 3:
            assert result["status"] == "waiting_human"
        else:
            assert result["status"] == "manual_takeover"

    detail = _thread_detail(thread_id)
    assert detail["status"] == "manual_takeover"
    assert detail["manual_takeover_note"]
    print("✓ Rejection loops stop at the retry ceiling and hand off to a human")


if __name__ == "__main__":
    with patch("backend.agent.nodes._get_llm", return_value=FakeLLM()):
        validate_low_confidence_policy()
        validate_information_request_flow()
        validate_recoverable_failure_retry()
        validate_retry_ceiling_manual_takeover()
        print("\nPHASE 5 = COMPLETE ✓")
