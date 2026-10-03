/**
 * Hooks for AISHA Learning Engine (ALE) — feedback submission and training data.
 *
 * Provides React Query hooks for:
 * - Submitting user feedback on AI responses (thumbs up/down + corrections)
 * - Extracting training pairs from knowledge base (admin)
 *
 * @module hooks/useAleFeedback
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { toJson } from "@/lib/types/json";
import {
  submitFeedbackInputSchema,
  submitFeedbackResponseSchema,
  kbExtractionResponseSchema,
} from "@/lib/schemas/ale";

import type { SubmitFeedbackInput, SubmitFeedbackResponse, KbExtractionResponse } from "@/lib/schemas/ale";

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Submit feedback on an AI response.
 *
 * Sends rating (thumbs up/down) and optional correction text to the
 * ALE training data pipeline via `submit_ai_feedback` RPC.
 *
 * @example
 * ```tsx
 * const { mutate: submitFeedback } = useSubmitAiFeedback();
 * submitFeedback({ trace_event_id: "...", rating: 1 });
 * ```
 */
export function useSubmitAiFeedback() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SubmitFeedbackInput): Promise<SubmitFeedbackResponse> => {
      const validated = submitFeedbackInputSchema.parse(input);

      const { data, error } = await aisha.rpc("submit_ai_feedback", {
        p_correction_text: validated.correction_text ?? undefined,
        p_domain_tags: validated.domain_tags,
        p_feedback_category: validated.feedback_category,
        p_message_id: validated.message_id ?? undefined,
        p_metadata: toJson(validated.metadata),
        p_rating: validated.rating,
        p_run_id: validated.run_id ?? undefined,
        p_trace_event_id: validated.trace_event_id ?? undefined,
      });

      if (error) throw new Error(error.message);

      return submitFeedbackResponseSchema.parse(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-feedback"] });
      queryClient.invalidateQueries({ queryKey: ["golden-examples"] });
    },
    onError: (error) => {
      safeError("useAleFeedback.submitFeedback", error);
    },
  });
}

/**
 * Extract training pairs from knowledge base into a dataset.
 *
 * Admin/staff only. Calls `extract_training_pairs_from_kb` RPC to pull
 * instruction/response pairs from knowledge_items and expert_rules.
 */
export function useExtractTrainingPairsFromKb() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      dataset_id: string;
      domain_tags?: string[];
      limit?: number;
      org_id?: string;
      source_types?: string[];
    }): Promise<KbExtractionResponse> => {
      const { data, error } = await aisha.rpc("extract_training_pairs_from_kb", {
        p_dataset_id: input.dataset_id,
        p_domain_tags: input.domain_tags ?? [],
        p_limit: input.limit ?? 500,
        p_org_id: input.org_id ?? undefined,
        p_source_types: input.source_types ?? undefined,
      });

      if (error) throw new Error(error.message);

      return kbExtractionResponseSchema.parse(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["training-datasets"] });
      queryClient.invalidateQueries({ queryKey: ["training-examples"] });
    },
    onError: (error) => {
      safeError("useAleFeedback.extractTrainingPairs", error);
    },
  });
}
