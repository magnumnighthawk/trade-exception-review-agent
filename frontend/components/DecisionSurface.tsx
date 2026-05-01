/**
 * DecisionSurface — Panel 3 of the supervision cockpit.
 *
 * LEARNING: This is the HITL action surface. It only renders when the agent
 * has hit an interrupt() and is waiting for a human decision.
 *
 * The four actions implement the full HITL contract:
 * - Approve  → agent proceeds as proposed
 * - Reject   → agent loops back to re-investigate (rejection reason fed back in)
 * - Modify   → human steers the agent (most powerful HITL pattern)
 * - Escalate → case leaves this agent entirely
 *
 * LEARNING — The Modify pattern (steering vs oversight):
 * When a human modifies, their instruction goes into state["human_decision"]["modification"].
 * The next investigation prompt includes this as context. The agent doesn't just
 * try again — it tries again *with the human's guidance baked in*.
 * This is qualitatively different from approve/reject. The human is steering.
 *
 * CONFIDENCE INDICATOR:
 * The confidence bar is not just decorative. Research on human-AI teaming shows
 * operators calibrate their review depth to stated confidence. Low confidence
 * should slow down the operator, not just change a colour.
 * Hence the warning text at < 70%.
 */

"use client"

import { useState } from "react"
import type { InterruptPayload, HumanDecision, DecisionAction, AgentStatus } from "@/lib/types"

const RISK_STYLES: Record<string, { badge: string; bar: string }> = {
  critical: { badge: "bg-red-500/20 text-red-400 border border-red-500/30",    bar: "bg-red-500" },
  high:     { badge: "bg-orange-500/20 text-orange-400 border border-orange-500/30", bar: "bg-orange-500" },
  medium:   { badge: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30", bar: "bg-yellow-500" },
  low:      { badge: "bg-green-500/20 text-green-400 border border-green-500/30",  bar: "bg-green-500" },
}

interface Props {
  status: AgentStatus
  interruptPayload: InterruptPayload | null
  onDecision: (decision: HumanDecision) => void
}

export function DecisionSurface({ status, interruptPayload, onDecision }: Props) {
  const [mode, setMode] = useState<"review" | "reject" | "modify">("review")
  const [inputText, setInputText] = useState("")
  const [submitting, setSubmitting] = useState(false)

  // Reset local state when a new interrupt arrives
  // (e.g. after a reject loop produces a new proposal)
  const payload = interruptPayload

  const handleSubmit = async (action: DecisionAction) => {
    if (!payload) return
    if ((action === "modify" || action === "reject") && !inputText.trim()) return

    setSubmitting(true)
    await onDecision({
      action,
      modification: inputText.trim() || null,
      operator_id: "operator_001",
    })
    setSubmitting(false)
    setMode("review")
    setInputText("")
  }

  // ── Idle / non-HITL state ──────────────────────────────────────────────────
  if (status !== "waiting_human" || !payload) {
    return (
      <div className="flex flex-col h-full bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-100">Decision Surface</h2>
          <p className="text-xs text-zinc-500 mt-0.5">Awaiting agent proposal</p>
        </div>
        <div className="flex-1 flex items-center justify-center">
          {status === "complete" && (
            <div className="text-center">
              <div className="text-3xl mb-2">✅</div>
              <p className="text-sm text-green-400 font-medium">Case resolved</p>
            </div>
          )}
          {status === "escalated" && (
            <div className="text-center">
              <div className="text-3xl mb-2">↑</div>
              <p className="text-sm text-orange-400 font-medium">Escalated to senior queue</p>
            </div>
          )}
          {status === "error" && (
            <div className="text-center">
              <div className="text-3xl mb-2">❌</div>
              <p className="text-sm text-red-400 font-medium">Agent error</p>
            </div>
          )}
          {(status === "idle" || status === "streaming" || status === "starting" || status === "resuming") && (
            <p className="text-xs text-zinc-600">
              {status === "idle" ? "No active review" : "Agent is working…"}
            </p>
          )}
        </div>
      </div>
    )
  }

  // ── Active HITL state ──────────────────────────────────────────────────────
  const proposal = payload.proposal
  const risk = RISK_STYLES[proposal.risk_level] ?? RISK_STYLES.medium
  const confidencePct = Math.round(payload.confidence * 100)
  const isLowConfidence = payload.confidence < 0.70

  return (
    <div className="flex flex-col h-full bg-zinc-900 border border-yellow-500/30 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between bg-yellow-500/5">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Decision Required</h2>
          <p className="text-xs text-zinc-400 mt-0.5">Trade {payload.trade_id} · ${payload.amount.toLocaleString()}</p>
        </div>
        <span className={`text-xs px-2 py-1 rounded font-medium ${risk.badge}`}>
          {proposal.risk_level.toUpperCase()}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Confidence bar */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-zinc-400">Agent Confidence</span>
            <span className={confidencePct < 70 ? "text-red-400 font-semibold" : "text-zinc-300"}>
              {confidencePct}%
            </span>
          </div>
          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${risk.bar}`}
              style={{ width: `${confidencePct}%` }}
            />
          </div>
          {isLowConfidence && (
            <p className="text-xs text-red-400 mt-1.5">
              ⚠️ Confidence below 70% — review investigation reasoning carefully before approving.
            </p>
          )}
        </div>

        {/* Proposal */}
        <div className="bg-zinc-800/60 rounded-lg p-3 border border-zinc-700/50">
          <p className="text-xs text-zinc-400 mb-1">Proposed Action</p>
          <p className="text-sm font-medium text-zinc-100">{proposal.action}</p>
          <p className="text-xs text-zinc-400 mt-2 leading-relaxed">{proposal.details}</p>
        </div>

        {/* Investigation summary */}
        <div className="bg-zinc-800/40 rounded-lg p-3 border border-zinc-700/30">
          <p className="text-xs text-zinc-500 mb-1">Root Cause</p>
          <p className="text-xs text-zinc-300 leading-relaxed">{payload.investigation_summary}</p>
        </div>

        {/* Modify/Reject input */}
        {(mode === "modify" || mode === "reject") && (
          <div>
            <label className="text-xs text-zinc-400 block mb-1.5">
              {mode === "modify" ? "Modification instruction (required)" : "Rejection reason (required)"}
            </label>
            <textarea
              autoFocus
              rows={3}
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              placeholder={
                mode === "modify"
                  ? "Describe what the agent should do differently…"
                  : "Why is this proposal incorrect?"
              }
              className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="px-4 py-3 border-t border-zinc-800 space-y-2">
        {mode === "review" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              {/* Approve */}
              <button
                disabled={submitting}
                onClick={() => handleSubmit("approve")}
                className="py-2 px-3 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
              >
                ✓ Approve
              </button>
              {/* Escalate */}
              <button
                disabled={submitting}
                onClick={() => handleSubmit("escalate")}
                className="py-2 px-3 rounded-lg bg-orange-600/80 hover:bg-orange-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
              >
                ↑ Escalate
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {/* Modify */}
              <button
                onClick={() => setMode("modify")}
                className="py-2 px-3 rounded-lg bg-blue-600/80 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
              >
                ✎ Modify
              </button>
              {/* Reject */}
              <button
                onClick={() => setMode("reject")}
                className="py-2 px-3 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-xs font-semibold transition-colors"
              >
                ✗ Reject
              </button>
            </div>
          </>
        )}

        {(mode === "modify" || mode === "reject") && (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => { setMode("review"); setInputText("") }}
              className="py-2 px-3 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-xs font-semibold transition-colors"
            >
              ← Back
            </button>
            <button
              disabled={!inputText.trim() || submitting}
              onClick={() => handleSubmit(mode === "modify" ? "modify" : "reject")}
              className="py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors disabled:opacity-40"
            >
              {submitting ? "Submitting…" : mode === "modify" ? "Submit Modification" : "Send for Reinvestigation"}
            </button>
          </div>
        )}

        {/* LEARNING hint */}
        <p className="text-xs text-zinc-600 text-center pt-1">
          {mode === "modify"
            ? "Modify = steering. Your instruction goes into the agent's next investigation."
            : mode === "reject"
            ? "Reject = the agent re-investigates with your reason as context."
            : "Approve or modify to proceed · Escalate to senior queue"}
        </p>
      </div>
    </div>
  )
}
