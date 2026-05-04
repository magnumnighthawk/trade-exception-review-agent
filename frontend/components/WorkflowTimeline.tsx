/**
 * WorkflowTimeline — Panel 2B: Workflow execution visualization.
 *
 * LEARNING: As the agent executes, it progresses through nodes.
 * The timeline shows the path it took, how long each step took,
 * and whether it succeeded or failed.
 *
 * Phase 4: Complements AgentReasoning by showing the structural
 * flow (DAG execution) while AgentReasoning shows the detailed
 * token-level reasoning stream.
 *
 * This is the "bird's eye view" of what the agent is doing.
 */

"use client"

import { useEffect, useState } from "react"

export interface NodeExecution {
  node_id: string
  status: "pending" | "running" | "complete" | "interrupted" | "error"
  started_at?: string
  completed_at?: string
  duration_ms?: number
  error_message?: string
}

const NODE_DISPLAY_NAMES: Record<string, string> = {
  receive_exception: "Receive Exception",
  investigate: "Investigate",
  propose_resolution: "Propose Resolution",
  execute_resolution: "Execute Resolution",
}

const STATUS_ICONS: Record<string, string> = {
  pending: "⊘",
  running: "⟳",
  complete: "✓",
  interrupted: "⚡",
  error: "✗",
}

const STATUS_COLOURS: Record<string, string> = {
  pending: "text-zinc-500 bg-zinc-500/20",
  running: "text-blue-400 bg-blue-400/20 animate-pulse",
  complete: "text-green-400 bg-green-400/20",
  interrupted: "text-yellow-400 bg-yellow-400/20",
  error: "text-red-400 bg-red-400/20",
}

interface Props {
  nodes: NodeExecution[]
  currentNode?: string
  isRunning: boolean
  onInterrupt?: () => void
}

export function WorkflowTimeline({ nodes, currentNode, isRunning, onInterrupt }: Props) {
  const [timeline, setTimeline] = useState<NodeExecution[]>([])

  useEffect(() => {
    setTimeline(nodes)
  }, [nodes])

  if (timeline.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-zinc-500 text-sm">
        Waiting for agent to start...
      </div>
    )
  }

  // Calculate total elapsed time
  const firstStarted = timeline[0]?.started_at
    ? new Date(timeline[0].started_at).getTime()
    : Date.now()
  const lastCompleted = timeline
    .filter((n) => n.completed_at)
    .map((n) => new Date(n.completed_at!).getTime())
    .sort((a, b) => b - a)[0]
  const totalElapsedMs = lastCompleted ? lastCompleted - firstStarted : 0

  const formatDuration = (ms?: number): string => {
    if (!ms) return "0ms"
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  const formatTime = (isoDate?: string): string => {
    if (!isoDate) return "-"
    const offset = new Date(isoDate).getTime() - firstStarted
    return `+${formatDuration(Math.max(0, offset))}`
  }

  return (
    <div className="flex flex-col h-full bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800">
        <h3 className="text-sm font-semibold text-zinc-100">Workflow Execution</h3>
        <p className="text-xs text-zinc-500 mt-0.5">
          Total elapsed: {formatDuration(totalElapsedMs)} {isRunning && "• Still running..."}
        </p>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {timeline.map((node, idx) => {
          const isCurrent = node.node_id === currentNode
          const displayName = NODE_DISPLAY_NAMES[node.node_id] || node.node_id

          return (
            <div key={idx} className="space-y-1">
              {/* Node header row */}
              <div className="flex items-start gap-3">
                {/* Timeline connector + node circle */}
                <div className="flex flex-col items-center shrink-0 pt-0.5">
                  {/* Status circle */}
                  <div
                    className={`flex items-center justify-center w-6 h-6 rounded-full border ${STATUS_COLOURS[node.status]}`}
                  >
                    <span className="text-xs font-bold">{STATUS_ICONS[node.status]}</span>
                  </div>

                  {/* Vertical line to next node (if not last) */}
                  {idx < timeline.length - 1 && (
                    <div className={`w-0.5 h-6 my-0.5 ${STATUS_COLOURS[node.status]}`} />
                  )}
                </div>

                {/* Node info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <h4 className="text-sm font-medium text-zinc-100">{displayName}</h4>
                    <span className="text-xs text-zinc-500 shrink-0">{formatTime(node.started_at)}</span>
                  </div>

                  {/* Duration bar and text */}
                  {node.duration_ms && (
                    <div className="mt-1 flex items-center gap-2">
                      <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${
                            node.status === "error"
                              ? "bg-red-500"
                              : node.status === "complete"
                                ? "bg-green-500"
                                : "bg-blue-500"
                          }`}
                          style={{ width: `${Math.min((node.duration_ms / 5000) * 100, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-zinc-400 shrink-0 w-8 text-right">
                        {formatDuration(node.duration_ms)}
                      </span>
                    </div>
                  )}

                  {/* Status text and error message */}
                  <div className="mt-1 flex items-center gap-2">
                    <span
                      className={`text-xs font-medium ${
                        node.status === "running"
                          ? "text-blue-400 animate-pulse"
                          : node.status === "error"
                            ? "text-red-400"
                            : node.status === "interrupted"
                              ? "text-yellow-400"
                              : "text-zinc-500"
                      }`}
                    >
                      {node.status === "running" ? "Running…" : node.status.charAt(0).toUpperCase() + node.status.slice(1)}
                    </span>
                    {isCurrent && <span className="text-xs text-blue-400 font-medium">• Currently here</span>}
                  </div>

                  {/* Error message (if applicable) */}
                  {node.error_message && (
                    <p className="text-xs text-red-400 mt-2 p-2 bg-red-400/10 rounded border border-red-400/20">
                      {node.error_message}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer: Last event info */}
      {isRunning && (
        <div className="px-4 py-2 border-t border-zinc-800 text-xs text-zinc-500 bg-zinc-800/30">
          <div className="flex items-center justify-between">
            <span>Agent paused at "{NODE_DISPLAY_NAMES[currentNode || ""] || currentNode || "unknown"}"</span>
            {onInterrupt && (
              <button
                onClick={onInterrupt}
                className="px-2 py-1 text-xs text-red-400 hover:bg-red-400/10 rounded border border-red-400/30"
              >
                Force Interrupt
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
