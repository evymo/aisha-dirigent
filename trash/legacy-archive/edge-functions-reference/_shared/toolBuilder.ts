/**
 * Tool Builder — Type-safe factory with fail-closed security defaults.
 *
 * Provides a builder pattern for defining AI agent tools with secure defaults.
 * Every tool starts with the most restrictive configuration (consent required,
 * audit required, low timeout, read-only false) and must be explicitly relaxed.
 *
 * Inspired by Claude Code's `buildTool()` pattern with `TOOL_DEFAULTS` where
 * `isConcurrencySafe → false`, `isReadOnly → false`. Adapted for AISHA's
 * DB-backed tool registry with additional consent/audit/tier requirements.
 *
 * Usage:
 *   import { buildTool, validateToolDefinition } from "../_shared/toolBuilder.ts";
 *
 *   const myTool = buildTool("search_knowledge_base")
 *     .description("Search the knowledge base for relevant content")
 *     .handler("rpc", "search_knowledge_v2")
 *     .inputSchema({ type: "object", properties: { query: { type: "string" } }, required: ["query"] })
 *     .noConsentRequired()    // explicit opt-out of consent check
 *     .noAuditRequired()      // explicit opt-out of audit
 *     .accessTier("basic")    // lower from default "qualified"
 *     .timeout(10_000)        // reduce from default 30s
 *     .build();
 *
 * @module
 */

// =============================================================================
// Types
// =============================================================================

/** Supported tool handler dispatch types. */
export type ToolHandlerType = "rpc" | "edge_function" | "webhook";

/** JSON Schema subset for tool input parameters. */
export interface ToolInputSchema {
  type: "object";
  properties?: Record<string, Record<string, unknown>>;
  required?: string[];
}

/**
 * Complete tool definition produced by the builder.
 * Superset of the DB `agent_tools` row with additional builder metadata.
 */
export interface BuiltToolDefinition {
  /** Tool name (unique identifier). */
  name: string;
  /** Human-readable description for LLM tool selection. */
  description: string;
  /** JSON Schema for input validation. */
  parametersSchema: ToolInputSchema;
  /** Dispatch type: RPC, edge function, or webhook. */
  handlerType: ToolHandlerType;
  /** Handler reference (function name, URL, etc.). */
  handlerRef: string;
  /** Minimum access tier required to use this tool. */
  accessTierMin: string;
  /** Whether user consent is required before execution. */
  requiresConsent: boolean;
  /** Audit action to log (null = no audit). */
  auditAction: string | null;
  /** Maximum execution time in milliseconds. */
  timeoutMs: number;
  /** Whether this tool is read-only (safe for concurrent execution). */
  isReadOnly: boolean;
  /** Whether this tool should be deferred (lazy-loaded on demand). */
  shouldDefer: boolean;
  /** Tool category for grouping/filtering. */
  category: string;
  /** Additional metadata. */
  metadata: Record<string, unknown>;
}

/**
 * Validation result for a tool definition loaded from the database.
 */
export interface ToolValidationResult {
  /** Whether the tool definition is valid. */
  valid: boolean;
  /** Validation errors (empty if valid). */
  errors: string[];
  /** The validated definition with defaults applied (null if invalid). */
  definition: BuiltToolDefinition | null;
}

// =============================================================================
// Fail-Closed Defaults
// =============================================================================

/**
 * Default configuration for all tools. Every default is the MOST RESTRICTIVE
 * option — builders must explicitly opt out of restrictions.
 *
 * This is the "fail-closed" principle: if a developer forgets to configure
 * something, the tool is maximally restricted rather than open.
 */
const TOOL_DEFAULTS = {
  /** Require consent by default — explicit opt-out needed. */
  requiresConsent: true,
  /** Require audit by default — generates audit_action from tool name. */
  auditRequired: true,
  /** Default minimum access tier — qualified users only. */
  accessTierMin: "qualified",
  /** Conservative timeout — 30 seconds. */
  timeoutMs: 30_000,
  /** Not read-only by default (safest assumption). */
  isReadOnly: false,
  /** Not deferred by default — always loaded. */
  shouldDefer: false,
  /** Default category. */
  category: "general",
} as const;

// =============================================================================
// Builder
// =============================================================================

/** Intermediate builder state. */
interface ToolBuilderState {
  name: string;
  description: string | null;
  parametersSchema: ToolInputSchema | null;
  handlerType: ToolHandlerType | null;
  handlerRef: string | null;
  accessTierMin: string;
  requiresConsent: boolean;
  auditAction: string | null;
  auditRequired: boolean;
  timeoutMs: number;
  isReadOnly: boolean;
  shouldDefer: boolean;
  category: string;
  metadata: Record<string, unknown>;
}

/**
 * Fluent builder for tool definitions.
 *
 * Starts with fail-closed defaults. Each method returns `this` for chaining.
 * Call `.build()` to produce the final `BuiltToolDefinition`.
 *
 * @throws Error if required fields (description, handler) are missing at build time.
 */
export class ToolBuilder {
  private state: ToolBuilderState;

  constructor(name: string) {
    this.state = {
      name,
      description: null,
      parametersSchema: null,
      handlerType: null,
      handlerRef: null,
      accessTierMin: TOOL_DEFAULTS.accessTierMin,
      requiresConsent: TOOL_DEFAULTS.requiresConsent,
      auditAction: null,
      auditRequired: TOOL_DEFAULTS.auditRequired,
      timeoutMs: TOOL_DEFAULTS.timeoutMs,
      isReadOnly: TOOL_DEFAULTS.isReadOnly,
      shouldDefer: TOOL_DEFAULTS.shouldDefer,
      category: TOOL_DEFAULTS.category,
      metadata: {},
    };
  }

  /** Set tool description (required). */
  description(desc: string): this {
    this.state.description = desc;
    return this;
  }

  /** Set handler type and reference (required). */
  handler(type: ToolHandlerType, ref: string): this {
    this.state.handlerType = type;
    this.state.handlerRef = ref;
    return this;
  }

  /** Set input parameter JSON Schema. */
  inputSchema(schema: ToolInputSchema): this {
    this.state.parametersSchema = schema;
    return this;
  }

  /** Set minimum access tier. Default: "qualified". */
  accessTier(tier: string): this {
    this.state.accessTierMin = tier;
    return this;
  }

  /** Explicitly disable consent requirement. */
  noConsentRequired(): this {
    this.state.requiresConsent = false;
    return this;
  }

  /** Explicitly disable audit logging. */
  noAuditRequired(): this {
    this.state.auditRequired = false;
    return this;
  }

  /** Set custom audit action name. */
  auditAction(action: string): this {
    this.state.auditAction = action;
    this.state.auditRequired = true;
    return this;
  }

  /** Set maximum execution timeout in milliseconds. Default: 30000. */
  timeout(ms: number): this {
    this.state.timeoutMs = ms;
    return this;
  }

  /** Mark tool as read-only (safe for concurrent execution). */
  readOnly(): this {
    this.state.isReadOnly = true;
    return this;
  }

  /** Mark tool as deferred (lazy-loaded only when searched/needed). */
  deferred(): this {
    this.state.shouldDefer = true;
    return this;
  }

  /** Set tool category for grouping. */
  forCategory(cat: string): this {
    this.state.category = cat;
    return this;
  }

  /** Add metadata key-value pair. */
  meta(key: string, value: unknown): this {
    this.state.metadata[key] = value;
    return this;
  }

  /**
   * Build the final tool definition.
   * @throws Error if required fields are missing.
   */
  build(): BuiltToolDefinition {
    if (!this.state.description) {
      throw new Error(`[toolBuilder] Tool "${this.state.name}" missing description`);
    }
    if (!this.state.handlerType || !this.state.handlerRef) {
      throw new Error(`[toolBuilder] Tool "${this.state.name}" missing handler`);
    }

    // Auto-generate audit action from tool name if audit is required but no custom action
    const auditAction = this.state.auditRequired
      ? this.state.auditAction ?? `TOOL_${this.state.name.toUpperCase()}`
      : null;

    return {
      name: this.state.name,
      description: this.state.description,
      parametersSchema: this.state.parametersSchema ?? { type: "object" },
      handlerType: this.state.handlerType,
      handlerRef: this.state.handlerRef,
      accessTierMin: this.state.accessTierMin,
      requiresConsent: this.state.requiresConsent,
      auditAction,
      timeoutMs: this.state.timeoutMs,
      isReadOnly: this.state.isReadOnly,
      shouldDefer: this.state.shouldDefer,
      category: this.state.category,
      metadata: this.state.metadata,
    };
  }
}

/**
 * Create a new tool builder.
 *
 * @param name - Unique tool name (must match `agent_tools.name` in DB).
 * @returns Fluent builder with fail-closed defaults.
 */
export function buildTool(name: string): ToolBuilder {
  return new ToolBuilder(name);
}

// =============================================================================
// DB Tool Validation
// =============================================================================

/** Valid access tiers (must match toolExecutor ACCESS_TIER_ORDER). */
const VALID_ACCESS_TIERS = new Set([
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
]);

/** Valid handler types. */
const VALID_HANDLER_TYPES = new Set(["rpc", "edge_function", "webhook"]);

/**
 * Validate a tool definition loaded from the database.
 *
 * Applies fail-closed defaults for any missing fields and validates
 * the structure matches expectations. Returns a normalized
 * `BuiltToolDefinition` with all defaults applied.
 *
 * @param raw - Raw tool data from the DB (e.g., from `get_agent_tool` RPC).
 * @returns Validation result with normalized definition or errors.
 */
export function validateToolDefinition(
  raw: Record<string, unknown>,
): ToolValidationResult {
  const errors: string[] = [];

  // Required fields
  const name = raw.name as string | undefined;
  if (!name || typeof name !== "string") {
    errors.push("Missing or invalid 'name'");
  }

  const description = raw.description as string | undefined;
  if (!description || typeof description !== "string") {
    errors.push("Missing or invalid 'description'");
  }

  const handlerType = raw.handler_type as string | undefined;
  if (!handlerType || !VALID_HANDLER_TYPES.has(handlerType)) {
    errors.push(`Invalid handler_type: ${handlerType}`);
  }

  const handlerRef = raw.handler_ref as string | undefined;
  if (!handlerRef || typeof handlerRef !== "string") {
    errors.push("Missing or invalid 'handler_ref'");
  }

  if (errors.length > 0) {
    return { valid: false, errors, definition: null };
  }

  // Optional fields with fail-closed defaults
  const accessTierMin = raw.access_tier_min as string | undefined;
  const resolvedTier = accessTierMin && VALID_ACCESS_TIERS.has(accessTierMin)
    ? accessTierMin
    : TOOL_DEFAULTS.accessTierMin;

  const requiresConsent = typeof raw.requires_consent === "boolean"
    ? raw.requires_consent
    : TOOL_DEFAULTS.requiresConsent;

  const auditAction = typeof raw.audit_action === "string"
    ? raw.audit_action
    : `TOOL_${(name as string).toUpperCase()}`;

  const parametersSchema = raw.parameters_schema as ToolInputSchema | undefined;

  const metadata = typeof raw.metadata === "object" && raw.metadata !== null
    ? raw.metadata as Record<string, unknown>
    : {};

  const shouldDefer = typeof raw.should_defer === "boolean"
    ? raw.should_defer
    : TOOL_DEFAULTS.shouldDefer;

  const isReadOnly = typeof raw.is_read_only === "boolean"
    ? raw.is_read_only
    : TOOL_DEFAULTS.isReadOnly;

  const timeoutMs = typeof raw.timeout_ms === "number" && raw.timeout_ms > 0
    ? raw.timeout_ms
    : TOOL_DEFAULTS.timeoutMs;

  const category = typeof raw.category === "string"
    ? raw.category
    : TOOL_DEFAULTS.category;

  return {
    valid: true,
    errors: [],
    definition: {
      name: name as string,
      description: description as string,
      parametersSchema: parametersSchema ?? { type: "object" },
      handlerType: handlerType as ToolHandlerType,
      handlerRef: handlerRef as string,
      accessTierMin: resolvedTier,
      requiresConsent,
      auditAction,
      timeoutMs,
      isReadOnly,
      shouldDefer,
      category,
      metadata,
    },
  };
}

/**
 * Convert a `BuiltToolDefinition` to OpenAI function calling format.
 */
export function toOpenAISpec(def: BuiltToolDefinition): {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
} {
  return {
    type: "function",
    function: {
      name: def.name,
      description: def.description,
      parameters: def.parametersSchema as Record<string, unknown>,
    },
  };
}

/**
 * Convert a `BuiltToolDefinition` to the DB `agent_tools` row shape.
 * Useful for seeding or syncing tool definitions from code to DB.
 */
export function toDbRow(def: BuiltToolDefinition): Record<string, unknown> {
  return {
    name: def.name,
    description: def.description,
    parameters_schema: def.parametersSchema,
    handler_type: def.handlerType,
    handler_ref: def.handlerRef,
    access_tier_min: def.accessTierMin,
    requires_consent: def.requiresConsent,
    audit_action: def.auditAction,
    metadata: {
      ...def.metadata,
      is_read_only: def.isReadOnly,
      should_defer: def.shouldDefer,
      category: def.category,
      timeout_ms: def.timeoutMs,
    },
  };
}
