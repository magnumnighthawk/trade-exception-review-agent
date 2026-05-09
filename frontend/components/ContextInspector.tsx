"use client"

import { useEffect, useMemo, useState } from "react"

import type {
  AuditLogResponse,
  CheckpointStateResponse,
  QueueItem,
  ThreadSession,
} from "@/lib/types"
import { RISK_BADGE_CLASSES, STATUS_PILL_CLASSES } from "@/lib/theme"

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

const STATUS_LABELS: Record<string, string> = {
  idle: "Ready to run",
  starting: "Starting",
  running: "Investigating",
  streaming: "Investigating",
  waiting_human: "Awaiting review",
  resuming: "Resuming",
  complete: "Resolved",
  escalated: "Escalated",
  manual_takeover: "Manual resolution",
  error: "Needs intervention",
}

type InspectorTab = "summary" | "audit" | "checkpoint"

interface Props {
  selectedItem: QueueItem | null
  selectedSession: ThreadSession | null
}

export function ContextInspector({ selectedItem, selectedSession }: Props) {
  const [activeTab, setActiveTab] = useState<InspectorTab>("summary")
  const [auditPayload, setAuditPayload] = useState<AuditLogResponse | null>(null)
  const [checkpointPayload, setCheckpointPayload] = useState<CheckpointStateResponse | null>(null)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [checkpointError, setCheckpointError] = useState<string | null>(null)
  const [isAuditLoading, setIsAuditLoading] = useState(false)
  const [isCheckpointLoading, setIsCheckpointLoading] = useState(false)

  const threadId = selectedItem?.thread_id ?? null
  const latestStage = selectedSession?.stageHistory.at(-1) ?? null
  const summaryProposal =
    selectedItem?.proposal_action ??
    latestStage?.snapshot?.proposal?.action ??
    selectedSession?.finalState?.proposal?.action ??
    null

  const summaryHighlight = useMemo(() => {
    if (!selectedItem) {
      return "Pick a trade to inspect its summary, audit trail, and checkpoint details."
    }
    if (selectedItem.status === "idle") {
      return "This trade is waiting to be launched. Use the triage board to start a review when capacity opens."
    }
    if (selectedItem.status === "error") {
      return "The run failed and needs intervention. Use this inspector to review the checkpoint and audit trace before retrying."
    }
    if (selectedItem.status === "manual_takeover") {
      return "The agent has stepped aside. Use the audit and checkpoint tabs to understand the manual handoff."
    }
    if (selectedItem.status === "waiting_human" && selectedItem.intervention_kind === "information_request") {
      return "The agent paused because it lacks a source-of-truth input. Supply the missing context or escalate."
    }
    if (selectedItem.status === "waiting_human" && selectedItem.intervention_kind === "failure_recovery") {
      return "The agent hit a recoverable failure. Review the latest checkpoint before retrying or taking manual ownership."
    }
    if (selectedItem.status === "complete" || selectedItem.status === "escalated") {
      return "This case is closed, but the audit and checkpoint surfaces remain available for post-run review."
    }
    return "Use the tabs to move between the live case summary, audit history, and checkpoint state without leaving the workstation."
  }, [selectedItem])

  useEffect(() => {
    let ignore = false

    const loadInspectorData = async () => {
      if (!threadId) {
        if (!ignore) {
          setAuditPayload(null)
          setCheckpointPayload(null)
          setAuditError(null)
          setCheckpointError(null)
        }
        return
      }

      if (!ignore) {
        setIsAuditLoading(true)
        setIsCheckpointLoading(true)
        setAuditError(null)
        setCheckpointError(null)
      }

      const [auditResult, checkpointResult] = await Promise.allSettled([
        fetch(`${API_BASE}/queue/audit/${threadId}`),
        fetch(`${API_BASE}/review/${threadId}/checkpoint`),
      ])

      if (ignore) return

      if (auditResult.status === "fulfilled") {
        if (auditResult.value.ok) {
          setAuditPayload((await auditResult.value.json()) as AuditLogResponse)
          setAuditError(null)
        } else {
          setAuditPayload(null)
          setAuditError(`Audit fetch failed (${auditResult.value.status})`)
        }
      } else {
        setAuditPayload(null)
        setAuditError("Audit fetch failed")
      }

      if (checkpointResult.status === "fulfilled") {
        if (checkpointResult.value.ok) {
          setCheckpointPayload((await checkpointResult.value.json()) as CheckpointStateResponse)
          setCheckpointError(null)
        } else {
          setCheckpointPayload(null)
          setCheckpointError(`Checkpoint fetch failed (${checkpointResult.value.status})`)
        }
      } else {
        setCheckpointPayload(null)
        setCheckpointError("Checkpoint fetch failed")
      }

      setIsAuditLoading(false)
      setIsCheckpointLoading(false)
    }

    void loadInspectorData()

    return () => {
      ignore = true
    }
  }, [threadId, selectedSession?.status])

  return (
    <section className="panel flex h-full min-h-[24rem] flex-col overflow-hidden rounded-[1.75rem]">
      <header className="panel-header border-b border-line px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink-strong">Context inspector</h2>
            <p className="mt-1 text-xs leading-5 text-ink-muted">{summaryHighlight}</p>
          </div>

          {selectedItem && (
            <span
              className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                STATUS_PILL_CLASSES[selectedItem.status] || STATUS_PILL_CLASSES.idle
              }`}
            >
              {STATUS_LABELS[selectedItem.status] || selectedItem.status}
            </span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <InspectorTabButton
            label="Summary"
            active={activeTab === "summary"}
            onClick={() => setActiveTab("summary")}
          />
          <InspectorTabButton
            label="Audit trail"
            active={activeTab === "audit"}
            onClick={() => setActiveTab("audit")}
            disabled={!threadId}
          />
          <InspectorTabButton
            label="Checkpoint"
            active={activeTab === "checkpoint"}
            onClick={() => setActiveTab("checkpoint")}
            disabled={!threadId}
          />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {activeTab === "summary" && (
          <div className="space-y-3">
            {selectedItem ? (
              <>
                <div className="rounded-[1.35rem] border border-line bg-surface-elevated p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">Selected case</p>
                      <h3 className="mt-2 font-mono text-lg font-semibold text-ink-strong">
                        {selectedItem.trade_id}
                      </h3>
                      <p className="mt-1 text-sm text-ink-muted">
                        {selectedItem.counterparty || "Unknown counterparty"}
                      </p>
                    </div>

                    {selectedItem.risk_level && (
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                          RISK_BADGE_CLASSES[selectedItem.risk_level] ?? RISK_BADGE_CLASSES.medium
                        }`}
                      >
                        {selectedItem.risk_level}
                      </span>
                    )}
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <SummaryMetric
                      label="Amount"
                      value={`$${((selectedItem.amount ?? 0) / 1_000_000).toFixed(2)}M`}
                    />
                    <SummaryMetric
                      label="Confidence"
                      value={
                        selectedItem.confidence == null
                          ? "—"
                          : `${Math.round(selectedItem.confidence * 100)}%`
                      }
                    />
                  </div>
                </div>

                <div className="rounded-[1.35rem] border border-line bg-surface p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">Latest operator-facing signal</p>
                  <p className="mt-3 text-sm leading-6 text-ink">
                    {selectedSession?.failureContext?.message ??
                      selectedSession?.manualTakeoverNote ??
                      summaryProposal ??
                      selectedSession?.finalState?.execution_result ??
                      "No proposal has been produced yet."}
                  </p>
                </div>

                {(selectedSession?.failureContext || selectedSession?.manualTakeoverNote) && (
                  <div className="rounded-[1.35rem] border border-line bg-surface p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">Recovery context</p>
                    <div className="mt-3 space-y-3">
                      {selectedSession?.failureContext && (
                        <>
                          <SummaryMetric label="Failed node" value={selectedSession.failureContext.failed_node} />
                          <SummaryMetric
                            label="Retry state"
                            value={
                              selectedSession.failureContext.retry_available
                                ? `retry ${selectedSession.failureContext.retry_count} available`
                                : "retry exhausted"
                            }
                          />
                        </>
                      )}
                      {selectedSession?.manualTakeoverNote && (
                        <SummaryMetric label="Manual handoff" value={selectedSession.manualTakeoverNote} />
                      )}
                    </div>
                  </div>
                )}

                <div className="rounded-[1.35rem] border border-line bg-surface p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">Stage focus</p>
                  {latestStage ? (
                    <div className="mt-3 space-y-3">
                      <SummaryMetric label="Latest stage" value={latestStage.message} />
                      <SummaryMetric
                        label="Captured transcript"
                        value={latestStage.tokens ? `${latestStage.tokens.length} characters` : "No transcript yet"}
                      />
                      {latestStage.snapshot?.status && (
                        <SummaryMetric label="Snapshot status" value={latestStage.snapshot.status} />
                      )}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm leading-6 text-ink-muted">
                      No stage history has been captured yet for this selection.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <EmptyInspectorState message="Select a case from the triage board to open its contextual inspector." />
            )}
          </div>
        )}

        {activeTab === "audit" && (
          <div className="space-y-3">
            {!threadId ? (
              <EmptyInspectorState message="Audit history becomes available once a review thread exists." />
            ) : isAuditLoading ? (
              <EmptyInspectorState message="Loading audit history…" />
            ) : auditError ? (
              <EmptyInspectorState message={auditError} tone="error" />
            ) : auditPayload && auditPayload.audit_entries.length > 0 ? (
              auditPayload.audit_entries
                .slice()
                .reverse()
                .map((entry) => (
                  <div key={entry.audit_entry_id} className="rounded-[1.25rem] border border-line bg-surface p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">{entry.decision}</p>
                        <p className="mt-1 text-sm font-medium text-ink-strong">{entry.operator_id}</p>
                      </div>
                      <p className="text-xs text-ink-soft">{formatTimestamp(entry.timestamp)}</p>
                    </div>

                    {entry.reason && (
                      <p className="mt-3 text-sm leading-6 text-ink">{entry.reason}</p>
                    )}
                    {entry.modification && (
                      <p className="mt-3 rounded-[1rem] border border-line bg-surface-elevated px-3 py-2 text-sm leading-6 text-ink-muted">
                        {entry.modification}
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.16em] text-ink-soft">
                      {entry.confidence_before != null && (
                        <span>{Math.round(entry.confidence_before * 100)}% confidence</span>
                      )}
                      {entry.escalation_category && <span>{entry.escalation_category}</span>}
                    </div>
                    {entry.context_fields && Object.keys(entry.context_fields).length > 0 && (
                      <div className="mt-3 rounded-[1rem] border border-line bg-surface-elevated px-3 py-2 text-sm text-ink-muted">
                        {Object.entries(entry.context_fields).map(([key, value]) => (
                          <p key={key}>
                            <span className="font-medium text-ink-strong">{key}:</span> {value}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ))
            ) : (
              <EmptyInspectorState message="No audit entries have been recorded for this thread yet." />
            )}
          </div>
        )}

        {activeTab === "checkpoint" && (
          <div className="space-y-3">
            {!threadId ? (
              <EmptyInspectorState message="Checkpoint metadata appears once a thread has been started." />
            ) : isCheckpointLoading ? (
              <EmptyInspectorState message="Loading checkpoint metadata…" />
            ) : checkpointError ? (
              <EmptyInspectorState message={checkpointError} tone="error" />
            ) : checkpointPayload ? (
              <>
                <div className="rounded-[1.35rem] border border-line bg-surface-elevated p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">Checkpoint health</p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <SummaryMetric
                      label="Stored checkpoint"
                      value={checkpointPayload.has_checkpoint ? "Yes" : "No"}
                    />
                    <SummaryMetric
                      label="Interrupts"
                      value={String(checkpointPayload.interrupt_count)}
                    />
                    <SummaryMetric
                      label="Next node"
                      value={checkpointPayload.next_node ?? "None"}
                    />
                    <SummaryMetric
                      label="Backend"
                      value={checkpointPayload.checkpointer_backend}
                    />
                  </div>
                </div>

                <div className="rounded-[1.35rem] border border-line bg-surface p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">State keys</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {checkpointPayload.state_keys.map((stateKey) => (
                      <span
                        key={stateKey}
                        className="rounded-full border border-line-strong bg-surface-elevated px-2.5 py-1 text-xs text-ink-muted"
                      >
                        {stateKey}
                      </span>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <EmptyInspectorState message="No checkpoint metadata is available for this thread." />
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function InspectorTabButton({
  label,
  active,
  disabled = false,
  onClick,
}: {
  label: string
  active: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full px-3 py-2 text-xs font-medium ${
        active
          ? "bg-accent text-accent-contrast shadow-[0_14px_26px_-20px_var(--accent)]"
          : "border border-line-strong bg-surface text-ink-muted hover:bg-surface-hover hover:text-ink-strong"
      } disabled:opacity-45`}
    >
      {label}
    </button>
  )
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1rem] border border-line bg-surface px-3 py-3">
      <p className="text-[10px] uppercase tracking-[0.18em] text-ink-soft">{label}</p>
      <p className="mt-1 text-sm font-medium text-ink">{value}</p>
    </div>
  )
}

function EmptyInspectorState({
  message,
  tone = "neutral",
}: {
  message: string
  tone?: "neutral" | "error"
}) {
  return (
    <div
      className={`rounded-[1.35rem] border px-4 py-4 text-sm leading-6 ${
        tone === "error"
          ? "border-[var(--critical-border)] bg-[var(--critical-soft)] text-[var(--critical-ink)]"
          : "border-dashed border-line-strong bg-surface-muted text-ink-muted"
      }`}
    >
      {message}
    </div>
  )
}

function formatTimestamp(isoDate: string) {
  return new Date(isoDate).toLocaleString()
}
