/**
 * useResolverGovernance — admin hooks for the orchestration-decision policy lens.
 *
 *   useResolverPolicies — list_ai_resolver_policies (the weights/thresholds editor)
 *   useSetResolverPolicy — set_ai_resolver_policy_audited (tune weights; NULL inherits)
 *   useAiDecisions       — get_ai_decisions_admin (the decision drilldown: ranking + cost)
 *
 * All writes go through the audited SECURITY DEFINER RPC (admin/staff enforced server-side);
 * the UI is only the affordance. Mirrors useSpendGovernance.
 *
 * @module hooks/useResolverGovernance
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";

// ============================================================================
// Schemas
// ============================================================================

const ResolverPolicySchema = z.object({
  policy_id: z.string().uuid(),
  scope_type: z.string(),
  scope_id: z.string().uuid().nullable(),
  task_kind: z.string().nullable(),
  bench_weight: z.coerce.number(),
  local_bonus: z.coerce.number(),
  cost_match_weight: z.coerce.number(),
  tool_match_weight: z.coerce.number(),
  vision_match_weight: z.coerce.number(),
  budget_remaining_floor: z.coerce.number(),
  budget_max_cost: z.coerce.number(),
  premium_max_cost: z.coerce.number(),
  batch_min_deadline_hours: z.coerce.number(),
  batch_min_tokens: z.coerce.number(),
  health_allow_set: z.array(z.string()),
  default_bench: z.coerce.number(),
  default_expected_tokens: z.coerce.number(),
  default_deadline_hours: z.coerce.number(),
  default_max_cost: z.coerce.number(),
  default_budget_remaining: z.coerce.number(),
  is_active: z.boolean(),
  updated_at: z.string(),
});
const ResolverPolicyArraySchema = z.array(ResolverPolicySchema);
export type ResolverPolicy = z.infer<typeof ResolverPolicySchema>;

const DecisionCandidateSchema = z.object({
  rank: z.coerce.number(),
  is_top: z.boolean(),
  provider_slug: z.string().nullable(),
  model_id: z.string().nullable(),
  backend_kind: z.string().nullable(),
  score: z.coerce.number().nullable(),
  reason: z.string().nullable(),
});

const AiDecisionSchema = z.object({
  decision_id: z.string().uuid(),
  created_at: z.string(),
  clow_purpose: z.string().nullable(),
  runtime: z.string().nullable(),
  provider_slug: z.string().nullable(),
  model_id: z.string().nullable(),
  backend_kind: z.string().nullable(),
  strategy: z.string().nullable(),
  resolution_source: z.string().nullable(),
  admission_verdict: z.string().nullable(),
  reason: z.string().nullable(),
  resolver_policy_id: z.string().uuid().nullable(),
  estimated_cost: z.coerce.number().nullable(),
  actual_cost: z.coerce.number().nullable(),
  candidates: z.array(DecisionCandidateSchema).default([]),
});
const AiDecisionArraySchema = z.array(AiDecisionSchema);
export type AiDecision = z.infer<typeof AiDecisionSchema>;
export type DecisionCandidate = z.infer<typeof DecisionCandidateSchema>;

// ============================================================================
// Queries
// ============================================================================

export function useResolverPolicies(opts: { enabled?: boolean } = {}) {
  const { enabled = true } = opts;
  return useQuery({
    queryKey: ["resolver_policies"],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<ResolverPolicy[]> => {
      const { data, error } = await aisha.rpc("list_ai_resolver_policies");
      if (error) {
        safeError("useResolverPolicies", error);
        throw new Error(error.message);
      }
      const parsed = ResolverPolicyArraySchema.safeParse(data);
      if (!parsed.success) {
        safeError("useResolverPolicies:parse", parsed.error);
        return [];
      }
      return parsed.data;
    },
  });
}

export function useAiDecisions(opts: { limit?: number; storyId?: string | null; enabled?: boolean } = {}) {
  const { limit = 50, storyId = null, enabled = true } = opts;
  return useQuery({
    queryKey: ["ai_decisions", limit, storyId],
    enabled,
    staleTime: 15_000,
    queryFn: async (): Promise<AiDecision[]> => {
      const { data, error } = await aisha.rpc("get_ai_decisions_admin", {
        p_limit: limit,
        p_story_id: storyId ?? undefined,
      });
      if (error) {
        safeError("useAiDecisions", error);
        throw new Error(error.message);
      }
      const parsed = AiDecisionArraySchema.safeParse(data);
      if (!parsed.success) {
        safeError("useAiDecisions:parse", parsed.error);
        return [];
      }
      return parsed.data;
    },
  });
}

// ============================================================================
// Mutations
// ============================================================================

export interface SetResolverPolicyInput {
  scopeType?: "global" | "story" | "instance";
  scopeId?: string | null;
  taskKind?: string | null;
  benchWeight?: number | null;
  localBonus?: number | null;
  costMatchWeight?: number | null;
  toolMatchWeight?: number | null;
  visionMatchWeight?: number | null;
  budgetRemainingFloorUsd?: number | null;
  budgetMaxCostUsd?: number | null;
  premiumMaxCostUsd?: number | null;
  batchMinDeadlineHours?: number | null;
  batchMinTokens?: number | null;
  healthAllowSet?: string[] | null;
  defaultBench?: number | null;
  defaultExpectedTokens?: number | null;
  defaultDeadlineHours?: number | null;
  defaultMaxCostUsd?: number | null;
  defaultBudgetRemainingUsd?: number | null;
  deactivate?: boolean;
}

export function useSetResolverPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SetResolverPolicyInput) => {
      const { data, error } = await aisha.rpc("set_ai_resolver_policy_audited", {
        // Keys MUST stay alphabetically ordered (rpc-params-alphabetical.test.ts).
        p_batch_min_deadline_hours: input.batchMinDeadlineHours ?? undefined,
        p_batch_min_tokens: input.batchMinTokens ?? undefined,
        p_bench_weight: input.benchWeight ?? undefined,
        p_budget_max_cost: input.budgetMaxCostUsd ?? undefined,
        p_budget_remaining_floor: input.budgetRemainingFloorUsd ?? undefined,
        p_cost_match_weight: input.costMatchWeight ?? undefined,
        p_deactivate: input.deactivate ?? undefined,
        p_default_bench: input.defaultBench ?? undefined,
        p_default_budget_remaining: input.defaultBudgetRemainingUsd ?? undefined,
        p_default_deadline_hours: input.defaultDeadlineHours ?? undefined,
        p_default_expected_tokens: input.defaultExpectedTokens ?? undefined,
        p_default_max_cost: input.defaultMaxCostUsd ?? undefined,
        p_health_allow_set: input.healthAllowSet ?? undefined,
        p_local_bonus: input.localBonus ?? undefined,
        p_premium_max_cost: input.premiumMaxCostUsd ?? undefined,
        p_scope_id: input.scopeId ?? undefined,
        p_scope_type: input.scopeType ?? undefined,
        p_task_kind: input.taskKind ?? undefined,
        p_tool_match_weight: input.toolMatchWeight ?? undefined,
        p_vision_match_weight: input.visionMatchWeight ?? undefined,
      });
      if (error) {
        safeError("useSetResolverPolicy", error);
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resolver_policies"] });
    },
  });
}
