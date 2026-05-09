"use client"

import { useState } from "react"

import type {
  AgentStatus,
  DecisionAction,
  FailureRecoveryInterruptPayload,
  HumanDecision,
  InformationRequestInterruptPayload,
  InterruptPayload,
  ProposalReviewInterruptPayload,
} from "@/lib/types"
import { RISK_BADGE_CLASSES, getConfidenceBarClass } from "@/lib/theme"

const ESCALATION_CATEGORIES = [
  "Senior Operator Review",
  "Counterparty Intervention",
  "Risk Committee",
  "Legal Review",
  "External Escalation",
]

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
          <h2 className="text-sm font-semibold text-ink-strong">Action surface</h2>
          <p className="mt-1 text-xs text-ink-muted">This rail activates only when the agent needs human intervention.</p>
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
            {status === "manual_takeover" && (
              <>
                <div className="text-3xl text-[var(--alert-ink)]">⌁</div>
                <p className="mt-3 text-sm font-semibold text-[var(--alert-ink)]">Handed to manual resolution</p>
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
                  : "The agent is still collecting evidence before a human intervention is needed."}
              </p>
            )}
          </div>
        </div>
      </section>
    )
  }

  const payloadKey = `${interruptPayload.kind}-${interruptPayload.trade_id}`

  return <ActiveDecisionSurface key={payloadKey} payload={interruptPayload} onDecision={onDecision} />
}

function ActiveDecisionSurface({
  payload,
  onDecision,
}: {
  payload: InterruptPayload
  onDecision: (decision: HumanDecision) => void
}) {
  const [mode, setMode] = useState<DecisionAction | null>(null)
  const [operatorId, setOperatorId] = useState("operator_001")
  const [note, setNote] = useState("")
  const [reason, setReason] = useState("")
  const [escalationCategory, setEscalationCategory] = useState<string | null>(null)
  const [contextFields, setContextFields] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [formMessage, setFormMessage] = useState<string | null>(null)

  const clearMode = () => {
    setMode(null)
    setNote("")
    setReason("")
    setEscalationCategory(null)
    setFormMessage(null)
  }

  const submitDecision = async (action: DecisionAction) => {
    if (!operatorId.trim()) {
      setFormMessage("Operator ID is required for audit logging.")
      return
    }

    if (payload.kind === "proposal_review") {
      const threshold = payload.policy.low_confidence_threshold
      if (action === "approve" && payload.confidence < threshold) {
        setFormMessage("Approval is locked below the policy threshold. Modify the plan or escalate it.")
        return
      }
      if ((action === "modify" || action === "reject") && !note.trim()) {
        setFormMessage("Add guidance before submitting this decision.")
        return
      }
    }

    if (payload.kind === "information_request" && action === "provide_context") {
      const missing = payload.fields_needed.filter((field) => !contextFields[field]?.trim())
      if (missing.length > 0) {
        setFormMessage(`Provide all requested fields before resuming: ${missing.join(", ")}`)
        return
      }
    }

    if (payload.kind === "failure_recovery") {
      if (action === "retry" && !payload.retry_available) {
        setFormMessage("Retry is no longer available for this case.")
        return
      }
      if (action === "manual_takeover" && !note.trim()) {
        setFormMessage("Add a manual-takeover note before removing the case from agent control.")
        return
      }
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
        modification: note.trim() || null,
        operator_id: operatorId.trim(),
        reason: reason.trim() || null,
        confidence_before: payload.kind === "proposal_review" ? payload.confidence : null,
        escalation_category: escalationCategory || null,
        context_fields:
          payload.kind === "information_request"
            ? Object.fromEntries(
                Object.entries(contextFields).filter(([, value]) => value.trim().length > 0),
              )
            : null,
      })
      clearMode()
      if (payload.kind === "information_request") {
        setContextFields({})
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="panel flex h-full min-h-[24rem] flex-col overflow-hidden rounded-[1.75rem]">
      <header className={`border-b px-5 py-4 ${getHeaderTone(payload)}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink-strong">{getSurfaceTitle(payload)}</h2>
            <p className="mt-1 text-xs text-ink-muted">{getSurfaceSubtitle(payload)}</p>
          </div>

          {payload.kind === "proposal_review" && (
            <span
              className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                RISK_BADGE_CLASSES[payload.proposal.risk_level] || RISK_BADGE_CLASSES.medium
              }`}
            >
              {payload.proposal.risk_level}
            </span>
          )}
        </div>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <OperatorIdentityCard operatorId={operatorId} setOperatorId={setOperatorId} />

        {payload.kind === "proposal_review" && (
          <ProposalReviewPanel payload={payload} mode={mode} note={note} setNote={setNote} />
        )}

        {payload.kind === "information_request" && (
          <InformationRequestPanel
            payload={payload}
            contextFields={contextFields}
            setContextFields={setContextFields}
          />
        )}

        {payload.kind === "failure_recovery" && (
          <FailureRecoveryPanel payload={payload} mode={mode} note={note} setNote={setNote} />
        )}

        {(mode === "modify" ||
          mode === "reject" ||
          mode === "escalate" ||
          mode === "manual_takeover") && (
          <FreeformNoteCard
            label={mode === "manual_takeover" ? "Manual handoff note" : "Decision note"}
            value={mode === "escalate" ? reason : note}
            onChange={(value) => {
              if (mode === "escalate") setReason(value)
              else setNote(value)
            }}
            placeholder={
              mode === "manual_takeover"
                ? "Explain what the human operator will do next."
                : "Add the operator guidance or rationale for this path."
            }
          />
        )}

        {mode === "escalate" && (
          <EscalationCategoryCard
            escalationCategory={escalationCategory}
            setEscalationCategory={setEscalationCategory}
          />
        )}
      </div>

      <footer className="border-t border-line px-5 py-4">
        {formMessage && (
          <div className="mb-3 rounded-[1rem] border border-[var(--critical-border)] bg-[var(--critical-soft)] px-3 py-2 text-xs leading-5 text-[var(--critical-ink)]">
            {formMessage}
          </div>
        )}

        {payload.kind === "proposal_review" && (
          <ProposalActions
            payload={payload}
            mode={mode}
            submitting={submitting}
            onMode={setMode}
            onBack={clearMode}
            onSubmit={submitDecision}
          />
        )}

        {payload.kind === "information_request" && (
          <SimpleActionGrid
            primaryLabel="Provide context"
            primaryDisabled={submitting}
            onPrimary={() => void submitDecision("provide_context")}
            secondaryLabel="Escalate"
            secondaryDisabled={submitting}
            onSecondary={() => {
              setMode("escalate")
              setFormMessage(null)
            }}
            mode={mode}
            submitting={submitting}
            onBack={clearMode}
            onConfirm={() => void submitDecision("escalate")}
          />
        )}

        {payload.kind === "failure_recovery" && (
          <FailureRecoveryActions
            payload={payload}
            mode={mode}
            submitting={submitting}
            onMode={setMode}
            onBack={clearMode}
            onSubmit={submitDecision}
          />
        )}
      </footer>
    </section>
  )
}

function ProposalReviewPanel({
  payload,
  mode,
  note,
  setNote,
}: {
  payload: ProposalReviewInterruptPayload
  mode: DecisionAction | null
  note: string
  setNote: (value: string) => void
}) {
  const confidencePct = Math.round(payload.confidence * 100)
  const isLowConfidence = payload.confidence < payload.policy.low_confidence_threshold
  const isHighConfidence = payload.confidence >= payload.policy.high_confidence_threshold

  return (
    <>
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
            ? "Policy locks approval below the low-confidence threshold. Steer the plan or escalate it."
            : isHighConfidence
              ? "High-confidence proposal: approval is available immediately, but you can still steer or escalate."
              : "This proposal is inside the review band. Validate the reasoning before approving."}
        </p>
      </div>

      <div className="rounded-[1.35rem] border border-line bg-surface-elevated p-4">
        <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">Proposed action</p>
        <p className="mt-3 text-base font-semibold text-ink-strong">{payload.proposal.action}</p>
        <p className="mt-2 text-sm leading-6 text-ink-muted">{payload.proposal.details}</p>
      </div>

      <div className="rounded-[1.35rem] border border-line bg-surface px-4 py-4">
        <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">Investigation summary</p>
        <p className="mt-3 text-sm leading-6 text-ink">{payload.investigation_summary}</p>
      </div>

      {(mode === "modify" || mode === "reject") && (
        <FreeformNoteCard
          label={mode === "modify" ? "Modification instruction" : "Rejection reason"}
          value={note}
          onChange={setNote}
          placeholder={
            mode === "modify"
              ? "Describe what the agent should do differently."
              : "Explain why the proposal is incorrect."
          }
        />
      )}
    </>
  )
}

function InformationRequestPanel({
  payload,
  contextFields,
  setContextFields,
}: {
  payload: InformationRequestInterruptPayload
  contextFields: Record<string, string>
  setContextFields: (value: Record<string, string>) => void
}) {
  return (
    <>
      <div className="rounded-[1.35rem] border border-[var(--warning-border)] bg-[var(--warning-soft)] p-4">
        <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">Agent question</p>
        <p className="mt-3 text-sm leading-6 text-ink">{payload.question}</p>
      </div>

      <div className="rounded-[1.35rem] border border-line bg-surface p-4">
        <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">Why the agent stopped</p>
        <p className="mt-3 text-sm leading-6 text-ink-muted">{payload.context_summary}</p>
      </div>

      <div className="rounded-[1.35rem] border border-line bg-surface-elevated p-4">
        <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">Requested fields</p>
        <div className="mt-3 space-y-3">
          {payload.fields_needed.map((field) => (
            <label key={field} className="block">
              <span className="text-xs font-medium uppercase tracking-[0.16em] text-ink-soft">{field}</span>
              <input
                type="text"
                value={contextFields[field] ?? ""}
                onChange={(event) =>
                  setContextFields({
                    ...contextFields,
                    [field]: event.target.value,
                  })
                }
                placeholder={`Enter ${field}`}
                className="surface-field mt-2 w-full rounded-[1rem] px-3 py-2 text-sm"
              />
            </label>
          ))}
        </div>
      </div>
    </>
  )
}

function FailureRecoveryPanel({
  payload,
  mode,
  note,
  setNote,
}: {
  payload: FailureRecoveryInterruptPayload
  mode: DecisionAction | null
  note: string
  setNote: (value: string) => void
}) {
  return (
    <>
      <div className="rounded-[1.35rem] border border-[var(--critical-border)] bg-[var(--critical-soft)] p-4">
        <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">Failure summary</p>
        <p className="mt-3 text-sm leading-6 text-ink">{payload.error_message}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--critical-ink)]">
          <span>{payload.failed_node}</span>
          <span>retry {payload.retry_count}</span>
          <span>{payload.retry_available ? "retry available" : "retry exhausted"}</span>
        </div>
      </div>

      {payload.latest_proposal && (
        <div className="rounded-[1.35rem] border border-line bg-surface-elevated p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">Latest approved plan</p>
          <p className="mt-3 text-base font-semibold text-ink-strong">{payload.latest_proposal.action}</p>
          <p className="mt-2 text-sm leading-6 text-ink-muted">{payload.latest_proposal.details}</p>
        </div>
      )}

      {mode === "manual_takeover" && (
        <FreeformNoteCard
          label="Manual takeover note"
          value={note}
          onChange={setNote}
          placeholder="Explain what the operator will do outside the agent flow."
        />
      )}
    </>
  )
}

function ProposalActions({
  payload,
  mode,
  submitting,
  onMode,
  onBack,
  onSubmit,
}: {
  payload: ProposalReviewInterruptPayload
  mode: DecisionAction | null
  submitting: boolean
  onMode: (mode: DecisionAction | null) => void
  onBack: () => void
  onSubmit: (action: DecisionAction) => Promise<void>
}) {
  const canApprove = payload.confidence >= payload.policy.low_confidence_threshold

  if (mode === "modify" || mode === "reject" || mode === "escalate") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-line-strong bg-surface px-3 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-ink hover:bg-surface-hover"
        >
          Back
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => void onSubmit(mode)}
          className="rounded-full bg-accent px-3 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-accent-contrast hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-45"
        >
          Confirm
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!canApprove || submitting}
          onClick={() => void onSubmit("approve")}
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
          onClick={() => onMode("escalate")}
          className="rounded-full bg-[var(--alert-solid)] px-3 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent-contrast)] hover:-translate-y-0.5 disabled:opacity-50"
        >
          Escalate
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onMode("modify")}
          className="rounded-full bg-accent px-3 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-accent-contrast hover:-translate-y-0.5"
        >
          Modify
        </button>
        <button
          type="button"
          onClick={() => onMode("reject")}
          className="rounded-full border border-line-strong bg-surface px-3 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-ink hover:bg-surface-hover"
        >
          Reject
        </button>
      </div>
    </div>
  )
}

function FailureRecoveryActions({
  payload,
  mode,
  submitting,
  onMode,
  onBack,
  onSubmit,
}: {
  payload: FailureRecoveryInterruptPayload
  mode: DecisionAction | null
  submitting: boolean
  onMode: (mode: DecisionAction | null) => void
  onBack: () => void
  onSubmit: (action: DecisionAction) => Promise<void>
}) {
  if (mode === "manual_takeover" || mode === "escalate") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-line-strong bg-surface px-3 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-ink hover:bg-surface-hover"
        >
          Back
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => void onSubmit(mode)}
          className="rounded-full bg-accent px-3 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-accent-contrast hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-45"
        >
          Confirm
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={!payload.retry_available || submitting}
        onClick={() => void onSubmit("retry")}
        className={`w-full rounded-full px-3 py-3 text-xs font-semibold uppercase tracking-[0.16em] ${
          payload.retry_available
            ? "bg-[var(--success-solid)] text-[var(--accent-contrast)] hover:-translate-y-0.5"
            : "bg-surface-muted text-ink-soft opacity-55"
        }`}
      >
        Retry
      </button>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onMode("manual_takeover")}
          className="rounded-full border border-line-strong bg-surface px-3 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-ink hover:bg-surface-hover"
        >
          Manual takeover
        </button>
        <button
          type="button"
          onClick={() => onMode("escalate")}
          className="rounded-full bg-[var(--alert-solid)] px-3 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent-contrast)] hover:-translate-y-0.5"
        >
          Escalate
        </button>
      </div>
    </div>
  )
}

function SimpleActionGrid({
  primaryLabel,
  primaryDisabled,
  onPrimary,
  secondaryLabel,
  secondaryDisabled,
  onSecondary,
  mode,
  submitting,
  onBack,
  onConfirm,
}: {
  primaryLabel: string
  primaryDisabled: boolean
  onPrimary: () => void
  secondaryLabel: string
  secondaryDisabled: boolean
  onSecondary: () => void
  mode: DecisionAction | null
  submitting: boolean
  onBack: () => void
  onConfirm: () => void
}) {
  if (mode === "escalate") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-line-strong bg-surface px-3 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-ink hover:bg-surface-hover"
        >
          Back
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={onConfirm}
          className="rounded-full bg-accent px-3 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-accent-contrast hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-45"
        >
          Confirm
        </button>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        disabled={primaryDisabled}
        onClick={onPrimary}
        className="rounded-full bg-accent px-3 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-accent-contrast hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-45"
      >
        {primaryLabel}
      </button>
      <button
        type="button"
        disabled={secondaryDisabled}
        onClick={onSecondary}
        className="rounded-full bg-[var(--alert-solid)] px-3 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent-contrast)] hover:-translate-y-0.5 disabled:opacity-45"
      >
        {secondaryLabel}
      </button>
    </div>
  )
}

function OperatorIdentityCard({
  operatorId,
  setOperatorId,
}: {
  operatorId: string
  setOperatorId: (value: string) => void
}) {
  return (
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
  )
}

function FreeformNoteCard({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <div className="rounded-[1.35rem] border border-line bg-surface px-4 py-4">
      <label className="block text-xs uppercase tracking-[0.18em] text-ink-soft">
        {label}
        <textarea
          rows={4}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="surface-field mt-3 w-full resize-none rounded-[1rem] px-3 py-3 text-sm leading-6"
        />
      </label>
    </div>
  )
}

function EscalationCategoryCard({
  escalationCategory,
  setEscalationCategory,
}: {
  escalationCategory: string | null
  setEscalationCategory: (value: string) => void
}) {
  return (
    <div className="rounded-[1.35rem] border border-line bg-surface px-4 py-4">
      <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">Escalation category</p>
      <div className="mt-3 space-y-2">
        {ESCALATION_CATEGORIES.map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => setEscalationCategory(category)}
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
  )
}

function getSurfaceTitle(payload: InterruptPayload) {
  if (payload.kind === "proposal_review") {
    return payload.confidence < payload.policy.low_confidence_threshold
      ? "Low-confidence review required"
      : "Proposal decision required"
  }
  if (payload.kind === "information_request") return "Additional context required"
  return "Recovery decision required"
}

function getSurfaceSubtitle(payload: InterruptPayload) {
  if (payload.kind === "proposal_review") {
    return `Trade ${payload.trade_id} · $${payload.amount.toLocaleString()}`
  }
  if (payload.kind === "information_request") {
    return `Trade ${payload.trade_id} · investigation paused for source-of-truth input`
  }
  return `Trade ${payload.trade_id} · execution failed but recovery is still possible`
}

function getHeaderTone(payload: InterruptPayload) {
  if (payload.kind === "proposal_review") {
    return payload.confidence < payload.policy.low_confidence_threshold
      ? "border-[var(--critical-border)] bg-[var(--critical-soft)]"
      : "border-[var(--warning-border)] bg-[var(--warning-soft)]"
  }
  if (payload.kind === "information_request") {
    return "border-[var(--warning-border)] bg-[var(--warning-soft)]"
  }
  return "border-[var(--critical-border)] bg-[var(--critical-soft)]"
}
