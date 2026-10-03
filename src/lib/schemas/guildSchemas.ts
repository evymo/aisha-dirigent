/**
 * Zod schemas for Guild of Experts + Expert Rules
 *
 * @module lib/schemas/guildSchemas
 */

import { z } from "zod";

// =============================================================================
// Enums
// =============================================================================

export const guildTierSchema = z.enum([
  "apprentice",
  "journeyman",
  "master",
  "grandmaster",
]);

export const expertRuleStatusSchema = z.enum([
  "draft",
  "review",
  "published",
  "archived",
]);

export const expertRuleCategorySchema = z.enum([
  "coding_standard",
  "architecture_pattern",
  "testing_strategy",
  "devops_pipeline",
  "ux_guideline",
  "api_design",
  "data_modeling",
  "security_practice",
  "performance_optimization",
  "documentation_standard",
  "project_management",
  "ai_prompt_engineering",
  "domain_knowledge",
  "integration_pattern",
  "other",
]);

export const expertRuleDocumentTypeSchema = z.enum([
  "example",
  "template",
  "checklist",
  "reference",
  "diagram",
  "snippet",
  "other",
]);

export const ruleBindingTypeSchema = z.enum([
  "instructions",
  "knowledge_source",
  "guardrail",
  "reference",
]);

// =============================================================================
// Expertise Areas
// =============================================================================

/** Expertise area in list view */
export const expertiseAreaSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name_key: z.string(),
  description_key: z.string().nullable(),
  icon: z.string().nullable(),
  parent_id: z.string().uuid().nullable(),
  sort_order: z.number(),
  member_count: z.number(),
  rule_count: z.number(),
});

export type ExpertiseArea = z.infer<typeof expertiseAreaSchema>;
export const expertiseAreaArraySchema = z.array(expertiseAreaSchema);

// =============================================================================
// Guild Members
// =============================================================================

/** Inline expertise for member list view */
export const memberExpertiseInlineSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name_key: z.string(),
  icon: z.string().nullable(),
  proficiency_level: z.number(),
  is_primary: z.boolean(),
});

/** Guild member in list view */
export const guildMemberSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  display_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  guild_tier: guildTierSchema.nullable(),
  guild_bio: z.string().nullable(),
  expertise_summary: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  certification_level: z.string().nullable(),
  is_production_provider: z.boolean().nullable(),
  guild_joined_at: z.string().nullable(),
  rules_count: z.number(),
  expertise_areas: z.array(memberExpertiseInlineSchema).default([]),
});

export type GuildMember = z.infer<typeof guildMemberSchema>;
export const guildMemberArraySchema = z.array(guildMemberSchema);

/** Detailed inline expertise (for member detail) */
export const memberExpertiseDetailSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name_key: z.string(),
  icon: z.string().nullable(),
  proficiency_level: z.number(),
  years_experience: z.number().nullable(),
  description: z.string().nullable(),
  is_primary: z.boolean(),
});

/** Published rule inline (for member detail) */
export const memberRuleInlineSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  category: z.string(),
  subscriber_count: z.number(),
  rating_avg: z.number().nullable(),
  rating_count: z.number(),
  published_at: z.string().nullable(),
});

/** Guild member detail view (from get_guild_member_detail) */
export const guildMemberDetailSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  display_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  business_name: z.string().nullable(),
  description: z.string().nullable(),
  guild_tier: guildTierSchema.nullable(),
  guild_bio: z.string().nullable(),
  expertise_summary: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  website: z.string().nullable(),
  certification_level: z.string().nullable(),
  is_production_provider: z.boolean().nullable(),
  guild_joined_at: z.string().nullable(),
  services: z.array(z.string()).nullable(),
  languages: z.array(z.string()).nullable(),
  expertise_areas: z.array(memberExpertiseDetailSchema).default([]),
  published_rules: z.array(memberRuleInlineSchema).default([]),
});

export type GuildMemberDetail = z.infer<typeof guildMemberDetailSchema>;

// =============================================================================
// Expert Rules
// =============================================================================

/** Expert rule in list view */
export const expertRuleSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  category: z.string(),
  expertise_area_slug: z.string().nullable(),
  expertise_area_name_key: z.string().nullable(),
  expertise_area_icon: z.string().nullable(),
  author_partner_id: z.string().uuid(),
  author_display_name: z.string().nullable(),
  author_avatar_url: z.string().nullable(),
  author_guild_tier: z.string().nullable(),
  is_verified: z.boolean(),
  subscriber_count: z.number(),
  usage_count: z.number(),
  rating_avg: z.number().nullable(),
  rating_count: z.number(),
  document_count: z.number(),
  ai_context_tags: z.array(z.string()).nullable(),
  published_at: z.string().nullable(),
  created_at: z.string(),
});

export type ExpertRule = z.infer<typeof expertRuleSchema>;
export const expertRuleArraySchema = z.array(expertRuleSchema);

/** Expert rule document (inside detail) */
export const expertRuleDocumentSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  file_path: z.string().nullable(),
  file_name: z.string().nullable(),
  mime_type: z.string().nullable(),
  content_markdown: z.string().nullable(),
  document_type: z.string(),
  sort_order: z.number(),
});

/** Expert rule detail (get_expert_rule_detail returns jsonb) */
export const expertRuleDetailSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  body_markdown: z.string().nullable(),
  category: z.string(),
  expertise_area_slug: z.string().nullable(),
  expertise_area_name_key: z.string().nullable(),
  expertise_area_icon: z.string().nullable(),
  author_partner_id: z.string().uuid(),
  author_display_name: z.string().nullable(),
  author_avatar_url: z.string().nullable(),
  author_guild_tier: z.string().nullable(),
  ai_instructions: z.string().nullable(),
  ai_context_tags: z.array(z.string()).nullable(),
  is_verified: z.boolean(),
  version: z.number(),
  subscriber_count: z.number(),
  usage_count: z.number(),
  rating_avg: z.number().nullable(),
  rating_count: z.number(),
  status: z.string(),
  visibility: z.string(),
  published_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  documents: z.array(expertRuleDocumentSchema).default([]),
  is_subscribed: z.boolean(),
});

export type ExpertRuleDetail = z.infer<typeof expertRuleDetailSchema>;

// =============================================================================
// Contributed Rules (partner's own)
// =============================================================================

export const contributedRuleSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  category: z.string(),
  status: z.string(),
  visibility: z.string(),
  is_verified: z.boolean(),
  subscriber_count: z.number(),
  usage_count: z.number(),
  rating_avg: z.number().nullable(),
  rating_count: z.number(),
  version: z.number(),
  published_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ContributedRule = z.infer<typeof contributedRuleSchema>;
export const contributedRuleArraySchema = z.array(contributedRuleSchema);

// =============================================================================
// Subscriptions
// =============================================================================

export const ruleSubscriptionSchema = z.object({
  id: z.string().uuid(),
  expert_rule_id: z.string().uuid(),
  rule_slug: z.string(),
  rule_title: z.string(),
  rule_summary: z.string().nullable(),
  rule_category: z.string(),
  author_display_name: z.string().nullable(),
  author_avatar_url: z.string().nullable(),
  is_verified: z.boolean(),
  subscribed_at: z.string(),
  rating_avg: z.number().nullable(),
  usage_count: z.number(),
  last_used_at: z.string().nullable(),
});

export type RuleSubscription = z.infer<typeof ruleSubscriptionSchema>;
export const ruleSubscriptionArraySchema = z.array(ruleSubscriptionSchema);

// =============================================================================
// Story Knowledge Context (StoryLoop integration)
// =============================================================================

export const storyKnowledgeContextSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  category: z.string(),
  has_ai_instructions: z.boolean(),
  ai_instructions: z.string().nullable(),
  author_display_name: z.string().nullable(),
  relevance_score: z.number(),
});

export type StoryKnowledgeContext = z.infer<typeof storyKnowledgeContextSchema>;
export const storyKnowledgeContextArraySchema = z.array(storyKnowledgeContextSchema);

// =============================================================================
// Create/Update Expert Rule Params
// =============================================================================

export const createExpertRuleParamsSchema = z.object({
  p_title: z.string().min(3).max(200),
  p_slug: z.string().min(2).max(200).regex(/^[a-z0-9-]+$/),
  p_summary: z.string().max(500).optional(),
  p_body_markdown: z.string().optional(),
  p_category: expertRuleCategorySchema.optional(),
  p_expertise_area_slug: z.string().optional(),
  p_visibility: z.enum(["public", "members", "guild"]).optional(),
  p_ai_instructions: z.string().optional(),
  p_ai_context_tags: z.array(z.string()).optional(),
});

export type CreateExpertRuleParams = z.infer<typeof createExpertRuleParamsSchema>;

export const updateExpertRuleParamsSchema = z.object({
  p_rule_id: z.string().uuid(),
  p_title: z.string().min(3).max(200).optional(),
  p_summary: z.string().max(500).optional(),
  p_body_markdown: z.string().optional(),
  p_category: expertRuleCategorySchema.optional(),
  p_expertise_area_slug: z.string().optional(),
  p_visibility: z.enum(["public", "members", "guild"]).optional(),
  p_ai_instructions: z.string().optional(),
  p_ai_context_tags: z.array(z.string()).optional(),
  p_change_note: z.string().optional(),
});

export type UpdateExpertRuleParams = z.infer<typeof updateExpertRuleParamsSchema>;

// =============================================================================
// Agent Bindings
// =============================================================================

export const agentRuleBindingSchema = z.object({
  id: z.string().uuid(),
  expert_rule_id: z.string().uuid(),
  rule_slug: z.string(),
  rule_title: z.string(),
  rule_category: z.string(),
  rule_body_markdown: z.string().nullable(),
  rule_ai_instructions: z.string().nullable(),
  rule_ai_context_tags: z.array(z.string()).nullable(),
  binding_type: z.string(),
  priority: z.number(),
  binding_config: z.record(z.unknown()).nullable(),
});

export type AgentRuleBinding = z.infer<typeof agentRuleBindingSchema>;
export const agentRuleBindingArraySchema = z.array(agentRuleBindingSchema);

// =============================================================================
// Manage Expertise Params
// =============================================================================

export const expertiseEntrySchema = z.object({
  expertise_area_slug: z.string(),
  proficiency_level: z.number().min(1).max(5),
  years_experience: z.number().nullable().optional(),
  description: z.string().nullable().optional(),
  is_primary: z.boolean().optional(),
});

export type ExpertiseEntry = z.infer<typeof expertiseEntrySchema>;
