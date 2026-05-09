LOW_CONFIDENCE_THRESHOLD = 0.70
HIGH_CONFIDENCE_THRESHOLD = 0.85
MAX_INVESTIGATION_ATTEMPTS = 3
MAX_EXECUTION_RETRIES = 2


def approval_locked(confidence: float) -> bool:
    """Return True when policy forbids direct approval."""
    return confidence < LOW_CONFIDENCE_THRESHOLD


def build_review_policy() -> dict:
    """Return the UI-safe policy payload attached to intervention envelopes."""
    return {
        "low_confidence_threshold": LOW_CONFIDENCE_THRESHOLD,
        "high_confidence_threshold": HIGH_CONFIDENCE_THRESHOLD,
        "max_investigation_attempts": MAX_INVESTIGATION_ATTEMPTS,
        "max_execution_retries": MAX_EXECUTION_RETRIES,
    }
