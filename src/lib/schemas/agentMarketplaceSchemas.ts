/**
 * Zod schemas for the agent marketplace (Phase 1).
 *
 * A published agent is a plugin_catalog row with kind='agent'. The listing comes
 * from get_available_plugins(p_kind='agent') (canary/ga only); installing one
 * mints a consumer-owned story via install_agent_as_story.
 *
 * Per-type schema (no shared "marketplace listing" abstraction — the platform
 * keeps per-type silos; mirrors guildSchemas).
 *
 * @module lib/schemas/agentMarketplaceSchemas
 */

import { z } from "zod";

/** A marketplace agent as returned by get_available_plugins (kind='agent'). */
export const availableAgentSchema = z.object({
  plugin_id: z.string().uuid(),
  slug: z.string(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  kind: z.string(),
  trust_tier: z.string(),
  status: z.string(),
  capabilities: z.array(z.string()).default([]),
  version: z.string().nullable().optional(),
});

export type AvailableAgent = z.infer<typeof availableAgentSchema>;

/** Result of install_agent_as_story — the minted consumer-owned story. */
export const agentInstallResultSchema = z.object({
  story_id: z.string().uuid(),
  ruleset_id: z.string().uuid().nullable(),
  plugin_id: z.string().uuid(),
  slug: z.string(),
  rule_count: z.number(),
  kb_count: z.number(),
});

export type AgentInstallResult = z.infer<typeof agentInstallResultSchema>;

/** Parameters for installing an agent as a story. */
export interface InstallAgentParams {
  pluginId: string;
  /** Optional partner identity the caller owns; null for a plain member install. */
  partnerId?: string | null;
  /** Optional story title override. */
  title?: string | null;
}

// =============================================================================
// Partner publish side (a certified member authors + submits an agent)
// =============================================================================

/**
 * The declarative agent definition (plugin_catalog.agent_spec). Free-form jsonb
 * on the server (the runtime reads a stable set of keys); we validate the fields
 * the publish form manages and `.passthrough()` the rest so editing an agent
 * round-trips keys the form does not surface (knowledge_items, model_overrides,
 * context_profile, denied_tools, …).
 */
export const agentSpecSchema = z
  .object({
    version: z.string().optional(),
    purpose: z.string().optional(),
    system_prompt: z.string().optional(),
    default_model: z.string().optional(),
    rule_slugs: z.array(z.string()).optional(),
    allowed_tools: z.array(z.string()).optional(),
    max_loops: z.number().int().nonnegative().optional(),
    safety_level: z.string().optional(),
  })
  .passthrough();

export type AgentSpec = z.infer<typeof agentSpecSchema>;

/**
 * A partner's OWN agent as returned by get_my_agents — any lifecycle status,
 * with agent_spec hydrated for the edit form. Distinct from AvailableAgent
 * (the consumer listing) which is canary/ga only and omits agent_spec.
 */
export const myAgentSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  kind: z.string(),
  trust_tier: z.string(),
  status: z.string(),
  capabilities: z.array(z.string()).default([]),
  agent_spec: agentSpecSchema.nullable(),
  author: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type MyAgent = z.infer<typeof myAgentSchema>;

/** Result of submit_plugin for an agent (declarative → version_id is null). */
export const submitAgentResultSchema = z.object({
  plugin_id: z.string().uuid(),
  version_id: z.string().uuid().nullable(),
  slug: z.string(),
  version: z.string(),
  kind: z.string(),
  status: z.string(),
});

export type SubmitAgentResult = z.infer<typeof submitAgentResultSchema>;

/** Result of publish_agent — enqueued for compliance review. */
export const publishAgentResultSchema = z.object({
  status: z.string(),
  queue_id: z.string().uuid(),
  message: z.string(),
});

export type PublishAgentResult = z.infer<typeof publishAgentResultSchema>;

/**
 * Parameters for submit_plugin. The manifest is the full agent manifest
 * ({ id, version, kind:'agent', name, description, capabilities, agent_spec,
 * lifecycle }). A declarative run-as-story agent carries no code artifact, so
 * both artifact fields default to null.
 */
export interface SubmitAgentParams {
  manifest: Record<string, unknown>;
  artifactSha256?: string | null;
  artifactUrl?: string | null;
}
