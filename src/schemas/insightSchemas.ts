/**
 * Insight schemas — Ragnarok (RAG retrieval), Maestro (dialog management),
 * a model registry for Alquist Insight integraci.
 *
 * AISHA principy:
 * - Hook-Only Data Access (CLAUDE.md bod 1) — všechen přístup přes hooky.
 * - Zod Validation (CLAUDE.md bod 3) — všechna externí data parsována přes tato schemata.
 * - i18n keys (CLAUDE.md bod 4) — UI komponenty čtou error messages přes t().
 *
 * Frontend NIKDY nesmí volat Maestro přímo — viz `useStoryConsult` (svc-ai-chat
 * orchestrace s Tao/Psyche/Hippocampus/governance brain wiringem). Tato schemata
 * pokrývají Ragnarok read-only retrieval a model registry pro admin layer.
 */
import { z } from 'zod';

// =============================================================================
// Ragnarok — read-only hybrid search (BM25 + KNN over Elasticsearch)
// =============================================================================

export const RagnarokSearchRequestSchema = z.object({
  query: z.string().min(1).max(10_000),
  project_id: z.string().optional(),
  kb_ids: z.array(z.string()).optional(),
  lang: z.string().optional(),
  context: z.array(z.object({
    role: z.string(),
    content: z.string(),
  })).optional(),
  return_highlights: z.boolean().optional().default(false),
  return_matched_chunks: z.boolean().optional().default(false),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export type RagnarokSearchRequest = z.infer<typeof RagnarokSearchRequestSchema>;

export const RagnarokMatchedChunkSchema = z.object({
  chunk_id: z.string().optional(),
  knowledge_item_id: z.string().optional(),
  source_slug: z.string().optional(),
  title: z.string().optional(),
  chunk_text: z.string().optional(),
  score: z.number().optional(),
  highlight: z.string().optional(),
  bm25_score: z.number().optional(),
  knn_score: z.number().optional(),
  source: z.enum(['ragnarok', 'pgvector']).optional(),
});

export type RagnarokMatchedChunk = z.infer<typeof RagnarokMatchedChunkSchema>;

export const RagnarokSearchResponseSchema = z.object({
  ok: z.literal(true).optional(),
  data: z.object({
    answer: z.string().optional(),
    generated_text: z.string().optional(),
    matched_chunks: z.array(RagnarokMatchedChunkSchema).optional(),
    chunks: z.array(RagnarokMatchedChunkSchema).optional(),
    sources: z.array(z.unknown()).optional(),
    project_id: z.string().optional(),
  }).passthrough().optional(),
});

export type RagnarokSearchResponse = z.infer<typeof RagnarokSearchResponseSchema>;

// =============================================================================
// Story KB Upload (přes existující knowledge_items pipeline — auto_embed_trigger
// + WF_KB_RAGNAROK_SYNC). Frontend volá RPC, ne Ragnarok upload napřímo.
// =============================================================================

export const StoryKnowledgeItemSchema = z.object({
  id: z.string().uuid(),
  story_id: z.string().uuid(),
  title: z.string(),
  source_slug: z.string().optional(),
  status: z.string().optional(),
  item_type: z.string().optional(),
  body_markdown: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  language: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string().optional(),
  embedding_status: z.string().optional(),
  ragnarok_indexed_at: z.string().nullable().optional(),
});

export type StoryKnowledgeItem = z.infer<typeof StoryKnowledgeItemSchema>;

// =============================================================================
// AI Model Registry — admin layer (model switch UI v Dirigent extenzi + admin)
// =============================================================================

export const AiModelRegistryEntrySchema = z.object({
  id: z.string().uuid(),
  provider: z.string(),
  model_id: z.string(),
  display_name: z.string().nullable(),
  model_family: z.string().nullable(),
  is_admin_active: z.boolean(),
  is_available: z.boolean(),
  is_deprecated: z.boolean(),
  context_window: z.number().nullable(),
  max_output_tokens: z.number().nullable(),
  input_price_per_m: z.number().nullable(),
  output_price_per_m: z.number().nullable(),
  eval_status: z.string().nullable(),
  latest_eval_score: z.number().nullable(),
});

export type AiModelRegistryEntry = z.infer<typeof AiModelRegistryEntrySchema>;

export const AiModelRegistryListSchema = z.array(AiModelRegistryEntrySchema);

export type AiModelRegistryList = z.infer<typeof AiModelRegistryListSchema>;

export const SetActiveAiModelRequestSchema = z.object({
  provider: z.string().min(1),
  model_id: z.string().min(1),
  is_active: z.boolean().optional().default(true),
});

export type SetActiveAiModelRequest = z.infer<typeof SetActiveAiModelRequestSchema>;

export const SetActiveAiModelResponseSchema = z.object({
  ok: z.boolean(),
  provider: z.string(),
  model_id: z.string(),
  is_admin_active: z.boolean(),
  previous_state: z.boolean().nullable().optional(),
});

export type SetActiveAiModelResponse = z.infer<typeof SetActiveAiModelResponseSchema>;
