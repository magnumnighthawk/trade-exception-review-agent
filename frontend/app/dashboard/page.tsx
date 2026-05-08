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

import { useSupervisionThreads } from "@/hooks/useSupervisionThreads"
import { ExceptionQueue } from "@/components/ExceptionQueue"
import { AgentReasoning } from "@/components/AgentReasoning"
import { DecisionSurface } from "@/components/DecisionSurface"

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

  const selectedStatus = selectedSession?.status === "running"
    ? "streaming"
    : (selectedSession?.status ?? "idle")

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Top bar */}
      <header className="border-b border-zinc-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-6 w-6 rounded bg-blue-600 flex items-center justify-center text-xs font-bold">T</div>
          <span className="text-sm font-semibold text-zinc-100">Trade Exception Review</span>
          <span className="text-xs text-zinc-600 font-mono">Phase 2 — Supervision Cockpit</span>
        </div>
        <div className="flex items-center gap-4">
          {queueError && (
            <span className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 px-2 py-1 rounded">
              {queueError}
            </span>
          )}
          {selectedThreadId && (
            <button
              onClick={() => resetThread(selectedThreadId)}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Reset
            </button>
          )}
          <span className="text-xs text-zinc-600">operator_001</span>
        </div>
      </header>

      {/* Three-panel cockpit */}
      <main className="h-[calc(100vh-49px)] p-4 grid grid-cols-[280px_1fr_320px] gap-3">

        {/* Panel 1 — Exception Queue */}
        <ExceptionQueue
          items={queueItems}
          isLoading={isQueueLoading}
          selectedTradeId={selectedTradeId}
          selectedThreadId={selectedThreadId}
          onSelectItem={selectQueueItem}
          onRunTrade={runTradeReview}
          onResetThread={resetThread}
        />

        {/* Panel 2 — Agent Reasoning */}
        <AgentReasoning
          status={selectedStatus}
          tokens={selectedSession?.tokens ?? ""}
          currentNode={selectedSession?.currentNode ?? null}
          nodeHistory={selectedSession?.nodeHistory ?? []}
        />

        {/* Panel 3 — Decision Surface */}
        <DecisionSurface
          status={selectedStatus}
          interruptPayload={selectedSession?.interruptPayload ?? null}
          onDecision={submitDecision}
        />

      </main>
    </div>
  )
}
