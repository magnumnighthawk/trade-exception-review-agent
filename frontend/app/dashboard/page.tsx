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
    lastQueueSyncAt,
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
        selectedQueueItem.thread_id ? "thread active" : "ready to start"
      }`
    : "No case selected"
  const queueHealthLabel = queueError ? "Sync issue" : lastQueueSyncAt ? "Queue live" : "Connecting"
  const queueHealthTone = queueError
    ? "border-[var(--critical-border)] bg-[var(--critical-soft)] text-[var(--critical-ink)]"
    : lastQueueSyncAt
      ? "border-line-strong bg-surface text-ink-muted"
      : "border-accent/30 bg-accent-soft text-accent"
  const queueHealthDot = queueError
    ? "bg-[var(--critical-ink)]"
    : lastQueueSyncAt
      ? "bg-[var(--success-solid)]"
      : "animate-pulse bg-accent"
  const queueHealthTitle = queueError
    ? queueError
    : lastQueueSyncAt
      ? `Last successful sync ${new Date(lastQueueSyncAt).toLocaleTimeString()}`
      : "Waiting for first successful queue sync"

  return (
    <div className="min-h-screen text-ink">
      <div className="mx-auto flex min-h-screen max-w-[1700px] flex-col px-4 py-4 lg:px-6 lg:py-6">
        <header className="panel-elevated mb-4 rounded-[1.7rem] px-5 py-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[1rem] border border-accent/20 bg-[linear-gradient(145deg,var(--accent-soft),transparent)] text-xs font-semibold uppercase tracking-[0.14em] text-accent shadow-[0_18px_42px_-30px_var(--accent)]">
                TR
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-line-strong bg-surface px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-ink-soft">
                    Ops desk
                  </span>
                  {isDecisionMode && (
                    <span className="rounded-full border border-[var(--warning-border)] bg-[var(--warning-soft)] px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--warning-ink)]">
                      Human review active
                    </span>
                  )}
                </div>

                <h1 className="mt-2 font-display text-[1.45rem] leading-none text-ink-strong sm:text-[1.65rem]">
                  Exception supervision
                </h1>
                <p className="mt-1 text-sm text-ink-muted">
                  Review paused cases first, then monitor live runs.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 xl:items-end">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-line-strong bg-surface px-3 py-2 text-xs font-medium text-ink-muted">
                  {selectedCaseLabel}
                </span>
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
                <ThemeSwitcher compact />
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={`flex items-center gap-2 rounded-full border px-3 py-1.5 ${queueHealthTone}`}
                  title={queueHealthTitle}
                >
                  <span className={`status-dot h-2 w-2 rounded-full ${queueHealthDot}`} />
                  {queueHealthLabel}
                </span>
                <span className="rounded-full border border-line-strong bg-surface px-3 py-1.5 text-ink-soft">
                  {queueItems.length} cases in view
                </span>
              </div>
            </div>
          </div>
        </header>

        <main
          className={`grid flex-1 grid-cols-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)_340px] ${
            isDecisionMode
              ? "2xl:grid-cols-[340px_minmax(0,1fr)_400px]"
              : "2xl:grid-cols-[340px_minmax(0,1.15fr)_340px]"
          }`}
        >
          <ExceptionQueue
            items={queueItems}
            isLoading={isQueueLoading}
            queueError={queueError}
            lastQueueSyncAt={lastQueueSyncAt}
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
