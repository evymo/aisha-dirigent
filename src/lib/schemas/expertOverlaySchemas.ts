/**
 * Zod schemas for Expert Overlay / AI Orchestrator domain tables
 *
 * Covers Phase 3 tables: agent_catalog, context_profiles,
 * ai_runs, ai_trace_events, mcp_auth_tokens.
 *
 * @module lib/schemas/expertOverlaySchemas
 */

import { z } from "zod";

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Enum: AI event types matching `ai_event_type` Postgres enum.
 * Includes all values from Phase 3 base + Phase 4 (agent loop) +
 * Phase 5 (dynamic composition) + Phase 6 (proactive triggers) +
 * Bridge (n8n trace) + Epocha 1 (moderation).
 */
export const aiEventTypeSchema = z.enum([
  // Phase 3 base
  "llm_call",
  "mcp_call",
  "tool_call",
  "patch_applied",
  "test_run",
  "deploy",
  "quality_gate",
  "human_approval",
  "route_decision",
  "context_compose",
  "compliance_check",
  // Phase 3 evaluation
  "evaluation",
  // Phase 4 agent loop + memory
  "memory_read",
  "memory_write",
  "task_checkpoint",
  "react_thought",
  // Phase 5 dynamic composition
  "workflow_start",
  "workflow_node",
  "workflow_transition",
  "parallel_fanout",
  "critic_review",
  // Phase 6 proactive triggers
  "proactive_trigger",
  "proactive_evaluation",
  "scheduled_job",
  "study_monitor",
  // Bridge: n8n trace logging
  "dirigent_action",
  "n8n_workflow",
  "escalation",
  "notification",
  // Epocha 1: moderation
  "moderation_decision",
]);

export type AiEventType = z.infer<typeof aiEventTypeSchema>;

/**
 * AI run status values
 */
export const aiRunStatusSchema = z.enum([
  "queued",
  "running",
  "success",
  "failed",
  "cancelled",
]);

export type AiRunStatus = z.infer<typeof aiRunStatusSchema>;

/**
 * Agent safety level values
 */
export const aiSafetyLevelSchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);

export type AiSafetyLevel = z.infer<typeof aiSafetyLevelSchema>;

/**
 * MCP token scope values
 */
export const mcpTokenScopeSchema = z.enum([
  "full",
  "read_only",
  "tool_specific",
]);

export type McpTokenScope = z.infer<typeof mcpTokenScopeSchema>;

// ============================================================================
// AGENT CATALOG
// ============================================================================

/**
 * Schema for agent_catalog row (list/detail view)
 */
export const agentCatalogRowSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  display_name: z.string(),
  purpose: z.string(),
  default_model: z.string(),
  default_context_profile: z.string(),
  safety_level: aiSafetyLevelSchema,
  max_loops: z.number().int().nonnegative(),
  allowed_tools: z.array(z.string()).default([]),
  denied_tools: z.array(z.string()).default([]),
  model_overrides: z.record(z.unknown()).default({}),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const agentCatalogArraySchema = z.array(agentCatalogRowSchema);

export type AgentCatalogRow = z.infer<typeof agentCatalogRowSchema>;

/**
 * Schema for creating a new agent catalog entry
 */
export const createAgentCatalogSchema = z.object({
  slug: z.string().min(2).max(100).regex(/^[a-z0-9_-]+$/),
  display_name: z.string().min(1).max(200),
  purpose: z.string().min(1),
  default_model: z.string().min(1),
  default_context_profile: z.string().default("repo_plus_rules"),
  safety_level: aiSafetyLevelSchema.default("medium"),
  max_loops: z.number().int().min(1).max(100).default(5),
  allowed_tools: z.array(z.string()).default([]),
  denied_tools: z.array(z.string()).default([]),
  model_overrides: z.record(z.unknown()).default({}),
  is_active: z.boolean().default(true),
});

export type CreateAgentCatalogParams = z.infer<typeof createAgentCatalogSchema>;

/**
 * Schema for updating an agent catalog entry
 */
export const updateAgentCatalogSchema = createAgentCatalogSchema.partial().extend({
  id: z.string().uuid(),
});

export type UpdateAgentCatalogParams = z.infer<typeof updateAgentCatalogSchema>;

// ============================================================================
// CONTEXT PROFILES
// ============================================================================

/**
 * Context layer configuration
 */
export const contextLayerConfigSchema = z.object({
  enabled: z.boolean().default(false),
  include_body: z.boolean().optional(),
  max_rules: z.number().int().positive().optional(),
  max_chunks: z.number().int().positive().optional(),
  max_events: z.number().int().positive().optional(),
});

/**
 * Schema for context_profiles row (list/detail view)
 */
export const contextProfileRowSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  display_name: z.string(),
  description: z.string().nullable(),
  token_budget: z.number().int().positive(),
  priority_order: z.array(z.string()),
  layers: z.record(contextLayerConfigSchema).or(z.record(z.unknown())),
  is_active: z.boolean(),
  created_at: z.string(),
});

export const contextProfileArraySchema = z.array(contextProfileRowSchema);

export type ContextProfileRow = z.infer<typeof contextProfileRowSchema>;

/**
 * Schema for creating a context profile
 */
export const createContextProfileSchema = z.object({
  slug: z.string().min(2).max(100).regex(/^[a-z0-9_-]+$/),
  display_name: z.string().min(1).max(200),
  description: z.string().nullable().default(null),
  token_budget: z.number().int().min(100).max(200000).default(8000),
  priority_order: z.array(z.string()).min(1),
  layers: z.record(z.unknown()),
  is_active: z.boolean().default(true),
});

export type CreateContextProfileParams = z.infer<typeof createContextProfileSchema>;

/**
 * Schema for updating a context profile
 */
export const updateContextProfileSchema = createContextProfileSchema.partial().extend({
  id: z.string().uuid(),
});

export type UpdateContextProfileParams = z.infer<typeof updateContextProfileSchema>;

// ============================================================================
// AI RUNS
// ============================================================================

/**
 * Schema for ai_runs row (list view)
 */
export const aiRunRowSchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  status: aiRunStatusSchema,
  story_id: z.string().uuid().nullable(),
  actor_user_id: z.string().uuid().nullable(),
  route_plan: z.record(z.unknown()).nullable(),
  cost_total_json: z.record(z.unknown()).default({}),
  metadata: z.record(z.unknown()).default({}),
  started_at: z.string(),
  finished_at: z.string().nullable(),
});

export const aiRunArraySchema = z.array(aiRunRowSchema);

export type AiRunRow = z.infer<typeof aiRunRowSchema>;

// ============================================================================
// AI TRACE EVENTS
// ============================================================================

/**
 * Schema for ai_trace_events row (list view)
 */
export const aiTraceEventRowSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  event_type: aiEventTypeSchema,
  operation: z.string().nullable(),
  agent_slug: z.string().nullable(),
  provider: z.string().nullable(),
  status: z.string(),
  duration_ms: z.number().nullable(),
  cost_json: z.record(z.unknown()).nullable(),
  request_summary: z.record(z.unknown()).nullable(),
  response_summary: z.record(z.unknown()).nullable(),
  error_json: z.record(z.unknown()).nullable(),
  created_at: z.string(),
  // Runtime/executor axis — which runtime ran the work (decision_id →
  // ai_decisions.runtime), surfaced alongside the provider (cloud) axis.
  backend_kind: z.string().nullable().optional(),
  model_id: z.string().nullable().optional(),
  decision_id: z.string().uuid().nullable().optional(),
});

export const aiTraceEventArraySchema = z.array(aiTraceEventRowSchema);

export type AiTraceEventRow = z.infer<typeof aiTraceEventRowSchema>;

// ============================================================================
// MCP AUTH TOKENS
// ============================================================================

/**
 * Schema for mcp_auth_tokens row (list view — token_hash is NOT exposed)
 */
export const mcpAuthTokenRowSchema = z.object({
  id: z.string().uuid(),
  scope: mcpTokenScopeSchema,
  allowed_tools: z.array(z.string()).default([]),
  denied_tools: z.array(z.string()).default([]),
  rate_limit_rpm: z.number().int().nonnegative(),
  rate_limit_daily: z.number().int().nonnegative(),
  usage_count: z.number().int().nonnegative(),
  is_active: z.boolean(),
  project_id: z.string().uuid().nullable(),
  account_id: z.string().uuid().nullable(),
  created_by: z.string().uuid(),
  last_used_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
});

export const mcpAuthTokenArraySchema = z.array(mcpAuthTokenRowSchema);

export type McpAuthTokenRow = z.infer<typeof mcpAuthTokenRowSchema>;

/**
 * Schema for creating an MCP auth token
 */
export const createMcpAuthTokenSchema = z.object({
  scope: mcpTokenScopeSchema.default("read_only"),
  allowed_tools: z.array(z.string()).default([]),
  denied_tools: z.array(z.string()).default([]),
  rate_limit_rpm: z.number().int().min(1).max(1000).default(60),
  rate_limit_daily: z.number().int().min(1).max(100000).default(10000),
  project_id: z.string().uuid().nullable().default(null),
  account_id: z.string().uuid().nullable().default(null),
  expires_at: z.string().nullable().default(null),
});

export type CreateMcpAuthTokenParams = z.infer<typeof createMcpAuthTokenSchema>;

// ============================================================================
// CONTEXT BUNDLE (compose_context RPC response)
// ============================================================================

/**
 * Schema for the context bundle returned by compose_context RPC
 */
export const contextBundleSchema = z.object({
  profile: z.string(),
  token_budget: z.number(),
  tokens_used: z.number(),
  layers: z.record(z.unknown()),
});

export type ContextBundle = z.infer<typeof contextBundleSchema>;

/**
 * Schema for the compose_context RPC request params
 */
export const composeContextRequestSchema = z.object({
  p_story_id: z.string().uuid(),
  p_context_profile_slug: z.string().default("repo_plus_rules"),
  p_run_id: z.string().uuid().nullable().default(null),
  p_query: z.string().nullable().default(null),
});

export type ComposeContextRequest = z.infer<typeof composeContextRequestSchema>;

// ============================================================================
// AI AGENT METRICS (Phase 4 — Observability)
// ============================================================================

/**
 * Schema for a single agent metrics summary row
 * returned by `get_ai_agent_metrics` RPC.
 */
export const agentMetricsSummaryRowSchema = z.object({
  agent_slug: z.string(),
  total_events: z.number().int(),
  avg_latency_ms: z.number().int().nullable(),
  p95_latency_ms: z.number().int().nullable(),
  total_tokens: z.number(),
  total_cost: z.number(),
  total_errors: z.number().int(),
  total_successes: z.number().int(),
  error_rate_pct: z.number(),
});

export const agentMetricsSummaryArraySchema = z.array(agentMetricsSummaryRowSchema);

export type AgentMetricsSummaryRow = z.infer<typeof agentMetricsSummaryRowSchema>;

/**
 * Schema for a single timeseries data point
 * returned by `get_ai_agent_metrics_timeseries` RPC.
 */
export const agentMetricsTimeseriesRowSchema = z.object({
  hour: z.string(),
  agent_slug: z.string(),
  total_events: z.number().int(),
  avg_latency_ms: z.number().int().nullable(),
  total_tokens: z.number(),
  total_cost: z.number(),
  errors: z.number().int(),
  successes: z.number().int(),
});

export const agentMetricsTimeseriesArraySchema = z.array(agentMetricsTimeseriesRowSchema);

export type AgentMetricsTimeseriesRow = z.infer<typeof agentMetricsTimeseriesRowSchema>;

/**
 * Schema for the run summary object
 * returned by `get_ai_run_summary` RPC.
 */
export const aiRunSummarySchema = z.object({
  total_runs: z.number().int(),
  by_status: z.record(z.number()),
  by_kind: z.record(z.number()),
  avg_duration_ms: z.number().int().nullable(),
});

export type AiRunSummary = z.infer<typeof aiRunSummarySchema>;

// ============================================================================
// ROUTE TASK (route_task RPC request)
// ============================================================================

/**
 * Schema for the route_task RPC request params
 */
export const routeTaskRequestSchema = z.object({
  p_task_kind: z.string().min(1),
  p_risk_profile: z.string().default("low"),
  p_domain: z.array(z.string()).default([]),
  p_tech: z.array(z.string()).default([]),
  p_story_id: z.string().uuid().nullable().default(null),
  p_constraints: z.record(z.unknown()).default({}),
});

export type RouteTaskRequest = z.infer<typeof routeTaskRequestSchema>;

// ============================================================================
// MODERATION SESSIONS + DECISIONS (Epocha 1)
// ============================================================================

/**
 * Session type enum for moderation sessions
 */
export const moderationSessionTypeSchema = z.enum([
  "chat_flow",
  "pre_commit",
  "pr_review",
  "test_strategy",
  "architecture",
  "estimation",
]);

export type ModerationSessionType = z.infer<typeof moderationSessionTypeSchema>;

/**
 * Moderation session status
 */
export const moderationSessionStatusSchema = z.enum([
  "active",
  "completed",
  "escalated",
]);

export type ModerationSessionStatus = z.infer<typeof moderationSessionStatusSchema>;

/**
 * Decision type enum for moderation decisions
 */
export const moderationDecisionTypeSchema = z.enum([
  "test_gap",
  "quality_issue",
  "refactor_suggestion",
  "compliance_violation",
  "architecture_concern",
  "estimation_adjustment",
  "code_comment_needed",
  "consistency_issue",
  "monolith_warning",
  "next_step",
]);

export type ModerationDecisionType = z.infer<typeof moderationDecisionTypeSchema>;

/**
 * Severity levels for moderation decisions
 */
export const moderationSeveritySchema = z.enum([
  "info",
  "warning",
  "error",
  "critical",
]);

export type ModerationSeverity = z.infer<typeof moderationSeveritySchema>;

/**
 * Schema for moderation_sessions admin row (includes decision counts)
 */
export const moderationSessionAdminRowSchema = z.object({
  id: z.string().uuid(),
  story_id: z.string().uuid().nullable(),
  user_id: z.string().uuid(),
  session_type: z.string(),
  expertise_level: z.string(),
  tech_stack: z.array(z.string()).or(z.record(z.unknown())).default([]),
  status: z.string(),
  metadata: z.record(z.unknown()).default({}),
  decision_count: z.number().int().default(0),
  critical_count: z.number().int().default(0),
  created_at: z.string(),
  updated_at: z.string(),
});

export const moderationSessionAdminArraySchema = z.array(moderationSessionAdminRowSchema);

export type ModerationSessionAdminRow = z.infer<typeof moderationSessionAdminRowSchema>;

/**
 * Schema for moderation_decisions row
 */
export const moderationDecisionRowSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  decision_type: z.string(),
  severity: z.string(),
  context: z.record(z.unknown()).default({}),
  recommendation: z.string(),
  evidence: z.record(z.unknown()).nullable().default(null),
  accepted: z.boolean().nullable(),
  created_at: z.string(),
});

export const moderationDecisionArraySchema = z.array(moderationDecisionRowSchema);

export type ModerationDecisionRow = z.infer<typeof moderationDecisionRowSchema>;
