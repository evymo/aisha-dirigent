import { describe, expect, it } from "vitest";

import {
  aggregationParamsSchema,
  blockAggregationSchema,
  blockTimeSeriesSchema,
  booleanAggregationSchema,
  calculateMedian,
  calculateStdDev,
  getDistribution,
  getTagAggregation,
  getTrendDirection,
  parseBlockAggregation,
  questionnaireAggregationSchema,
  questionnaireResponseSchema,
  scaleAggregationSchema,
  sectionAggregationSchema,
  tagsAggregationSchema,
  textAggregationSchema,
  timeSeriesPointSchema,
} from "@/schemas/responseAggregationSchemas";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const QUESTIONNAIRE_ID = "22222222-2222-4222-8222-222222222222";
const STUDY_REGISTRATION_ID = "33333333-3333-4333-8333-333333333333";

describe("responseAggregationSchemas", () => {
  it("validates questionnaire response payloads", () => {
    expect(
      questionnaireResponseSchema.parse({
        id: "44444444-4444-4444-8444-444444444444",
        user_id: USER_ID,
        questionnaire_id: QUESTIONNAIRE_ID,
        block_code: "pain_scale",
        question_type: "scale",
        value: 8,
        created_at: "2026-04-01T00:00:00.000Z",
        study_registration_id: STUDY_REGISTRATION_ID,
      }),
    ).toMatchObject({
      block_code: "pain_scale",
      value: 8,
    });

    expect(() =>
      questionnaireResponseSchema.parse({
        id: "44444444-4444-4444-8444-444444444444",
        user_id: USER_ID,
        questionnaire_id: QUESTIONNAIRE_ID,
        block_code: "pain_scale",
        question_type: "scale",
        value: 101,
        created_at: "2026-04-01T00:00:00.000Z",
        study_registration_id: STUDY_REGISTRATION_ID,
      }),
    ).toThrow();
  });

  it("validates all block aggregation variants", () => {
    const scale = scaleAggregationSchema.parse({
      block_code: "pain_scale",
      question_type: "scale",
      count: 3,
      avg: 6,
      median: 6,
      min: 4,
      max: 8,
      std_dev: 1.63,
      distribution: { "4": 1, "6": 1, "8": 1 },
      trend_percent: 0.12,
    });

    const tags = tagsAggregationSchema.parse({
      block_code: "symptoms",
      question_type: "tags",
      count: 2,
      tag_counts: { fatigue: 2, sleep: 1 },
      tag_percentages: { fatigue: 1, sleep: 0.5 },
      top_tags: [{ value: "fatigue", count: 2, percentage: 1 }],
      avg_selections_per_response: 1.5,
    });

    const bool = booleanAggregationSchema.parse({
      block_code: "consent",
      question_type: "boolean",
      count: 2,
      true_count: 1,
      false_count: 1,
      true_percentage: 0.5,
      false_percentage: 0.5,
    });

    const text = textAggregationSchema.parse({
      block_code: "notes",
      question_type: "textarea",
      count: 2,
      avg_length: 24,
      filled_count: 2,
      empty_count: 0,
      top_keywords: ["sleep"],
    });

    expect(blockAggregationSchema.parse(scale).question_type).toBe("scale");
    expect(blockAggregationSchema.parse(tags).question_type).toBe("tags");
    expect(blockAggregationSchema.parse(bool).question_type).toBe("boolean");
    expect(blockAggregationSchema.parse(text).question_type).toBe("textarea");
  });

  it("parses nested questionnaire aggregations", () => {
    const block = scaleAggregationSchema.parse({
      block_code: "energy",
      question_type: "scale",
      count: 4,
      avg: 7,
      median: 7,
      min: 5,
      max: 9,
      std_dev: 1,
      trend_percent: null,
    });

    const section = sectionAggregationSchema.parse({
      section_key: "vitality",
      section_name: "Vitality",
      block_aggregations: [block],
      section_avg: 7,
      response_count: 4,
    });

    const aggregation = questionnaireAggregationSchema.parse({
      questionnaire_code: "Q-01",
      questionnaire_name: "Baseline",
      period_start: "2026-04-01",
      period_end: "2026-04-30",
      total_responses: 4,
      unique_users: 4,
      sections: [section],
      overall_avg: 7,
      completion_rate: 0.8,
    });

    expect(aggregation.sections[0].block_aggregations[0].block_code).toBe("energy");
  });

  it("validates time series and aggregation params", () => {
    const point = timeSeriesPointSchema.parse({
      period: "2026-W14",
      period_label: "Week 14",
      value: 6,
      count: 8,
    });

    expect(
      blockTimeSeriesSchema.parse({
        block_code: "energy",
        question_type: "scale",
        granularity: "week",
        data_points: [point],
        trend_direction: "up",
        trend_percent: 0.2,
      }).granularity,
    ).toBe("week");

    expect(
      aggregationParamsSchema.parse({
        questionnaire_code: "Q-01",
        study_id: QUESTIONNAIRE_ID,
        registration_ids: [STUDY_REGISTRATION_ID],
        group_by: "section",
        granularity: "month",
      }).group_by,
    ).toBe("section");
  });

  it("returns null for invalid block aggregation payloads", () => {
    expect(parseBlockAggregation({ question_type: "unknown" })).toBeNull();
    expect(
      parseBlockAggregation({
        block_code: "consent",
        question_type: "boolean",
        count: 1,
        true_count: 1,
        false_count: 0,
        true_percentage: 1,
        false_percentage: 0,
      }),
    ).toMatchObject({ question_type: "boolean" });
  });

  it("calculates median, standard deviation and distributions", () => {
    expect(calculateMedian([])).toBeNull();
    expect(calculateMedian([3, 1, 2])).toBe(2);
    expect(calculateMedian([10, 4])).toBe(7);

    expect(calculateStdDev([5])).toBeNull();
    expect(calculateStdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2);

    expect(getDistribution([1, 1, 2, 4, 10], 1, 4)).toEqual({
      "1": 2,
      "2": 1,
      "3": 0,
      "4": 1,
    });
  });

  it("aggregates tags and detects trend direction", () => {
    expect(getTagAggregation([["fatigue", "sleep"], ["fatigue"]])).toEqual({
      counts: { fatigue: 2, sleep: 1 },
      percentages: { fatigue: 1, sleep: 0.5 },
    });
    expect(getTagAggregation([])).toEqual({ counts: {}, percentages: {} });

    expect(getTrendDirection([])).toBeNull();
    expect(getTrendDirection([{ period: "1", value: null, count: 1 }])).toBeNull();
    expect(getTrendDirection([
      { period: "1", value: 100, count: 1 },
      { period: "2", value: 103, count: 1 },
    ])).toBe("stable");
    expect(getTrendDirection([
      { period: "1", value: 100, count: 1 },
      { period: "2", value: 120, count: 1 },
    ])).toBe("up");
    expect(getTrendDirection([
      { period: "1", value: 100, count: 1 },
      { period: "2", value: 80, count: 1 },
    ])).toBe("down");
  });
});
