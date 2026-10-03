/**
 * Hooks for Expert Rules — browse, detail, create, update, publish.
 *
 * @module hooks/useExpertRules
 */

import { useQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { parseRpcArray } from "@/lib/validation/rpcSchemas";
import {
  expertRuleSchema,
  expertRuleDetailSchema,
  contributedRuleSchema,
  ruleSubscriptionSchema,
  storyKnowledgeContextSchema,
  type ExpertRule,
  type ExpertRuleDetail,
  type ContributedRule,
  type RuleSubscription,
  type StoryKnowledgeContext,
  type CreateExpertRuleParams,
  type UpdateExpertRuleParams,
} from "@/lib/schemas/guildSchemas";

// =============================================================================
// Query Keys
// =============================================================================

export const expertRuleKeys = {
  all: ["expert-rules"] as const,
  list: (filters: Record<string, unknown>) => ["expert-rules", "list", filters] as const,
  detail: (slug: string) => ["expert-rules", "detail", slug] as const,
  myContributed: () => ["expert-rules", "my-contributed"] as const,
  mySubscriptions: () => ["expert-rules", "my-subscriptions"] as const,
  storyContext: (storyId: string, tags: string[]) => ["expert-rules", "story-context", storyId, tags] as const,
  agentBindings: (agentId: string) => ["expert-rules", "agent-bindings", agentId] as const,
};

// =============================================================================
// Query Options (for route loaders)
// =============================================================================

/**
 * Query options for expert rules list with filters.
 */
export const expertRulesQueryOptions = (opts?: {
  category?: string;
  expertiseSlug?: string;
  search?: string;
  authorPartnerId?: string;
  limit?: number;
  offset?: number;
}) =>
  queryOptions({
    queryKey: expertRuleKeys.list({
      category: opts?.category,
      expertiseSlug: opts?.expertiseSlug,
      search: opts?.search,
      authorPartnerId: opts?.authorPartnerId,
      limit: opts?.limit,
      offset: opts?.offset,
    }),
    queryFn: async (): Promise<ExpertRule[]> => {
      const { data, error } = await aisha.rpc("get_expert_rules", {
        p_author_partner_id: opts?.authorPartnerId ?? undefined,
        p_category: opts?.category ?? undefined,
        p_expertise_slug: opts?.expertiseSlug ?? undefined,
        p_limit: opts?.limit ?? 50,
        p_offset: opts?.offset ?? 0,

        p_search: opts?.search ?? undefined,});
      if (error) throw new Error(error.message);
      return parseRpcArray(expertRuleSchema, data, "get_expert_rules");
    },
    staleTime: 2 * 60 * 1000,
  });

/**
 * Query options for expert rule detail.
 */
export const expertRuleDetailQueryOptions = (slug: string) =>
  queryOptions({
    queryKey: expertRuleKeys.detail(slug),
    queryFn: async (): Promise<ExpertRuleDetail | null> => {
      const { data, error } = await aisha.rpc("get_expert_rule_detail", {
        p_rule_slug: slug,
      });
      if (error) throw new Error(error.message);
      if (!data) return null;
      return expertRuleDetailSchema.parse(data);
    },
    staleTime: 2 * 60 * 1000,
    enabled: !!slug,
  });

// =============================================================================
// Hooks — Read
// =============================================================================

/**
 * Hook to browse published expert rules.
 *
 * @param opts - Filter options: category, expertiseSlug, search, authorPartnerId.
 * @returns Query with expert rules list.
 */
export function useExpertRules(opts?: {
  category?: string;
  expertiseSlug?: string;
  search?: string;
  authorPartnerId?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery(expertRulesQueryOptions(opts));
}

/**
 * Hook to fetch a single expert rule detail.
 *
 * @param slug - Rule slug (URL-friendly identifier).
 * @returns Query with full rule detail including documents.
 */
export function useExpertRuleDetail(slug: string | undefined) {
  return useQuery({
    ...expertRuleDetailQueryOptions(slug ?? ""),
    enabled: !!slug,
  });
}

/**
 * Hook to fetch partner's own contributed rules.
 *
 * @returns Query with the calling partner's rules (all statuses).
 */
export function useMyContributedRules() {
  return useQuery({
    queryKey: expertRuleKeys.myContributed(),
    queryFn: async (): Promise<ContributedRule[]> => {
      const { data, error } = await aisha.rpc("get_my_contributed_rules");
      if (error) throw new Error(error.message);
      return parseRpcArray(contributedRuleSchema, data, "get_my_contributed_rules");
    },
    staleTime: 60 * 1000,
  });
}

/**
 * Hook to fetch current user's rule subscriptions.
 *
 * @returns Query with subscribed rules.
 */
export function useMyRuleSubscriptions() {
  return useQuery({
    queryKey: expertRuleKeys.mySubscriptions(),
    queryFn: async (): Promise<RuleSubscription[]> => {
      const { data, error } = await aisha.rpc("get_my_rule_subscriptions");
      if (error) throw new Error(error.message);
      return parseRpcArray(ruleSubscriptionSchema, data, "get_my_rule_subscriptions");
    },
    staleTime: 60 * 1000,
  });
}

/**
 * Hook to fetch knowledge context for a StoryLoop story.
 * Returns relevant expert rules based on user subscriptions and context tags.
 *
 * @param storyId - The story UUID.
 * @param contextTags - Context tags for matching relevant rules.
 * @returns Query with relevant rules sorted by relevance.
 */
export function useStoryKnowledgeContext(storyId: string | undefined, contextTags: string[] = []) {
  return useQuery({
    queryKey: expertRuleKeys.storyContext(storyId ?? "", contextTags),
    queryFn: async (): Promise<StoryKnowledgeContext[]> => {
      if (!storyId) return [];
      const { data, error } = await aisha.rpc("get_story_knowledge_context", {
        p_context_tags: contextTags,
      
        p_story_id: storyId,});
      if (error) throw new Error(error.message);
      return parseRpcArray(storyKnowledgeContextSchema, data, "get_story_knowledge_context");
    },
    enabled: !!storyId,
    staleTime: 60 * 1000,
  });
}

// useAgentRuleBindings — removed: get_rules_for_agent dropped in channel-centric migration

// =============================================================================
// Hooks — Mutations
// =============================================================================

/**
 * Hook to create a new expert rule.
 *
 * @returns Mutation returning the new rule UUID.
 */
export function useCreateExpertRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: CreateExpertRuleParams): Promise<string> => {
      const { data, error } = await aisha.rpc("create_expert_rule_audited", {
        p_ai_context_tags: params.p_ai_context_tags ?? [],
      
        p_ai_instructions: params.p_ai_instructions ?? undefined,
        p_body_markdown: params.p_body_markdown ?? "",
        p_category: params.p_category ?? "other",
        p_expertise_area_slug: params.p_expertise_area_slug ?? undefined,
        p_slug: params.p_slug,
        p_summary: params.p_summary ?? undefined,
        p_title: params.p_title,
        p_visibility: params.p_visibility ?? "public",});
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: expertRuleKeys.all });
      void queryClient.invalidateQueries({ queryKey: expertRuleKeys.myContributed() });
    },
    onError: (error) => {
      safeError("useCreateExpertRule.failed", error);
    },
  });
}

/**
 * Hook to update an existing expert rule.
 *
 * @returns Mutation for updating rule content.
 */
export function useUpdateExpertRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: UpdateExpertRuleParams): Promise<boolean> => {
      const { data, error } = await aisha.rpc("update_expert_rule_audited", {
        p_ai_context_tags: params.p_ai_context_tags ?? undefined,
        p_ai_instructions: params.p_ai_instructions ?? undefined,
        p_body_markdown: params.p_body_markdown ?? undefined,
        p_category: params.p_category ?? undefined,
        p_change_note: params.p_change_note ?? undefined,
      
        p_expertise_area_slug: params.p_expertise_area_slug ?? undefined,
        p_rule_id: params.p_rule_id,
        p_summary: params.p_summary ?? undefined,
        p_title: params.p_title ?? undefined,
        p_visibility: params.p_visibility ?? undefined,});
      if (error) throw new Error(error.message);
      return !!data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: expertRuleKeys.all });
      void queryClient.invalidateQueries({ queryKey: expertRuleKeys.myContributed() });
    },
    onError: (error) => {
      safeError("useUpdateExpertRule.failed", error);
    },
  });
}

/**
 * Hook to publish a draft/review rule. Routes through AISHA compliance gate.
 * The rule enters 'review' status while AISHA evaluates. If AISHA is unavailable,
 * auto-approves. Returns status and queue_id for tracking.
 *
 * @returns Mutation for publishing a rule.
 */
export function usePublishExpertRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ruleId: string): Promise<{ status: string; queue_id: string; message: string }> => {
      const { data, error } = await aisha.rpc("publish_expert_rule", {
        p_rule_id: ruleId,
      });
      if (error) throw new Error(error.message);
      if (data && typeof data === "object" && "status" in data) {
        return data as { status: string; queue_id: string; message: string };
      }
      return { status: "published", queue_id: "", message: "Published" };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: expertRuleKeys.all });
      void queryClient.invalidateQueries({ queryKey: expertRuleKeys.myContributed() });
    },
    onError: (error) => {
      safeError("usePublishExpertRule.failed", error);
    },
  });
}

/**
 * Hook to subscribe (borrow) a published expert rule.
 *
 * @returns Mutation to subscribe.
 */
export function useSubscribeToRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ruleId: string): Promise<boolean> => {
      const { data, error } = await aisha.rpc("subscribe_to_expert_rule", {
        p_rule_id: ruleId,
      });
      if (error) throw new Error(error.message);
      return !!data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: expertRuleKeys.all });
      void queryClient.invalidateQueries({ queryKey: expertRuleKeys.mySubscriptions() });
    },
    onError: (error) => {
      safeError("useSubscribeToRule.failed", error);
    },
  });
}

/**
 * Hook to unsubscribe from an expert rule.
 *
 * @returns Mutation to unsubscribe.
 */
export function useUnsubscribeFromRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ruleId: string): Promise<boolean> => {
      const { data, error } = await aisha.rpc("unsubscribe_from_expert_rule", {
        p_rule_id: ruleId,
      });
      if (error) throw new Error(error.message);
      return !!data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: expertRuleKeys.mySubscriptions() });
    },
    onError: (error) => {
      safeError("useUnsubscribeFromRule.failed", error);
    },
  });
}

/**
 * Hook to rate an expert rule (1-5 stars).
 *
 * @returns Mutation to submit or update a rating.
 */
export function useRateExpertRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { ruleId: string; rating: number; reviewText?: string }): Promise<boolean> => {
      const { data, error } = await aisha.rpc("rate_expert_rule", {
        p_rating: params.rating,
        p_review_text: params.reviewText ?? undefined,
      
        p_rule_id: params.ruleId,});
      if (error) throw new Error(error.message);
      return !!data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: expertRuleKeys.all });
    },
    onError: (error) => {
      safeError("useRateExpertRule.failed", error);
    },
  });
}
