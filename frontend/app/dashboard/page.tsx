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

import { useAgentStream } from "@/hooks/useAgentStream"
import { ExceptionQueue } from "@/components/ExceptionQueue"
import { AgentReasoning } from "@/components/AgentReasoning"
import { DecisionSurface } from "@/components/DecisionSurface"
import { useState } from "react"

export default function DashboardPage() {
  const {
    status,
    tokens,
    currentNode,
    nodeHistory,
    interruptPayload,
    finalState,
    error,
    startReview,
    submitDecision,
    reset,
  } = useAgentStream()

  const [activeTradeId, setActiveTradeId] = useState<string | null>(null)

  const handleSelectTrade = async (tradeId: string) => {
    // If a review is already running, reset first
    if (status !== "idle") {
      reset()
      // Small delay to let state settle before starting new review
      await new Promise(r => setTimeout(r, 100))
    }
    setActiveTradeId(tradeId)
    await startReview(tradeId)
  }

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
          {error && (
            <span className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 px-2 py-1 rounded">
              {error}
            </span>
          )}
          {status !== "idle" && (
            <button
              onClick={reset}
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
          activeTradeId={activeTradeId}
          agentStatus={status}
          onSelectTrade={handleSelectTrade}
        />

        {/* Panel 2 — Agent Reasoning */}
        <AgentReasoning
          status={status}
          tokens={tokens}
          currentNode={currentNode}
          nodeHistory={nodeHistory}
        />

        {/* Panel 3 — Decision Surface */}
        <DecisionSurface
          status={status}
          interruptPayload={interruptPayload}
          onDecision={submitDecision}
        />

      </main>
    </div>
  )
}
