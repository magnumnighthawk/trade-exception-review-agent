from backend.agent.state import TradeExceptionState

SYSTEM_CONTEXT = """You are a trade exception review specialist at a major investment bank.
You investigate flagged trade exceptions, determine their root cause with precision,
and propose clear, actionable resolutions.

Your outputs will be reviewed by a human operator before any action is taken.
Be specific, cite evidence, and always state your confidence level honestly.
If you are uncertain, say so — an operator will provide additional guidance.

Output format for structured responses: valid JSON only, no markdown fences."""


def _format_additional_context(state: TradeExceptionState) -> str:
    additional_context = state.get("additional_context") or {}
    if not additional_context:
        return ""

    lines = "\n".join(f"- {key}: {value}" for key, value in additional_context.items())
    return f"""
ADDITIONAL HUMAN-PROVIDED CONTEXT:
{lines}
Use this as the source-of-truth when resolving ambiguity.
"""

def build_investigation_prompt(state: TradeExceptionState) -> str:
    exc = state["exception"]
    history_context = ""

    if state.get("investigation_attempts", 0) > 0 and state.get("human_decision"):
        decision = state["human_decision"]
        history_context = f"""
IMPORTANT — Previous investigation/proposal cycle was rejected by a human operator.
Rejection / modification instruction: {decision.get("modification", "No modification provided")}
You must factor this feedback into your revised investigation.
"""

    additional_context = _format_additional_context(state)

    return f"""{SYSTEM_CONTEXT}

{history_context}
{additional_context}
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
  "confidence": 0.0
}}

Be honest about confidence. Low confidence triggers mandatory human review."""

def build_proposal_prompt(state: TradeExceptionState) -> str:
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

    additional_context = _format_additional_context(state)

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

{additional_context}
{modification_context}

Produce a formal resolution proposal. Return a JSON object with exactly these fields:
{{
  "action": "A short, actionable title for the resolution (max 10 words)",
  "details": "Step-by-step explanation of what will be done and why",
  "confidence": 0.0,
  "requires_human_approval": true,
  "risk_level": "low"
}}

Risk level guidance:
- critical: amount > $5M, or counterparty is systemically important
- high: amount > $1M, or exception type is settlement_fail with same-day consequences
- medium: amount $100K–$1M, or standard IBAN/amount discrepancy
- low: amount < $100K, routine correction"""

def build_execution_confirmation_prompt(state: TradeExceptionState) -> str:
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
