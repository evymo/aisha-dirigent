/**
 * Zod schemas for knowledge base
 *
 * @module lib/schemas/knowledgeBaseSchemas
 */

import { z } from "zod";

/**
 * Schema for a knowledge topic (list view)
 */
export const knowledgeTopicSchema = z.object({
    id: z.string().uuid(),
    slug: z.string(),
    title: z.string(),
    summary: z.string().nullable(),
    visibility: z.string(),
    verification_status: z.string(),
    source_locale: z.string(),
    is_locked: z.boolean(),
    post_count: z.number(),
    created_at: z.string(),
    updated_at: z.string(),
});

export const knowledgeTopicArraySchema = z.array(knowledgeTopicSchema);

/**
 * Schema for a knowledge topic link (inside detail)
 */
export const knowledgeTopicLinkSchema = z.object({
    id: z.string().uuid(),
    link_type: z.string(),
    is_verified: z.boolean(),
    sort_order: z.number(),
    archive_document_id: z.string().uuid().nullable(),
    external_url: z.string().nullable(),
    product_id: z.string().uuid().nullable(),
    production_batch_id: z.string().uuid().nullable(),
});

/**
 * Schema for a knowledge topic (detail view)
 */
export const knowledgeTopicDetailSchema = z.object({
    id: z.string().uuid(),
    slug: z.string(),
    title: z.string(),
    summary: z.string().nullable(),
    visibility: z.string(),
    verification_status: z.string(),
    source_locale: z.string(),
    is_locked: z.boolean(),
    body_markdown: z.string().nullable(),
    links: z.array(knowledgeTopicLinkSchema).default([]),
    post_count: z.number(),
    created_at: z.string(),
    updated_at: z.string(),
});

/**
 * Schema for a knowledge post
 */
export const knowledgePostSchema = z.object({
    id: z.string().uuid(),
    topic_id: z.string().uuid(),
    author_display_name: z.string().nullable(),
    body: z.string(),
    original_locale: z.string(),
    is_translated: z.boolean(),
    translation_provider: z.string().nullable(),
    status: z.string(),
    created_at: z.string(),
});

export const knowledgePostArraySchema = z.array(knowledgePostSchema);

export type KnowledgeTopicRow = z.infer<typeof knowledgeTopicSchema>;
export type KnowledgeTopic = KnowledgeTopicRow; // Alias for convenience

export const createKnowledgePostSchema = z.object({
    body: z.string().min(1),
    topic_id: z.string().uuid(),
});

export type CreateKnowledgePostParams = z.infer<typeof createKnowledgePostSchema>;

// Admin Schemas
export const createKnowledgeTopicSchema = z.object({
    slug: z.string().min(3),
    // ... existing content ...
    title_key: z.string(),
    summary_key: z.string().nullable().optional(),
    visibility: z.enum(["public", "members", "archived"]).optional(),
    initial_locale: z.string().optional(),
    initial_title: z.string().optional(),
    initial_summary: z.string().optional(),
    initial_body: z.string().optional(),
});

export const updateKnowledgeTopicSchema = z.object({
    topic_id: z.string().uuid(),
    slug: z.string().optional(),
    title_key: z.string().optional(),
    summary_key: z.string().optional(),
    visibility: z.enum(["public", "members", "archived"]).optional(),
    locale: z.string(),
    title: z.string().optional(),
    summary: z.string().optional(),
    body: z.string().optional(),
    commit_message: z.string().optional(),
});

export const deleteKnowledgeTopicSchema = z.object({
    topic_id: z.string().uuid(),
});

/** AISHA compliance gate evaluation result (jsonb from aisha_evaluation column) */
export const aishaEvaluationSchema = z.object({
    alignment_score: z.number().optional(),
    security_score: z.number().optional(),
    quality_score: z.number().optional(),
    confidence: z.number().optional(),
    verdict: z.string().optional(),
    reason: z.string().optional(),
    suggestions: z.array(z.string()).optional(),
}).nullable().optional();
export type AishaEvaluation = z.infer<typeof aishaEvaluationSchema>;

export const moderationQueueItemSchema = z.object({
    id: z.string().uuid(),
    resource_type: z.string(),
    resource_id: z.string().uuid(),
    risk_score: z.number().nullable(),
    risk_tags: z.array(z.string()).nullable(),
    status: z.string(),
    created_at: z.string(),
    post_body: z.string().nullable(),
    post_author_name: z.string().nullable(),
    topic_title: z.string().nullable(),
    topic_slug: z.string().nullable(),
    reviewer_notes: z.string().nullable().optional(),
    /** AISHA compliance gate evaluation (expert_rule items) */
    aisha_evaluation: aishaEvaluationSchema,
    /** Whether AISHA auto-approved/rejected this item */
    auto_decision: z.boolean().nullable().optional(),
    /** Expert rule title (when resource_type = 'expert_rule') */
    rule_title: z.string().nullable().optional(),
});

export const reviewModerationItemSchema = z.object({
    decision: z.enum(["approved", "rejected"]),
    notes: z.string().optional(),
    queue_id: z.string().uuid(),
});

export type CreateKnowledgeTopicParams = z.infer<typeof createKnowledgeTopicSchema>;
export type UpdateKnowledgeTopicParams = z.infer<typeof updateKnowledgeTopicSchema>;
export type DeleteKnowledgeTopicParams = z.infer<typeof deleteKnowledgeTopicSchema>;
export type ModerationQueueItem = z.infer<typeof moderationQueueItemSchema>;
export type ReviewModerationItemParams = z.infer<typeof reviewModerationItemSchema>;
export type KnowledgeTopicDetailRow = z.infer<typeof knowledgeTopicDetailSchema>;
export type KnowledgeTopicLinkRow = z.infer<typeof knowledgeTopicLinkSchema>;
export type KnowledgePostRow = z.infer<typeof knowledgePostSchema>;
