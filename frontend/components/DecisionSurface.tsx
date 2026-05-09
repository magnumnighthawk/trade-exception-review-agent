/**
 * DecisionSurface — Panel 3 of the supervision cockpit.
 *
 * LEARNING: This is the HITL action surface. It only renders when the agent
 * has hit an interrupt() and is waiting for a human decision.
 *
 * The four actions implement the full HITL contract:
 * - Approve  → agent proceeds as proposed
 * - Reject   → agent loops back to re-investigate (rejection reason fed back in)
 * - Modify   → human steers the agent (most powerful HITL pattern)
 * - Escalate → case leaves this agent entirely
 *
 * LEARNING — The Modify pattern (steering vs oversight):
 * When a human modifies, their instruction goes into state["human_decision"]["modification"].
 * The next investigation prompt includes this as context. The agent doesn't just
 * try again — it tries again *with the human's guidance baked in*.
 * This is qualitatively different from approve/reject. The human is steering.
 *
 * CONFIDENCE INDICATOR:
 * The confidence bar is not just decorative. Research on human-AI teaming shows
 * operators calibrate their review depth to stated confidence. Low confidence
 * should slow down the operator, not just change a colour.
 * Hence the warning text at < 70%.
 *
 * Phase 4: Enhanced with confidence gating, audit fields, escalation categories.
 * - Confidence < 0.70: Cannot approve, must modify or escalate
 * - Confidence 0.70-0.85: Can approve but should review reasoning
 * - Confidence > 0.85: Low friction approval (one-click)
 * - Audit capture: operator_id, reason for compliance
 */

"use client"

import { useState } from "react"

import type { AgentStatus, DecisionAction, HumanDecision, InterruptPayload } from "@/lib/types"
import { RISK_BADGE_CLASSES, getConfidenceBarClass } from "@/lib/theme"

const ESCALATION_CATEGORIES = [
  "Senior Operator Review",
  "Counterparty Intervention",
  "Risk Committee",
  "Legal Review",
  "External Escalation",
]

const CONFIDENCE_THRESHOLDS = {
  AUTO_APPROVABLE: 0.85,
  REQUIRES_REVIEW: 0.7,
}

interface Props {
  status: AgentStatus
  interruptPayload: InterruptPayload | null
  onDecision: (decision: HumanDecision) => void
}

export function DecisionSurface({ status, interruptPayload, onDecision }: Props) {
  if (status !== "waiting_human" || !interruptPayload) {
    return (
      <section className="panel flex h-full min-h-[24rem] flex-col overflow-hidden rounded-[1.75rem]">
        <header className="panel-header border-b border-line px-5 py-4">
          <h2 className="text-sm font-semibold text-ink-strong">Decision surface</h2>
          <p className="mt-1 text-xs text-ink-muted">Awaiting the next proposal checkpoint</p>
        </header>

        <div className="flex flex-1 items-center justify-center px-5 py-6">
          <div className="rounded-[1.4rem] border border-dashed border-line-strong bg-surface-muted px-8 py-10 text-center">
            {status === "complete" && (
              <>
                <div className="text-3xl text-[var(--success-ink)]">✓</div>
                <p className="mt-3 text-sm font-semibold text-[var(--success-ink)]">Case resolved</p>
              </>
            )}
            {status === "escalated" && (
              <>
                <div className="text-3xl text-[var(--alert-ink)]">↗</div>
                <p className="mt-3 text-sm font-semibold text-[var(--alert-ink)]">Escalated to the senior queue</p>
              </>
            )}
            {status === "error" && (
              <>
                <div className="text-3xl text-[var(--critical-ink)]">×</div>
                <p className="mt-3 text-sm font-semibold text-[var(--critical-ink)]">Agent error</p>
              </>
            )}
            {(status === "idle" || status === "streaming" || status === "starting" || status === "resuming") && (
              <p className="max-w-xs text-sm leading-6 text-ink-muted">
                {status === "idle"
                  ? "No active review is selected."
                  : "The agent is still collecting evidence before a human decision is needed."}
              </p>
            )}
          </div>
        </div>
      </section>
    )
  }

  const payloadKey = [
    interruptPayload.trade_id,
    interruptPayload.proposal.action,
    interruptPayload.confidence,
  ].join("-")

  return (
    <ActiveDecisionSurface
      key={payloadKey}
      payload={interruptPayload}
      onDecision={onDecision}
    />
  )
}

function ActiveDecisionSurface({
  payload,
  onDecision,
}: {
  payload: InterruptPayload
  onDecision: (decision: HumanDecision) => void
}) {
  const [mode, setMode] = useState<"review" | "reject" | "modify" | "escalate">("review")
  const [inputText, setInputText] = useState("")
  const [operatorId, setOperatorId] = useState("operator_001")
  const [reason, setReason] = useState("")
  const [escalationCategory, setEscalationCategory] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [formMessage, setFormMessage] = useState<string | null>(null)

  const resetReviewInputs = () => {
    setMode("review")
    setInputText("")
    setReason("")
    setEscalationCategory(null)
    setFormMessage(null)
  }

  const handleSubmit = async (action: DecisionAction) => {
    if (action === "approve" && payload.confidence < CONFIDENCE_THRESHOLDS.REQUIRES_REVIEW) {
      setFormMessage("Approval is locked below 70% confidence. Modify the plan or escalate it.")
      return
    }

    if (!operatorId.trim()) {
      setFormMessage("Operator ID is required for audit logging.")
      return
    }

    if ((action === "modify" || action === "reject") && !inputText.trim()) {
      setFormMessage("Add guidance before submitting this decision.")
      return
    }

    if (action === "escalate" && !escalationCategory) {
      setFormMessage("Choose an escalation category before sending the case onward.")
      return
    }

    setFormMessage(null)
    setSubmitting(true)

    try {
      await onDecision({
        action,
        modification: inputText.trim() || null,
        operator_id: operatorId.trim(),
        reason: reason.trim() || null,
        confidence_before: payload.confidence,
        escalation_category: escalationCategory || null,
      })
      resetReviewInputs()
    } finally {
      setSubmitting(false)
    }
  }

  const proposal = payload.proposal
  const confidencePct = Math.round(payload.confidence * 100)
  const isLowConfidence = payload.confidence < CONFIDENCE_THRESHOLDS.REQUIRES_REVIEW
  const isHighConfidence = payload.confidence >= CONFIDENCE_THRESHOLDS.AUTO_APPROVABLE
  const canApprove = payload.confidence >= CONFIDENCE_THRESHOLDS.REQUIRES_REVIEW

  return (
    <section
      className={`panel flex h-full min-h-[24rem] flex-col overflow-hidden rounded-[1.75rem] ${
        isLowConfidence ? "border-[var(--critical-border)]" : "border-[var(--warning-border)]"
      }`}
    >
      <header
        className={`border-b px-5 py-4 ${
          isLowConfidence
            ? "border-[var(--critical-border)] bg-[var(--critical-soft)]"
            : "border-[var(--warning-border)] bg-[var(--warning-soft)]"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink-strong">
              {isLowConfidence ? "Low-confidence review required" : "Decision required"}
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              Trade {payload.trade_id} · ${payload.amount.toLocaleString()}
            </p>
          </div>

          <span
            className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
              RISK_BADGE_CLASSES[proposal.risk_level] || RISK_BADGE_CLASSES.medium
            }`}
          >
            {proposal.risk_level}
          </span>
        </div>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <div className="rounded-[1.35rem] border border-line bg-surface-elevated p-4">
          <div className="flex items-center justify-between gap-2 text-xs uppercase tracking-[0.18em]">
            <span className="text-ink-soft">Agent confidence</span>
            <span className={isLowConfidence ? "font-semibold text-[var(--critical-ink)]" : "text-ink-muted"}>
              {confidencePct}%
            </span>
          </div>
          <div className="mt-3 h-2 rounded-full bg-surface-muted">
            <div
              className={`h-2 rounded-full ${getConfidenceBarClass(confidencePct)}`}
              style={{ width: `${confidencePct}%` }}
            />
          </div>

          <p
            className={`mt-3 rounded-[1rem] border px-3 py-2 text-xs leading-5 ${
              isLowConfidence
                ? "border-[var(--critical-border)] bg-[var(--critical-soft)] text-[var(--critical-ink)]"
                : isHighConfidence
                  ? "border-[var(--success-border)] bg-[var(--success-soft)] text-[var(--success-ink)]"
                  : "border-[var(--warning-border)] bg-[var(--warning-soft)] text-[var(--warning-ink)]"
            }`}
          >
            {isLowConfidence
              ? "Approve is disabled below the review threshold. Provide a steering instruction or escalate the case."
              : isHighConfidence
                ? "High-confidence proposal: approval is available immediately, but you can still steer or escalate."
                : "This proposal is within the review band. Validate the reasoning before approving."}
          </p>
        </div>

        <div className="rounded-[1.35rem] border border-line bg-surface-elevated p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">Proposed action</p>
          <p className="mt-3 text-base font-semibold text-ink-strong">{proposal.action}</p>
          <p className="mt-2 text-sm leading-6 text-ink-muted">{proposal.details}</p>
        </div>

        <div className="rounded-[1.35rem] border border-line bg-surface px-4 py-4">
          <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">Investigation summary</p>
          <p className="mt-3 text-sm leading-6 text-ink">{payload.investigation_summary}</p>
        </div>

        <div className="rounded-[1.35rem] border border-line bg-surface px-4 py-4">
          <label className="block text-xs uppercase tracking-[0.18em] text-ink-soft" htmlFor="operator-id">
            Operator ID
          </label>
          <input
            id="operator-id"
            type="text"
            value={operatorId}
            onChange={(event) => setOperatorId(event.target.value)}
            placeholder="ops_johndoe"
            className="surface-field mt-3 w-full rounded-[1rem] px-3 py-2 text-sm"
          />
        </div>

        {mode === "modify" && (
          <div className="rounded-[1.35rem] border border-line bg-surface px-4 py-4">
            <label className="block text-xs uppercase tracking-[0.18em] text-ink-soft" htmlFor="modify-instruction">
              Modification instruction
            </label>
            <textarea
              id="modify-instruction"
              autoFocus
              rows={4}
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              placeholder="Describe what the agent should do differently."
              className="surface-field mt-3 w-full resize-none rounded-[1rem] px-3 py-3 text-sm leading-6"
            />
          </div>
        )}

        {mode === "reject" && (
          <div className="rounded-[1.35rem] border border-line bg-surface px-4 py-4">
            <label className="block text-xs uppercase tracking-[0.18em] text-ink-soft" htmlFor="reject-reason">
              Rejection reason
            </label>
            <textarea
              id="reject-reason"
              autoFocus
              rows={4}
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              placeholder="Explain why the proposal is incorrect."
              className="surface-field mt-3 w-full resize-none rounded-[1rem] px-3 py-3 text-sm leading-6"
            />
          </div>
        )}

        {mode === "escalate" && (
          <div className="rounded-[1.35rem] border border-line bg-surface px-4 py-4">
            <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">Escalation category</p>
            <div className="mt-3 space-y-2">
              {ESCALATION_CATEGORIES.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => {
                    setEscalationCategory(category)
                    setFormMessage(null)
                  }}
                  className={`w-full rounded-[1rem] border px-3 py-3 text-left text-sm ${
                    escalationCategory === category
                      ? "border-[var(--alert-border)] bg-[var(--alert-soft)] text-[var(--alert-ink)]"
                      : "border-line bg-surface-muted text-ink hover:border-[var(--alert-border)] hover:bg-surface-hover"
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>
        )}

        {(mode === "modify" || mode === "reject" || mode === "escalate") && (
          <div className="rounded-[1.35rem] border border-line bg-surface px-4 py-4">
            <label className="block text-xs uppercase tracking-[0.18em] text-ink-soft" htmlFor="audit-reason">
              Decision reason
            </label>
            <textarea
              id="audit-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Optional audit note describing why you chose this path."
              className="surface-field mt-3 w-full resize-none rounded-[1rem] px-3 py-3 text-sm leading-6"
            />
          </div>
        )}
      </div>

      <footer className="border-t border-line px-5 py-4">
        {formMessage && (
          <div className="mb-3 rounded-[1rem] border border-[var(--critical-border)] bg-[var(--critical-soft)] px-3 py-2 text-xs leading-5 text-[var(--critical-ink)]">
            {formMessage}
          </div>
        )}

        {mode === "review" ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!canApprove || submitting}
                onClick={() => void handleSubmit("approve")}
                className={`rounded-full px-3 py-3 text-xs font-semibold uppercase tracking-[0.16em] ${
                  canApprove
                    ? "bg-[var(--success-solid)] text-[var(--accent-contrast)] hover:-translate-y-0.5"
                    : "bg-surface-muted text-ink-soft opacity-55"
                }`}
              >
                Approve
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  setMode("escalate")
                  setFormMessage(null)
                }}
                className="rounded-full bg-[var(--alert-solid)] px-3 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent-contrast)] hover:-translate-y-0.5 disabled:opacity-50"
              >
                Escalate
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setMode("modify")
                  setFormMessage(null)
                }}
                className="rounded-full bg-accent px-3 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-accent-contrast hover:-translate-y-0.5"
              >
                Modify
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("reject")
                  setFormMessage(null)
                }}
                className="rounded-full border border-line-strong bg-surface px-3 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-ink hover:bg-surface-hover"
              >
                Reject
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={resetReviewInputs}
              className="rounded-full border border-line-strong bg-surface px-3 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-ink hover:bg-surface-hover"
            >
              Back
            </button>
            <button
              type="button"
              disabled={(mode !== "escalate" && !inputText.trim()) || !operatorId.trim() || submitting}
              onClick={() => void handleSubmit(mode as DecisionAction)}
              className="rounded-full bg-accent px-3 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-accent-contrast hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-45"
            >
              {submitting
                ? "Submitting"
                : mode === "modify"
                  ? "Submit modification"
                  : mode === "reject"
                    ? "Send for reinvestigation"
                    : "Escalate case"}
            </button>
          </div>
        )}

        <p className="mt-3 text-center text-xs text-ink-soft">
          {mode === "modify"
            ? "Modify steers the next investigation with your instruction."
            : mode === "reject"
              ? "Reject returns the case for another investigation pass."
              : "Approve, modify, or escalate while the agent is checkpointed."}
        </p>
      </footer>
    </section>
  )
}
