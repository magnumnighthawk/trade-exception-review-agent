"use client"

import type { QueueItem } from "@/lib/types"

const RISK_COLOURS: Record<string, string> = {
  critical: "text-red-500 bg-red-500/20 border border-red-500/40",
  high: "text-orange-400 bg-orange-400/20 border border-orange-400/40",
  medium: "text-yellow-400 bg-yellow-400/20 border border-yellow-400/40",
  low: "text-green-400 bg-green-400/20 border border-green-400/40",
}

const STATUS_COLOURS: Record<string, string> = {
  idle: "text-zinc-500",
  starting: "text-blue-400 animate-pulse",
  running: "text-blue-400 animate-pulse",
  streaming: "text-blue-400 animate-pulse",
  waiting_human: "text-yellow-400 font-medium",
  resuming: "text-blue-400 animate-pulse",
  complete: "text-green-400",
  escalated: "text-orange-400",
  error: "text-red-400",
}

const STATUS_LABELS: Record<string, string> = {
  idle: "Awaiting Run",
  starting: "Starting…",
  running: "Investigating…",
  streaming: "Investigating…",
  waiting_human: "⚡ Awaiting Review",
  resuming: "Resuming…",
  complete: "✓ Resolved",
  escalated: "↑ Escalated",
  error: "✗ Error",
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

  const confidenceToRiskLevel = (confidence?: number | null): string => {
    if (confidence == null) return "medium"
    if (confidence > 0.85) return "low"
    if (confidence > 0.70) return "medium"
    return "high"
  }

  const formatPausedAt = (isoDate?: string | null): string => {
    if (!isoDate) return ""
    return new Date(isoDate).toLocaleString()
  }

  return (
    <div className="flex flex-col h-full bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Exception Queue</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            {items.filter((item) => item.status === "waiting_human").length} awaiting review
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          {isLoading ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-zinc-400">Updating…</span>
            </>
          ) : (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
              <span className="text-zinc-500">Live</span>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/50">
        {sortedItems.map((item) => {
          const isSelectedByTrade = item.trade_id === selectedTradeId
          const isSelectedByThread = item.thread_id != null && item.thread_id === selectedThreadId
          const isSelected = isSelectedByTrade || isSelectedByThread

          const confidencePercent = item.confidence == null ? null : Math.round(item.confidence * 100)
          const riskLevel = item.risk_level || confidenceToRiskLevel(item.confidence)
          const canRun = item.status === "idle"
          const canReset = Boolean(item.thread_id)

          return (
            <div
              key={`${item.trade_id}-${item.thread_id ?? "pending"}`}
              className={`px-4 py-3.5 transition-all hover:bg-zinc-800/50 ${
                isSelected ? "bg-zinc-800 border-l-2 border-blue-500" : "border-l-2 border-transparent"
              }`}
            >
              <button onClick={() => onSelectItem(item)} className="w-full text-left">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-mono font-medium text-zinc-100">{item.trade_id}</span>
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${RISK_COLOURS[riskLevel] || RISK_COLOURS.medium}`}>
                      {riskLevel.toUpperCase()}
                    </span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLOURS[item.status] || STATUS_COLOURS.idle}`}>
                    {STATUS_LABELS[item.status] || item.status}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-xs text-zinc-400 truncate">{item.counterparty || "Unknown"}</p>
                  <p className="text-xs font-mono text-zinc-300 shrink-0">
                    ${(item.amount ? item.amount / 1_000_000 : 0).toFixed(2)}M
                  </p>
                </div>

                <div className="flex items-center gap-2 mb-2">
                  <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    {confidencePercent != null && (
                      <div
                        className={`h-full ${
                          confidencePercent > 85 ? "bg-green-500" : confidencePercent > 70 ? "bg-yellow-500" : "bg-red-500"
                        }`}
                        style={{ width: `${confidencePercent}%` }}
                      />
                    )}
                  </div>
                  <span className="text-xs text-zinc-400 shrink-0 w-10 text-right">
                    {confidencePercent == null ? "--" : `${confidencePercent}%`}
                  </span>
                </div>

                {item.proposal_action && (
                  <p className="text-xs text-zinc-500 truncate mb-1 italic">{item.proposal_action}</p>
                )}
                <p className="text-xs text-zinc-600">
                  {item.paused_at ? `Paused at ${formatPausedAt(item.paused_at)}` : "Not started"}
                </p>
              </button>

              <div className="mt-3 flex items-center gap-2">
                <button
                  disabled={!canRun}
                  onClick={() => void onRunTrade(item.trade_id)}
                  className="px-2 py-1 text-[11px] rounded border border-blue-500/40 text-blue-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-blue-500/10"
                >
                  ▶ Run
                </button>
                <button
                  disabled={!canReset || !item.thread_id}
                  onClick={() => {
                    if (item.thread_id) {
                      void onResetThread(item.thread_id)
                    }
                  }}
                  className="px-2 py-1 text-[11px] rounded border border-zinc-600 text-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-zinc-700/50"
                >
                  ↺ Reset
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
