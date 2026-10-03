/**
 * Story Delivery Context hooks (Phase 2).
 *
 * Provides data access for:
 * - Fetching aggregated story delivery context (mcp_get_story_context)
 * - Creating ruleset fingerprints (create_story_ruleset)
 * - Updating delivery metadata (update_story_delivery_context)
 *
 * @module
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import {
  StoryDeliveryContextSchema,
  StoryRulesetSchema,
  type StoryDeliveryContext,
  type StoryRuleset,
  type CreateStoryRulesetRequest,
  type UpdateStoryDeliveryContextRequest,
  type UpdateStoryProjectPreviewRequest,
} from "@/schemas/storyDeliverySchemas";
import { storyLoopKeys } from "./useStoryLoop";

// =====================================================
// Query Keys
// =====================================================

export const storyDeliveryKeys = {
  all: ["story-delivery"] as const,
  context: (storyId: string) => [...storyDeliveryKeys.all, "context", storyId] as const,
  rulesets: (storyId: string) => [...storyDeliveryKeys.all, "rulesets", storyId] as const,
};

// =====================================================
// Queries
// =====================================================

/**
 * Fetch the full delivery context for a story.
 *
 * Returns aggregated data from partner_stories, story_rulesets,
 * story_contexts, story_participants, and expert_rules.
 *
 * @param storyId - UUID of the partner story (null disables the query)
 * @returns StoryDeliveryContext or null
 * @example
 * const { data: ctx } = useStoryDeliveryContext(storyId);
 * if (ctx?.ruleset) { console.log(ctx.ruleset.fingerprint); }
 */
export function useStoryDeliveryContext(storyId: string | null) {
  return useQuery({
    queryKey: storyDeliveryKeys.context(storyId ?? ""),
    queryFn: async (): Promise<StoryDeliveryContext | null> => {
      if (!storyId) return null;

      const { data, error } = await aisha.rpc("mcp_get_story_context", {
        p_story_id: storyId,
      });

      if (error) {
        safeError("storyDelivery.useStoryDeliveryContext", error);
        throw new Error(error.message);
      }

      if (!data) return null;

      const validated = StoryDeliveryContextSchema.safeParse(data);
      if (!validated.success) {
        safeError("storyDelivery.useStoryDeliveryContext.validation", validated.error);
        return null;
      }

      return validated.data;
    },
    enabled: !!storyId,
  });
}

// =====================================================
// Mutations
// =====================================================

/**
 * Create a ruleset fingerprint for a story by pinning expert rule IDs.
 *
 * The server computes a deterministic SHA-256 fingerprint from sorted
 * rule IDs + their current versions. Same inputs always yield the same
 * fingerprint.
 *
 * @returns Mutation that resolves to the created StoryRuleset
 * @example
 * const createRuleset = useCreateStoryRuleset();
 * await createRuleset.mutateAsync({
 *   story_id: "...",
 *   rule_ids: ["rule-1", "rule-2"],
 *   context_profile: "web-frontend",
 * });
 */
export function useCreateStoryRuleset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: CreateStoryRulesetRequest): Promise<StoryRuleset> => {
      const { data, error } = await aisha.rpc("create_story_ruleset", {
        p_rule_ids: params.rule_ids,
        ...(params.context_profile ? { p_context_profile: params.context_profile } : {}),
      
        p_story_id: params.story_id,});

      if (error) {
        safeError("storyDelivery.createStoryRuleset", error);
        throw new Error(error.message);
      }

      const validated = StoryRulesetSchema.safeParse(data);
      if (!validated.success) {
        safeError("storyDelivery.createStoryRuleset.validation", validated.error);
        throw new Error("Invalid ruleset response");
      }

      return validated.data;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: storyDeliveryKeys.context(result.story_id),
      });
      queryClient.invalidateQueries({
        queryKey: storyDeliveryKeys.rulesets(result.story_id),
      });
      queryClient.invalidateQueries({
        queryKey: storyLoopKeys.story(result.story_id),
      });
    },
  });
}

/**
 * Update delivery metadata for a story (repo URL, tech stack, domain, etc.).
 *
 * Supports partial updates — only non-undefined fields are applied.
 *
 * @returns Mutation that resolves to the updated fields as JSON
 * @example
 * const updateContext = useUpdateStoryDeliveryContext();
 * await updateContext.mutateAsync({
 *   story_id: "...",
 *   repo_url: "https://github.com/org/repo",
 *   tech_stack: ["react", "typescript"],
 * });
 */
export function useUpdateStoryDeliveryContext() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      params: UpdateStoryDeliveryContextRequest,
    ): Promise<Record<string, unknown>> => {
      const { data, error } = await aisha.rpc("update_story_delivery_context", {
        p_story_id: params.story_id,
        ...(params.repo_url !== undefined ? { p_repo_url: params.repo_url } : {}),
        ...(params.repo_provider !== undefined ? { p_repo_provider: params.repo_provider } : {}),
        ...(params.default_branch !== undefined ? { p_default_branch: params.default_branch } : {}),
        ...(params.delivery_status !== undefined ? { p_delivery_status: params.delivery_status } : {}),
        ...(params.tech_stack !== undefined ? { p_tech_stack: params.tech_stack } : {}),
        ...(params.risk_profile !== undefined ? { p_risk_profile: params.risk_profile } : {}),
        ...(params.domain !== undefined ? { p_domain: params.domain } : {}),
        ...(params.build_config !== undefined
          ? { p_build_config: JSON.parse(JSON.stringify(params.build_config)) }
          : {}),
        ...(params.env_hints !== undefined
          ? { p_env_hints: JSON.parse(JSON.stringify(params.env_hints)) }
          : {}),
      });

      if (error) {
        safeError("storyDelivery.updateStoryDeliveryContext", error);
        throw new Error(error.message);
      }

      return (data ?? {}) as Record<string, unknown>;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: storyDeliveryKeys.context(variables.story_id),
      });
      queryClient.invalidateQueries({
        queryKey: storyLoopKeys.story(variables.story_id),
      });
    },
  });
}

/**
 * Update or publish structured project preview for a story.
 *
 * Persisted in `partner_stories.project_preview` and exposed through
 * `mcp_get_story_context` + `compose_context` project_preview layer.
 */
export function useUpdateStoryProjectPreview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      params: UpdateStoryProjectPreviewRequest,
    ): Promise<Record<string, unknown>> => {
      const { data, error } = await aisha.rpc("update_story_project_preview", {
        p_project_preview: JSON.parse(JSON.stringify(params.project_preview)),
        p_publish: params.publish ?? false,
        p_story_id: params.story_id,
      });

      if (error) {
        safeError("storyDelivery.updateStoryProjectPreview", error);
        throw new Error(error.message);
      }

      return (data ?? {}) as Record<string, unknown>;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: storyDeliveryKeys.context(variables.story_id),
      });
      queryClient.invalidateQueries({
        queryKey: storyLoopKeys.story(variables.story_id),
      });
    },
  });
}
