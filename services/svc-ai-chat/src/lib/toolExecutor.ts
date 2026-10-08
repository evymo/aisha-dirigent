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
 *   const executor = createToolExecutor(pgrestService, pgrestUser, userId, tracer);
 *   const result = await executor.execute({ id: "call_123", name: "search_knowledge_base", arguments: { query: "sleep" } });
 *
 * @module
 */

import type { PostgrestClient } from "./deps.js";
import type { Tracer } from "./tracer.js";
import type { ChatAccessLevel } from "./guardrails-config.js";
import { validateToolDefinition, type BuiltToolDefinition } from "./toolBuilder.js";

import { createSafeLogger } from '@aisha/security';
import { acsGlobalMode, acsGuardToolExecution } from './acs/guard.js';
const log = createSafeLogger('svc-ai-chat');
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
  handler_type: "rpc" | "edge_function" | "webhook" | "mcp";
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
  /**
   * Nástroje, které agentům trasy katalog ZAKAZUJE (`agent_catalog.denied_tools`, přes
   * route_task `tools_denylist`). Odečtou se od práva kanálu a jejich volání se odmítne
   * vždy — bez ohledu na příznak DYNAMIC_TOOL_SELECTION (SELF_IMPROVEMENT_LOOP.md K-36).
   */
  deniedTools?: readonly string[];
  /**
   * Druhý původ nástrojů: MCP server, týž, přes který volá /v1 (K-35). Smí ho sestavit
   * jen zprostředkovaný token uživatele (lib/chatMcpOrigin.ts); bez něj `null` a MCP
   * nástroje se nenabídnou ani nespustí.
   */
  mcp?: McpToolOrigin | null;
}

/**
 * Nástroje MCP pod identitou uživatele. `list` vrací jen to, co uživatel smí (server
 * filtruje tools/list týmž predikátem jako tools/call), `call` výsledek a zda prošel.
 */
export interface McpToolOrigin {
  list(): Promise<Array<{ name: string; description: string; parameters: Record<string, unknown> }>>;
  call(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }>;
}

/** Odkud nástroj pochází — jedno jméno má právě jeden původ (K-35). */
type ToolOrigin = "agent_tools" | "mcp";

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
 * @param pgrestService - Service-role client (for tool lookups & audit).
 * @param pgrestUser - User-scoped client (for RPC execution with RLS).
 * @param userId - Authenticated user's UUID.
 * @param tracer - Observability tracer instance.
 * @param config - Optional configuration overrides.
 */
export function createToolExecutor(
  pgrestService: PostgrestClient,
  pgrestUser: PostgrestClient,
  userId: string,
  tracer: Tracer,
  config?: ToolExecutorConfig,
): ToolExecutor {
  const accessLevel = config?.accessLevel ?? "basic";
  const partnerId = config?.partnerId;
  const timeoutMs = config?.timeoutMs ?? 15_000;
  const maxCallsPerTurn = config?.maxCallsPerTurn ?? 10;
  let callCount = 0;

  // Povolená sada (K-36). Dřív executeCore načetl JAKÝKOLI aktivní nástroj podle jména,
  // takže model (nebo vložená instrukce) mohl zavolat nástroj, který mu kanál nenabídl,
  // a `agent_catalog.denied_tools` se za běhu nevynucoval vůbec. Teď: povolené je jen to,
  // o co si volající řekl v loadToolsByNames (právo kanálu), minus zákazy. Dokud se nic
  // nenačte, není povolené nic — fail-closed.
  //
  // Povolené jméno má navíc právě jeden známý původ (K-35): agent_tools, nebo MCP.
  // Jméno bez původu (fantom) i jméno v obou (dvojznačné) se nepovolí — nikdy hádat.
  const deniedTools = new Set(config?.deniedTools ?? []);
  const mcp = config?.mcp ?? null;
  const permittedTools = new Map<string, ToolOrigin>();
  const mcpDefinitions = new Map<string, ToolDefinition>();

  function mcpDefinition(name: string): ToolDefinition {
    const tool = mcpDefinitions.get(name);
    if (!tool) throw new Error(`MCP tool "${name}" was not loaded`);
    return tool;
  }

  const cache: ToolCache = new Map();

  // -------------------------------------------------------------------------
  // Resolve tool from cache or DB (with fail-closed validation)
  // -------------------------------------------------------------------------
  async function resolveTool(name: string): Promise<ToolDefinition> {
    const cached = cache.get(name);
    if (cached) return cached;

    const { data, error } = await pgrestService.rpc("get_agent_tool", {
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

    const { data } = await pgrestService.rpc("has_data_sharing_consent", {
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
      await pgrestService.rpc("insert_audit_journal_entry", {
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
    } catch (err) {
      // Audit failure must not block tool execution
      log.safeError(`[toolExecutor] Audit write failed for ${tool.name}`, err);
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
        const { data, error } = await pgrestUser.rpc(tool.handler_ref, args);
        if (error) throw new Error(`RPC ${tool.handler_ref} failed: ${error.message}`);
        return JSON.stringify(data);
      }

      case "edge_function": {
        // v2: edge functions migrated to microservices — handler_ref should point to svc-* URL
        throw new Error(
          `edge_function handler type is deprecated in v2; migrate tool "${tool.name}" to handler_type="webhook" with a svc-* URL as handler_ref`,
        );
      }

      case "webhook": {
        const webhookUrl = tool.handler_ref;
        const controller = new AbortController();
        // Use tool-specific timeout from builder validation, falling back to executor default
        const effectiveTimeout = tool._validated?.timeoutMs ?? timeoutMs;
        const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

        // OWASP A10 — tool.handler_ref is admin-controlled but enters from a
        // DB row; route through SSRF guard to reject internal probes.
        const { createSsrfGuard, parseHostAllowlist } = await import('@aisha/security');
        const { config } = await import('../config.js');
        const guard = createSsrfGuard({
          service: 'svc-ai-chat',
          hostAllowlist: parseHostAllowlist(config.ssrfHostAllowlist),
          allowedSchemes: ['https:', 'http:'],
          allowInternalNetworks: true,
        });

        try {
          const response = await guard.safeFetch(webhookUrl, {
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

      case "mcp": {
        // Jen sem vede původ „mcp“ z loadToolsByNames, a ten vzniká jen s originem
        // zprostředkovaným tokenem uživatele — žádná náhrada service klíčem.
        if (!mcp) throw new Error(`MCP origin unavailable for tool "${tool.name}"`);
        const result = await mcp.call(tool.handler_ref, args);
        if (!result.ok) throw new Error(`MCP tool ${tool.handler_ref} failed: ${result.text}`);
        return result.text;
      }

      default:
        throw new Error(`Unknown handler type: ${tool.handler_type}`);
    }
  }

  // -------------------------------------------------------------------------
  // Single execution
  // -------------------------------------------------------------------------
  // IP-8 (ACS): side-effectful tools run through the readback machine
  // (propose → machine decision → execute). ACS_MODE=off → direct call,
  // zero behavioural change. Intent threading (F4) will replace the null
  // anchor with the run's canonical intent_id.
  async function execute(toolCall: ToolCall): Promise<ToolCallResult> {
    if (acsGlobalMode() === 'off') return executeCore(toolCall);
    return acsGuardToolExecution(
      { id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments },
      null,
      () => executeCore(toolCall),
    );
  }

  async function executeCore(toolCall: ToolCall): Promise<ToolCallResult> {
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

    // 0. Jen povolený a nezakázaný nástroj (K-36) — dřív než se cokoli načte z DB.
    if (!permittedTools.has(toolCall.name) || deniedTools.has(toolCall.name)) {
      const msg = deniedTools.has(toolCall.name)
        ? `Tool "${toolCall.name}" is denied for the routed agent`
        : `Tool "${toolCall.name}" is not permitted in this context`;
      await tracer.event("tool_call", toolCall.name, "internal", "permission_check", "error", Date.now() - t0, {
        errorJson: { message: msg },
      });
      return {
        toolCallId: toolCall.id,
        content: JSON.stringify({ error: msg }),
        ok: false,
        durationMs: Date.now() - t0,
      };
    }

    try {
      // 1. Resolve tool — podle původu zjištěného při načtení (K-35): nástroj MCP jen
      //    z definice, kterou dal MCP; registr agent_tools se pro něj nikdy nedotazuje.
      const tool = permittedTools.get(toolCall.name) === "mcp"
        ? mcpDefinition(toolCall.name)
        : await resolveTool(toolCall.name);

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

    const mcpTools = await loadMcpDefinitions();
    const results: ToolDefinition[] = [];
    for (const name of toolNames) {
      // Zakázaný nástroj se nenabídne ani nepovolí (K-36).
      if (deniedTools.has(name)) {
        log.safeWarn(`[toolExecutor] Tool "${name}" is denied for the routed agent, not loaded`);
        continue;
      }
      let registered: ToolDefinition | null = null;
      try {
        registered = await resolveTool(name);
      } catch {
        registered = null;
      }
      const fromMcp = mcpTools.get(name) ?? null;
      // Jméno = jeden původ (K-35). Dvojznačné jméno se nespustí ani jedním původem;
      // repo to hlídá brána nastroj-ma-jeden-puvod, tady jde o data instance.
      if (registered && fromMcp) {
        log.safeWarn(`[toolExecutor] Tool "${name}" exists in agent_tools AND MCP — ambiguous origin, not loaded`);
        await tracer.event("tool_call", name, "internal", "origin_check", "error", 0, {
          errorJson: { message: `Tool "${name}" has two origins (agent_tools, mcp)` },
        });
        continue;
      }
      const tool = registered ?? fromMcp;
      if (!tool) {
        log.safeWarn(`[toolExecutor] Tool "${name}" has no known origin (agent_tools, mcp), skipping`);
        continue;
      }
      if (fromMcp) mcpDefinitions.set(name, fromMcp);
      // Právo kanálu: povolené jméno platí i pro odložený nástroj, který se nabídne později.
      permittedTools.set(name, registered ? "agent_tools" : "mcp");
      // Skip deferred tools unless explicitly requested
      if (!includeDeferred && tool._validated?.shouldDefer) continue;
      results.push(tool);
    }
    return results;
  }

  // -------------------------------------------------------------------------
  // MCP origin (K-35): nástroje, které uživatel na MCP serveru smí. MCP je autorita
  // svých oprávnění (tools/list i tools/call pod identitou uživatele), proto tu žádný
  // vlastní stupeň přístupu ani souhlas — ten by byl jen druhá, rozjetá kopie.
  // -------------------------------------------------------------------------
  async function loadMcpDefinitions(): Promise<Map<string, ToolDefinition>> {
    const byName = new Map<string, ToolDefinition>();
    if (!mcp) return byName;
    for (const spec of await mcp.list()) {
      byName.set(spec.name, {
        id: `mcp:${spec.name}`,
        name: spec.name,
        description: spec.description,
        parameters_schema: spec.parameters,
        handler_type: "mcp",
        handler_ref: spec.name,
        access_tier_min: "none",
        requires_consent: false,
        audit_action: null,
        metadata: { origin: "mcp" },
      });
    }
    return byName;
  }

  // -------------------------------------------------------------------------
  // @deprecated Use loadToolsByNames with channel's allowed_tools instead.
  // Kept for backward compatibility during migration.
  // -------------------------------------------------------------------------
  async function loadToolsForAgent(_agentConfigId: string): Promise<ToolDefinition[]> {
    log.safeWarn("[toolExecutor] loadToolsForAgent is deprecated — use loadToolsByNames with channel allowed_tools");
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

/** Alias for legacy workflowEngine imports. */
export type ToolExecutorInstance = ToolExecutor;
