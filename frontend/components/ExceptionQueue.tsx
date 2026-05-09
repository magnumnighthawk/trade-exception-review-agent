"use client"

import type { QueueItem } from "@/lib/types"
import {
  RISK_BADGE_CLASSES,
  STATUS_PILL_CLASSES,
  getConfidenceBarClass,
  resolveConfidenceRiskLevel,
} from "@/lib/theme"

const STATUS_LABELS: Record<string, string> = {
  idle: "Awaiting run",
  starting: "Starting",
  running: "Investigating",
  streaming: "Investigating",
  waiting_human: "Awaiting review",
  resuming: "Resuming",
  complete: "Resolved",
  escalated: "Escalated",
  error: "Error",
}

interface Props {
  items: QueueItem[]
  isLoading: boolean
  selectedTradeId: string | null
  selectedThreadId: string | null
  onSelectItem: (item: QueueItem) => void
  onRunTrade: (tradeId: string) => Promise<void>
  onResetThread: (threadId: string) => Promise<void>
}

export function ExceptionQueue({
  items,
  isLoading,
  selectedTradeId,
  selectedThreadId,
  onSelectItem,
  onRunTrade,
  onResetThread,
}: Props) {
  const sortedItems = [...items].sort((a, b) => {
    const confA = a.confidence ?? 1
    const confB = b.confidence ?? 1
    if (confA !== confB) return confA - confB

    const amountA = a.amount ?? 0
    const amountB = b.amount ?? 0
    if (amountA !== amountB) return amountB - amountA

    const ageA = a.paused_at ? new Date(a.paused_at).getTime() : 0
    const ageB = b.paused_at ? new Date(b.paused_at).getTime() : 0
    return ageA - ageB
  })

  const formatPausedAt = (isoDate?: string | null): string => {
    if (!isoDate) return "Not started"
    return `Paused ${new Date(isoDate).toLocaleString()}`
  }

  return (
    <section className="panel flex h-full min-h-[24rem] flex-col overflow-hidden rounded-[1.6rem]">
      <header className="panel-header border-b border-line px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink-strong">Exception queue</h2>
            <p className="mt-1 text-xs text-ink-muted">
              {items.filter((item) => item.status === "waiting_human").length} awaiting review
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-line-strong bg-surface px-3 py-1.5 text-xs text-ink-muted">
            <span
              className={`status-dot h-2 w-2 rounded-full ${
                isLoading ? "animate-pulse bg-accent" : "bg-[var(--success-solid)]"
              }`}
            />
            <span>{isLoading ? "Updating" : "Live"}</span>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="space-y-2.5">
          {sortedItems.map((item) => {
            const isSelectedByTrade = item.trade_id === selectedTradeId
            const isSelectedByThread = item.thread_id != null && item.thread_id === selectedThreadId
            const isSelected = isSelectedByTrade || isSelectedByThread

            const confidencePercent = item.confidence == null ? null : Math.round(item.confidence * 100)
            const riskLevel = item.risk_level || resolveConfidenceRiskLevel(item.confidence)
            const canRun = item.status === "idle"
            const canReset = Boolean(item.thread_id)

            return (
              <article
                key={`${item.trade_id}-${item.thread_id ?? "pending"}`}
                className={`rounded-[1.35rem] border p-4 transition duration-200 ${
                  isSelected
                    ? "border-accent bg-surface-selected shadow-[0_24px_44px_-34px_var(--accent)]"
                    : "border-transparent bg-transparent hover:border-line-strong hover:bg-surface-hover"
                }`}
              >
                <button type="button" onClick={() => onSelectItem(item)} className="w-full text-left">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-ink-strong">
                          {item.trade_id}
                        </span>
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                            RISK_BADGE_CLASSES[riskLevel] || RISK_BADGE_CLASSES.medium
                          }`}
                        >
                          {riskLevel}
                        </span>
                      </div>
                      <p className="mt-2 truncate text-sm text-ink-muted">
                        {item.counterparty || "Unknown counterparty"}
                      </p>
                    </div>

                    <span
                      className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                        STATUS_PILL_CLASSES[item.status] || STATUS_PILL_CLASSES.idle
                      }`}
                    >
                      {STATUS_LABELS[item.status] || item.status}
                    </span>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-ink-soft">Amount</p>
                      <p className="mt-1 font-mono text-sm text-ink-strong">
                        ${(item.amount ? item.amount / 1_000_000 : 0).toFixed(2)}M
                      </p>
                    </div>

                    <div className="min-w-[7rem] flex-1">
                      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.18em] text-ink-soft">
                        <span>Confidence</span>
                        <span className="text-ink-muted">
                          {confidencePercent == null ? "--" : `${confidencePercent}%`}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-surface-muted">
                        {confidencePercent != null && (
                          <div
                            className={`h-2 rounded-full ${getConfidenceBarClass(confidencePercent)}`}
                            style={{ width: `${confidencePercent}%` }}
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  {item.proposal_action && (
                    <p className="mt-4 rounded-[1rem] border border-line bg-surface px-3 py-2 text-xs italic leading-5 text-ink-muted">
                      {item.proposal_action}
                    </p>
                  )}

                  <p className="mt-3 text-xs text-ink-soft">{formatPausedAt(item.paused_at)}</p>
                </button>

                <div className="mt-4 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!canRun}
                    onClick={() => void onRunTrade(item.trade_id)}
                    className="rounded-full bg-accent px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-contrast shadow-[0_22px_36px_-30px_var(--accent)] hover:-translate-y-0.5 hover:bg-accent-strong disabled:translate-y-0 disabled:opacity-35"
                  >
                    Run review
                  </button>

                  <button
                    type="button"
                    disabled={!canReset || !item.thread_id}
                    onClick={() => {
                      if (item.thread_id) {
                        void onResetThread(item.thread_id)
                      }
                    }}
                    className="rounded-full border border-line-strong bg-surface px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted hover:bg-surface-hover hover:text-ink-strong disabled:opacity-35"
                  >
                    Reset
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}
