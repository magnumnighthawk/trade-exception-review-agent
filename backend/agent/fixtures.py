"""
Sample trade exceptions for development and testing.

LEARNING: Having a set of realistic, typed test fixtures is essential
for agent development. You want to test:
- Different exception types
- Different confidence levels (low confidence should trigger more cautious behaviour)
- Different amounts (amount affects risk_level in the proposal)
- Edge cases (missing data, ambiguous reasons)

In production, these would come from a settlement platform via a message
queue (Kafka, SQS) or a database poll.
"""

from datetime import datetime, timezone


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


SAMPLE_EXCEPTIONS = {
    "TRD-9821": {
        "trade_id": "TRD-9821",
        "type": "iban_mismatch",
        "amount": 2_400_000.00,
        "counterparty": "Goldman Sachs",
        "reason": "Settlement failed — IBAN on trade ticket (GB29NWBK60161331926819) does not match counterparty IBAN on file (GB94BARC10201530093459)",
        "flagged_at": _now(),
    },
    "TRD-9834": {
        "trade_id": "TRD-9834",
        "type": "amount_discrepancy",
        "amount": 875_000.00,
        "counterparty": "Morgan Stanley",
        "reason": "Settlement amount ($875,000) differs from confirmed trade amount ($857,000) — $18,000 discrepancy, possible accrued interest miscalculation",
        "flagged_at": _now(),
        "scenario": {
            "force_low_confidence_proposal": 0.62,
        },
    },
    "TRD-9841": {
        "trade_id": "TRD-9841",
        "type": "settlement_fail",
        "amount": 45_000.00,
        "counterparty": "Barclays",
        "reason": "Settlement instruction failed — counterparty BIC code (BARCGB22) returned 'unknown recipient' from SWIFT network",
        "flagged_at": _now(),
        "scenario": {
            "simulate_recoverable_execution_failure": True,
            "recoverable_failure_message": "Downstream settlement adapter timed out while confirming the retry.",
        },
    },
    "TRD-9855": {
        "trade_id": "TRD-9855",
        "type": "counterparty_mismatch",
        "amount": 12_000_000.00,
        "counterparty": "Deutsche Bank",
        "reason": "Trade confirmation received from Deutsche Bank AG (Frankfurt) but settlement instructions reference Deutsche Bank Trust Company Americas (New York) — entity mismatch on a $12M position",
        "flagged_at": _now(),
        "scenario": {
            "requires_information_request": True,
            "information_request_question": "The legal entity on the confirmation does not match the settlement account. Please provide the source-of-truth entity and settlement account that should be used.",
            "information_request_fields": [
                "source_of_truth_entity",
                "approved_settlement_account",
            ],
        },
    },
}


def get_exception(trade_id: str) -> dict:
    """
    Retrieve a sample exception by trade ID.

    PRODUCTION: This would query your trade management database.
    The function signature stays the same — only the implementation changes.
    That's a good interface design principle for agent tools.
    """
    if trade_id not in SAMPLE_EXCEPTIONS:
        raise ValueError(f"Unknown trade ID: {trade_id}. Available: {list(SAMPLE_EXCEPTIONS.keys())}")
    return SAMPLE_EXCEPTIONS[trade_id]
