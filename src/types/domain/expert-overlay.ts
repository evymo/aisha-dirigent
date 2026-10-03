/**
 * Expert Overlay Layer — Domain Types
 *
 * TypeScript interfaces for Phase 3: Router Service, Context Composer,
 * Quality Governor, MCP auth scopes, and AI observability.
 *
 * The Expert Overlay is NOT another agent — it's a **policy & context system**
 * that ensures all AI agents share the same rules, project context, gates,
 * and audit trail.
 *
 * Architecture:
 * ```
 *   TaskEnvelope → Router → RoutePlan → agents execute → QualityGovernor gates
 *                            ↕
 *                    Context Composer → ContextBundle
 * ```
 *
 * @module types/domain/expert-overlay
 */

// =============================================================================
// Agent Catalog
// =============================================================================

/**
 * Safety level tiers for agent execution.
 * Higher levels impose stricter guardrails + model constraints.
 */
export type AgentSafetyLevel = "minimal" | "standard" | "strict" | "paranoid";

/**
 * Model tier identifiers used across agent_catalog.
 * Maps to actual provider models at runtime (e.g. claude-opus → claude-sonnet-4-20250514).
 */
export type ModelTier =
  | "claude-opus"
  | "gpt-strong"
  | "fast"
  | "code_strong"
  | "reasoning";

/**
 * Agent catalog entry — one registered AI agent with its capabilities,
 * permitted tools, default model/context profile, and safety constraints.
 */
export interface AgentCatalogEntry {
  /** UUID */
  id: string;
  /** Unique machine identifier, e.g. "aisha_planner" */
  slug: string;
  /** Human-readable display name */
  displayName: string;
  /** Agent purpose: planning, patching, compliance, documentation, debugging, verification */
  purpose: string;
  /** Default model tier for this agent */
  defaultModel: ModelTier | string;
  /** Risk-based model overrides: { "high_risk": "claude-opus", "low_risk": "fast" } */
  modelOverrides: Record<string, string>;
  /** MCP tool names this agent may invoke */
  allowedTools: string[];
  /** Explicitly blocked tool names (supercedes allowedTools) */
  deniedTools: string[];
  /** Slug of the default context_profile for this agent */
  defaultContextProfile: string;
  /** Maximum agent loop iterations */
  maxLoops: number;
  /** Safety level: minimal=chat, standard=dev, strict=security, paranoid=production */
  safetyLevel: AgentSafetyLevel;
  /** Whether the agent is available for routing */
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

// =============================================================================
// Context Profiles & Bundles
// =============================================================================

/**
 * The four context layers assembled by the Context Composer.
 */
export type ContextLayerName =
  | "project_context"
  | "ruleset"
  | "kb_retrieval"
  | "memory";

/**
 * Layer configuration for project_context.
 */
export interface ProjectContextLayerConfig {
  enabled: boolean;
  /** Which fields to include: "story", "ruleset", "build_config", "env_hints", "participants" */
  fields: string[];
}

/**
 * Layer configuration for ruleset injection.
 */
export interface RulesetLayerConfig {
  enabled: boolean;
  /** Whether to include full body_markdown of each rule */
  includeBody: boolean;
  /** Maximum rules to include (sorted by priority) */
  maxRules: number;
}

/**
 * Layer configuration for knowledge-base retrieval.
 */
export interface KbRetrievalLayerConfig {
  enabled: boolean;
  /** Maximum retrieved chunks */
  maxChunks: number;
  /** Filter by item types: "expert_rule", "engineering_doc", "playbook", "faq", etc. */
  itemTypes: string[];
  /** Cosine similarity threshold for vector search */
  similarityThreshold: number;
}

/**
 * Layer configuration for run memory (trace events).
 */
export interface MemoryLayerConfig {
  enabled: boolean;
  /** Maximum trace events to include as memory */
  maxEvents: number;
}

/**
 * Combined layers configuration stored in context_profiles.layers JSONB.
 */
export interface ContextLayersConfig {
  project_context: ProjectContextLayerConfig;
  ruleset: RulesetLayerConfig;
  kb_retrieval: KbRetrievalLayerConfig;
  memory: MemoryLayerConfig;
}

/**
 * Context profile definition — declarative specification of how the
 * Context Composer should build a context bundle for a given use case.
 */
export interface ContextProfile {
  /** UUID */
  id: string;
  /** Unique machine identifier, e.g. "repo_plus_rules" */
  slug: string;
  /** Human-readable display name */
  displayName: string;
  /** What this profile is optimized for */
  description?: string;
  /** Layer-by-layer configuration */
  layers: ContextLayersConfig;
  /** Maximum token budget for the entire context bundle */
  tokenBudget: number;
  /** Order in which layers are assembled (first layer fills first, respecting token budget) */
  priorityOrder: ContextLayerName[];
  /** Whether this profile can be selected */
  isActive: boolean;
  createdAt: string;
}

/**
 * Assembled context bundle — the output of compose_context().
 * Contains data from each enabled layer, plus token accounting.
 */
export interface ContextBundle {
  /** Which profile was used */
  profile: string;
  /** Maximum tokens allowed */
  tokenBudget: number;
  /** Estimated tokens consumed */
  tokensUsed: number;
  /** Assembled layers */
  layers: {
    project_context?: ProjectContextData;
    ruleset?: RulesetContextData;
    kb_retrieval?: KbRetrievalContextData;
    memory?: MemoryContextData;
  };
}

/**
 * Project context layer data (from mcp_get_story_context).
 */
export interface ProjectContextData {
  story_id: string;
  title?: string;
  repo_url?: string;
  delivery_status?: string;
  tech_stack?: string[];
  risk_profile?: string;
  domain?: string;
  [key: string]: unknown;
}

/**
 * Ruleset layer data — fingerprinted set of expert rules.
 */
export interface RulesetContextData {
  fingerprint: string;
  rules: RulesetRule[];
}

/**
 * A single rule within the ruleset context.
 */
export interface RulesetRule {
  slug: string;
  title: string;
  category: string;
  aiInstructions?: string;
  /** Only included when profile has includeBody=true */
  bodyMarkdown?: string;
}

/**
 * Knowledge-base retrieval layer data.
 */
export interface KbRetrievalContextData {
  chunks: KbChunk[];
}

/**
 * A retrieved knowledge chunk.
 */
export interface KbChunk {
  knowledgeItemId: string;
  title: string;
  chunkText: string;
  sourceSlug: string;
}

/**
 * Memory layer data — recent trace events from the current run.
 */
export interface MemoryContextData {
  events: MemoryEvent[];
}

/**
 * A single memory event from the trace.
 */
export interface MemoryEvent {
  eventType: AiEventType;
  status: TraceEventStatus;
  operation?: string;
  agentSlug?: string;
  createdAt: string;
}

// =============================================================================
// Router — Task Envelopes & Route Plans
// =============================================================================

/**
 * Supported task kinds that the Router can handle.
 */
export type TaskKind =
  | "chat"
  | "project_delivery"
  | "compliance_check"
  | "guild_review"
  | "pr_gate"
  | "incident"
  | "doc_update";

/**
 * Risk profile levels.
 */
export type RiskProfile = "low" | "medium" | "high";

/**
 * Task envelope — the input to the Router.
 * Describes WHAT needs to be done and the risk/domain/tech context.
 *
 * @example
 * ```typescript
 * const envelope: TaskEnvelope = {
 *   taskKind: "project_delivery",
 *   riskProfile: "medium",
 *   domain: ["healthcare", "compliance"],
 *   tech: ["react", "supabase"],
 *   storyId: "uuid-of-story",
 *   constraints: { maxBudgetUsd: 5.0 },
 * };
 * ```
 */
export interface TaskEnvelope {
  /** What type of task is being requested */
  taskKind: TaskKind;
  /** Risk assessment: low/medium/high — affects model selection + gates */
  riskProfile: RiskProfile;
  /** Domain tags for specialized rule matching */
  domain: string[];
  /** Technology stack tags */
  tech: string[];
  /** Optional: tie to a specific partner story */
  storyId?: string;
  /** Optional: additional constraints (max budget, deadline, etc.) */
  constraints?: Record<string, unknown>;
}

/**
 * Agent step in the route plan — one agent in the execution pipeline.
 */
export interface RouteAgentStep {
  /** Agent slug from agent_catalog */
  slug: string;
  /** Resolved model for this execution (may differ from default based on risk) */
  model: string;
  /** Context profile slug that compose_context will use for this agent */
  contextProfile: string;
  /** 1-based position in pipeline */
  stepIndex: number;
}

/**
 * Stop conditions for the route plan execution.
 */
export interface StopConditions {
  /** Maximum loops across all agents */
  maxLoops: number;
  /** Must the compliance gate pass before completion? */
  mustPassCompliance: boolean;
  /** Does the task require human approval before proceeding? */
  requireHumanApproval: boolean;
}

/**
 * Route plan — the output of route_task().
 * Contains an ordered pipeline of agents, their collective tool allowlist,
 * and execution stop conditions.
 */
export interface RoutePlan {
  /** UUID of the created ai_run */
  runId: string;
  /** Ordered agent pipeline */
  agents: RouteAgentStep[];
  /** Union of all agents' allowed tools (deduplicated) */
  toolsAllowlist: string[];
  /** Conditions that must be met to complete the run */
  stopConditions: StopConditions;
}

// =============================================================================
// MCP Auth Tokens
// =============================================================================

/**
 * MCP token scope levels.
 * - global: full platform access (admin only)
 * - account: scoped to an organization/partner
 * - project: scoped to a specific story
 */
export type McpTokenScope = "global" | "account" | "project";

/**
 * MCP authentication token (read view — never contains raw token).
 */
export interface McpAuthToken {
  /** UUID */
  id: string;
  /** Token scope level */
  scope: McpTokenScope;
  /** Organization ID (for account/project scopes) */
  accountId?: string;
  /** Story ID (for project scope) */
  projectId?: string;
  /** MCP tool names this token may invoke (empty = all non-denied) */
  allowedTools: string[];
  /** Explicitly blocked tool names */
  deniedTools: string[];
  /** Maximum requests per minute */
  rateLimitRpm: number;
  /** Maximum requests per day */
  rateLimitDaily: number;
  /** When the token expires (null = no expiry) */
  expiresAt?: string;
  /** Whether the token is currently active */
  isActive: boolean;
  /** Who created this token */
  createdBy: string;
  createdAt: string;
  /** Last time this token was used */
  lastUsedAt?: string;
  /** Total usage count */
  usageCount: number;
}

/**
 * Result of create_mcp_token() — includes raw token (shown only once).
 */
export interface McpTokenCreationResult {
  /** UUID of the created token record */
  tokenId: string;
  /** Raw token string — MUST be stored securely, cannot be retrieved again */
  rawToken: string;
  /** Token scope */
  scope: McpTokenScope;
  /** When the token expires */
  expiresAt?: string;
  /** Security warning */
  warning: string;
}

/**
 * Result of validate_mcp_token() — validation outcome.
 */
export interface McpTokenValidationResult {
  /** Whether the token is valid */
  valid: boolean;
  /** Rejection reason (if invalid) */
  reason?:
    | "token_not_found_or_expired"
    | "project_scope_mismatch"
    | "tool_denied"
    | "tool_not_allowed";
  /** Token scope (if valid) */
  scope?: McpTokenScope;
  /** Account ID (if valid + scoped) */
  accountId?: string;
  /** Project ID (if valid + scoped) */
  projectId?: string;
  /** Rate limit: requests per minute */
  rateLimitRpm?: number;
  /** Rate limit: requests per day */
  rateLimitDaily?: number;
}

// =============================================================================
// AI Observability — Runs & Trace Events
// =============================================================================

/**
 * AI run status lifecycle.
 */
export type AiRunStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "canceled"
  | "blocked";

/**
 * Top-level AI execution run — every Router invocation creates one.
 */
export interface AiRun {
  /** UUID */
  id: string;
  /** Task kind that created this run */
  kind: TaskKind;
  /** Optional: associated partner story */
  storyId?: string;
  /** User who initiated the run */
  actorUserId?: string;
  /** The route plan produced by the Router */
  routePlan?: RoutePlan;
  /** Current status */
  status: AiRunStatus;
  /** When the run started */
  startedAt: string;
  /** When the run finished (null if still running) */
  finishedAt?: string;
  /** Aggregated cost data: { "openai": 0.05, "anthropic": 0.12 } */
  costTotalJson: Record<string, number>;
  /** Additional metadata */
  metadata: Record<string, unknown>;
}

/**
 * AI trace event types matching the ai_event_type PostgreSQL enum.
 * Keep in sync with aiEventTypeSchema in expertOverlaySchemas.ts.
 */
export type AiEventType =
  | "llm_call"
  | "mcp_call"
  | "tool_call"
  | "patch_applied"
  | "test_run"
  | "deploy"
  | "quality_gate"
  | "human_approval"
  | "route_decision"
  | "context_compose"
  | "compliance_check"
  | "evaluation"
  | "memory_read"
  | "memory_write"
  | "task_checkpoint"
  | "react_thought"
  | "workflow_start"
  | "workflow_node"
  | "workflow_transition"
  | "parallel_fanout"
  | "critic_review"
  | "proactive_trigger"
  | "proactive_evaluation"
  | "scheduled_job"
  | "study_monitor"
  | "dirigent_action"
  | "n8n_workflow"
  | "escalation"
  | "notification"
  | "moderation_decision";

/**
 * Trace event status.
 */
export type TraceEventStatus = "ok" | "error" | "timeout" | "skipped";

/**
 * Fine-grained trace event within an ai_run.
 * Contains NO PII — only IDs and redacted summaries.
 */
export interface AiTraceEvent {
  /** UUID */
  id: string;
  /** Parent AI run */
  runId: string;
  /** Type of event */
  eventType: AiEventType;
  /** Which agent produced this event */
  agentSlug?: string;
  /** AI provider: "openai", "anthropic", etc. */
  provider?: string;
  /** Operation name */
  operation?: string;
  /** Event outcome */
  status: TraceEventStatus;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Cost data for this individual event */
  costJson?: Record<string, number>;
  /** Redacted request summary (no PII) */
  requestSummary?: Record<string, unknown>;
  /** Redacted response summary (no PII) */
  responseSummary?: Record<string, unknown>;
  /** Error details (if status is "error") */
  errorJson?: Record<string, unknown>;
  createdAt: string;
}

// =============================================================================
// Quality Governor — Gates & Compliance Results
// =============================================================================

/**
 * Quality gate verdict.
 */
export type GateVerdict = "pass" | "fail" | "warn" | "skip";

/**
 * Quality gate types in the Governor pipeline.
 */
export type GateType =
  | "compliance"
  | "reality_check"
  | "deploy_gate"
  | "reroute";

/**
 * Result of a single quality gate evaluation.
 */
export interface QualityGateResult {
  /** Which gate was evaluated */
  gate: GateType;
  /** Outcome */
  verdict: GateVerdict;
  /** Human-readable reason */
  reason: string;
  /** Specific findings (rule violations, test failures, etc.) */
  findings: GateFinding[];
  /** Which agent evaluated this gate */
  evaluatorAgent?: string;
  /** Duration of the gate check */
  durationMs?: number;
}

/**
 * Individual finding from a quality gate evaluation.
 */
export interface GateFinding {
  /** Severity: critical issues block, warnings inform */
  severity: "critical" | "warning" | "info";
  /** Rule or check that flagged this */
  ruleSlug?: string;
  /** Human-readable description */
  message: string;
  /** Affected file or resource */
  location?: string;
  /** Suggested remediation */
  suggestion?: string;
}

/**
 * Compliance context returned by mcp_get_compliance_context().
 */
export interface ComplianceContext {
  storyId: string;
  ruleset: {
    fingerprint: string;
    rules: Array<{
      id: string;
      slug: string;
      title: string;
      category: string;
      aiInstructions?: string;
      bodyMarkdown?: string;
    }>;
  } | null;
}

// =============================================================================
// RPC Parameter Types — for supabase.rpc() calls
// =============================================================================

/**
 * Parameters for route_task() RPC.
 */
export interface RouteTaskParams {
  p_task_kind: TaskKind;
  p_risk_profile?: RiskProfile;
  p_domain?: string[];
  p_tech?: string[];
  p_story_id?: string;
  p_constraints?: Record<string, unknown>;
}

/**
 * Parameters for compose_context() RPC.
 */
export interface ComposeContextParams {
  p_story_id: string;
  p_context_profile_slug?: string;
  p_run_id?: string;
  p_query?: string;
}

/**
 * Parameters for log_ai_trace_event() RPC.
 */
export interface LogAiTraceEventParams {
  p_run_id: string;
  p_event_type: AiEventType;
  p_agent_slug?: string;
  p_provider?: string;
  p_operation?: string;
  p_status?: TraceEventStatus;
  p_duration_ms?: number;
  p_cost_json?: Record<string, number>;
  p_request_summary?: Record<string, unknown>;
  p_response_summary?: Record<string, unknown>;
  p_error_json?: Record<string, unknown>;
}

/**
 * Parameters for finish_ai_run() RPC.
 */
export interface FinishAiRunParams {
  p_run_id: string;
  p_status?: AiRunStatus;
  p_cost_total_json?: Record<string, number>;
}

/**
 * Parameters for validate_mcp_token() RPC.
 */
export interface ValidateMcpTokenParams {
  p_token_hash: string;
  p_tool_name?: string;
  p_project_id?: string;
}

/**
 * Parameters for create_mcp_token() RPC.
 */
export interface CreateMcpTokenParams {
  p_scope: McpTokenScope;
  p_account_id?: string;
  p_project_id?: string;
  p_allowed_tools?: string[];
  p_denied_tools?: string[];
  p_rate_limit_rpm?: number;
  p_rate_limit_daily?: number;
  p_expires_in_days?: number;
}

/**
 * Parameters for mcp_get_compliance_context() RPC.
 */
export interface GetComplianceContextParams {
  p_story_id: string;
  p_severity_threshold?: number;
}
