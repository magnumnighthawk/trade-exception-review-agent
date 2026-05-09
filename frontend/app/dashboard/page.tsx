/**
 * Dashboard page — the three-panel supervision cockpit.
 *
 * LEARNING: This page is the composition layer. It:
 * 1. Owns the useSupervisionThreads hook (single source of truth for agent state)
 * 2. Passes the right slice of state to each panel
 * 3. Switches the right rail based on the operator's current task
 *
 * The workstation now adapts to context:
 * - triage on the left
 * - stage-by-stage reasoning in the center
 * - contextual inspector or decision surface on the right
 *
 * HITL: The agent still decides when the action surface appears. The layout only
 * upgrades the right rail into DecisionSurface when status === "waiting_human".
 */

"use client"

import { AgentReasoning } from "@/components/AgentReasoning"
import { ContextInspector } from "@/components/ContextInspector"
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
    selectedQueueItem,
    selectedSession,
    selectQueueItem,
    runTradeReview,
    resetThread,
    submitDecision,
  } = useSupervisionThreads()

  const selectedStatus =
    selectedSession?.status === "running" ? "streaming" : (selectedSession?.status ?? "idle")
  const isDecisionMode = selectedStatus === "waiting_human"
  const selectedCaseLabel = selectedQueueItem
    ? `${selectedQueueItem.trade_id} · ${
        selectedQueueItem.thread_id ? "active thread" : "not started"
      }`
    : "No case selected"

  return (
    <div className="min-h-screen text-ink">
      <div className="mx-auto flex min-h-screen max-w-[1700px] flex-col px-4 py-4 lg:px-6 lg:py-6">
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
                  Contextual operations desk
                </span>
              </div>
              <div>
                <h1 className="font-display text-[1.65rem] leading-none text-ink-strong sm:text-[1.9rem]">
                  Trade Exception Review
                </h1>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-muted">
                  Triage urgent work on the left, inspect stage-by-stage reasoning in the center,
                  and switch the right rail between contextual detail and active human decisioning.
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

            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="rounded-full border border-line-strong bg-surface px-3 py-2 text-ink-muted">
                {selectedCaseLabel}
              </span>
              {queueError ? (
                <span className="rounded-full border border-[var(--critical-border)] bg-[var(--critical-soft)] px-3 py-2 text-[var(--critical-ink)]">
                  {queueError}
                </span>
              ) : (
                <span className="flex items-center gap-2 text-ink-muted">
                  <span className="status-dot h-2 w-2 rounded-full bg-[var(--success-solid)]" />
                  Queue synced and ready
                </span>
              )}
            </div>
          </div>
        </header>

        <main
          className={`grid flex-1 grid-cols-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)_340px] ${
            isDecisionMode ? "2xl:grid-cols-[340px_minmax(0,1fr)_400px]" : "2xl:grid-cols-[340px_minmax(0,1.15fr)_340px]"
          }`}
        >
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
            key={selectedThreadId ?? selectedTradeId ?? "reasoning-empty"}
            status={selectedStatus}
            currentStageId={selectedSession?.currentStageId ?? null}
            stageHistory={selectedSession?.stageHistory ?? []}
          />

          {isDecisionMode ? (
            <DecisionSurface
              status={selectedStatus}
              interruptPayload={selectedSession?.interruptPayload ?? null}
              onDecision={submitDecision}
            />
          ) : (
            <ContextInspector
              selectedItem={selectedQueueItem}
              selectedSession={selectedSession}
            />
          )}
        </main>
      </div>
    </div>
  )
}
