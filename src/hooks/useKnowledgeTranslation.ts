/**
 * Hook for knowledge topic translation — LLM-powered with caching.
 *
 * Reads cached translation via `get_topic_translation` RPC.
 * If no translation exists, invokes `translate-content` edge function on demand.
 *
 * @module hooks/useKnowledgeTranslation
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";

// =============================================================================
// Schemas
// =============================================================================

const topicTranslationSchema = z.object({
  topic_id: z.string().uuid(),
  topic_slug: z.string(),
  version_no: z.number(),
  source_locale: z.string(),
  body_markdown: z.string(),
  body_translated: z.string(),
  translation_provider: z.string().nullable(),
  translation_model: z.string().nullable(),
  is_human_reviewed: z.boolean().nullable(),
  quality_score: z.number().nullable(),
});

export type TopicTranslation = z.infer<typeof topicTranslationSchema>;

const translationMetricRowSchema = z.object({
  content_type: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  locale: z.string(),
  translation_count: z.number(),
  avg_token_count: z.number().nullable(),
  avg_latency_ms: z.number().nullable(),
  avg_quality_score: z.number().nullable(),
  human_reviewed_count: z.number(),
});

export type TranslationMetricRow = z.infer<typeof translationMetricRowSchema>;

// =============================================================================
// useTopicTranslation — Get cached or trigger on-the-fly translation
// =============================================================================

/**
 * Fetch a knowledge topic in the requested locale.
 *
 * Returns the cached translation if available, or the original text in
 * source_locale. Call `requestTranslation` to trigger LLM translation
 * for missing locales.
 *
 * @example
 * const { translation, isLoading, requestTranslation } = useTopicTranslation("rpc-only-pattern", "en");
 */
export function useTopicTranslation(topicSlug: string, locale: string) {
  const queryClient = useQueryClient();

  const queryKey = ["knowledge-topic-translation", topicSlug, locale] as const;

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<TopicTranslation | null> => {
      const { data, error } = await aisha.rpc("get_topic_translation", {
        p_locale: locale,
        p_topic_slug: topicSlug,
      });

      if (error) {
        safeError("useTopicTranslation.rpc", error);
        throw error;
      }

      if (!data || (Array.isArray(data) && data.length === 0)) {
        return null;
      }

      const row = Array.isArray(data) ? data[0] : data;
      const parsed = topicTranslationSchema.safeParse(row);
      return parsed.success ? parsed.data : null;
    },
    enabled: !!topicSlug && !!locale,
    staleTime: 5 * 60 * 1000, // 5 min — translations are stable
  });

  // Mutation to trigger edge function translation
  const requestTranslation = useMutation({
    mutationFn: async () => {
      // First get the source data from the current query
      const current = query.data;
      if (!current) {
        throw new Error("No topic data to translate");
      }

      const { data, error } = await aisha.functions.invoke("translate-content", {
        body: {
          content_type: "topic",
          topic_version_id: current.topic_id, // We need version ID — get from latest
          source_text: current.body_markdown,
          source_locale: current.source_locale,
          target_locales: [locale],
        },
      });

      if (error) {
        safeError("useTopicTranslation.edgeFunction", error);
        throw error;
      }

      return data;
    },
    onSuccess: () => {
      // Invalidate to refetch the now-cached translation
      queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    translation: query.data,
    isLoading: query.isLoading,
    error: query.error,
    needsTranslation: query.data !== null && query.data?.translation_provider === null,
    requestTranslation: requestTranslation.mutate,
    isTranslating: requestTranslation.isPending,
  };
}

// =============================================================================
// useTranslationMetrics — Admin dashboard data for feedback loop
// =============================================================================

/**
 * Fetch translation metrics aggregated by provider/model/locale.
 * Admin-only. Used for the AI feedback loop dashboard.
 *
 * @example
 * const { metrics, isLoading } = useTranslationMetrics(30);
 */
export function useTranslationMetrics(days = 30) {
  return useQuery({
    queryKey: ["translation-metrics", days],
    queryFn: async (): Promise<TranslationMetricRow[]> => {
      const { data, error } = await aisha.rpc("get_translation_metrics_admin", {
        p_days: days,
      });

      if (error) {
        safeError("useTranslationMetrics.rpc", error);
        throw error;
      }

      if (!data || !Array.isArray(data)) return [];

      return data
        .map((row: unknown) => translationMetricRowSchema.safeParse(row))
        .filter((r: z.SafeParseReturnType<unknown, TranslationMetricRow>) => r.success)
        .map((r: z.SafeParseSuccess<TranslationMetricRow>) => r.data);
    },
    staleTime: 60 * 1000, // 1 min
  });
}

// =============================================================================
// useRateTranslation — Feedback loop input
// =============================================================================

/**
 * Rate a translation quality (0-1). Admin/staff only.
 * Feeds back into model selection optimization.
 *
 * @example
 * const { rateTranslation } = useRateTranslation();
 * rateTranslation({ topicVersionId, locale: "en", qualityScore: 0.9 });
 */
export function useRateTranslation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      topicVersionId: string;
      locale: string;
      qualityScore: number;
    }) => {
      const { error } = await aisha.rpc("rate_topic_translation", {
        p_locale: params.locale,
        p_quality_score: params.qualityScore,
        p_topic_version_id: params.topicVersionId,
      });

      if (error) {
        safeError("useRateTranslation.rpc", error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["translation-metrics"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-topic-translation"] });
    },
  });
}
