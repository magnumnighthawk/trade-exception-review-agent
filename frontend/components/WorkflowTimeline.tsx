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
  error: "✕",
}

const STATUS_COLOUR_CLASSES: Record<string, string> = {
  pending: "border-line-strong bg-surface text-ink-soft",
  running: "border-accent bg-accent-soft text-accent",
  complete: "border-[var(--success-border)] bg-[var(--success-soft)] text-[var(--success-ink)]",
  interrupted: "border-[var(--warning-border)] bg-[var(--warning-soft)] text-[var(--warning-ink)]",
  error: "border-[var(--critical-border)] bg-[var(--critical-soft)] text-[var(--critical-ink)]",
}

interface Props {
  nodes: NodeExecution[]
  currentNode?: string
  isRunning: boolean
  onInterrupt?: () => void
}

export function WorkflowTimeline({ nodes, currentNode, isRunning, onInterrupt }: Props) {
  if (nodes.length === 0) {
    return (
      <section className="panel flex h-full min-h-[18rem] items-center justify-center rounded-[1.6rem] border border-dashed border-line-strong bg-surface-muted px-6 text-center text-sm text-ink-muted">
        Waiting for the workflow to start.
      </section>
    )
  }

  const firstStartedAt = nodes[0]?.started_at ? new Date(nodes[0].started_at).getTime() : null
  const lastCompletedAt = nodes
    .filter((node) => node.completed_at)
    .map((node) => new Date(node.completed_at as string).getTime())
    .sort((a, b) => b - a)[0]
  const totalElapsedMs = firstStartedAt != null && lastCompletedAt != null ? lastCompletedAt - firstStartedAt : null

  const formatDuration = (ms?: number | null): string => {
    if (!ms) return "0ms"
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  const formatTime = (isoDate?: string): string => {
    if (!isoDate || firstStartedAt == null) return "—"
    const offset = new Date(isoDate).getTime() - firstStartedAt
    return `+${formatDuration(Math.max(0, offset))}`
  }

  return (
    <section className="panel flex h-full flex-col overflow-hidden rounded-[1.6rem]">
      <header className="panel-header border-b border-line px-5 py-4">
        <h3 className="text-sm font-semibold text-ink-strong">Workflow execution</h3>
        <p className="mt-1 text-xs text-ink-muted">
          Total elapsed: {formatDuration(totalElapsedMs)} {isRunning ? "· still running" : ""}
        </p>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {nodes.map((node, index) => {
          const isCurrent = node.node_id === currentNode
          const displayName = NODE_DISPLAY_NAMES[node.node_id] || node.node_id

          return (
            <div key={`${node.node_id}-${index}`} className="flex items-start gap-4">
              <div className="flex shrink-0 flex-col items-center pt-0.5">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold ${STATUS_COLOUR_CLASSES[node.status]}`}
                >
                  {STATUS_ICONS[node.status]}
                </div>
                {index < nodes.length - 1 && <div className="mt-1 h-8 w-px bg-line-strong" />}
              </div>

              <div className="min-w-0 flex-1 rounded-[1.15rem] border border-line bg-surface-elevated px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold text-ink-strong">{displayName}</h4>
                  <span className="text-xs text-ink-soft">{formatTime(node.started_at)}</span>
                </div>

                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span
                    className={`font-medium ${
                      node.status === "running"
                        ? "text-accent"
                        : node.status === "complete"
                          ? "text-[var(--success-ink)]"
                          : node.status === "interrupted"
                            ? "text-[var(--warning-ink)]"
                            : node.status === "error"
                              ? "text-[var(--critical-ink)]"
                              : "text-ink-soft"
                    }`}
                  >
                    {node.status === "running"
                      ? "Running"
                      : node.status.charAt(0).toUpperCase() + node.status.slice(1)}
                  </span>
                  {isCurrent && <span className="text-accent">· Current node</span>}
                </div>

                {node.duration_ms != null && (
                  <div className="mt-3 flex items-center gap-3">
                    <div className="h-2 flex-1 rounded-full bg-surface-muted">
                      <div
                        className={`h-2 rounded-full ${
                          node.status === "error"
                            ? "bg-[var(--critical-solid)]"
                            : node.status === "complete"
                              ? "bg-[var(--success-solid)]"
                              : node.status === "interrupted"
                                ? "bg-[var(--warning-solid)]"
                                : "bg-accent"
                        }`}
                        style={{ width: `${Math.min((node.duration_ms / 5000) * 100, 100)}%` }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right text-xs text-ink-muted">
                      {formatDuration(node.duration_ms)}
                    </span>
                  </div>
                )}

                {node.error_message && (
                  <p className="mt-3 rounded-[0.9rem] border border-[var(--critical-border)] bg-[var(--critical-soft)] px-3 py-2 text-xs leading-5 text-[var(--critical-ink)]">
                    {node.error_message}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {isRunning && (
        <footer className="border-t border-line bg-surface px-5 py-3 text-xs text-ink-muted">
          <div className="flex items-center justify-between gap-3">
            <span>
              Agent currently at {NODE_DISPLAY_NAMES[currentNode || ""] || currentNode || "unknown"}
            </span>
            {onInterrupt && (
              <button
                type="button"
                onClick={onInterrupt}
                className="rounded-full border border-[var(--critical-border)] bg-[var(--critical-soft)] px-3 py-2 font-medium text-[var(--critical-ink)] hover:-translate-y-0.5"
              >
                Force interrupt
              </button>
            )}
          </div>
        </footer>
      )}
    </section>
  )
}
