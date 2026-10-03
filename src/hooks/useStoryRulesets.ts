/**
 * useStoryRulesets — per-story ruleset binding lookup.
 *
 * Wraps the `get_story_rulesets` RPC. Returns one row per story_rulesets
 * binding, joined with rich expert_rules metadata.
 *
 * Used by AdminStoryDetail (Rulesets tab) to render the ruleset list +
 * by future Mission Control surfaces that need to know "what rules are
 * active for this story right now".
 *
 * @module hooks/useStoryRulesets
 */

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";

// ============================================================================
// Schema
// ============================================================================

const StoryRuleSchema = z.object({
  rule_id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  category: z.string(),
  status: z.string(),
  current_version: z.number().int(),
  used_version: z.number().int().nullable(),
  is_default: z.boolean(),
});

const StoryRulesetRowSchema = z.object({
  ruleset_id: z.string().uuid(),
  ruleset_fingerprint: z.string(),
  context_profile: z.string().nullable(),
  created_at: z.string(),
  created_by: z.string(),
  rule_count: z.number().int(),
  rules: z.array(StoryRuleSchema),
});

const StoryRulesetArraySchema = z.array(StoryRulesetRowSchema);

/** A single rule resolved within a story's ruleset binding. */
export type StoryRule = z.infer<typeof StoryRuleSchema>;
/** One row of story_rulesets joined with the expert_rules it references. */
export type StoryRulesetRow = z.infer<typeof StoryRulesetRowSchema>;

// ============================================================================
// Hook
// ============================================================================

interface UseStoryRulesetsOptions {
  /** Story whose ruleset bindings we want. */
  storyId: string | null | undefined;
  /** Disable the query (e.g. while storyId resolves). */
  enabled?: boolean;
}

/**
 * Returns ruleset bindings for a story, newest first.
 *
 * Each row is one row of `story_rulesets` (most stories have just one
 * latest binding, but the table supports history). The `rules` array is
 * pre-joined with the expert_rules' current metadata so the UI doesn't
 * have to do a second round-trip.
 */
export function useStoryRulesets(opts: UseStoryRulesetsOptions) {
  const { storyId, enabled = true } = opts;

  return useQuery({
    queryKey: ["story_rulesets", storyId],
    enabled: enabled && !!storyId,
    staleTime: 30 * 1000,
    queryFn: async (): Promise<StoryRulesetRow[]> => {
      if (!storyId) return [];
      const { data, error } = await aisha.rpc("get_story_rulesets", {
        p_story_id: storyId,
      });

      if (error) {
        safeError("useStoryRulesets", error);
        throw error;
      }

      return StoryRulesetArraySchema.parse(data ?? []);
    },
  });
}
