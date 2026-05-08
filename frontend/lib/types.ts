/**
 * Shared TypeScript types for the Trade Exception Review Agent frontend.
 *
 * LEARNING: These types mirror the Pydantic models in backend/api/models.py.
 * Keeping them in sync is a discipline concern — in production you'd generate
 * them automatically from the OpenAPI schema (e.g. openapi-typescript).
 *
 * The discriminated union pattern for SSE events is the key thing to study here.
 * TypeScript narrows the type based on the `type` field, so each event handler
 * only sees the fields that actually exist on that event shape.
 */

// ── Agent status — discriminated union ────────────────────────────────────────
// LEARNING: This is NOT an enum. It's a union of string literals.
// Every component that renders based on agent status branches on this type.
// Adding a new status means the TypeScript compiler forces you to handle it
// everywhere — that's the safety guarantee.
export type AgentStatus =
  | "idle"           // No agent running yet
  | "starting"       // POST /review/start in-flight
  | "streaming"      // SSE connected, agent is running
  | "waiting_human"  // Agent hit interrupt() — HITL gate open
  | "resuming"       // Human submitted decision, agent resuming
  | "complete"       // Agent finished successfully
  | "escalated"      // Case escalated to senior queue
  | "error"          // Agent encountered an unrecoverable error

// ── SSE event types — discriminated union on `type` ──────────────────────────
// LEARNING: Every event from the SSE stream has a `type` field.
// We union all possible shapes here. When you do:
//   if (event.type === "hitl_interrupt") { ... }
// TypeScript narrows `event` to HitlInterruptEvent inside the block.
// This is safe, exhaustive, and documents the full event contract.

export interface TokenEvent {
  type: "token"
  content: string
  node: string
}

export interface NodeStartEvent {
  type: "node_start"
  node: string
  message: string
}

export interface NodeCompleteEvent {
  type: "node_complete"
  node: string
  state_snapshot: Partial<AgentStateSnapshot> | null
}

export interface HitlInterruptEvent {
  type: "hitl_interrupt"
  thread_id: string
  interrupt_payload: InterruptPayload
}

export interface CompleteEvent {
  type: "complete"
  status: string
  final_state: Partial<AgentStateSnapshot>
}

export interface ErrorEvent {
  type: "error"
  message: string
  recoverable: boolean
}

export type SSEEvent =
  | TokenEvent
  | NodeStartEvent
  | NodeCompleteEvent
  | HitlInterruptEvent
  | CompleteEvent
  | ErrorEvent

// ── Domain types ──────────────────────────────────────────────────────────────

export interface TradeException {
  trade_id: string
  type: "settlement_fail" | "iban_mismatch" | "amount_discrepancy" | "counterparty_mismatch"
  amount: number
  counterparty: string
  reason: string
  flagged_at: string
}

export interface Investigation {
  root_cause: string
  evidence: string[]
  suggested_action: string
  confidence: number
}

export interface ResolutionProposal {
  action: string
  details: string
  confidence: number
  requires_human_approval: boolean
  risk_level: "low" | "medium" | "high" | "critical"
}

// The payload the agent sends to interrupt() — what DecisionSurface renders
export interface InterruptPayload {
  trade_id: string
  proposal: ResolutionProposal
  investigation_summary: string
  confidence: number
  risk_level: "low" | "medium" | "high" | "critical"
  amount: number
}

// Partial snapshot of agent state for UI display
export interface AgentStateSnapshot {
  status: string
  investigation: Investigation
  proposal: ResolutionProposal
  investigation_attempts: number
  execution_result: string
  escalation_reason: string
}

// ── Human decision ─────────────────────────────────────────────────────────────

export type DecisionAction = "approve" | "reject" | "modify" | "escalate"

export interface HumanDecision {
  action: DecisionAction
  modification: string | null
  operator_id: string
  reason?: string | null
  confidence_before?: number | null
  escalation_category?: string | null
}

// ── Queue item ─────────────────────────────────────────────────────────────────

export interface QueueItem {
  thread_id: string | null
  trade_id: string
  status: AgentStatus | "running"
  risk_level: "low" | "medium" | "high" | "critical" | null
  confidence: number | null
  amount: number | null
  counterparty: string | null
  proposal_action: string | null
  interrupt_payload: InterruptPayload | null
  paused_at: string | null
}
