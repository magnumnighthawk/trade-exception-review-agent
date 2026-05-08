"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type {
  AgentStatus,
  AgentStateSnapshot,
  HumanDecision,
  InterruptPayload,
  QueueItem,
  SSEEvent,
} from "@/lib/types"

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

type ThreadSession = {
  threadId: string
  tradeId: string
  status: AgentStatus | "running"
  tokens: string
  currentNode: string | null
  nodeHistory: string[]
  interruptPayload: InterruptPayload | null
  finalState: Partial<AgentStateSnapshot> | null
  error: string | null
}

type StartReviewResponse = {
  thread_id: string
  trade_id: string
}

type QueueResponse = {
  items: QueueItem[]
  total: number
}

const defaultSession = (threadId: string): ThreadSession => ({
  threadId,
  tradeId: "unknown",
  status: "starting",
  tokens: "",
  currentNode: null,
  nodeHistory: [],
  interruptPayload: null,
  finalState: null,
  error: null,
})

const NODE_RESET_BOUNDARY = new Set(["receive_exception", "investigate", "propose_resolution"])

const toAgentStatus = (status: string): AgentStatus | "running" => {
  if (status === "running") return "running"
  if (
    status === "idle" ||
    status === "starting" ||
    status === "streaming" ||
    status === "waiting_human" ||
    status === "resuming" ||
    status === "complete" ||
    status === "escalated" ||
    status === "error"
  ) {
    return status
  }
  return "error"
}

export interface UseSupervisionThreadsReturn {
  queueItems: QueueItem[]
  isQueueLoading: boolean
  queueError: string | null
  selectedThreadId: string | null
  selectedTradeId: string | null
  selectedSession: ThreadSession | null
  selectQueueItem: (item: QueueItem) => void
  runTradeReview: (tradeId: string) => Promise<void>
  resetThread: (threadId: string) => Promise<void>
  submitDecision: (decision: HumanDecision) => Promise<void>
  refreshQueue: () => Promise<void>
}

export function useSupervisionThreads(refreshInterval = 2000): UseSupervisionThreadsReturn {
  const [queueItems, setQueueItems] = useState<QueueItem[]>([])
  const [isQueueLoading, setIsQueueLoading] = useState(false)
  const [queueError, setQueueError] = useState<string | null>(null)

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null)

  const [sessions, setSessions] = useState<Record<string, ThreadSession>>({})
  const streamRefs = useRef<Record<string, EventSource>>({})

  const selectedSession = useMemo(() => {
    if (selectedThreadId && sessions[selectedThreadId]) {
      return sessions[selectedThreadId]
    }
    if (selectedTradeId) {
      const queueItem = queueItems.find((item) => item.trade_id === selectedTradeId)
      if (queueItem?.thread_id && sessions[queueItem.thread_id]) {
        return sessions[queueItem.thread_id]
      }
    }
    return null
  }, [selectedThreadId, selectedTradeId, sessions, queueItems])

  const upsertSession = useCallback((threadId: string, updater: (current: ThreadSession | null) => ThreadSession) => {
    setSessions((prev) => {
      const current = prev[threadId] ?? null
      const next = updater(current)
      return { ...prev, [threadId]: next }
    })
  }, [])

  const closeStream = useCallback((threadId: string) => {
    const stream = streamRefs.current[threadId]
    if (!stream) return
    stream.close()
    delete streamRefs.current[threadId]
  }, [])

  const handleStreamEvent = useCallback((threadId: string, event: SSEEvent) => {
    switch (event.type) {
      case "node_start":
        upsertSession(threadId, (session) => {
          const base = session ?? defaultSession(threadId)
          const shouldResetTokens = NODE_RESET_BOUNDARY.has(event.node)
          return {
            ...base,
            status: "streaming",
            currentNode: event.node,
            nodeHistory: [...base.nodeHistory, event.node],
            tokens: shouldResetTokens ? "" : base.tokens,
          }
        })
        break

      case "token":
        upsertSession(threadId, (session) => {
          const base = session ?? defaultSession(threadId)
          return { ...base, tokens: base.tokens + event.content }
        })
        break

      case "node_complete":
        upsertSession(threadId, (session) => {
          const base = session ?? defaultSession(threadId)
          return { ...base, currentNode: null }
        })
        break

      case "hitl_interrupt":
        // HITL: each thread independently enters waiting_human; switching tabs should
        // not clear this state because operator may act on it later.
        upsertSession(threadId, (session) => {
          const base = session ?? defaultSession(threadId)
          return {
            ...base,
            status: "waiting_human",
            currentNode: null,
            interruptPayload: event.interrupt_payload,
          }
        })
        closeStream(threadId)
        break

      case "complete":
        upsertSession(threadId, (session) => {
          const base = session ?? defaultSession(threadId)
          return {
            ...base,
            status: event.status === "escalated" ? "escalated" : "complete",
            currentNode: null,
            finalState: event.final_state,
          }
        })
        closeStream(threadId)
        break

      case "error":
        upsertSession(threadId, (session) => {
          const base = session ?? defaultSession(threadId)
          return {
            ...base,
            status: "error",
            error: event.message,
          }
        })
        closeStream(threadId)
        break
    }
  }, [closeStream, upsertSession])

  const openStream = useCallback((threadId: string, mode: "start" | "resume") => {
    closeStream(threadId)
    const suffix = mode === "resume" ? "/stream/resume" : "/stream"
    const stream = new EventSource(`${API_BASE}/review/${threadId}${suffix}`)
    streamRefs.current[threadId] = stream

    stream.onmessage = (raw) => {
      let parsed: SSEEvent
      try {
        parsed = JSON.parse(raw.data) as SSEEvent
      } catch {
        return
      }
      handleStreamEvent(threadId, parsed)
    }

    stream.onerror = () => {
      // LEARNING: EventSource can raise onerror on normal close. We only treat
      // it as a failure if this thread still has a live stream handle.
      if (streamRefs.current[threadId] !== stream) return
      upsertSession(threadId, (session) => {
        const base = session ?? defaultSession(threadId)
        const alreadyTerminal = base.status === "waiting_human" || base.status === "complete" || base.status === "escalated"
        if (alreadyTerminal) return base
        return { ...base, status: "error", error: "Stream disconnected" }
      })
      closeStream(threadId)
    }
  }, [closeStream, handleStreamEvent, upsertSession])

  const refreshQueue = useCallback(async () => {
    try {
      setIsQueueLoading(true)
      const response = await fetch(`${API_BASE}/queue/`)
      if (!response.ok) {
        throw new Error(`Queue fetch failed (${response.status})`)
      }
      const payload = (await response.json()) as QueueResponse
      setQueueItems(payload.items)
      setQueueError(null)

      // Sync queue-level status into local sessions without overwriting rich stream context.
      setSessions((prev) => {
        const next = { ...prev }
        for (const item of payload.items) {
          if (!item.thread_id || !next[item.thread_id]) continue
          next[item.thread_id] = {
            ...next[item.thread_id],
            status: toAgentStatus(item.status),
            interruptPayload: item.interrupt_payload ?? next[item.thread_id].interruptPayload,
          }
        }
        return next
      })
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : "Failed to load queue")
    } finally {
      setIsQueueLoading(false)
    }
  }, [])

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void refreshQueue()
    }, 0)
    const timer = window.setInterval(() => {
      void refreshQueue()
    }, refreshInterval)

    return () => {
      window.clearTimeout(initialLoad)
      window.clearInterval(timer)
      Object.values(streamRefs.current).forEach((stream) => stream.close())
      streamRefs.current = {}
    }
  }, [refreshInterval, refreshQueue])

  const runTradeReview = useCallback(async (tradeId: string) => {
    const response = await fetch(`${API_BASE}/review/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trade_id: tradeId, operator_id: "operator_001" }),
    })

    if (!response.ok) {
      throw new Error(`Failed to start review (${response.status})`)
    }

    const { thread_id } = (await response.json()) as StartReviewResponse

    upsertSession(thread_id, (existing) => ({
      threadId: thread_id,
      tradeId,
      status: "starting",
      tokens: existing?.tokens ?? "",
      currentNode: existing?.currentNode ?? null,
      nodeHistory: existing?.nodeHistory ?? [],
      interruptPayload: existing?.interruptPayload ?? null,
      finalState: existing?.finalState ?? null,
      error: null,
    }))

    setSelectedTradeId(tradeId)
    setSelectedThreadId(thread_id)

    openStream(thread_id, "start")
    await refreshQueue()
  }, [openStream, refreshQueue, upsertSession])

  const submitDecision = useCallback(async (decision: HumanDecision) => {
    if (!selectedThreadId) return
    const threadId = selectedThreadId

    upsertSession(threadId, (session) => {
      const base = session ?? defaultSession(threadId)
      return { ...base, status: "resuming", tokens: "", error: null }
    })

    const response = await fetch(`${API_BASE}/review/${threadId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(decision),
    })

    if (!response.ok) {
      upsertSession(threadId, (session) => {
        const base = session ?? defaultSession(threadId)
        return { ...base, status: "error", error: `Decision failed (${response.status})` }
      })
      return
    }

    const payload = (await response.json()) as { status: string }
    const nextStatus = payload.status

    if (nextStatus === "complete" || nextStatus === "escalated") {
      upsertSession(threadId, (session) => {
        const base = session ?? defaultSession(threadId)
        return { ...base, status: toAgentStatus(nextStatus) }
      })
      await refreshQueue()
      return
    }

    openStream(threadId, "resume")
    await refreshQueue()
  }, [openStream, refreshQueue, selectedThreadId, upsertSession])

  const resetThread = useCallback(async (threadId: string) => {
    closeStream(threadId)
    await fetch(`${API_BASE}/review/${threadId}/reset`, { method: "POST" })

    setSessions((prev) => {
      const next = { ...prev }
      delete next[threadId]
      return next
    })

    if (selectedThreadId === threadId) {
      setSelectedThreadId(null)
    }

    await refreshQueue()
  }, [closeStream, refreshQueue, selectedThreadId])

  const selectQueueItem = useCallback((item: QueueItem) => {
    setSelectedTradeId(item.trade_id)
    if (item.thread_id) {
      setSelectedThreadId(item.thread_id)
    } else {
      setSelectedThreadId(null)
    }
  }, [])

  return {
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
    refreshQueue,
  }
}
