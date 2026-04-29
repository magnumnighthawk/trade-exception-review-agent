"""
Prompt templates for the Trade Exception Review Agent.

LEARNING: Keeping prompts in a dedicated file is a production discipline.
Prompts are effectively code — they change behaviour, they need versioning,
and they benefit from review. Do not inline them inside node functions.

Each prompt is a function that takes state and returns a formatted string.
This keeps them testable in isolation (you can unit-test prompt output
without running the full agent).
"""

from backend.agent.state import TradeExceptionState


# ── System context ─────────────────────────────────────────────────────────────

SYSTEM_CONTEXT = """You are a trade exception review specialist at a major investment bank.
You investigate flagged trade exceptions, determine their root cause with precision,
and propose clear, actionable resolutions.

Your outputs will be reviewed by a human operator before any action is taken.
Be specific, cite evidence, and always state your confidence level honestly.
If you are uncertain, say so — an operator will provide additional guidance.

Output format for structured responses: valid JSON only, no markdown fences."""


# ── Investigation prompt ───────────────────────────────────────────────────────

def build_investigation_prompt(state: TradeExceptionState) -> str:
    """
    LEARNING: The investigation prompt is the agent's first 'thinking' step.
    We give it the raw exception and ask it to reason about root cause before
    proposing anything. Separating investigation from proposal is intentional —
    it mirrors how a skilled analyst works, and it means the human can see
    the reasoning chain, not just the conclusion.
    """
    exc = state["exception"]
    history_context = ""

    # LEARNING: If this is a retry (investigation_attempts > 0), we include
    # the rejection reason from the previous proposal so the agent can
    # learn from it and produce a better investigation this time.
    if state.get("investigation_attempts", 0) > 0 and state.get("human_decision"):
        decision = state["human_decision"]
        history_context = f"""
IMPORTANT — Previous investigation was rejected by human operator.
Rejection / modification instruction: {decision.get("modification", "No modification provided")}
You must factor this feedback into your revised investigation.
"""

    return f"""{SYSTEM_CONTEXT}

{history_context}
You have received a flagged trade exception. Investigate it thoroughly.

EXCEPTION DETAILS:
- Trade ID: {exc["trade_id"]}
- Exception Type: {exc["type"]}
- Amount (USD): {exc["amount"]:,.2f}
- Counterparty: {exc["counterparty"]}
- Reason Flagged: {exc["reason"]}
- Flagged At: {exc["flagged_at"]}

Investigate this exception. Return a JSON object with exactly these fields:
{{
  "root_cause": "A precise, one-sentence description of what caused this exception",
  "evidence": ["fact 1", "fact 2", "fact 3"],
  "suggested_action": "A brief description of what should be done to resolve this",
  "confidence": 0.0  // float between 0.0 and 1.0 — your confidence in this investigation
}}

Be honest about confidence. Low confidence triggers mandatory human review."""


# ── Proposal prompt ────────────────────────────────────────────────────────────

def build_proposal_prompt(state: TradeExceptionState) -> str:
    """
    LEARNING: The proposal prompt takes the investigation output as input
    and produces a formal resolution proposal. Note how we pass the full
    investigation result — the LLM can use the evidence and suggested action
    to form a more grounded proposal.

    We also pass the exception amount here because amount thresholds are
    a key driver of risk_level — the agent needs this context.
    """
    exc = state["exception"]
    investigation = state["investigation"]

    modification_context = ""
    if state.get("human_decision") and state["human_decision"]["action"] == "modify":
        mod = state["human_decision"].get("modification")
        modification_context = f"""
OPERATOR MODIFICATION INSTRUCTION:
A human operator has reviewed the previous proposal and provided this steering instruction:
"{mod}"
Your new proposal MUST incorporate this instruction.
"""

    return f"""{SYSTEM_CONTEXT}

You have investigated a trade exception and now need to produce a formal resolution proposal.

EXCEPTION:
- Trade ID: {exc["trade_id"]}
- Type: {exc["type"]}
- Amount (USD): {exc["amount"]:,.2f}
- Counterparty: {exc["counterparty"]}

INVESTIGATION FINDINGS:
- Root Cause: {investigation["root_cause"]}
- Evidence: {', '.join(investigation["evidence"])}
- Suggested Action: {investigation["suggested_action"]}
- Investigation Confidence: {investigation["confidence"]}

{modification_context}

Produce a formal resolution proposal. Return a JSON object with exactly these fields:
{{
  "action": "A short, actionable title for the resolution (max 10 words)",
  "details": "Step-by-step explanation of what will be done and why",
  "confidence": 0.0,  // float 0.0–1.0 — your confidence in this resolution
  "requires_human_approval": true,  // always true in this system for safety
  "risk_level": "low"  // one of: low, medium, high, critical
}}

Risk level guidance:
- critical: amount > $5M, or counterparty is systemically important
- high: amount > $1M, or exception type is settlement_fail with same-day consequences
- medium: amount $100K–$1M, or standard IBAN/amount discrepancy
- low: amount < $100K, routine correction"""


# ── Execution prompt ───────────────────────────────────────────────────────────

def build_execution_confirmation_prompt(state: TradeExceptionState) -> str:
    """
    LEARNING: In this system, 'execution' means generating the exact
    instructions that the downstream settlement system would receive.
    We're not actually calling a settlement API in Phase 1 (that's a
    tool in a later phase), but we prepare the confirmation record.
    """
    exc = state["exception"]
    proposal = state["proposal"]
    decision = state["human_decision"]

    return f"""{SYSTEM_CONTEXT}

A human operator has approved the following resolution for trade exception {exc["trade_id"]}.
Generate the execution confirmation record.

APPROVED RESOLUTION:
- Action: {proposal["action"]}
- Details: {proposal["details"]}
- Approved by operator: {decision["operator_id"]}
- Approved at: {decision["decided_at"]}
- Modification from operator: {decision.get("modification") or "None — approved as proposed"}

Generate a brief execution confirmation (2-3 sentences) confirming what was done,
who approved it, and the expected outcome. This will be the final audit record."""
