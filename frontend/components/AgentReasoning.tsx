/**
 * AgentReasoning — Panel 2 of the supervision cockpit.
 *
 * LEARNING: This is the "transparent agent" component. Operators can see
 * every token the LLM produces in real time, the node progression, and
 * the structured outputs (investigation findings, proposal details).
 *
 * Two key design decisions to study:
 *
 * 1. STREAMING TEXT: We use a monospace div with whitespace-pre-wrap and
 *    append tokens as they arrive. This avoids React re-rendering the entire
 *    text block on every token — we just append to the DOM directly via
 *    the `tokens` prop accumulated in the hook.
 *
 * 2. NODE PROGRESS: We show the node pipeline visually so operators see
 *    how far along the agent is. This builds trust — the operator isn't
 *    watching a spinner, they're watching the agent reason.
 *
 * HITL: When status === "waiting_human", this panel fades slightly to signal
 * that the agent is paused and the DecisionSurface is now the active element.
 */

"use client"

import type { AgentStatus } from "@/lib/types"

const NODES = [
  { id: "receive_exception",  label: "Receive",   icon: "📥" },
  { id: "investigate",        label: "Investigate", icon: "🔍" },
  { id: "propose_resolution", label: "Propose",   icon: "💡" },
  { id: "execute_resolution", label: "Execute",   icon: "⚙️" },
]

interface Props {
  status: AgentStatus
  tokens: string
  currentNode: string | null
  nodeHistory: string[]
}

export function AgentReasoning({ status, tokens, currentNode, nodeHistory }: Props) {
  const isActive = status === "streaming" || status === "resuming"
  const isPaused = status === "waiting_human"

  return (
    <div className={`flex flex-col h-full bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden transition-opacity ${isPaused ? "opacity-60" : "opacity-100"}`}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Agent Reasoning</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            {isPaused ? "Paused — awaiting your decision" : isActive ? "Thinking…" : "Idle"}
          </p>
        </div>
        {isActive && (
          <span className="flex items-center gap-1.5 text-xs text-blue-400">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-ping" />
            Live
          </span>
        )}
      </div>

      {/* Node pipeline */}
      <div className="px-4 py-3 border-b border-zinc-800/60 flex items-center gap-0">
        {NODES.map((node, i) => {
          const done    = nodeHistory.includes(node.id) && node.id !== currentNode
          const active  = node.id === currentNode
          const pending = !done && !active

          return (
            <div key={node.id} className="flex items-center">
              <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-all ${
                active  ? "bg-blue-500/20 text-blue-300 border border-blue-500/30" :
                done    ? "text-green-400" :
                          "text-zinc-600"
              }`}>
                <span>{node.icon}</span>
                <span className="font-medium">{node.label}</span>
                {active && <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />}
                {done   && <span className="text-green-400">✓</span>}
              </div>
              {i < NODES.length - 1 && (
                <span className={`mx-1 text-xs ${done ? "text-green-400/40" : "text-zinc-700"}`}>→</span>
              )}
            </div>
          )
        })}
      </div>

      {/* Streaming text area */}
      <div className="flex-1 overflow-y-auto p-4">
        {tokens ? (
          <div className="font-mono text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">
            {tokens}
            {isActive && (
              <span className="inline-block w-2 h-3 bg-blue-400 animate-pulse ml-0.5 align-middle" />
            )}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            {status === "idle" && (
              <p className="text-xs text-zinc-600">Select an exception to start a review.</p>
            )}
            {(status === "starting") && (
              <p className="text-xs text-zinc-500 animate-pulse">Connecting to agent…</p>
            )}
            {isPaused && (
              <div className="text-center">
                <p className="text-sm text-yellow-400 font-medium">⚡ Agent is waiting</p>
                <p className="text-xs text-zinc-500 mt-1">Review the proposal below and submit your decision.</p>
              </div>
            )}
            {(status === "complete" || status === "escalated") && (
              <p className="text-xs text-green-400">✓ Review complete.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
