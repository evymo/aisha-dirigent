/**
 * Zod schemas for Story Delivery Context (Phase 2 + 4).
 *
 * Covers:
 * - Story delivery metadata (repo, tech stack, domain, risk)
 * - Ruleset fingerprints & version snapshots
 * - Full delivery context aggregate (mcp_get_story_context response)
 * - Delivery state machine (transitions, allowed transitions)
 * - Story environments (preview, staging, production)
 *
 * @module
 */

import { z } from "zod";

// =====================================================
// Shared value objects
// =====================================================

/** Allowed delivery status values matching the CHECK constraint */
export const DeliveryStatusEnum = z.enum([
  "analyzing",
  "matched",
  "scaffolding",
  "ready",
  "in_progress",
  "blocked",
  "qa",
  "delivering",
  "delivered",
  "archived",
  "maintenance",
]);
export type DeliveryStatus = z.infer<typeof DeliveryStatusEnum>;

/** Allowed repository provider values matching the CHECK constraint */
export const RepoProviderEnum = z.enum(["github", "gitlab", "bitbucket", "azure_devops"]);
export type RepoProvider = z.infer<typeof RepoProviderEnum>;

/** Participant role on a story */
export const StoryParticipantRoleEnum = z.enum(["lead", "contributor", "reviewer", "observer"]);
export type StoryParticipantRole = z.infer<typeof StoryParticipantRoleEnum>;

/** Structured story project preview used by AI + UI. */
export const StoryProjectPreviewSchema = z
  .object({
    constraints: z.array(z.string()),
    goals: z.array(z.string()),
    meta: z.record(z.unknown()).optional(),
    success_criteria: z.array(z.string()),
    summary: z.string(),
  })
  .passthrough();
export type StoryProjectPreview = z.infer<typeof StoryProjectPreviewSchema>;

// =====================================================
// Ruleset
// =====================================================

export const StoryRulesetSchema = z.object({
  id: z.string().uuid(),
  story_id: z.string().uuid(),
  ruleset_fingerprint: z.string(),
  rule_ids: z.array(z.string().uuid()),
  rule_versions: z.record(z.string(), z.number()),
  context_profile: z.string().nullable().optional(),
  created_at: z.string(),
  created_by: z.string().uuid(),
});
export type StoryRuleset = z.infer<typeof StoryRulesetSchema>;

// =====================================================
// Participant
// =====================================================

export const StoryParticipantSchema = z.object({
  story_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: StoryParticipantRoleEnum,
  joined_at: z.string(),
});
export type StoryParticipant = z.infer<typeof StoryParticipantSchema>;

// =====================================================
// Delivery context (update params)
// =====================================================

export const UpdateStoryDeliveryContextRequestSchema = z.object({
  story_id: z.string().uuid(),
  repo_url: z.string().url().optional(),
  repo_provider: RepoProviderEnum.optional(),
  default_branch: z.string().optional(),
  delivery_status: DeliveryStatusEnum.optional(),
  tech_stack: z.array(z.string()).optional(),
  risk_profile: z.string().optional(),
  domain: z.array(z.string()).optional(),
  build_config: z.record(z.unknown()).optional(),
  env_hints: z.record(z.unknown()).optional(),
});
export type UpdateStoryDeliveryContextRequest = z.infer<
  typeof UpdateStoryDeliveryContextRequestSchema
>;

export const UpdateStoryProjectPreviewRequestSchema = z.object({
  project_preview: StoryProjectPreviewSchema,
  publish: z.boolean().optional(),
  story_id: z.string().uuid(),
});
export type UpdateStoryProjectPreviewRequest = z.infer<
  typeof UpdateStoryProjectPreviewRequestSchema
>;

// =====================================================
// Canvas (GrapesJS visual builder)
// =====================================================

/** GrapesJS project data stored in partner_stories.canvas_data */
export const StoryCanvasDataSchema = z
  .object({
    assets: z.array(z.unknown()).optional(),
    pages: z.array(z.unknown()).optional(),
    styles: z.array(z.unknown()).optional(),
  })
  .passthrough();
export type StoryCanvasData = z.infer<typeof StoryCanvasDataSchema>;

/** Request schema for update_story_canvas RPC */
export const UpdateStoryCanvasRequestSchema = z.object({
  canvas_css: z.string().nullish(),
  canvas_data: StoryCanvasDataSchema,
  canvas_html: z.string().nullish(),
  publish: z.boolean().optional(),
  story_id: z.string().uuid(),
});
export type UpdateStoryCanvasRequest = z.infer<typeof UpdateStoryCanvasRequestSchema>;

/** Response from update_story_canvas RPC */
export const UpdateStoryCanvasResponseSchema = z.object({
  published: z.boolean(),
  story_id: z.string().uuid(),
  updated: z.boolean(),
});
export type UpdateStoryCanvasResponse = z.infer<typeof UpdateStoryCanvasResponseSchema>;

// =====================================================
// Create ruleset request
// =====================================================

export const CreateStoryRulesetRequestSchema = z.object({
  story_id: z.string().uuid(),
  rule_ids: z.array(z.string().uuid()).min(1),
  context_profile: z.string().optional(),
});
export type CreateStoryRulesetRequest = z.infer<typeof CreateStoryRulesetRequestSchema>;

// =====================================================
// mcp_get_story_context aggregate response
// =====================================================

const StoryContextStorySchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  status: z.string(),
  delivery_status: z.string().nullable(),
  repo_url: z.string().nullable(),
  repo_provider: z.string().nullable(),
  default_branch: z.string().nullable(),
  tech_stack: z.array(z.string()).nullable(),
  domain: z.array(z.string()).nullable(),
  project_preview: StoryProjectPreviewSchema,
  risk_profile: z.string().nullable(),
  origin: z.string().nullable(),
});

const StoryContextRulesetSchema = z
  .object({
    id: z.string().uuid(),
    fingerprint: z.string(),
    rule_count: z.number().nullable(),
    context_profile: z.string().nullable(),
    rule_versions: z.record(z.string(), z.number()).nullable(),
    created_at: z.string(),
  })
  .nullable();

const StoryContextBuildConfigSchema = z
  .object({
    mcp_endpoint: z.string().nullable(),
    mcp_token_id: z.string().nullable(),
    build_config: z.record(z.unknown()).nullable(),
    env_hints: z.record(z.unknown()).nullable(),
  })
  .nullable();

const StoryContextParticipantSchema = z.object({
  user_id: z.string().uuid(),
  role: z.string(),
  joined_at: z.string(),
});

const StoryContextRulePreviewSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  version: z.number(),
  expertise_area: z.string().nullable(),
});

export const StoryDeliveryContextSchema = z.object({
  story: StoryContextStorySchema,
  project_preview: StoryProjectPreviewSchema,
  ruleset: StoryContextRulesetSchema,
  build_config: StoryContextBuildConfigSchema,
  participants: z.array(StoryContextParticipantSchema),
  rules_preview: z.array(StoryContextRulePreviewSchema),
});
export type StoryDeliveryContext = z.infer<typeof StoryDeliveryContextSchema>;

// =====================================================
// Delivery State Machine (Phase 4.1)
// =====================================================

/** Trigger source for delivery transitions */
export const TriggerSourceEnum = z.enum([
  "manual",
  "workflow",
  "webhook",
  "extension",
  "system",
]);
export type TriggerSource = z.infer<typeof TriggerSourceEnum>;

/** A recorded delivery status transition */
export const DeliveryTransitionSchema = z.object({
  id: z.string().uuid(),
  from_status: z.string().nullable(),
  to_status: z.string(),
  triggered_by: z.string().uuid().nullable(),
  trigger_source: TriggerSourceEnum,
  metadata: z.record(z.unknown()).nullable(),
  created_at: z.string(),
  triggered_by_email: z.string().nullable().optional(),
});
export type DeliveryTransition = z.infer<typeof DeliveryTransitionSchema>;

/** Allowed transition from current state */
export const AllowedTransitionSchema = z.object({
  to_status: z.string(),
  requires_role: z.string().nullable(),
});
export type AllowedTransition = z.infer<typeof AllowedTransitionSchema>;

/** Result of transition_story_delivery_status RPC */
export const TransitionResultSchema = z.object({
  success: z.boolean(),
  transition_id: z.string().uuid().optional(),
  from_status: z.string().nullable().optional(),
  to_status: z.string().optional(),
  story_id: z.string().uuid().optional(),
  error: z.string().optional(),
  current_status: z.string().nullable().optional(),
});
export type TransitionResult = z.infer<typeof TransitionResultSchema>;

// =====================================================
// Story Environments (Phase 4.2)
// =====================================================

/** Environment types for story deployments */
export const EnvironmentTypeEnum = z.enum(["preview", "staging", "production"]);
export type EnvironmentType = z.infer<typeof EnvironmentTypeEnum>;

/** Deploy provider */
export const DeployProviderEnum = z.enum([
  "coolify",
  "vercel",
  "netlify",
  "manual",
  "other",
]);
export type DeployProvider = z.infer<typeof DeployProviderEnum>;

/** Deploy status */
export const DeployStatusEnum = z.enum([
  "pending",
  "building",
  "deployed",
  "failed",
  "stopped",
]);
export type DeployStatus = z.infer<typeof DeployStatusEnum>;

/** A story environment record */
export const StoryEnvironmentSchema = z.object({
  id: z.string().uuid(),
  environment: EnvironmentTypeEnum,
  url: z.string().nullable(),
  branch: z.string().nullable(),
  deploy_provider: DeployProviderEnum.nullable(),
  deploy_id: z.string().nullable(),
  deploy_status: DeployStatusEnum.nullable(),
  last_deployed_at: z.string().nullable(),
  config: z.record(z.unknown()).nullable(),
  created_at: z.string(),
});
export type StoryEnvironment = z.infer<typeof StoryEnvironmentSchema>;
