import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";

/**
 * Schema for aggregation parameters
 */
const aggregationParamsSchema = z.object({
  questionnaireCode: z.string(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  studyRegistrationId: z.string().uuid().optional(),
  groupBy: z.enum(["day", "week", "month"]).default("week"),
});

export type AggregationParams = z.infer<typeof aggregationParamsSchema>;

/**
 * Schema for scale/number aggregation result
 */
const scaleAggregationSchema = z.object({
  type: z.enum(["scale", "number"]),
  avg: z.number(),
  median: z.number(),
  std_dev: z.number(),
  min: z.number(),
  max: z.number(),
});

/**
 * Schema for boolean aggregation result
 */
const booleanAggregationSchema = z.object({
  type: z.literal("boolean"),
  true_count: z.number(),
  false_count: z.number(),
  true_percentage: z.number(),
});

/**
 * Schema for tags aggregation result
 */
const tagsAggregationSchema = z.object({
  type: z.literal("tags"),
  all_tags: z.array(z.array(z.string()).nullable()),
});

/**
 * Schema for text-based aggregation (placeholder)
 */
const textAggregationSchema = z.object({
  type: z.string(),
  raw: z.literal("text-based"),
});

const aggregationResultSchema = z.discriminatedUnion("type", [
  scaleAggregationSchema,
  booleanAggregationSchema,
  tagsAggregationSchema,
]).or(textAggregationSchema);

/**
 * Schema for block aggregation
 */
const blockAggregationSchema = z.object({
  block_code: z.string(),
  question_type: z.string(),
  response_count: z.number(),
  aggregation: aggregationResultSchema,
});

/**
 * Schema for time series point
 */
const timeSeriesPointSchema = z.object({
  period: z.string(),
  response_count: z.number(),
  avg_blocks_answered: z.number(),
});

/**
 * Schema for full aggregation response
 */
const aggregationResponseSchema = z.object({
  questionnaire_code: z.string(),
  questionnaire_id: z.string(),
  filters: z.object({
    start_date: z.string().nullable(),
    end_date: z.string().nullable(),
    study_registration_id: z.string().nullable(),
    group_by: z.string(),
  }),
  blocks: z.array(blockAggregationSchema),
  time_series: z.array(timeSeriesPointSchema),
  generated_at: z.string(),
});

export type BlockAggregation = z.infer<typeof blockAggregationSchema>;
export type TimeSeriesPoint = z.infer<typeof timeSeriesPointSchema>;
export type AggregationResponse = z.infer<typeof aggregationResponseSchema>;

/**
 * Hook for fetching aggregated questionnaire responses.
 * 
 * Provides per-block statistics (avg, median, distribution) and time series data.
 */
export function useQuestionnaireAggregation(params: AggregationParams) {
  return useQuery({
    queryKey: ["questionnaire-aggregation", params],
    queryFn: async (): Promise<AggregationResponse> => {
      const validated = aggregationParamsSchema.parse(params);

      const { data, error } = await aisha.rpc("aggregate_questionnaire_responses", {
        p_end_date: validated.endDate,
        p_group_by: validated.groupBy
,
        p_questionnaire_code: validated.questionnaireCode,
        p_start_date: validated.startDate,
        p_study_registration_id: validated.studyRegistrationId
    });

      if (error) {
        safeError("questionnaire.aggregation.fetch.failed", error);
        throw new Error(error.message);
      }

      // Validate response
      const parsed = aggregationResponseSchema.safeParse(data);
      if (!parsed.success) {
        safeError("questionnaire.aggregation.parse.failed", parsed.error);
        // Return raw data as fallback
        return data as AggregationResponse;
      }

      return parsed.data;
    },
    enabled: !!params.questionnaireCode,
  });
}

/**
 * Schema for block response history item
 */
const blockResponseHistoryItemSchema = z.object({
  response_id: z.string(),
  block_code: z.string(),
  question_type: z.string(),
  response_value: z.unknown(),
  completed_at: z.string(),
});

export type BlockResponseHistoryItem = z.infer<typeof blockResponseHistoryItemSchema>;

/**
 * Hook for fetching user's response history for a specific block.
 * Useful for trend analysis and personal dashboards.
 */
export function useBlockResponseHistory(
  blockCode: string,
  questionnaireCode?: string,
  limit: number = 30
) {
  return useQuery({
    queryKey: ["block-response-history", blockCode, questionnaireCode, limit],
    queryFn: async (): Promise<BlockResponseHistoryItem[]> => {
      const { data, error } = await aisha.rpc("get_block_response_history_audited", {
        p_block_code: blockCode,
        p_limit: limit
,
        p_questionnaire_code: questionnaireCode
    });

      if (error) {
        safeError("questionnaire.block.history.fetch.failed", error);
        throw new Error(error.message);
      }

      return (data as BlockResponseHistoryItem[]) ?? [];
    },
    enabled: !!blockCode,
  });
}

/**
 * Utility function to process tags aggregation into frequency map.
 */
export function processTagsAggregation(
  allTags: (string[] | null)[]
): Map<string, number> {
  const frequency = new Map<string, number>();
  
  for (const tagArray of allTags) {
    if (!tagArray) continue;
    for (const tag of tagArray) {
      frequency.set(tag, (frequency.get(tag) ?? 0) + 1);
    }
  }
  
  return frequency;
}

/**
 * Utility function to calculate trend direction from time series.
 */
export function calculateTrend(
  timeSeries: TimeSeriesPoint[]
): "up" | "down" | "stable" {
  if (timeSeries.length < 2) return "stable";

  const recentHalf = timeSeries.slice(Math.floor(timeSeries.length / 2));
  const olderHalf = timeSeries.slice(0, Math.floor(timeSeries.length / 2));

  const recentAvg = recentHalf.reduce((sum, p) => sum + p.response_count, 0) / recentHalf.length;
  const olderAvg = olderHalf.reduce((sum, p) => sum + p.response_count, 0) / olderHalf.length;

  const diff = recentAvg - olderAvg;
  const threshold = olderAvg * 0.1; // 10% threshold

  if (diff > threshold) return "up";
  if (diff < -threshold) return "down";
  return "stable";
}
