/**
 * ExceptionQueue — Panel 1 of the supervision cockpit.
 *
 * LEARNING: This component is the operator's entry point.
 * It shows all trade exceptions currently under review, sorted by urgency.
 * Clicking a row loads that thread into the main review panels.
 *
 * In production, this would be backed by a WebSocket or polling the
 * GET /queue/waiting endpoint so the list updates in real time.
 * For Phase 2, we start a new review from this panel.
 */

"use client"

import { useState } from "react"
import type { AgentStatus, QueueItem } from "@/lib/types"

// Sample exceptions that map to backend fixtures
const SAMPLE_EXCEPTIONS = [
  { trade_id: "TRD-9821", type: "IBAN Mismatch",          counterparty: "Goldman Sachs",  amount: 2_400_000 },
  { trade_id: "TRD-9834", type: "Amount Discrepancy",     counterparty: "Morgan Stanley", amount: 875_000   },
  { trade_id: "TRD-9841", type: "Settlement Fail",        counterparty: "Barclays",       amount: 45_000    },
  { trade_id: "TRD-9855", type: "Counterparty Mismatch",  counterparty: "Deutsche Bank",  amount: 12_000_000},
]

const RISK_COLOURS: Record<string, string> = {
  critical: "text-red-400 bg-red-400/10 border border-red-400/20",
  high:     "text-orange-400 bg-orange-400/10 border border-orange-400/20",
  medium:   "text-yellow-400 bg-yellow-400/10 border border-yellow-400/20",
  low:      "text-green-400 bg-green-400/10 border border-green-400/20",
}

const STATUS_COLOURS: Record<AgentStatus, string> = {
  idle:          "text-zinc-500",
  starting:      "text-blue-400 animate-pulse",
  streaming:     "text-blue-400 animate-pulse",
  waiting_human: "text-yellow-400",
  resuming:      "text-blue-400 animate-pulse",
  complete:      "text-green-400",
  escalated:     "text-orange-400",
  error:         "text-red-400",
}

const STATUS_LABELS: Record<AgentStatus, string> = {
  idle:          "Ready",
  starting:      "Starting…",
  streaming:     "Investigating…",
  waiting_human: "⚡ Awaiting Review",
  resuming:      "Resuming…",
  complete:      "✓ Resolved",
  escalated:     "↑ Escalated",
  error:         "✗ Error",
}

interface Props {
  activeTradeId: string | null
  agentStatus: AgentStatus
  onSelectTrade: (tradeId: string) => void
}

export function ExceptionQueue({ activeTradeId, agentStatus, onSelectTrade }: Props) {
  return (
    <div className="flex flex-col h-full bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Exception Queue</h2>
          <p className="text-xs text-zinc-500 mt-0.5">{SAMPLE_EXCEPTIONS.length} exceptions</p>
        </div>
        {/* Live indicator */}
        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
          <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
          Live
        </div>
      </div>

      {/* Exception list */}
      <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/60">
        {SAMPLE_EXCEPTIONS.map((exc) => {
          const isActive = exc.trade_id === activeTradeId
          const status: AgentStatus = isActive ? agentStatus : "idle"

          return (
            <button
              key={exc.trade_id}
              onClick={() => onSelectTrade(exc.trade_id)}
              className={`w-full text-left px-4 py-3 transition-colors hover:bg-zinc-800/50 ${
                isActive ? "bg-zinc-800/80 border-l-2 border-blue-500" : "border-l-2 border-transparent"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-medium text-zinc-100">{exc.trade_id}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_COLOURS[status]}`}>
                      {STATUS_LABELS[status]}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5 truncate">{exc.type}</p>
                  <p className="text-xs text-zinc-500 truncate">{exc.counterparty}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-mono text-zinc-300">
                    ${(exc.amount / 1_000_000).toFixed(exc.amount >= 1_000_000 ? 1 : 3)}M
                  </p>
                  {isActive && status === "waiting_human" && (
                    <span className="text-xs text-yellow-400 font-medium">Review now →</span>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
