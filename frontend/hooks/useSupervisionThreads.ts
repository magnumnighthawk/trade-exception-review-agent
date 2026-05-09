"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type {
  AgentStatus,
  HumanDecision,
  QueueItem,
  SSEEvent,
  ThreadDetailResponse,
  ThreadSession,
  ThreadStageRecord,
  ThreadStageResponse,
} from "@/lib/types"

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

type StartReviewResponse = {
  thread_id: string
  trade_id: string
}

type QueueResponse = {
  items: QueueItem[]
  total: number
}

const nowIso = () => new Date().toISOString()

const defaultSession = (threadId: string): ThreadSession => ({
  threadId,
  tradeId: "unknown",
  status: "starting",
  currentNode: null,
  currentStageId: null,
  stageHistory: [],
  interventionKind: null,
  interruptPayload: null,
  finalState: null,
  error: null,
  failureContext: null,
  manualTakeoverNote: null,
})

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
    status === "manual_takeover" ||
    status === "error"
  ) {
    return status
  }
  return "error"
}

const toStageRecord = (stage: ThreadStageResponse): ThreadStageRecord => ({
  id: stage.stage_id,
  node: stage.node,
  message: stage.message,
  attempt: stage.attempt,
  status: stage.status,
  tokens: stage.tokens,
  snapshot: stage.state_snapshot,
  startedAt: stage.started_at,
  completedAt: stage.completed_at,
})

const getLatestStageId = (stageHistory: ThreadStageRecord[]): string | null =>
  stageHistory.length > 0 ? stageHistory[stageHistory.length - 1].id : null

const getLatestRunningStageId = (stageHistory: ThreadStageRecord[]): string | null =>
  [...stageHistory].reverse().find((stage) => stage.status === "running")?.id ?? null

export interface UseSupervisionThreadsReturn {
  queueItems: QueueItem[]
  isQueueLoading: boolean
  queueError: string | null
  lastQueueSyncAt: string | null
  selectedThreadId: string | null
  selectedTradeId: string | null
  selectedQueueItem: QueueItem | null
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
  const [lastQueueSyncAt, setLastQueueSyncAt] = useState<string | null>(null)

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null)

  const [sessions, setSessions] = useState<Record<string, ThreadSession>>({})
  const streamRefs = useRef<Record<string, EventSource>>({})

  const selectedQueueItem = useMemo(() => {
    if (selectedThreadId) {
      const byThread = queueItems.find((item) => item.thread_id === selectedThreadId)
      if (byThread) return byThread
    }
    if (selectedTradeId) {
      return queueItems.find((item) => item.trade_id === selectedTradeId) ?? null
    }
    return null
  }, [queueItems, selectedThreadId, selectedTradeId])

  const selectedSession = useMemo(() => {
    if (selectedThreadId && sessions[selectedThreadId]) {
      return sessions[selectedThreadId]
    }
    if (selectedQueueItem?.thread_id && sessions[selectedQueueItem.thread_id]) {
      return sessions[selectedQueueItem.thread_id]
    }
    return null
  }, [selectedQueueItem, selectedThreadId, sessions])

  const upsertSession = useCallback(
    (threadId: string, updater: (current: ThreadSession | null) => ThreadSession) => {
      setSessions((prev) => {
        const current = prev[threadId] ?? null
        const next = updater(current)
        return { ...prev, [threadId]: next }
      })
    },
    [],
  )

  const closeStream = useCallback((threadId: string) => {
    const stream = streamRefs.current[threadId]
    if (!stream) return
    stream.close()
    delete streamRefs.current[threadId]
  }, [])

  const hydrateThreadDetail = useCallback(
    async (threadId: string) => {
      const response = await fetch(`${API_BASE}/queue/${threadId}`)
      if (!response.ok) {
        throw new Error(`Failed to load thread detail (${response.status})`)
      }

      const payload = (await response.json()) as ThreadDetailResponse
      const stageHistory = payload.stage_history.map(toStageRecord)
      const liveStageId = payload.current_node
        ? getLatestRunningStageId(stageHistory) ?? getLatestStageId(stageHistory)
        : null

      upsertSession(threadId, (session) => ({
        ...(session ?? defaultSession(threadId)),
        threadId,
        tradeId: payload.trade_id,
        status: toAgentStatus(payload.status),
        currentNode: payload.current_node,
        currentStageId: liveStageId,
        stageHistory,
        interventionKind: payload.intervention_kind,
        interruptPayload: payload.interrupt_payload,
        finalState: payload.final_state,
        error: payload.error,
        failureContext: payload.failure_context,
        manualTakeoverNote: payload.manual_takeover_note,
      }))
    },
    [upsertSession],
  )

  const handleStreamEvent = useCallback(
    (threadId: string, event: SSEEvent) => {
      switch (event.type) {
        case "node_start":
          upsertSession(threadId, (session) => {
            const base = session ?? defaultSession(threadId)
            const attempt = base.stageHistory.filter((stage) => stage.node === event.node).length + 1
            const nextStageId = `${event.node}-${attempt}`

            return {
              ...base,
              status: "streaming",
              currentNode: event.node,
              currentStageId: nextStageId,
              interventionKind: null,
              error: null,
              failureContext: null,
              stageHistory: [
                ...base.stageHistory,
                {
                  id: nextStageId,
                  node: event.node,
                  message: event.message,
                  attempt,
                  status: "running",
                  tokens: "",
                  snapshot: null,
                  startedAt: nowIso(),
                  completedAt: null,
                },
              ],
            }
          })
          break

        case "token":
          upsertSession(threadId, (session) => {
            const base = session ?? defaultSession(threadId)
            const targetStageId = base.currentStageId ?? getLatestStageId(base.stageHistory)
            if (!targetStageId) return base

            return {
              ...base,
              stageHistory: base.stageHistory.map((stage) =>
                stage.id === targetStageId
                  ? { ...stage, tokens: `${stage.tokens}${event.content}` }
                  : stage,
              ),
            }
          })
          break

        case "node_complete":
          upsertSession(threadId, (session) => {
            const base = session ?? defaultSession(threadId)
            const targetStageId =
              base.currentStageId ??
              [...base.stageHistory].reverse().find((stage) => stage.node === event.node)?.id ??
              null

            return {
              ...base,
              currentNode: null,
              currentStageId: null,
              stageHistory: base.stageHistory.map((stage) =>
                stage.id === targetStageId
                  ? {
                      ...stage,
                      status: "complete",
                      snapshot: event.state_snapshot,
                      completedAt: nowIso(),
                    }
                  : stage,
              ),
            }
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
              currentStageId: null,
              interventionKind: event.interrupt_payload.kind,
              interruptPayload: event.interrupt_payload,
              failureContext:
                event.interrupt_payload.kind === "failure_recovery"
                  ? {
                      category: "execution_error",
                      failed_node: event.interrupt_payload.failed_node,
                      message: event.interrupt_payload.error_message,
                      recoverable: event.interrupt_payload.recoverable,
                      retry_available: event.interrupt_payload.retry_available,
                      retry_count: event.interrupt_payload.retry_count,
                    }
                  : null,
            }
          })
          closeStream(threadId)
          break

        case "complete":
          upsertSession(threadId, (session) => {
            const base = session ?? defaultSession(threadId)
            const targetStageId =
              base.currentStageId ?? getLatestRunningStageId(base.stageHistory)

            return {
              ...base,
              status:
                event.status === "escalated"
                  ? "escalated"
                  : event.status === "manual_takeover"
                    ? "manual_takeover"
                    : "complete",
              currentNode: null,
              currentStageId: null,
              interventionKind: null,
              finalState: event.final_state,
              failureContext: event.final_state.failure_context ?? null,
              manualTakeoverNote: event.final_state.manual_takeover_note ?? null,
              stageHistory: base.stageHistory.map((stage) =>
                stage.id === targetStageId && stage.status === "running"
                  ? { ...stage, status: "complete", completedAt: nowIso() }
                  : stage,
              ),
            }
          })
          closeStream(threadId)
          break

        case "error":
          upsertSession(threadId, (session) => {
            const base = session ?? defaultSession(threadId)
            const targetStageId = base.currentStageId ?? getLatestStageId(base.stageHistory)

            return {
              ...base,
              status: "error",
              currentNode: null,
              currentStageId: null,
              interventionKind: null,
              error: event.message,
              failureContext: event.failure_context ?? null,
              stageHistory: base.stageHistory.map((stage) =>
                stage.id === targetStageId && stage.status === "running"
                  ? { ...stage, status: "error", completedAt: nowIso() }
                  : stage,
              ),
            }
          })
          closeStream(threadId)
          break
      }
    },
    [closeStream, upsertSession],
  )

  const openStream = useCallback(
    (threadId: string, mode: "start" | "resume") => {
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
          const alreadyTerminal =
            base.status === "waiting_human" ||
            base.status === "complete" ||
            base.status === "escalated" ||
            base.status === "manual_takeover"
          if (alreadyTerminal) return base

          const targetStageId = base.currentStageId ?? getLatestStageId(base.stageHistory)

          return {
            ...base,
            status: "error",
            error: "Stream disconnected",
            currentNode: null,
            currentStageId: null,
            interventionKind: null,
            stageHistory: base.stageHistory.map((stage) =>
              stage.id === targetStageId && stage.status === "running"
                ? { ...stage, status: "error", completedAt: nowIso() }
                : stage,
            ),
          }
        })
        closeStream(threadId)
      }
    },
    [closeStream, handleStreamEvent, upsertSession],
  )

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
      setLastQueueSyncAt(nowIso())

      // Sync queue-level status into local sessions without overwriting rich stream context.
      setSessions((prev) => {
        const next = { ...prev }
        for (const item of payload.items) {
          if (!item.thread_id || !next[item.thread_id]) continue
          const nextStatus = toAgentStatus(item.status)
          next[item.thread_id] = {
            ...next[item.thread_id],
            status: nextStatus,
            interventionKind: item.intervention_kind ?? next[item.thread_id].interventionKind,
            currentStageId:
              nextStatus === "starting" ||
              nextStatus === "running" ||
              nextStatus === "streaming" ||
              nextStatus === "resuming"
                ? next[item.thread_id].currentStageId
                : null,
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

  useEffect(() => {
    if (!selectedThreadId) return

    let ignore = false

    const loadSelectedThread = async () => {
      try {
        await hydrateThreadDetail(selectedThreadId)
      } catch (error) {
        if (!ignore) {
          setQueueError(error instanceof Error ? error.message : "Failed to hydrate thread")
        }
      }
    }

    void loadSelectedThread()

    return () => {
      ignore = true
    }
  }, [hydrateThreadDetail, selectedThreadId])

  const runTradeReview = useCallback(
    async (tradeId: string) => {
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
        ...(existing ?? defaultSession(thread_id)),
        threadId: thread_id,
        tradeId,
        status: "starting",
        currentNode: existing?.currentNode ?? null,
        currentStageId: existing?.currentStageId ?? null,
        stageHistory: existing?.stageHistory ?? [],
        interventionKind: existing?.interventionKind ?? null,
        interruptPayload: existing?.interruptPayload ?? null,
        finalState: existing?.finalState ?? null,
        error: null,
        failureContext: existing?.failureContext ?? null,
        manualTakeoverNote: existing?.manualTakeoverNote ?? null,
      }))

      setSelectedTradeId(tradeId)
      setSelectedThreadId(thread_id)

      openStream(thread_id, "start")
      await refreshQueue()
    },
    [openStream, refreshQueue, upsertSession],
  )

  const submitDecision = useCallback(
    async (decision: HumanDecision) => {
      if (!selectedThreadId) return
      const threadId = selectedThreadId

      upsertSession(threadId, (session) => {
        const base = session ?? defaultSession(threadId)
        return {
          ...base,
          status: "resuming",
          currentNode: null,
          currentStageId: null,
          interventionKind: null,
          error: null,
        }
      })

      const response = await fetch(`${API_BASE}/review/${threadId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(decision),
      })

      if (!response.ok) {
        upsertSession(threadId, (session) => {
          const base = session ?? defaultSession(threadId)
          return {
            ...base,
            status: "error",
            currentStageId: null,
            interventionKind: null,
            error: `Decision failed (${response.status})`,
          }
        })
        return
      }

      const payload = (await response.json()) as { status: string }
      const nextStatus = payload.status

      if (nextStatus === "complete" || nextStatus === "escalated" || nextStatus === "manual_takeover") {
        upsertSession(threadId, (session) => {
          const base = session ?? defaultSession(threadId)
          return {
            ...base,
            status: toAgentStatus(nextStatus),
            currentStageId: null,
            interventionKind: null,
          }
        })
        await refreshQueue()
        await hydrateThreadDetail(threadId)
        return
      }

      if (nextStatus === "waiting_human") {
        upsertSession(threadId, (session) => {
          const base = session ?? defaultSession(threadId)
          return {
            ...base,
            status: "waiting_human",
            currentStageId: null,
          }
        })
        await refreshQueue()
        await hydrateThreadDetail(threadId)
        return
      }

      openStream(threadId, "resume")
      await refreshQueue()
    },
    [hydrateThreadDetail, openStream, refreshQueue, selectedThreadId, upsertSession],
  )

  const resetThread = useCallback(
    async (threadId: string) => {
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
    },
    [closeStream, refreshQueue, selectedThreadId],
  )

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
    lastQueueSyncAt,
    selectedThreadId,
    selectedTradeId,
    selectedQueueItem,
    selectedSession,
    selectQueueItem,
    runTradeReview,
    resetThread,
    submitDecision,
    refreshQueue,
  }
}
