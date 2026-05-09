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
  { id: "receive_exception", label: "Receive", icon: "◌" },
  { id: "investigate", label: "Investigate", icon: "◎" },
  { id: "propose_resolution", label: "Propose", icon: "✦" },
  { id: "execute_resolution", label: "Execute", icon: "◈" },
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
    <section
      className={`panel flex h-full min-h-[24rem] flex-col overflow-hidden rounded-[1.75rem] transition-opacity ${
        isPaused ? "opacity-70" : "opacity-100"
      }`}
    >
      <header className="panel-header border-b border-line px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink-strong">Agent reasoning</h2>
            <p className="mt-1 text-xs text-ink-muted">
              {isPaused ? "Checkpointed and waiting for operator input" : isActive ? "Streaming live reasoning" : "Ready"}
            </p>
          </div>

          {isActive && (
            <span className="flex items-center gap-2 rounded-full border border-accent/25 bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent">
              <span className="status-dot h-2 w-2 animate-pulse rounded-full bg-accent" />
              Live
            </span>
          )}
        </div>
      </header>

      <div className="border-b border-line px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          {NODES.map((node, index) => {
            const done = nodeHistory.includes(node.id) && node.id !== currentNode
            const active = node.id === currentNode

            return (
              <div key={node.id} className="flex items-center gap-2">
                <div
                  className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium ${
                    active
                      ? "border-accent bg-accent-soft text-accent"
                      : done
                        ? "border-[var(--success-border)] bg-[var(--success-soft)] text-[var(--success-ink)]"
                        : "border-line-strong bg-surface text-ink-soft"
                  }`}
                >
                  <span className="text-sm leading-none">{node.icon}</span>
                  <span>{node.label}</span>
                  {active && <span className="status-dot h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
                  {done && <span className="text-[var(--success-ink)]">✓</span>}
                </div>

                {index < NODES.length - 1 && (
                  <span className="text-xs text-ink-soft/80" aria-hidden="true">
                    →
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {tokens ? (
          <div className="rounded-[1.4rem] border border-line bg-surface-elevated p-4 font-mono text-[13px] leading-6 text-ink whitespace-pre-wrap">
            {tokens}
            {isActive && <span className="ml-1 inline-block h-4 w-2 animate-pulse rounded-sm bg-accent align-middle" />}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center rounded-[1.4rem] border border-dashed border-line-strong bg-surface-muted px-6 text-center">
            {status === "idle" && (
              <p className="max-w-sm text-sm leading-6 text-ink-muted">
                Select an exception from the queue to watch the agent inspect evidence in real time.
              </p>
            )}
            {status === "starting" && (
              <p className="text-sm text-ink-muted">
                Connecting to the review stream<span className="animate-pulse">…</span>
              </p>
            )}
            {isPaused && (
              <div>
                <p className="text-base font-semibold text-[var(--warning-ink)]">Operator decision required</p>
                <p className="mt-2 text-sm leading-6 text-ink-muted">
                  The agent has checkpointed after proposing a resolution. Review the decision surface to continue.
                </p>
              </div>
            )}
            {(status === "complete" || status === "escalated") && (
              <p className="text-sm font-medium text-[var(--success-ink)]">Review complete.</p>
            )}
            {status === "error" && (
              <p className="text-sm font-medium text-[var(--critical-ink)]">
                The session hit an error. Reset the thread or choose another review.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
