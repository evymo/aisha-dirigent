/**
 * Zod validation schemas for collaboration network RPC responses
 *
 * Covers: story_links CRUD, collaboration_preferences, cross-story summaries,
 * and the story graph traversal.
 */

import { z } from "zod";

// ==========================================
// Enums
// ==========================================

export const linkTypeEnum = z.enum([
  "depends_on",
  "related_to",
  "blocks",
  "extends",
  "shares_context",
]);

export const linkDirectionEnum = z.enum([
  "forward",
  "backward",
  "bidirectional",
]);

export const collabModeEnum = z.enum([
  "silent",
  "digest",
  "notify",
  "interactive",
  "autopilot",
]);

export const severityEnum = z.enum(["low", "medium", "high", "critical"]);

export const autopilotRiskEnum = z.enum(["low", "medium"]);

// ==========================================
// Story Links Schemas
// ==========================================

/** Schema for a single linked story item returned by get_linked_stories */
export const linkedStorySchema = z.object({
  link_id: z.string().uuid(),
  link_type: linkTypeEnum,
  link_direction: linkDirectionEnum,
  is_accepted: z.boolean().nullable(),
  confidence_score: z.number().nullable(),
  created_by_agent: z.string().nullable(),
  link_created_at: z.string(),
  linked_story_id: z.string().uuid(),
  direction: z.enum(["outgoing", "incoming"]),
  linked_story_title: z.string().nullable(),
  linked_delivery_status: z.string().nullable(),
  linked_tech_stack: z.array(z.string()).nullable(),
  linked_domain: z.array(z.string()).nullable(),
  linked_participant_count: z.number().int(),
});

export type LinkedStory = z.infer<typeof linkedStorySchema>;
export const linkedStoriesArraySchema = z.array(linkedStorySchema);

/** Schema for create_story_link response */
export const createStoryLinkResponseSchema = z.object({
  id: z.string().uuid(),
  source_story_id: z.string().uuid(),
  target_story_id: z.string().uuid(),
  link_type: linkTypeEnum,
  is_accepted: z.boolean().nullable(),
  created: z.boolean(),
});

export type CreateStoryLinkResponse = z.infer<typeof createStoryLinkResponseSchema>;

/** Schema for accept/dismiss story link response */
export const storyLinkActionResponseSchema = z.object({
  id: z.string().uuid(),
  is_accepted: z.boolean().optional(),
  already_accepted: z.boolean().optional(),
  updated: z.boolean().optional(),
});

export type StoryLinkActionResponse = z.infer<typeof storyLinkActionResponseSchema>;

// ==========================================
// Story Graph Schema
// ==========================================

/** Schema for a single node in the story graph */
export const storyGraphNodeSchema = z.object({
  link_id: z.string().uuid(),
  link_type: linkTypeEnum,
  connected_story_id: z.string().uuid(),
  confidence_score: z.number().nullable(),
  depth: z.number().int(),
  title: z.string().nullable(),
  delivery_status: z.string().nullable(),
  tech_stack: z.array(z.string()).nullable(),
  domain: z.array(z.string()).nullable(),
  participant_count: z.number().int(),
});

export type StoryGraphNode = z.infer<typeof storyGraphNodeSchema>;
export const storyGraphArraySchema = z.array(storyGraphNodeSchema);

// ==========================================
// Collaboration Preferences Schema
// ==========================================

export const collaborationPreferencesSchema = z.object({
  collab_mode: collabModeEnum,
  notify_status_changes: z.boolean(),
  notify_blockers: z.boolean(),
  notify_architecture_decisions: z.boolean(),
  notify_code_events: z.boolean(),
  notify_participant_changes: z.boolean(),
  notify_ai_suggestions: z.boolean(),
  max_daily_cross_notifications: z.number().int(),
  min_severity: severityEnum,
  quiet_start: z.string(),
  quiet_end: z.string(),
  timezone: z.string(),
  autopilot_max_actions_per_day: z.number().int(),
  autopilot_allowed_actions: z.array(z.string()),
  autopilot_risk_ceiling: autopilotRiskEnum,
  is_default: z.boolean(),
  story_id: z.string().uuid().nullable(),
});

export type CollaborationPreferences = z.infer<typeof collaborationPreferencesSchema>;

/** Schema for update_collaboration_preferences response */
export const updatePreferencesResponseSchema = z.object({
  id: z.string().uuid(),
  story_id: z.string().uuid().nullable(),
  updated: z.boolean(),
});

export type UpdatePreferencesResponse = z.infer<typeof updatePreferencesResponseSchema>;

// ==========================================
// Cross-Story Summary Schema
// ==========================================

export const crossStorySummaryEntrySchema = z.object({
  entry_type: z.string(),
  summary: z.string(),
  created_at: z.string(),
});

export const crossStoryLinkInfoSchema = z.object({
  link_type: linkTypeEnum,
  link_direction: linkDirectionEnum,
  created_at: z.string(),
  confidence_score: z.number().nullable(),
});

export const crossStorySummarySchema = z.object({
  story_id: z.string().uuid(),
  title: z.string().nullable(),
  delivery_status: z.string().nullable(),
  tech_stack: z.array(z.string()).nullable(),
  domain: z.array(z.string()).nullable(),
  participant_count: z.number().int(),
  recent_entries: z.array(crossStorySummaryEntrySchema),
  link_info: crossStoryLinkInfoSchema.nullable(),
});

export type CrossStorySummary = z.infer<typeof crossStorySummarySchema>;
