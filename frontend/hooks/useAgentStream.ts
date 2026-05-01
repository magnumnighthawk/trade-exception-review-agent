/**
 * useAgentStream — SSE streaming hook for the Trade Exception Review Agent.
 *
 * LEARNING: This hook is the frontend equivalent of the backend's stream.py.
 * It owns the entire lifecycle of one agent review session:
 *   1. Start the agent (POST /review/start)
 *   2. Open the SSE stream (EventSource)
 *   3. Translate raw SSE events into typed React state
 *   4. Detect the HITL interrupt and expose a submitDecision function
 *   5. Re-open the stream after a decision (GET /review/{id}/stream/resume)
 *   6. Close cleanly on unmount
 *
 * LEARNING: Why EventSource instead of fetch + ReadableStream?
 * EventSource is the browser's native SSE API. It handles:
 * - Automatic reconnection on disconnect
 * - Event parsing (the "data: ...\n\n" format)
 * - Clean error signalling
 * The downside: it's GET-only and can't send headers (auth).
 * PRODUCTION: For authenticated SSE you'd use fetch + ReadableStream reader,
 * or pass a token as a query param. For this learning project, EventSource is ideal.
 *
 * TRADE-OFF: We build this manually rather than using Vercel AI SDK's useChat.
 * The goal is to understand every part. Phase 6 will show what useChat abstracts.
 */

"use client"

import { useState, useRef, useCallback } from "react"
import type {
  AgentStatus,
  SSEEvent,
  InterruptPayload,
  HumanDecision,
  AgentStateSnapshot,
} from "@/lib/types"

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

// ── Hook return type ───────────────────────────────────────────────────────────
export interface UseAgentStreamReturn {
  // State
  status: AgentStatus
  threadId: string | null
  tokens: string                        // Accumulated LLM tokens — the "thinking" text
  currentNode: string | null            // Which node is currently running
  nodeHistory: string[]                 // Ordered list of nodes that have run
  interruptPayload: InterruptPayload | null   // Set when status === "waiting_human"
  finalState: Partial<AgentStateSnapshot> | null
  error: string | null

  // Actions
  startReview: (tradeId: string) => Promise<void>
  submitDecision: (decision: HumanDecision) => Promise<void>
  reset: () => void
}

export function useAgentStream(): UseAgentStreamReturn {
  const [status, setStatus] = useState<AgentStatus>("idle")
  const [threadId, setThreadId] = useState<string | null>(null)
  const [tokens, setTokens] = useState("")
  const [currentNode, setCurrentNode] = useState<string | null>(null)
  const [nodeHistory, setNodeHistory] = useState<string[]>([])
  const [interruptPayload, setInterruptPayload] = useState<InterruptPayload | null>(null)
  const [finalState, setFinalState] = useState<Partial<AgentStateSnapshot> | null>(null)
  const [error, setError] = useState<string | null>(null)

  // We keep the EventSource in a ref so we can close it imperatively
  // without it being a dependency of useCallback hooks.
  const esRef = useRef<EventSource | null>(null)
  const isIntentionalCloseRef = useRef(false)
  const streamSeqRef = useRef(0)

  // ── SSE connection helper ────────────────────────────────────────────────────
  // LEARNING: We extract the SSE wiring into a helper so it can be reused
  // for both the initial stream and the post-decision resume stream.
  // The URL is the only thing that differs between the two cases.
  const openStream = useCallback((url: string) => {
    streamSeqRef.current += 1
    const streamSeq = streamSeqRef.current

    // Close any existing connection first
    isIntentionalCloseRef.current = true
    esRef.current?.close()

    const es = new EventSource(url)
    esRef.current = es
    isIntentionalCloseRef.current = false
    setStatus("streaming")

    const closeCurrentStream = () => {
      if (esRef.current === es) {
        isIntentionalCloseRef.current = true
        esRef.current = null
      }
      es.close()
    }

    es.onmessage = (e: MessageEvent) => {
      if (esRef.current !== es || streamSeq !== streamSeqRef.current) {
        return
      }

      let event: SSEEvent
      try {
        event = JSON.parse(e.data) as SSEEvent
      } catch {
        console.warn("[useAgentStream] Failed to parse SSE event:", e.data)
        return
      }

      // LEARNING: This switch statement is the client-side event handler.
      // Each case corresponds to one SSEEvent type from backend/api/models.py.
      // TypeScript narrows the type in each case branch.
      switch (event.type) {
        case "node_start":
          setCurrentNode(event.node)
          setNodeHistory(prev => [...prev, event.node])
          // Clear tokens when starting a new node so the UI shows
          // only the current node's streaming output
          if (event.node !== "execute_resolution") {
            setTokens("")
          }
          break

        case "token":
          // Accumulate tokens — this creates the real-time "typing" effect
          setTokens(prev => prev + event.content)
          break

        case "node_complete":
          // Node finished — snapshot may contain investigation/proposal data
          setCurrentNode(null)
          break

        case "hitl_interrupt":
          // HITL: Agent is paused. This is the most important event.
          // Status change to "waiting_human" triggers DecisionSurface to render.
          // LEARNING: The UI status change is DRIVEN BY THIS EVENT, not by a timer
          // or polling. The agent told us it needs a human — we respond to that.
          setInterruptPayload(event.interrupt_payload)
          setStatus("waiting_human")
          closeCurrentStream()   // Stream is paused — close to release the connection
          break

        case "complete":
          setFinalState(event.final_state)
          setStatus(event.status === "escalated" ? "escalated" : "complete")
          closeCurrentStream()
          break

        case "error":
          setError(event.message)
          setStatus("error")
          closeCurrentStream()
          break
      }
    }

    es.onerror = () => {
      if (esRef.current !== es || streamSeq !== streamSeqRef.current) {
        return
      }
      if (isIntentionalCloseRef.current || es.readyState === EventSource.CLOSED) {
        closeCurrentStream()
        return
      }
      // EventSource fires onerror on both transient network errors AND
      // when the server closes the connection normally (end of stream).
      // We only treat it as an error if we're not already in a terminal state.
      setStatus(prev => {
        if (prev === "streaming" || prev === "resuming") {
          return "error"
        }
        return prev
      })
      closeCurrentStream()
    }
  }, [])

  // ── Start a new review ───────────────────────────────────────────────────────
  const startReview = useCallback(async (tradeId: string) => {
    setStatus("starting")
    setTokens("")
    setNodeHistory([])
    setInterruptPayload(null)
    setFinalState(null)
    setError(null)

    // Step 1: Register the agent run and get a thread_id
    const res = await fetch(`${API_BASE}/review/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trade_id: tradeId, operator_id: "operator_001" }),
    })

    if (!res.ok) {
      const detail = await res.json().catch(() => ({ detail: "Unknown error" }))
      setError(detail.detail ?? "Failed to start review")
      setStatus("error")
      return
    }

    const { thread_id } = await res.json()
    setThreadId(thread_id)

    // Step 2: Open the SSE stream — agent begins running on the backend
    openStream(`${API_BASE}/review/${thread_id}/stream`)
  }, [openStream])

  // ── Submit human decision ────────────────────────────────────────────────────
  const submitDecision = useCallback(async (decision: HumanDecision) => {
    if (!threadId) return
    setStatus("resuming")
    setTokens("")    // Clear tokens — about to see the next phase of reasoning

    // Step 1: POST the decision — this resumes the checkpointed agent
    const res = await fetch(`${API_BASE}/review/${threadId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(decision),
    })

    if (!res.ok) {
      const detail = await res.json().catch(() => ({ detail: "Unknown error" }))
      setError(detail.detail ?? "Failed to submit decision")
      setStatus("error")
      return
    }

    const { status: newStatus } = await res.json()

    if (newStatus === "complete" || newStatus === "escalated") {
      // Agent finished synchronously in the decision handler (no further streaming)
      setStatus(newStatus)
      return
    }

    // Step 2: Re-open SSE to stream the rest of the execution
    // LEARNING: We reconnect to the /stream/resume endpoint which re-attaches
    // to the same checkpointed thread and streams from where it left off.
    openStream(`${API_BASE}/review/${threadId}/stream/resume`)
  }, [threadId, openStream])

  // ── Reset ────────────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    streamSeqRef.current += 1
    isIntentionalCloseRef.current = true
    esRef.current?.close()
    esRef.current = null
    setStatus("idle")
    setThreadId(null)
    setTokens("")
    setCurrentNode(null)
    setNodeHistory([])
    setInterruptPayload(null)
    setFinalState(null)
    setError(null)
  }, [])

  return {
    status,
    threadId,
    tokens,
    currentNode,
    nodeHistory,
    interruptPayload,
    finalState,
    error,
    startReview,
    submitDecision,
    reset,
  }
}
