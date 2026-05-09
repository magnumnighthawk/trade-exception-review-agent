/**
 * AgentReasoning — Panel 2 of the supervision cockpit.
 *
 * LEARNING: This is the "transparent agent" component. Operators can see
 * every token the LLM produces in real time, the node progression, and
 * the structured outputs (investigation findings, proposal details).
 *
 * Two key design decisions to study:
 *
 * 1. STAGE HISTORY: We persist each node execution as its own reviewable stage.
 *    This lets operators time-travel through prior reasoning instead of losing
 *    context when the agent advances.
 *
 * 2. PROGRESSIVE DISCLOSURE: The node strip provides the bird's-eye view, while
 *    the selected-stage detail pane shows transcript + structured outputs only
 *    for the stage the operator is currently inspecting.
 *
 * HITL: When status === "waiting_human", this panel shifts from "watch the live
 * agent" to "review the evidence that led to the interruption."
 */

"use client"

import { useMemo, useState } from "react"

import type { AgentStatus, ThreadStageRecord } from "@/lib/types"
import { RISK_BADGE_CLASSES } from "@/lib/theme"

const NODE_META: Record<string, { label: string; shortLabel: string; icon: string }> = {
  receive_exception: { label: "Receive exception", shortLabel: "Receive", icon: "◌" },
  investigate: { label: "Investigate root cause", shortLabel: "Investigate", icon: "◎" },
  propose_resolution: { label: "Propose resolution", shortLabel: "Propose", icon: "✦" },
  execute_resolution: { label: "Execute resolution", shortLabel: "Execute", icon: "◈" },
}

interface Props {
  status: AgentStatus
  currentStageId: string | null
  stageHistory: ThreadStageRecord[]
}

export function AgentReasoning({ status, currentStageId, stageHistory }: Props) {
  const isActive = status === "streaming" || status === "resuming"
  const isPaused = status === "waiting_human"
  const [pinnedStageId, setPinnedStageId] = useState<string | null>(null)

  const latestStage = stageHistory.at(-1) ?? null
  const liveStageId = currentStageId ?? latestStage?.id ?? null
  const selectedStageId = pinnedStageId ?? liveStageId
  const selectedStage =
    stageHistory.find((stage) => stage.id === selectedStageId) ??
    latestStage

  const canFollowLive = Boolean(liveStageId && pinnedStageId && pinnedStageId !== liveStageId)

  const summaryText = useMemo(() => {
    if (isPaused) return "Review the full stage trail before submitting a decision."
    if (isActive) return "Streaming live output while preserving earlier stages for review."
    if (status === "complete" || status === "escalated") return "Investigation history is frozen for post-run review."
    return "Select a trade to inspect the agent's stage-by-stage reasoning."
  }, [isActive, isPaused, status])

  return (
    <section
      className={`panel flex h-full min-h-[24rem] flex-col overflow-hidden rounded-[1.75rem] transition-opacity ${
        isPaused ? "opacity-95" : "opacity-100"
      }`}
    >
      <header className="panel-header border-b border-line px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink-strong">Reasoning workstation</h2>
            <p className="mt-1 text-xs leading-5 text-ink-muted">{summaryText}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canFollowLive && (
              <button
                type="button"
                onClick={() => setPinnedStageId(null)}
                className="rounded-full border border-accent/30 bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent hover:-translate-y-0.5"
              >
                Follow live stage
              </button>
            )}
            {isActive && (
              <span className="flex items-center gap-2 rounded-full border border-accent/25 bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent">
                <span className="status-dot h-2 w-2 animate-pulse rounded-full bg-accent" />
                Live
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="border-b border-line px-5 py-4">
        {stageHistory.length > 0 ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {stageHistory.map((stage) => {
              const nodeMeta = NODE_META[stage.node] ?? {
                label: stage.node,
                shortLabel: stage.node,
                icon: "•",
              }
              const isSelected = selectedStage?.id === stage.id
              const isLiveStage = liveStageId === stage.id

              return (
                <button
                  key={stage.id}
                  type="button"
                  onClick={() => {
                    setPinnedStageId(isLiveStage ? null : stage.id)
                  }}
                  className={`min-w-[11rem] rounded-[1.15rem] border px-3 py-3 text-left ${
                    isSelected
                      ? "border-accent bg-surface-selected shadow-[0_18px_36px_-32px_var(--accent)]"
                      : "border-line-strong bg-surface hover:bg-surface-hover"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-ink-strong">{nodeMeta.icon}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                        stage.status === "complete"
                          ? "bg-[var(--success-soft)] text-[var(--success-ink)]"
                          : stage.status === "error"
                            ? "bg-[var(--critical-soft)] text-[var(--critical-ink)]"
                            : "bg-accent-soft text-accent"
                      }`}
                    >
                      {stage.status}
                    </span>
                  </div>

                  <p className="mt-3 text-xs uppercase tracking-[0.16em] text-ink-soft">
                    {nodeMeta.shortLabel}
                    {stage.attempt > 1 ? ` · pass ${stage.attempt}` : ""}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-ink-muted">{stage.message}</p>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="rounded-[1.2rem] border border-dashed border-line-strong bg-surface px-4 py-4 text-xs leading-5 text-ink-muted">
            The node strip will populate as the agent advances through its execution graph.
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {selectedStage ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(17rem,0.85fr)]">
            <section className="rounded-[1.45rem] border border-line bg-surface-elevated p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">Selected stage</p>
                  <h3 className="mt-2 text-lg font-semibold text-ink-strong">
                    {(NODE_META[selectedStage.node] ?? { label: selectedStage.node }).label}
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-ink-muted">{selectedStage.message}</p>
                </div>

                <div className="rounded-[1rem] border border-line bg-surface px-3 py-2 text-right">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-ink-soft">Timing</p>
                  <p className="mt-1 text-xs text-ink">
                    {formatStageTime(selectedStage.startedAt)}
                    {selectedStage.completedAt ? ` → ${formatStageTime(selectedStage.completedAt)}` : ""}
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-[1.2rem] border border-line bg-surface px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">Transcript</p>
                  {liveStageId === selectedStage.id && isActive && (
                    <span className="text-xs font-medium text-accent">Actively streaming</span>
                  )}
                </div>

                {selectedStage.tokens ? (
                  <div className="mt-3 whitespace-pre-wrap font-mono text-[13px] leading-6 text-ink">
                    {selectedStage.tokens}
                    {liveStageId === selectedStage.id && isActive && (
                      <span className="ml-1 inline-block h-4 w-2 animate-pulse rounded-sm bg-accent align-middle" />
                    )}
                  </div>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-ink-muted">
                    {liveStageId === selectedStage.id && isActive
                      ? "Waiting for streamed output from this stage."
                      : "No transcript was captured for this stage."}
                  </p>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <div className="rounded-[1.35rem] border border-line bg-surface p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">Stage snapshot</p>
                <div className="mt-3 space-y-3">
                  {selectedStage.snapshot?.status && (
                    <SnapshotField label="Agent status" value={selectedStage.snapshot.status} />
                  )}
                  {selectedStage.snapshot?.investigation_attempts != null && (
                    <SnapshotField
                      label="Investigation attempts"
                      value={String(selectedStage.snapshot.investigation_attempts)}
                    />
                  )}
                  {selectedStage.snapshot?.execution_result && (
                    <SnapshotCallout
                      label="Execution result"
                      value={selectedStage.snapshot.execution_result}
                      tone="success"
                    />
                  )}
                  {selectedStage.snapshot?.escalation_reason && (
                    <SnapshotCallout
                      label="Escalation reason"
                      value={selectedStage.snapshot.escalation_reason}
                      tone="alert"
                    />
                  )}
                  {!selectedStage.snapshot && (
                    <p className="text-sm leading-6 text-ink-muted">
                      Structured output will appear here when the stage completes.
                    </p>
                  )}
                </div>
              </div>

              {selectedStage.snapshot?.investigation && (
                <div className="rounded-[1.35rem] border border-line bg-surface p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">Investigation findings</p>
                  <div className="mt-3 space-y-3">
                    <SnapshotField
                      label="Root cause"
                      value={selectedStage.snapshot.investigation.root_cause}
                    />
                    <SnapshotField
                      label="Suggested action"
                      value={selectedStage.snapshot.investigation.suggested_action}
                    />
                    <SnapshotField
                      label="Confidence"
                      value={`${Math.round(selectedStage.snapshot.investigation.confidence * 100)}%`}
                    />
                    {selectedStage.snapshot.investigation.evidence.length > 0 && (
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.18em] text-ink-soft">Evidence</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {selectedStage.snapshot.investigation.evidence.map((evidence) => (
                            <span
                              key={evidence}
                              className="rounded-full border border-line-strong bg-surface-elevated px-2.5 py-1 text-xs text-ink-muted"
                            >
                              {evidence}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {selectedStage.snapshot?.proposal && (
                <div className="rounded-[1.35rem] border border-line bg-surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">Resolution proposal</p>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                        RISK_BADGE_CLASSES[selectedStage.snapshot.proposal.risk_level] ??
                        RISK_BADGE_CLASSES.medium
                      }`}
                    >
                      {selectedStage.snapshot.proposal.risk_level}
                    </span>
                  </div>
                  <div className="mt-3 space-y-3">
                    <SnapshotField label="Action" value={selectedStage.snapshot.proposal.action} />
                    <SnapshotField label="Details" value={selectedStage.snapshot.proposal.details} />
                    <SnapshotField
                      label="Confidence"
                      value={`${Math.round(selectedStage.snapshot.proposal.confidence * 100)}%`}
                    />
                  </div>
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center rounded-[1.4rem] border border-dashed border-line-strong bg-surface-muted px-6 text-center">
            {status === "idle" && (
              <p className="max-w-sm text-sm leading-6 text-ink-muted">
                Select a trade from the triage board to open its reasoning workstation.
              </p>
            )}
            {status === "starting" && (
              <p className="text-sm text-ink-muted">
                Connecting to the review stream<span className="animate-pulse">…</span>
              </p>
            )}
            {isPaused && (
              <div>
                <p className="text-base font-semibold text-[var(--warning-ink)]">Operator decision required</p>
                <p className="mt-2 text-sm leading-6 text-ink-muted">
                  Review any earlier stage in the strip above to understand how the agent reached this checkpoint.
                </p>
              </div>
            )}
            {(status === "complete" || status === "escalated") && (
              <p className="text-sm font-medium text-[var(--success-ink)]">Review complete.</p>
            )}
            {status === "error" && (
              <p className="text-sm font-medium text-[var(--critical-ink)]">
                The session hit an error. Review the stage trail to locate the failure point.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function SnapshotField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.18em] text-ink-soft">{label}</p>
      <p className="mt-1 text-sm leading-6 text-ink">{value}</p>
    </div>
  )
}

function SnapshotCallout({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: "success" | "alert"
}) {
  const toneClass =
    tone === "success"
      ? "border-[var(--success-border)] bg-[var(--success-soft)] text-[var(--success-ink)]"
      : "border-[var(--alert-border)] bg-[var(--alert-soft)] text-[var(--alert-ink)]"

  return (
    <div className={`rounded-[1rem] border px-3 py-3 ${toneClass}`}>
      <p className="text-[10px] uppercase tracking-[0.18em]">{label}</p>
      <p className="mt-1 text-sm leading-6">{value}</p>
    </div>
  )
}

function formatStageTime(isoDate: string) {
  return new Date(isoDate).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}
