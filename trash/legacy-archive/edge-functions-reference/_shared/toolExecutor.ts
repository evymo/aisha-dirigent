/**
 * AI Tool Executor for Edge Functions
 *
 * Resolves tool definitions from the DB (`agent_tools` table), validates
 * arguments against the declared JSON Schema, dispatches to the appropriate
 * handler (RPC, edge function, or webhook), and records trace events.
 *
 * The executor is designed to be called inside the iterative tool-call loop
 * in `ai-chat` / `ai-story-consult`. It does **not** decide _when_ to call
 * tools — that decision is made by the LLM via `tool_choice: "auto"`.
 *
 * Security:
 * - Tools with `requires_consent = true` are checked against the user's
 *   data-sharing consents before execution.
 * - Tools with a non-null `audit_action` create an `audit_journal` entry.
 * - All executions are traced to `ai_trace_events` via the supplied Tracer.
 *
 * Usage:
 *   import { createToolExecutor } from "../_shared/toolExecutor.ts";
 *
 *   const executor = createToolExecutor(supabaseService, supabaseUser, userId, tracer);
 *   const result = await executor.execute({ id: "call_123", name: "search_knowledge_base", arguments: { query: "sleep" } });
 *
 * @module
 */

import type { SupabaseClient } from "./deps.ts";
import type { Tracer } from "./tracer.ts";
import type { ChatAccessLevel } from "./guardrails-config.ts";
import { validateToolDefinition, type BuiltToolDefinition } from "./toolBuilder.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Represents a single tool call from the LLM response. */
export interface ToolCall {
  /** Unique ID assigned by the LLM (used for correlating tool results). */
  id: string;
  /** Tool name (must match `agent_tools.name`). */
  name: string;
  /** Arguments parsed from the LLM output. */
  arguments: Record<string, unknown>;
}

/** Result of executing a single tool call. */
export interface ToolCallResult {
  /** The tool_call_id from the original ToolCall. */
  toolCallId: string;
  /** Serialised result string to send back to the LLM. */
  content: string;
  /** Whether execution succeeded. */
  ok: boolean;
  /** Duration in milliseconds. */
  durationMs: number;
}

/** Resolved tool definition from the database. */
interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  parameters_schema: Record<string, unknown>;
  handler_type: "rpc" | "edge_function" | "webhook";
  handler_ref: string;
  access_tier_min: string;
  requires_consent: boolean;
  audit_action: string | null;
  metadata: Record<string, unknown>;
  /** Validated definition with fail-closed defaults applied (from toolBuilder). */
  _validated?: BuiltToolDefinition;
}

/** Configuration for the tool executor. */
export interface ToolExecutorConfig {
  /** Current user's access level (from guardrails). */
  accessLevel?: ChatAccessLevel;
  /** Partner ID for consent checks. */
  partnerId?: string;
  /** Max execution time per tool call (ms). Default: 15000. */
  timeoutMs?: number;
  /** Max total tool calls per turn. Default: 10. */
  maxCallsPerTurn?: number;
}

// ---------------------------------------------------------------------------
// Access tier ordering (lower index = lower tier)
// ---------------------------------------------------------------------------

const ACCESS_TIER_ORDER: readonly string[] = [
  "none",
  "basic",
  "enrolled",
  "active",
  "qualified",
  "certified",
  "premium",
  "partner",
  "partner_certified",
  "partner_premium",
] as const;

function meetsAccessTier(userTier: string, requiredTier: string): boolean {
  const userIdx = ACCESS_TIER_ORDER.indexOf(userTier);
  const requiredIdx = ACCESS_TIER_ORDER.indexOf(requiredTier);
  if (userIdx === -1 || requiredIdx === -1) return false;
  return userIdx >= requiredIdx;
}

// ---------------------------------------------------------------------------
// Simple JSON Schema validator (subset: type, required, properties)
// ---------------------------------------------------------------------------

function validateArguments(
  args: Record<string, unknown>,
  schema: Record<string, unknown>,
): { valid: boolean; error?: string } {
  if (!schema || typeof schema !== "object") return { valid: true };

  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const required = schema.required as string[] | undefined;

  // Check required fields
  if (required && Array.isArray(required)) {
    for (const key of required) {
      if (args[key] === undefined || args[key] === null) {
        return { valid: false, error: `Missing required parameter: ${key}` };
      }
    }
  }

  // Check declared types
  if (properties) {
    for (const [key, prop] of Object.entries(properties)) {
      const val = args[key];
      if (val === undefined || val === null) continue;

      const expectedType = prop.type as string | undefined;
      if (!expectedType) continue;

      const actualType = typeof val;
      if (expectedType === "string" && actualType !== "string") {
        return { valid: false, error: `Parameter "${key}" must be string, got ${actualType}` };
      }
      if (expectedType === "integer" && (actualType !== "number" || !Number.isInteger(val))) {
        return { valid: false, error: `Parameter "${key}" must be integer` };
      }
      if (expectedType === "number" && actualType !== "number") {
        return { valid: false, error: `Parameter "${key}" must be number, got ${actualType}` };
      }
      if (expectedType === "boolean" && actualType !== "boolean") {
        return { valid: false, error: `Parameter "${key}" must be boolean, got ${actualType}` };
      }
      if (expectedType === "object" && (actualType !== "object" || Array.isArray(val))) {
        return { valid: false, error: `Parameter "${key}" must be object` };
      }
      if (expectedType === "array" && !Array.isArray(val)) {
        return { valid: false, error: `Parameter "${key}" must be array` };
      }
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Tool cache (per-request — avoids repeated DB lookups within a turn)
// ---------------------------------------------------------------------------

type ToolCache = Map<string, ToolDefinition>;

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export interface ToolExecutor {
  /** Execute a single tool call. */
  execute(toolCall: ToolCall): Promise<ToolCallResult>;

  /** Execute multiple tool calls in parallel (respects maxCallsPerTurn). */
  executeAll(toolCalls: ToolCall[]): Promise<ToolCallResult[]>;

  /** Convert loaded tool definitions to OpenAI-compatible tool specs. */
  toOpenAIToolSpecs(tools: ToolDefinition[]): Array<{
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }>;

  /** @deprecated Use loadToolsByNames instead. Returns empty array. */
  loadToolsForAgent(agentConfigId: string): Promise<ToolDefinition[]>;

  /** Load tools by name list (channel-centric: allowed_tools from channel config). */
  loadToolsByNames(toolNames: string[], options?: { includeDeferred?: boolean }): Promise<ToolDefinition[]>;
}

/**
 * Create a tool executor bound to a specific request context.
 *
 * @param supabaseService - Service-role client (for tool lookups & audit).
 * @param supabaseUser - User-scoped client (for RPC execution with RLS).
 * @param userId - Authenticated user's UUID.
 * @param tracer - Observability tracer instance.
 * @param config - Optional configuration overrides.
 */
export function createToolExecutor(
  supabaseService: SupabaseClient,
  supabaseUser: SupabaseClient,
  userId: string,
  tracer: Tracer,
  config?: ToolExecutorConfig,
): ToolExecutor {
  const accessLevel = config?.accessLevel ?? "basic";
  const partnerId = config?.partnerId;
  const timeoutMs = config?.timeoutMs ?? 15_000;
  const maxCallsPerTurn = config?.maxCallsPerTurn ?? 10;
  let callCount = 0;

  const cache: ToolCache = new Map();

  // -------------------------------------------------------------------------
  // Resolve tool from cache or DB (with fail-closed validation)
  // -------------------------------------------------------------------------
  async function resolveTool(name: string): Promise<ToolDefinition> {
    const cached = cache.get(name);
    if (cached) return cached;

    const { data, error } = await supabaseService.rpc("get_agent_tool", {
      p_name: name,
    });

    if (error || !data) {
      throw new Error(`Tool "${name}" not found or inactive`);
    }

    const tool = (typeof data === "string" ? JSON.parse(data) : data) as ToolDefinition;

    // Validate through toolBuilder — applies fail-closed defaults for any
    // missing security fields (consent, audit, access tier). If the DB row
    // is missing `requires_consent`, it defaults to TRUE (fail-closed).
    const validation = validateToolDefinition(tool as unknown as Record<string, unknown>);
    if (validation.valid && validation.definition) {
      tool._validated = validation.definition;
      // Apply fail-closed defaults back to the tool for downstream checks.
      // DB value takes precedence when explicitly set; builder default when missing.
      if (tool.requires_consent === undefined || tool.requires_consent === null) {
        tool.requires_consent = validation.definition.requiresConsent;
      }
      if (!tool.audit_action && validation.definition.auditAction) {
        tool.audit_action = validation.definition.auditAction;
      }
      if (!tool.access_tier_min) {
        tool.access_tier_min = validation.definition.accessTierMin;
      }
    }

    cache.set(name, tool);
    return tool;
  }

  // -------------------------------------------------------------------------
  // Check consent if required
  // -------------------------------------------------------------------------
  async function checkConsent(tool: ToolDefinition): Promise<boolean> {
    if (!tool.requires_consent) return true;
    if (!partnerId) return true; // no partner context → skip consent check

    const { data } = await supabaseService.rpc("has_data_sharing_consent", {
      p_partner_id: partnerId,
    
      p_user_id: userId,});

    return data === true;
  }

  // -------------------------------------------------------------------------
  // Write audit entry if configured
  // -------------------------------------------------------------------------
  async function auditToolCall(tool: ToolDefinition, args: Record<string, unknown>): Promise<void> {
    if (!tool.audit_action) return;

    try {
      await supabaseService.rpc("insert_audit_journal_entry", {
        p_action: tool.audit_action,
        p_metadata: {
          area: "ai",
          severity: "info",
          tool_name: tool.name,
          tool_handler: tool.handler_ref,
          // Only log parameter keys, never values (PII safety)
          param_keys: Object.keys(args),
        },
      
        p_user_id: userId,});
    } catch {
      // Audit failure must not block tool execution
      console.error(`[toolExecutor] Audit write failed for ${tool.name}`);
    }
  }

  // -------------------------------------------------------------------------
  // Dispatch to handler
  // -------------------------------------------------------------------------
  async function dispatch(
    tool: ToolDefinition,
    args: Record<string, unknown>,
  ): Promise<string> {
    switch (tool.handler_type) {
      case "rpc": {
        const { data, error } = await supabaseUser.rpc(tool.handler_ref, args);
        if (error) throw new Error(`RPC ${tool.handler_ref} failed: ${error.message}`);
        return JSON.stringify(data);
      }

      case "edge_function": {
        const { data, error } = await supabaseUser.functions.invoke(tool.handler_ref, {
          body: args,
        });
        if (error) throw new Error(`Edge function ${tool.handler_ref} failed: ${error.message}`);
        return JSON.stringify(data);
      }

      case "webhook": {
        const webhookUrl = tool.handler_ref;
        const controller = new AbortController();
        // Use tool-specific timeout from builder validation, falling back to executor default
        const effectiveTimeout = tool._validated?.timeoutMs ?? timeoutMs;
        const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

        try {
          const response = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: userId, ...args }),
            signal: controller.signal,
          });
          if (!response.ok) {
            throw new Error(`Webhook returned ${response.status}: ${response.statusText}`);
          }
          return await response.text();
        } finally {
          clearTimeout(timeoutId);
        }
      }

      default:
        throw new Error(`Unknown handler type: ${tool.handler_type}`);
    }
  }

  // -------------------------------------------------------------------------
  // Single execution
  // -------------------------------------------------------------------------
  async function execute(toolCall: ToolCall): Promise<ToolCallResult> {
    const t0 = Date.now();

    if (callCount >= maxCallsPerTurn) {
      return {
        toolCallId: toolCall.id,
        content: JSON.stringify({ error: `Tool call limit reached (max ${maxCallsPerTurn} per turn)` }),
        ok: false,
        durationMs: Date.now() - t0,
      };
    }
    callCount++;

    try {
      // 1. Resolve tool
      const tool = await resolveTool(toolCall.name);

      // 2. Check access tier
      if (!meetsAccessTier(accessLevel, tool.access_tier_min)) {
        const msg = `Insufficient access tier. Required: ${tool.access_tier_min}, current: ${accessLevel}`;
        await tracer.event("tool_call", toolCall.name, "internal", "access_check", "error", Date.now() - t0, {
          errorJson: { message: msg },
        });
        return {
          toolCallId: toolCall.id,
          content: JSON.stringify({ error: msg }),
          ok: false,
          durationMs: Date.now() - t0,
        };
      }

      // 3. Validate arguments
      const validation = validateArguments(toolCall.arguments, tool.parameters_schema);
      if (!validation.valid) {
        await tracer.event("tool_call", toolCall.name, "internal", "validate", "error", Date.now() - t0, {
          errorJson: { message: validation.error },
        });
        return {
          toolCallId: toolCall.id,
          content: JSON.stringify({ error: `Invalid arguments: ${validation.error}` }),
          ok: false,
          durationMs: Date.now() - t0,
        };
      }

      // 4. Consent check
      const hasConsent = await checkConsent(tool);
      if (!hasConsent) {
        await tracer.event("tool_call", toolCall.name, "internal", "consent_check", "error", Date.now() - t0, {
          errorJson: { message: "Data sharing consent not granted" },
        });
        return {
          toolCallId: toolCall.id,
          content: JSON.stringify({ error: "This tool requires data sharing consent which has not been granted." }),
          ok: false,
          durationMs: Date.now() - t0,
        };
      }

      // 5. Audit (non-blocking)
      await auditToolCall(tool, toolCall.arguments);

      // 6. Execute via tracer.span for observability
      const result = await tracer.span(
        "tool_call",
        toolCall.name,
        tool.handler_type,
        tool.handler_ref,
        () => dispatch(tool, toolCall.arguments),
        {
          requestSummary: {
            tool_name: toolCall.name,
            handler: `${tool.handler_type}:${tool.handler_ref}`,
            param_keys: Object.keys(toolCall.arguments),
          },
        },
      );

      return {
        toolCallId: toolCall.id,
        content: result,
        ok: true,
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      const durationMs = Date.now() - t0;
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Record failure (tracer.span already records if thrown inside, but
      // catching here ensures we always return a ToolCallResult)
      return {
        toolCallId: toolCall.id,
        content: JSON.stringify({ error: `Tool execution failed: ${errorMsg}` }),
        ok: false,
        durationMs,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Batch execution
  // -------------------------------------------------------------------------
  async function executeAll(toolCalls: ToolCall[]): Promise<ToolCallResult[]> {
    return Promise.all(toolCalls.map((tc) => execute(tc)));
  }

  // -------------------------------------------------------------------------
  // Load tools by name list (channel-centric: allowed_tools from channel config)
  // By default, deferred tools are excluded to reduce init payload.
  // -------------------------------------------------------------------------
  async function loadToolsByNames(
    toolNames: string[],
    options?: { includeDeferred?: boolean },
  ): Promise<ToolDefinition[]> {
    if (!toolNames.length) return [];
    const includeDeferred = options?.includeDeferred ?? false;

    const results: ToolDefinition[] = [];
    for (const name of toolNames) {
      try {
        const tool = await resolveTool(name);
        // Skip deferred tools unless explicitly requested
        if (!includeDeferred && tool._validated?.shouldDefer) continue;
        results.push(tool);
      } catch {
        // Skip tools that can't be resolved — non-blocking
        console.warn(`[toolExecutor] Tool "${name}" not found, skipping`);
      }
    }
    return results;
  }

  // -------------------------------------------------------------------------
  // @deprecated Use loadToolsByNames with channel's allowed_tools instead.
  // Kept for backward compatibility during migration.
  // -------------------------------------------------------------------------
  async function loadToolsForAgent(_agentConfigId: string): Promise<ToolDefinition[]> {
    console.warn("[toolExecutor] loadToolsForAgent is deprecated — use loadToolsByNames with channel allowed_tools");
    return [];
  }

  function toOpenAIToolSpecs(tools: ToolDefinition[]) {
    return tools
      .filter((t) => meetsAccessTier(accessLevel, t.access_tier_min))
      .map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters_schema,
        },
      }));
  }

  return { execute, executeAll, toOpenAIToolSpecs, loadToolsForAgent, loadToolsByNames };
}
