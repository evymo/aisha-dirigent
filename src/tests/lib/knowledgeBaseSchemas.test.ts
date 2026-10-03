import { describe, expect, it } from "vitest";

import {
  aishaEvaluationSchema,
  createKnowledgePostSchema,
  createKnowledgeTopicSchema,
  deleteKnowledgeTopicSchema,
  knowledgePostArraySchema,
  knowledgeTopicArraySchema,
  knowledgeTopicDetailSchema,
  moderationQueueItemSchema,
  reviewModerationItemSchema,
  updateKnowledgeTopicSchema,
} from "@/lib/schemas/knowledgeBaseSchemas";

const TOPIC_ID = "11111111-1111-4111-8111-111111111111";
const LINK_ID = "22222222-2222-4222-8222-222222222222";
const POST_ID = "33333333-3333-4333-8333-333333333333";
const QUEUE_ID = "44444444-4444-4444-8444-444444444444";

describe("knowledgeBaseSchemas", () => {
  it("validates list and detail topic payloads", () => {
    const topic = {
      id: TOPIC_ID,
      slug: "longevity",
      title: "Longevity",
      summary: null,
      visibility: "public",
      verification_status: "verified",
      source_locale: "en",
      is_locked: false,
      post_count: 2,
      created_at: "2026-04-01T00:00:00.000Z",
      updated_at: "2026-04-02T00:00:00.000Z",
    };

    expect(knowledgeTopicArraySchema.parse([topic])).toHaveLength(1);
    expect(
      knowledgeTopicDetailSchema.parse({
        ...topic,
        body_markdown: "# Longevity",
        links: [{
          id: LINK_ID,
          link_type: "archive_document",
          is_verified: true,
          sort_order: 1,
          archive_document_id: LINK_ID,
          external_url: null,
          product_id: null,
          production_batch_id: null,
        }],
      }).links,
    ).toHaveLength(1);
    expect(knowledgeTopicDetailSchema.parse({ ...topic, body_markdown: null }).links).toEqual([]);
  });

  it("validates posts and write params", () => {
    expect(
      knowledgePostArraySchema.parse([{
        id: POST_ID,
        topic_id: TOPIC_ID,
        author_display_name: null,
        body: "Evidence note",
        original_locale: "en",
        is_translated: false,
        translation_provider: null,
        status: "published",
        created_at: "2026-04-01T00:00:00.000Z",
      }])[0].body,
    ).toBe("Evidence note");

    expect(createKnowledgePostSchema.parse({ topic_id: TOPIC_ID, body: "Post body" })).toEqual({
      topic_id: TOPIC_ID,
      body: "Post body",
    });
    expect(() => createKnowledgePostSchema.parse({ topic_id: TOPIC_ID, body: "" })).toThrow();

    expect(createKnowledgeTopicSchema.parse({
      slug: "mitochondria",
      title_key: "knowledge.mitochondria.title",
      visibility: "members",
      initial_locale: "en",
    }).visibility).toBe("members");

    expect(updateKnowledgeTopicSchema.parse({
      topic_id: TOPIC_ID,
      locale: "cs",
      title: "Mitochondrie",
      commit_message: "Update localized title",
    }).topic_id).toBe(TOPIC_ID);

    expect(deleteKnowledgeTopicSchema.parse({ topic_id: TOPIC_ID })).toEqual({ topic_id: TOPIC_ID });
  });

  it("validates moderation queue and AISHA evaluation payloads", () => {
    expect(aishaEvaluationSchema.parse(null)).toBeNull();
    expect(aishaEvaluationSchema.parse({
      alignment_score: 0.95,
      verdict: "approved",
      suggestions: ["Keep source citation"],
    })?.verdict).toBe("approved");

    const item = moderationQueueItemSchema.parse({
      id: QUEUE_ID,
      resource_type: "expert_rule",
      resource_id: TOPIC_ID,
      risk_score: 0.1,
      risk_tags: ["low_risk"],
      status: "pending",
      created_at: "2026-04-01T00:00:00.000Z",
      post_body: null,
      post_author_name: null,
      topic_title: "Longevity",
      topic_slug: "longevity",
      reviewer_notes: null,
      aisha_evaluation: {
        quality_score: 0.9,
        confidence: 0.8,
        verdict: "review",
      },
      auto_decision: false,
      rule_title: "Evidence quality",
    });

    expect(item.aisha_evaluation?.verdict).toBe("review");
    expect(reviewModerationItemSchema.parse({
      queue_id: QUEUE_ID,
      decision: "approved",
      notes: "Looks good",
    }).decision).toBe("approved");
    expect(() => reviewModerationItemSchema.parse({
      queue_id: QUEUE_ID,
      decision: "maybe",
    })).toThrow();
  });
});
