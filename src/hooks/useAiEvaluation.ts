/**
 * AI Evaluation admin hooks for managing evaluation runs and results.
 *
 * Provides React Query hooks for:
 * - Listing and creating evaluation runs (regression testing)
 * - Viewing evaluation results per run
 * - Managing golden examples
 * - Admin rating of chat messages
 *
 * @module hooks/useAiEvaluation
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "@/hooks/useSession";
import { usePermissions } from "@/hooks/usePermissions";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";
import type { Database } from "@/integrations/db/types";

// ============================================================================
// Zod Schemas
// ============================================================================

const EvalRunSchema = z.object({
  id: z.string().uuid(),
  trigger_type: z.string(),
  agent_config_id: z.string().uuid().nullable(),
  agent_config_version: z.number().nullable(),
  status: z.string(),
  total_examples: z.number(),
  completed_examples: z.number(),
  avg_relevance: z.number().nullable(),
  avg_groundedness: z.number().nullable(),
  avg_safety: z.number().nullable(),
  avg_coherence: z.number().nullable(),
  avg_overall: z.number().nullable(),
  score_delta: z.number().nullable(),
  previous_run_id: z.string().uuid().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  created_at: z.string(),
  created_by: z.string().uuid().nullable(),
});

const EvalResultSchema = z.object({
  id: z.string().uuid(),
  message_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  relevance_score: z.number(),
  groundedness_score: z.number(),
  safety_score: z.number(),
  coherence_score: z.number(),
  overall_score: z.number(),
  reasoning: z.string().nullable(),
  evaluator_model: z.string(),
  tokens_used: z.number().nullable(),
  latency_ms: z.number().nullable(),
  created_at: z.string(),
});

const GoldenExampleSchema = z.object({
  message_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  user_message: z.string().nullable(),
  assistant_message: z.string().nullable(),
  routing_category: z.string().nullable(),
  model_used: z.string().nullable(),
  admin_rating: z.number().nullable(),
  admin_review_note: z.string().nullable(),
  user_rating: z.number().nullable(),
  created_at: z.string(),
});

// ============================================================================
// Exported Types
// ============================================================================

/** Single evaluation run metadata. */
export type EvalRun = z.infer<typeof EvalRunSchema>;

/** Per-message evaluation result with scores. */
export type EvalResult = z.infer<typeof EvalResultSchema>;

/** Golden example for regression testing. */
export type GoldenExample = z.infer<typeof GoldenExampleSchema>;

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * List evaluation runs (admin/staff only).
 *
 * @param agentConfigId - Optional filter by agent configuration
 * @param limit - Maximum results (default 20)
 */
export function useEvalRuns(agentConfigId?: string, limit = 20) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();

  return useQuery({
    queryKey: ["eval-runs", agentConfigId, limit],
    queryFn: async (): Promise<EvalRun[]> => {
      const { data, error } = await aisha.rpc("get_eval_runs_admin", {
        p_agent_config_id: agentConfigId ?? undefined,
        p_limit: limit,
      });

      if (error) throw new Error(error.message);
      if (!data || !Array.isArray(data)) return [];

      return data
        .map((item) => {
          const parsed = EvalRunSchema.safeParse(item);
          return parsed.success ? parsed.data : null;
        })
        .filter((x): x is EvalRun => x !== null);
    },
    enabled: !!user && hasPermission("view_admin_panel"),
    staleTime: 30_000,
  });
}

/**
 * Get evaluation results for a specific run (admin/staff only).
 *
 * @param evalRunId - UUID of the evaluation run
 * @param limit - Maximum results (default 100)
 */
export function useEvalResults(evalRunId: string | null | undefined, limit = 100) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();

  return useQuery({
    queryKey: ["eval-results", evalRunId, limit],
    queryFn: async (): Promise<EvalResult[]> => {
      if (!evalRunId) return [];

      const { data, error } = await aisha.rpc("get_eval_results_admin", {
        p_eval_run_id: evalRunId,
        p_limit: limit,
      });

      if (error) throw new Error(error.message);
      if (!data || !Array.isArray(data)) return [];

      return data
        .map((item) => {
          const parsed = EvalResultSchema.safeParse(item);
          return parsed.success ? parsed.data : null;
        })
        .filter((x): x is EvalResult => x !== null);
    },
    enabled: !!user && !!evalRunId && hasPermission("view_admin_panel"),
    staleTime: 10_000,
  });
}

// useGoldenExamples — removed: get_golden_examples_admin dropped in channel-centric migration

// ============================================================================
// Mutation Hooks
// ============================================================================

// useCreateEvalRun — removed: create_eval_run_admin dropped in channel-centric migration

/**
 * Start a batch evaluation run by invoking the evaluate-ai-response edge function.
 */
export function useStartEvalRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (evalRunId: string): Promise<{ success: number; errors: number }> => {
      const { data, error } = await aisha.functions.invoke("evaluate-ai-response", {
        body: { eval_run_id: evalRunId },
      });

      if (error) throw new Error(error.message);
      return data as { success: number; errors: number };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["eval-runs"] });
      queryClient.invalidateQueries({ queryKey: ["eval-results"] });
      queryClient.invalidateQueries({ queryKey: ["golden-examples"] });
    },
    onError: (error) => {
      safeError("useStartEvalRun.failed", error);
    },
  });
}

/**
 * Admin rate a chat message (set admin_rating, review note, golden example flag).
 */
export function useAdminRateMessage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();

  return useMutation({
    mutationFn: async (input: {
      message_id: string;
      rating?: -1 | 0 | 1;
      review_note?: string;
      is_golden?: boolean;
    }): Promise<void> => {
      if (!hasPermission("manage_agents")) {
        throw new Error("Permission denied");
      }

      const { error } = await aisha.rpc("admin_rate_chat_message", {
        p_is_golden: input.is_golden ?? undefined,
      
        p_message_id: input.message_id,
        p_rating: input.rating ?? 0,
        p_review_note: input.review_note ?? undefined,});

      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["golden-examples"] });
      queryClient.invalidateQueries({ queryKey: ["chat-messages"] });
    },
    onError: (error) => {
      safeError("useAdminRateMessage.failed", error);
    },
  });
}
