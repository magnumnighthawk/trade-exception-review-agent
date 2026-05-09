"use client"

import { useState } from "react"

import type { QueueItem } from "@/lib/types"
import {
  RISK_BADGE_CLASSES,
  STATUS_PILL_CLASSES,
  getConfidenceBarClass,
  resolveConfidenceRiskLevel,
} from "@/lib/theme"

const STATUS_LABELS: Record<string, string> = {
  idle: "Ready to run",
  starting: "Starting",
  running: "Investigating",
  streaming: "Investigating",
  waiting_human: "Awaiting review",
  resuming: "Resuming",
  complete: "Resolved",
  escalated: "Escalated",
  error: "Needs intervention",
}

const SECTION_CONFIG: Array<{
  id: string
  title: string
  note: string
  statuses: Array<QueueItem["status"]>
  accent: string
}> = [
  {
    id: "waiting_human",
    title: "Awaiting review",
    note: "Checkpointed cases blocking the workflow until an operator responds.",
    statuses: ["waiting_human"],
    accent: "border-[var(--warning-border)] bg-[var(--warning-soft)] text-[var(--warning-ink)]",
  },
  {
    id: "error",
    title: "Needs intervention",
    note: "Runs that failed and need manual recovery before they can continue.",
    statuses: ["error"],
    accent: "border-[var(--critical-border)] bg-[var(--critical-soft)] text-[var(--critical-ink)]",
  },
  {
    id: "running",
    title: "In progress",
    note: "Live threads currently investigating, resuming, or pushing toward completion.",
    statuses: ["starting", "running", "streaming", "resuming"],
    accent: "border-accent/30 bg-accent-soft text-accent",
  },
  {
    id: "idle",
    title: "Ready to run",
    note: "Trades not yet started. Launch from here when capacity opens up.",
    statuses: ["idle"],
    accent: "border-line-strong bg-surface text-ink-muted",
  },
  {
    id: "closed",
    title: "Closed loop",
    note: "Resolved or escalated cases kept secondary by default to reduce queue noise.",
    statuses: ["complete", "escalated"],
    accent: "border-[var(--success-border)] bg-[var(--success-soft)] text-[var(--success-ink)]",
  },
]

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
  const [showClosed, setShowClosed] = useState(false)

  const sortItems = (queueItems: QueueItem[]) =>
    [...queueItems].sort((a, b) => {
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

  const groupedSections = SECTION_CONFIG.map((section) => ({
    ...section,
    items: sortItems(items.filter((item) => section.statuses.includes(item.status))),
  }))

  const selectedClosedItem = groupedSections
    .find((section) => section.id === "closed")
    ?.items.some(
      (item) =>
        item.trade_id === selectedTradeId ||
        (item.thread_id != null && item.thread_id === selectedThreadId),
    ) ?? false

  const queueCounts = {
    urgent: groupedSections.find((section) => section.id === "waiting_human")?.items.length ?? 0,
    live:
      groupedSections.find((section) => section.id === "running")?.items.length ??
      0,
    ready: groupedSections.find((section) => section.id === "idle")?.items.length ?? 0,
    closed: groupedSections.find((section) => section.id === "closed")?.items.length ?? 0,
  }

  return (
    <section className="panel flex h-full min-h-[24rem] flex-col overflow-hidden rounded-[1.75rem]">
      <header className="panel-header border-b border-line px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink-strong">Exception board</h2>
            <p className="mt-1 text-xs text-ink-muted">
              Structured by operator task so urgent work reads at a glance.
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

        <div className="mt-4 grid grid-cols-2 gap-2">
          <QueueStat label="Urgent" value={queueCounts.urgent} tone="warning" />
          <QueueStat label="Live" value={queueCounts.live} tone="accent" />
          <QueueStat label="Ready" value={queueCounts.ready} tone="neutral" />
          <QueueStat label="Closed" value={queueCounts.closed} tone="success" />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="space-y-4">
          {groupedSections.map((section) => {
            const isClosedSection = section.id === "closed"
            const shouldShowSection =
              section.items.length > 0 && (!isClosedSection || showClosed || selectedClosedItem)

            if (isClosedSection && section.items.length > 0) {
              return (
                <div key={section.id} className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowClosed((current) => !current)}
                    className="flex w-full items-center justify-between rounded-[1.1rem] border border-line-strong bg-surface px-4 py-3 text-left hover:bg-surface-hover"
                  >
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">{section.title}</p>
                      <p className="mt-1 text-xs leading-5 text-ink-muted">{section.note}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${section.accent}`}>
                        {section.items.length}
                      </span>
                      <span className="text-xs text-ink-soft">{showClosed || selectedClosedItem ? "Hide" : "Show"}</span>
                    </div>
                  </button>

                  {(showClosed || selectedClosedItem) && (
                    <div className="space-y-2.5">
                      {section.items.map((item) => (
                        <QueueCard
                          key={`${item.trade_id}-${item.thread_id ?? "pending"}`}
                          item={item}
                          isSelected={
                            item.trade_id === selectedTradeId ||
                            (item.thread_id != null && item.thread_id === selectedThreadId)
                          }
                          onSelectItem={onSelectItem}
                          onRunTrade={onRunTrade}
                          onResetThread={onResetThread}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            }

            if (!shouldShowSection) return null

            return (
              <section key={section.id} className="space-y-2.5">
                <div className="flex items-start justify-between gap-3 px-1">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">{section.title}</p>
                    <p className="mt-1 text-xs leading-5 text-ink-muted">{section.note}</p>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${section.accent}`}>
                    {section.items.length}
                  </span>
                </div>

                <div className="space-y-2.5">
                  {section.items.map((item) => (
                    <QueueCard
                      key={`${item.trade_id}-${item.thread_id ?? "pending"}`}
                      item={item}
                      isSelected={
                        item.trade_id === selectedTradeId ||
                        (item.thread_id != null && item.thread_id === selectedThreadId)
                      }
                      onSelectItem={onSelectItem}
                      onRunTrade={onRunTrade}
                      onResetThread={onResetThread}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function QueueStat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: "warning" | "accent" | "neutral" | "success"
}) {
  const toneClass =
    tone === "warning"
      ? "border-[var(--warning-border)] bg-[var(--warning-soft)] text-[var(--warning-ink)]"
      : tone === "accent"
        ? "border-accent/30 bg-accent-soft text-accent"
        : tone === "success"
          ? "border-[var(--success-border)] bg-[var(--success-soft)] text-[var(--success-ink)]"
          : "border-line-strong bg-surface text-ink-muted"

  return (
    <div className={`rounded-[1.1rem] border px-3 py-3 ${toneClass}`}>
      <p className="text-[10px] uppercase tracking-[0.18em]">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  )
}

function QueueCard({
  item,
  isSelected,
  onSelectItem,
  onRunTrade,
  onResetThread,
}: {
  item: QueueItem
  isSelected: boolean
  onSelectItem: (item: QueueItem) => void
  onRunTrade: (tradeId: string) => Promise<void>
  onResetThread: (threadId: string) => Promise<void>
}) {
  const confidencePercent = item.confidence == null ? null : Math.round(item.confidence * 100)
  const riskLevel = item.risk_level || resolveConfidenceRiskLevel(item.confidence)
  const canRun = item.status === "idle"
  const canReset = Boolean(item.thread_id)

  const formatPausedAt = (isoDate?: string | null): string => {
    if (!isoDate) {
      return item.status === "idle" ? "Not started yet" : "No pause timestamp available"
    }
    return `Paused ${new Date(isoDate).toLocaleString()}`
  }

  const statusNote =
    item.status === "waiting_human"
      ? formatPausedAt(item.paused_at)
      : item.status === "error"
        ? "Manual recovery required before this case can continue."
        : item.status === "complete"
          ? "This case resolved successfully."
          : item.status === "escalated"
            ? "This case left the agent flow and was escalated."
            : item.status === "idle"
              ? "Ready for a fresh review run."
              : "Agent is actively working on this case."

  return (
    <article
      className={`rounded-[1.4rem] border p-4 transition duration-200 ${
        isSelected
          ? "border-accent bg-surface-selected shadow-[0_24px_44px_-34px_var(--accent)]"
          : "border-line bg-surface hover:border-line-strong hover:bg-surface-hover"
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

        <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] items-end gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-ink-soft">Amount</p>
            <p className="mt-1 font-mono text-sm text-ink-strong">
              ${(item.amount ? item.amount / 1_000_000 : 0).toFixed(2)}M
            </p>
          </div>

          <div className="min-w-[7rem]">
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
          <div className="mt-4 rounded-[1rem] border border-line bg-surface-elevated px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.18em] text-ink-soft">Latest proposal</p>
            <p className="mt-1 text-xs italic leading-5 text-ink-muted">{item.proposal_action}</p>
          </div>
        )}

        <p className="mt-3 text-xs leading-5 text-ink-soft">{statusNote}</p>
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
}
