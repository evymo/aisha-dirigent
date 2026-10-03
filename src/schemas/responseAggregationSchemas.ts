import { z } from "zod";

/**
 * Response Aggregation Schemas
 * 
 * Comprehensive type-safe schemas for aggregating questionnaire responses
 * based on block types (scale, tags, boolean, etc.)
 */

// =============================================================================
// Value Schemas by Block Type
// =============================================================================

/** Scale response value (numeric 1-10) */
export const scaleResponseValueSchema = z.number().min(0).max(100);

/** Tags response value (array of selected tag values) */
export const tagsResponseValueSchema = z.array(z.string());

/** Boolean response value */
export const booleanResponseValueSchema = z.boolean();

/** Text/Textarea response value */
export const textResponseValueSchema = z.string();

/** Number response value */
export const numberResponseValueSchema = z.number();

/** Feeling preset response value (preset ID) */
export const feelingPresetResponseValueSchema = z.string();

/** Generic response value - union of all types */
export const responseValueSchema = z.union([
  scaleResponseValueSchema,
  tagsResponseValueSchema,
  booleanResponseValueSchema,
  textResponseValueSchema,
  z.null(),
]);

export type ResponseValue = z.infer<typeof responseValueSchema>;

// =============================================================================
// Individual Response Schema
// =============================================================================

/** Single response entry from questionnaire_responses */
export const questionnaireResponseSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  questionnaire_id: z.string().uuid(),
  block_code: z.string(),
  question_type: z.string(),
  value: responseValueSchema,
  created_at: z.string(),
  study_registration_id: z.string().uuid().nullable(),
});

export type QuestionnaireResponse = z.infer<typeof questionnaireResponseSchema>;

// =============================================================================
// Aggregation Result Schemas by Type
// =============================================================================

/** Aggregated stats for scale-type blocks */
export const scaleAggregationSchema = z.object({
  block_code: z.string(),
  question_type: z.literal("scale"),
  count: z.number(),
  avg: z.number().nullable(),
  median: z.number().nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  std_dev: z.number().nullable(),
  distribution: z.record(z.string(), z.number()).optional(), // { "1": 5, "2": 10, ... }
  trend_percent: z.number().nullable(), // Change vs previous period
});

export type ScaleAggregation = z.infer<typeof scaleAggregationSchema>;

/** Aggregated stats for tags-type blocks */
export const tagsAggregationSchema = z.object({
  block_code: z.string(),
  question_type: z.literal("tags"),
  count: z.number(),
  tag_counts: z.record(z.string(), z.number()), // { "chronic_fatigue": 45, "joint_pain": 32 }
  tag_percentages: z.record(z.string(), z.number()), // { "chronic_fatigue": 0.45, ... }
  top_tags: z.array(z.object({
    value: z.string(),
    count: z.number(),
    percentage: z.number(),
  })),
  avg_selections_per_response: z.number().nullable(),
});

export type TagsAggregation = z.infer<typeof tagsAggregationSchema>;

/** Aggregated stats for boolean-type blocks */
export const booleanAggregationSchema = z.object({
  block_code: z.string(),
  question_type: z.literal("boolean"),
  count: z.number(),
  true_count: z.number(),
  false_count: z.number(),
  true_percentage: z.number(),
  false_percentage: z.number(),
});

export type BooleanAggregation = z.infer<typeof booleanAggregationSchema>;

/** Aggregated stats for text-type blocks (limited analysis) */
export const textAggregationSchema = z.object({
  block_code: z.string(),
  question_type: z.union([z.literal("text"), z.literal("textarea")]),
  count: z.number(),
  avg_length: z.number().nullable(),
  filled_count: z.number(), // Non-empty responses
  empty_count: z.number(),
  // Keywords could be extracted via AI/NLP later
  top_keywords: z.array(z.string()).optional(),
});

export type TextAggregation = z.infer<typeof textAggregationSchema>;

/** Aggregated stats for feeling_preset-type blocks */
export const feelingPresetAggregationSchema = z.object({
  block_code: z.string(),
  question_type: z.literal("feeling_preset"),
  count: z.number(),
  preset_counts: z.record(z.string(), z.number()),
  preset_percentages: z.record(z.string(), z.number()),
  top_presets: z.array(z.object({
    preset_id: z.string(),
    count: z.number(),
    percentage: z.number(),
  })),
});

export type FeelingPresetAggregation = z.infer<typeof feelingPresetAggregationSchema>;

/** Union of all aggregation types */
export const blockAggregationSchema = z.discriminatedUnion("question_type", [
  scaleAggregationSchema,
  tagsAggregationSchema,
  booleanAggregationSchema,
  textAggregationSchema.extend({ question_type: z.literal("text") }),
  textAggregationSchema.extend({ question_type: z.literal("textarea") }),
  feelingPresetAggregationSchema,
]);

export type BlockAggregation = z.infer<typeof blockAggregationSchema>;

// =============================================================================
// Section/Questionnaire Level Aggregation
// =============================================================================

/** Section-level aggregation (e.g., "Vitality", "Sleep") */
export const sectionAggregationSchema = z.object({
  section_key: z.string(),
  section_name: z.string().optional(),
  block_aggregations: z.array(blockAggregationSchema),
  section_avg: z.number().nullable(), // Average of all scale blocks in section
  response_count: z.number(),
});

export type SectionAggregation = z.infer<typeof sectionAggregationSchema>;

/** Full questionnaire aggregation */
export const questionnaireAggregationSchema = z.object({
  questionnaire_code: z.string(),
  questionnaire_name: z.string().optional(),
  period_start: z.string(),
  period_end: z.string(),
  total_responses: z.number(),
  unique_users: z.number(),
  sections: z.array(sectionAggregationSchema),
  overall_avg: z.number().nullable(), // Overall average across all scale blocks
  completion_rate: z.number().nullable(), // Percentage of users who completed
});

export type QuestionnaireAggregation = z.infer<typeof questionnaireAggregationSchema>;

// =============================================================================
// Time Series Aggregation
// =============================================================================

/** Single data point in time series */
export const timeSeriesPointSchema = z.object({
  period: z.string(), // ISO date or "2024-W01" for week
  period_label: z.string().optional(),
  value: z.number().nullable(),
  count: z.number(),
});

export type TimeSeriesPoint = z.infer<typeof timeSeriesPointSchema>;

/** Time series for a single block */
export const blockTimeSeriesSchema = z.object({
  block_code: z.string(),
  question_type: z.string(),
  granularity: z.enum(["day", "week", "month", "quarter"]),
  data_points: z.array(timeSeriesPointSchema),
  trend_direction: z.enum(["up", "down", "stable"]).nullable(),
  trend_percent: z.number().nullable(),
});

export type BlockTimeSeries = z.infer<typeof blockTimeSeriesSchema>;

// =============================================================================
// Comparison Aggregation
// =============================================================================

/** Comparison between two groups (e.g., study arms) */
export const groupComparisonSchema = z.object({
  block_code: z.string(),
  question_type: z.string(),
  group_a: z.object({
    label: z.string(),
    count: z.number(),
    avg: z.number().nullable(),
    median: z.number().nullable(),
  }),
  group_b: z.object({
    label: z.string(),
    count: z.number(),
    avg: z.number().nullable(),
    median: z.number().nullable(),
  }),
  difference: z.number().nullable(),
  difference_percent: z.number().nullable(),
  statistical_significance: z.number().nullable(), // p-value if calculated
});

export type GroupComparison = z.infer<typeof groupComparisonSchema>;

// =============================================================================
// Helper Types for RPC Params
// =============================================================================

/** Parameters for fetching aggregation */
export const aggregationParamsSchema = z.object({
  questionnaire_code: z.string(),
  period_start: z.string().optional(),
  period_end: z.string().optional(),
  study_id: z.string().uuid().optional(),
  registration_ids: z.array(z.string().uuid()).optional(),
  group_by: z.enum(["section", "block", "period"]).optional(),
  granularity: z.enum(["day", "week", "month", "quarter"]).optional(),
});

export type AggregationParams = z.infer<typeof aggregationParamsSchema>;

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Safely parse aggregation data from RPC response
 */
export function parseBlockAggregation(data: unknown): BlockAggregation | null {
  try {
    return blockAggregationSchema.parse(data);
  } catch {
    return null;
  }
}

/**
 * Calculate median from array of numbers
 */
export function calculateMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Calculate standard deviation
 */
export function calculateStdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const squareDiffs = values.map((v) => Math.pow(v - avg, 2));
  const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(avgSquareDiff);
}

/**
 * Get distribution of scale values
 */
export function getDistribution(
  values: number[],
  min: number = 1,
  max: number = 10
): Record<string, number> {
  const distribution: Record<string, number> = {};
  for (let i = min; i <= max; i++) {
    distribution[String(i)] = 0;
  }
  for (const v of values) {
    const key = String(Math.round(v));
    if (distribution[key] !== undefined) {
      distribution[key]++;
    }
  }
  return distribution;
}

/**
 * Get tag counts and percentages from array of tag arrays
 */
export function getTagAggregation(
  responses: string[][]
): { counts: Record<string, number>; percentages: Record<string, number> } {
  const counts: Record<string, number> = {};
  const total = responses.length;
  
  for (const tags of responses) {
    for (const tag of tags) {
      counts[tag] = (counts[tag] || 0) + 1;
    }
  }
  
  const percentages: Record<string, number> = {};
  for (const [tag, count] of Object.entries(counts)) {
    percentages[tag] = total > 0 ? count / total : 0;
  }
  
  return { counts, percentages };
}

/**
 * Determine trend direction from time series
 */
export function getTrendDirection(
  points: TimeSeriesPoint[]
): "up" | "down" | "stable" | null {
  if (points.length < 2) return null;
  
  const validPoints = points.filter((p) => p.value !== null);
  if (validPoints.length < 2) return null;
  
  const first = validPoints[0].value!;
  const last = validPoints[validPoints.length - 1].value!;
  const diff = last - first;
  const threshold = 0.05 * first; // 5% threshold
  
  if (Math.abs(diff) < threshold) return "stable";
  return diff > 0 ? "up" : "down";
}
