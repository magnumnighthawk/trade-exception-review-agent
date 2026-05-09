/**
 * Dashboard page — the three-panel supervision cockpit.
 *
 * LEARNING: This page is the composition layer. It:
 * 1. Owns the useAgentStream hook (single source of truth for agent state)
 * 2. Passes the right slice of state to each panel
 * 3. Passes callbacks down (onSelectTrade, onDecision)
 *
 * The layout is deliberately simple — three columns on desktop,
 * stacked on mobile. In production you'd add resizable panels,
 * keyboard shortcuts, and accessibility roles.
 *
 * HITL: Notice that submitDecision is passed to DecisionSurface but
 * the status change that shows DecisionSurface comes from the hook,
 * which got it from the SSE stream. The UI is reactive, not imperative.
 * The agent told the UI to show the decision surface — not a timer,
 * not a poll, not a flag you set manually.
 */

"use client"

import { AgentReasoning } from "@/components/AgentReasoning"
import { DecisionSurface } from "@/components/DecisionSurface"
import { ExceptionQueue } from "@/components/ExceptionQueue"
import { ThemeSwitcher } from "@/components/ThemeSwitcher"
import { useSupervisionThreads } from "@/hooks/useSupervisionThreads"

export default function DashboardPage() {
  const {
    queueItems,
    isQueueLoading,
    queueError,
    selectedThreadId,
    selectedTradeId,
    selectedSession,
    selectQueueItem,
    runTradeReview,
    resetThread,
    submitDecision,
  } = useSupervisionThreads()

  const selectedStatus =
    selectedSession?.status === "running" ? "streaming" : (selectedSession?.status ?? "idle")

  return (
    <div className="min-h-screen text-ink">
      <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col px-4 py-4 lg:px-6 lg:py-6">
        <header className="panel-elevated mb-4 flex flex-col gap-4 rounded-[1.8rem] px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.25rem] border border-accent/20 bg-[linear-gradient(145deg,var(--accent-soft),transparent)] text-sm font-semibold text-accent shadow-[0_22px_48px_-28px_var(--accent)]">
              TR
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-line-strong bg-surface-muted px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-ink-soft">
                  Supervision cockpit
                </span>
                <span className="rounded-full border border-accent/25 bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent">
                  Phase 4
                </span>
              </div>
              <div>
                <h1 className="font-display text-[1.65rem] leading-none text-ink-strong sm:text-[1.9rem]">
                  Trade Exception Review
                </h1>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-muted">
                  A pastel, operator-first supervision surface for steering checkpointed agent
                  runs without losing audit context.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:items-end">
            <div className="flex flex-wrap items-center gap-3">
              <ThemeSwitcher />
              <span className="rounded-full border border-line-strong bg-surface px-3 py-2 text-xs font-medium text-ink-muted">
                operator_001
              </span>
              {selectedThreadId && (
                <button
                  type="button"
                  onClick={() => resetThread(selectedThreadId)}
                  className="rounded-full border border-line-strong bg-surface px-3 py-2 text-xs font-medium text-ink-muted hover:bg-surface-hover hover:text-ink-strong"
                >
                  Reset thread
                </button>
              )}
            </div>

            {queueError ? (
              <div className="rounded-full border border-[var(--critical-border)] bg-[var(--critical-soft)] px-3 py-1.5 text-xs text-[var(--critical-ink)]">
                {queueError}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-ink-muted">
                <span className="status-dot h-2 w-2 rounded-full bg-[var(--success-solid)]" />
                Queue synced and ready
              </div>
            )}
          </div>
        </header>

        <main className="grid flex-1 grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
          <ExceptionQueue
            items={queueItems}
            isLoading={isQueueLoading}
            selectedTradeId={selectedTradeId}
            selectedThreadId={selectedThreadId}
            onSelectItem={selectQueueItem}
            onRunTrade={runTradeReview}
            onResetThread={resetThread}
          />

          <AgentReasoning
            status={selectedStatus}
            tokens={selectedSession?.tokens ?? ""}
            currentNode={selectedSession?.currentNode ?? null}
            nodeHistory={selectedSession?.nodeHistory ?? []}
          />

          <DecisionSurface
            status={selectedStatus}
            interruptPayload={selectedSession?.interruptPayload ?? null}
            onDecision={submitDecision}
          />
        </main>
      </div>
    </div>
  )
}
