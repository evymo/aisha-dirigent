/**
 * Plugin System Zod Schemas
 *
 * Runtime validation schemas for the AISHA plugin framework.
 * Used by hooks, edge functions, and CLI for consistent validation.
 *
 * @module lib/schemas/pluginSchemas
 */

import { z } from "zod";

// =============================================================================
// Enums
// =============================================================================

/** Plugin kind enum. */
export const pluginKindSchema = z.enum([
  "web_tracking",
  "auth_provider",
  "backend_provider",
  "automation_node",
  "full_stack",
  // Agent marketplace: a published agent. Declarative (run-as-story, no code
  // artifact) or executable (call-mode, Phase 2). See install_agent_as_story.
  "agent",
  // Datový zdroj (konektor) — materialize_data_source. ⛔ 2026-09-16: v JSON
  // schématu i DB enumu už byl, tady chyběl a tři dodávané manifesty neprošly.
  // Shodu tří zdrojů hlídá brána plugin-manifest-projde-schematem.
  "data_source",
]);

/** Plugin trust tier enum. */
export const pluginTrustTierSchema = z.enum([
  "internal",
  "partner",
  "external",
]);

/** Plugin lifecycle status enum. */
export const pluginStatusSchema = z.enum([
  "submitted",
  "reviewing",
  "sandbox_testing",
  "approved",
  "canary",
  "ga",
  "disabled",
  "archived",
]);

/** Plugin load strategy enum. */
export const pluginLoadStrategySchema = z.enum(["hot", "cold"]);

/** Plugin health event kind enum. */
export const pluginHealthEventKindSchema = z.enum([
  "load",
  "invoke",
  "error",
  "timeout",
  "rollback",
  "patch",
]);

// =============================================================================
// Sandbox Policy
// =============================================================================

/** Sandbox policy from manifest. */
export const pluginSandboxPolicySchema = z.object({
  timeout_ms: z.number().int().min(100).max(30000).default(5000),
  network_allowlist: z.array(z.string()).default([]),
  max_memory_mb: z.number().int().min(8).max(256).default(64),
  /** RPC, která plugin smí z sandboxu volat (broker je čte ze schválené politiky). */
  rpc_allowlist: z.array(z.string()).default([]),
});

// =============================================================================
// Plugin Manifest
// =============================================================================

/** Config schema field definition. */
/**
 * Jedno pole konfigurace pluginu.
 *
 * ⛔ NAMĚŘENO 2026-09-16: schéma čekalo mapu polí s `required: boolean` u pole,
 * ale všechny dodávané manifesty i DB funkce (activate_data_source,
 * get_data_source_secret_status, set_data_source_secrets) pracují s JSON Schema
 * objektem `{ type: 'object', required: [...], properties: {...} }` a pověření
 * poznají podle `secret: true`. Žádný manifest schématem neprošel. `.strict()`:
 * neznámý klíč je chyba, ne tiché zahození (zod by jinak `secret` odřízl).
 */
const configFieldSchema = z
  .object({
    type: z.enum(["string", "number", "integer", "boolean"]),
    description: z.string().optional(),
    default: z.unknown().optional(),
    secret: z.boolean().optional(),
  })
  .strict();

/** Konfigurace pluginu pro tenanta — JSON Schema objekt, jak ho čte DB. */
export const pluginConfigSchemaSchema = z
  .object({
    type: z.literal("object"),
    required: z.array(z.string()).optional(),
    properties: z.record(z.string(), configFieldSchema),
  })
  .strict();

/** Plugin lifecycle entry points. */
export const pluginLifecycleSchema = z.object({
  web_entry: z.string().optional(),
  backend_entry: z.string().optional(),
  n8n_entry: z.string().optional(),
  migrations_dir: z.string().optional(),
  load_strategy: pluginLoadStrategySchema.default("hot"),
});

/** Plugin dependency declarations. */
/**
 * PŘÍMÉ npm závislosti zdroje pluginu (balík → verze).
 * ⛔ 2026-09-16: tvar `{plugins, stack, capabilities_required}` nikdo nečetl;
 * jediný konzument, scripts/plugins/build.mjs, bere `dependencies` jako mapu
 * balíků a porovnává ji s tím, co bundler skutečně zabalil.
 */
export const pluginDependenciesSchema = z.record(z.string(), z.string());

/** Router model keys a marketplace agent may request (NOT raw provider ids). */
export const agentModelKeySchema = z.enum(["fast", "balanced", "maxQuality"]);

/**
 * Agent declarative spec (kind='agent').
 *
 * Run-as-story template: published expert-rule slugs + optional knowledge items +
 * story defaults — install_agent_as_story mints a consumer-owned story from this.
 * Runtime registry keys (purpose/default_model/allowed_tools/…) —
 * materialize_agent_runtime projects these into an agent_catalog row so route_task
 * can route to the agent (call-mode). Absent for executable agents (Phase 2).
 */
export const agentStorySpecSchema = z.object({
  /** Published expert_rule slugs composed into the installed story's ruleset. */
  rule_slugs: z.array(z.string()).default([]),
  // ── runtime registry keys (call-mode; consumed by materialize_agent_runtime) ──
  /** Short purpose line for the agent_catalog row. */
  purpose: z.string().max(500).optional(),
  /** Router model KEY (fast|balanced|maxQuality) — never a raw provider model id. */
  default_model: agentModelKeySchema.optional(),
  /** Per-task-kind model key overrides. */
  model_overrides: z.record(z.string(), agentModelKeySchema).optional(),
  /** Tool slugs the agent may use. */
  allowed_tools: z.array(z.string()).optional(),
  /** Tool slugs the agent may never use. */
  denied_tools: z.array(z.string()).optional(),
  /** Loop safety bound. */
  max_loops: z.number().int().min(1).max(10).optional(),
  /** Safety posture (standard|elevated|critical). */
  safety_level: z.enum(["standard", "elevated", "critical"]).optional(),
  /** Autonomy (manual forces human approval in route_task). */
  autonomy_level: z.enum(["manual", "semi", "full"]).optional(),
  /** Knowledge items hydrated under the new (consumer-owned) story_id. */
  knowledge_items: z
    .array(
      z.object({
        title: z.string().max(256),
        body_markdown: z.string(),
        summary: z.string().optional(),
        item_type: z
          .enum([
            "expert_rule",
            "engineering_doc",
            "domain_doc",
            "playbook",
            "case_study",
            "personality_trait",
            "core_value",
          ])
          .default("domain_doc"),
        ai_context_tags: z.array(z.string()).optional(),
      }),
    )
    .default([]),
  /** Story context profile (defaults to repo_plus_rules). */
  context_profile: z.string().optional(),
  tech_stack: z.array(z.string()).optional(),
  domain: z.array(z.string()).optional(),
  risk_profile: z.string().optional(),
  build_config: z.record(z.string(), z.unknown()).optional(),
});

/** Full plugin manifest schema — validates CLI submit input. */
export const pluginManifestSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/),
  version: z
    .string()
    // eslint-disable-next-line security/detect-unsafe-regex -- semver, optional group enters via literal '-' not in \d — unambiguous
    .regex(/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/),
  name: z.string().max(128).optional(),
  description: z.string().max(1000).optional(),
  author: z.string().max(128).optional(),
  kind: pluginKindSchema,
  trust_tier: pluginTrustTierSchema,
  capabilities: z
    // Mirror plugin-manifest.schema.json's authoritative `^[a-z]+\..+$` contract
    // (lowercase prefix + dot + remainder) — the single source of truth for the
    // capability grammar. Accepts agent capabilities like `agent.run_as_story`
    // alongside plugin capabilities like `http.get.metrics`. (Was 3-segment-only,
    // which rejected valid 2-segment agent capabilities.)
    .array(z.string().regex(/^[a-z]+\..+$/))
    .min(1),
  config_schema: pluginConfigSchemaSchema.optional(),
  lifecycle: pluginLifecycleSchema,
  sandbox: pluginSandboxPolicySchema.optional(),
  dependencies: pluginDependenciesSchema.optional(),
  /** Run-as-story template — present only for kind='agent' declarative agents. */
  agent_spec: agentStorySpecSchema.optional(),
});

// =============================================================================
// Plugin Catalog (DB row shape)
// =============================================================================

/** Plugin catalog entry — returned by get_available_plugins RPC. */
export const pluginCatalogSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  kind: pluginKindSchema,
  trust_tier: pluginTrustTierSchema,
  status: pluginStatusSchema,
  capabilities: z.array(z.string()),
  config_schema: z.record(z.string(), z.unknown()).nullable(),
  sandbox_policy: pluginSandboxPolicySchema.nullable(),
  author_partner_id: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

/** Plugin version — returned alongside catalog entry. */
export const pluginVersionSchema = z.object({
  id: z.string().uuid(),
  plugin_id: z.string().uuid(),
  version: z.string(),
  artifact_sha256: z.string(),
  artifact_url: z.string(),
  changelog: z.string().nullable(),
  resolved_deps: z.record(z.string(), z.unknown()).nullable(),
  submitted_by: z.string().uuid().nullable(),
  reviewed_by: z.string().uuid().nullable(),
  reviewed_at: z.string().nullable(),
  created_at: z.string(),
});

// =============================================================================
// Plugin Config (resolved for runtime)
// =============================================================================

/** Effective plugin config — merged global + tenant override. */
export const effectivePluginConfigSchema = z.object({
  plugin_id: z.string().uuid(),
  slug: z.string(),
  kind: pluginKindSchema,
  trust_tier: pluginTrustTierSchema,
  status: pluginStatusSchema,
  capabilities: z.array(z.string()),
  config: z.record(z.string(), z.unknown()),
  sandbox: pluginSandboxPolicySchema,
  load_strategy: pluginLoadStrategySchema,
  artifact_url: z.string(),
  artifact_sha256: z.string(),
  version: z.string(),
});

// =============================================================================
// Plugin Health Summary
// =============================================================================

/** Health summary — returned by get_plugin_health_summary RPC. */
export const pluginHealthSummarySchema = z.object({
  plugin_id: z.string().uuid(),
  total_invocations: z.number().int(),
  error_count: z.number().int(),
  error_rate: z.number(),
  p95_latency_ms: z.number(),
  last_error: z.string().nullable(),
  period_hours: z.number(),
});

// =============================================================================
// Type Inference
// =============================================================================

/** Plugin manifest type. */
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

/** Agent run-as-story template type. */
export type AgentStorySpec = z.infer<typeof agentStorySpecSchema>;

/** Plugin catalog entry type. */
export type PluginCatalogEntry = z.infer<typeof pluginCatalogSchema>;

/** Plugin version type. */
export type PluginVersion = z.infer<typeof pluginVersionSchema>;

/** Effective plugin config type. */
export type EffectivePluginConfig = z.infer<typeof effectivePluginConfigSchema>;

/** Plugin health summary type. */
export type PluginHealthSummary = z.infer<typeof pluginHealthSummarySchema>;

// =============================================================================
// Sandbox Context Schemas (for validation of plugin ↔ host messages)
// =============================================================================

/** Sandbox RPC call request. */
export const sandboxRpcRequestSchema = z.object({
  type: z.literal("rpc"),
  function_name: z.string().regex(/^[a-z_][a-z0-9_]{1,62}$/),
  params: z.record(z.string(), z.unknown()),
});

/** Sandbox KV operation request. */
export const sandboxKvRequestSchema = z.object({
  type: z.literal("kv"),
  op: z.enum(["get", "set", "delete", "list"]),
  key: z.string().max(512).optional(),
  prefix: z.string().max(512).optional(),
  value: z.unknown().optional(),
});

/** Sandbox storage operation request. */
export const sandboxStorageRequestSchema = z.object({
  type: z.literal("storage"),
  op: z.enum(["get", "put", "delete", "list"]),
  key: z.string().max(1024).optional(),
  prefix: z.string().max(1024).optional(),
  content_type: z.string().max(128).optional(),
});

/** Sandbox LLM inference request. */
export const sandboxLlmRequestSchema = z.object({
  type: z.literal("llm"),
  op: z.enum(["chat", "embed"]),
  messages: z.array(z.object({
    role: z.enum(["system", "user", "assistant"]),
    content: z.string(),
  })).optional(),
  text: z.string().optional(),
  options: z.object({
    model: z.string().optional(),
    max_tokens: z.number().int().min(1).max(32768).optional(),
    temperature: z.number().min(0).max(2).optional(),
  }).optional(),
});

/** Sandbox event bus request. */
export const sandboxEventRequestSchema = z.object({
  type: z.literal("event"),
  op: z.enum(["publish", "subscribe"]),
  topic: z.string().regex(/^[a-z][a-z0-9_.]{1,126}[a-z0-9]$/),
  payload: z.unknown().optional(),
});

/** Sandbox notification request. */
export const sandboxNotifyRequestSchema = z.object({
  type: z.literal("notify"),
  user_id: z.string().uuid(),
  channel: z.enum(["in_app", "email", "push"]),
  title: z.string().max(200),
  body: z.string().max(2000),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/** Sandbox outbound fetch request. */
export const sandboxFetchRequestSchema = z.object({
  type: z.literal("fetch"),
  url: z.string().url(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]).default("GET"),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
});

/** Union of all sandbox API requests (host validates incoming messages). */
export const sandboxApiRequestSchema = z.discriminatedUnion("type", [
  sandboxRpcRequestSchema,
  sandboxKvRequestSchema,
  sandboxStorageRequestSchema,
  sandboxLlmRequestSchema,
  sandboxEventRequestSchema,
  sandboxNotifyRequestSchema,
  sandboxFetchRequestSchema,
]);

/** Sandbox API request type. */
export type SandboxApiRequest = z.infer<typeof sandboxApiRequestSchema>;
