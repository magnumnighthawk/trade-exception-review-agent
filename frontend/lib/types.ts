/**
 * Shared TypeScript types for the Trade Exception Review Agent frontend.
 *
 * LEARNING: These types mirror the Pydantic models in backend/api/models.py.
 * Keeping them in sync is a discipline concern — in production you'd generate
 * them automatically from the OpenAPI schema.
 */

export type AgentStatus =
  | "idle"
  | "starting"
  | "streaming"
  | "waiting_human"
  | "resuming"
  | "complete"
  | "escalated"
  | "manual_takeover"
  | "error"

export type ThreadStageStatus = "running" | "complete" | "error"
export type InterventionKind = "proposal_review" | "information_request" | "failure_recovery"
export type DecisionAction =
  | "approve"
  | "reject"
  | "modify"
  | "escalate"
  | "provide_context"
  | "retry"
  | "manual_takeover"

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

export interface CompleteEvent {
  type: "complete"
  status: string
  final_state: Partial<AgentStateSnapshot>
}

export interface ErrorEvent {
  type: "error"
  message: string
  recoverable: boolean
  failure_context?: FailureContext | null
}

export interface ReviewPolicyPayload {
  low_confidence_threshold: number
  high_confidence_threshold: number
  max_investigation_attempts: number
  max_execution_retries: number
}

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

export interface FailureContext {
  category: "insufficient_information" | "retry_limit" | "execution_error" | "manual_takeover"
  failed_node: string
  message: string
  recoverable: boolean
  retry_available: boolean
  retry_count: number
}

export interface ProposalReviewInterruptPayload {
  kind: "proposal_review"
  trade_id: string
  proposal: ResolutionProposal
  investigation_summary: string
  confidence: number
  risk_level: "low" | "medium" | "high" | "critical"
  amount: number
  policy: ReviewPolicyPayload
}

export interface InformationRequestInterruptPayload {
  kind: "information_request"
  trade_id: string
  question: string
  fields_needed: string[]
  attempt: number
  context_summary: string
  policy: ReviewPolicyPayload
}

export interface FailureRecoveryInterruptPayload {
  kind: "failure_recovery"
  trade_id: string
  failed_node: string
  error_message: string
  recoverable: boolean
  retry_available: boolean
  retry_count: number
  latest_proposal: ResolutionProposal | null
  policy: ReviewPolicyPayload
}

export type InterruptPayload =
  | ProposalReviewInterruptPayload
  | InformationRequestInterruptPayload
  | FailureRecoveryInterruptPayload

export interface HitlInterruptEvent {
  type: "hitl_interrupt"
  thread_id: string
  interrupt_payload: InterruptPayload
}

export type SSEEvent =
  | TokenEvent
  | NodeStartEvent
  | NodeCompleteEvent
  | HitlInterruptEvent
  | CompleteEvent
  | ErrorEvent

export interface AgentStateSnapshot {
  status: string
  investigation: Investigation
  proposal: ResolutionProposal
  investigation_attempts: number
  execution_attempts: number
  execution_result: string
  escalation_reason: string
  additional_context: Record<string, string>
  failure_context: FailureContext
  manual_takeover_note: string
}

export interface ThreadStageResponse {
  stage_id: string
  node: string
  message: string
  attempt: number
  status: ThreadStageStatus
  tokens: string
  state_snapshot: Partial<AgentStateSnapshot> | null
  started_at: string
  completed_at: string | null
}

export interface ThreadStageRecord {
  id: string
  node: string
  message: string
  attempt: number
  status: ThreadStageStatus
  tokens: string
  snapshot: Partial<AgentStateSnapshot> | null
  startedAt: string
  completedAt: string | null
}

export interface ThreadDetailResponse {
  thread_id: string
  trade_id: string
  status: AgentStatus | "running"
  current_node: string | null
  intervention_kind: InterventionKind | null
  interrupt_payload: InterruptPayload | null
  final_state: Partial<AgentStateSnapshot> | null
  error: string | null
  failure_context: FailureContext | null
  manual_takeover_note: string | null
  paused_at: string | null
  stage_history: ThreadStageResponse[]
}

export interface ThreadSession {
  threadId: string
  tradeId: string
  status: AgentStatus | "running"
  currentNode: string | null
  currentStageId: string | null
  stageHistory: ThreadStageRecord[]
  interventionKind: InterventionKind | null
  interruptPayload: InterruptPayload | null
  finalState: Partial<AgentStateSnapshot> | null
  error: string | null
  failureContext: FailureContext | null
  manualTakeoverNote: string | null
}

export interface HumanDecision {
  action: DecisionAction
  modification: string | null
  operator_id: string
  reason?: string | null
  confidence_before?: number | null
  escalation_category?: string | null
  context_fields?: Record<string, string> | null
}

export interface QueueItem {
  thread_id: string | null
  trade_id: string
  status: AgentStatus | "running"
  risk_level: "low" | "medium" | "high" | "critical" | null
  confidence: number | null
  amount: number | null
  counterparty: string | null
  proposal_action: string | null
  intervention_kind: InterventionKind | null
  interrupt_payload: InterruptPayload | null
  paused_at: string | null
}

export interface AuditEntryResponse {
  audit_entry_id: string
  timestamp: string
  operator_id: string
  thread_id: string
  trade_id: string
  decision: DecisionAction
  modification: string | null
  reason: string | null
  confidence_before: number | null
  agent_proposal_before: string | null
  escalation_category: string | null
  context_fields: Record<string, string> | null
}

export interface AuditLogResponse {
  thread_id: string
  trade_id: string
  audit_entries: AuditEntryResponse[]
  total_entries: number
}

export interface CheckpointStateResponse {
  thread_id: string
  has_checkpoint: boolean
  has_interrupt: boolean
  interrupt_count: number
  next_node: string | null
  status: string | null
  state_keys: string[]
  checkpointer_backend: string
}
