/**
 * Zod validation schemas for RPC responses
 * 
 * These schemas ensure type safety between frontend and backend RPC calls.
 * All RPC responses should be validated using these schemas.
 */

import { z } from "zod";

import { safeWarn } from "@/lib/security/safeLogger";

// ============================================
// CHAT ACCESS
// ============================================

export const ChatAccessLevelSchema = z.enum([
  "none",
  "basic", 
  "enrolled",
  "active",
  "qualified",
  "certified",
  "premium",
  "pending_approval",
  "needs_questionnaire",
]);

export type ChatAccessLevelType = z.infer<typeof ChatAccessLevelSchema>;

export const ChatAccessResponseSchema = z.object({
  access_level: ChatAccessLevelSchema,
  can_chat: z.boolean(),
  block_reason: z.string().nullable(),
  has_terms_consent: z.boolean().optional(),
  has_registration: z.boolean().optional(),
  has_pending_registration: z.boolean().optional(),
  has_membership: z.boolean().optional(),
  membership_tier: z.string().nullable().optional(),
  registration_status: z.string().nullable().optional(),
  study_name: z.string().nullable().optional(),
  has_completed_questionnaire: z.boolean().optional(),
});

export type ChatAccessResponse = z.infer<typeof ChatAccessResponseSchema>;

// ============================================
// PRODUCT ACCESS
// ============================================

export const ProductAccessTypeSchema = z.enum([
  "view",
  "preorder", 
  "order",
  "auto_approve",
]);

export type ProductAccessType = z.infer<typeof ProductAccessTypeSchema>;

export const ProductAccessResponseSchema = z.object({
  access_type: ProductAccessTypeSchema,
  can_purchase: z.boolean(),
  requires_membership: z.boolean(),
  required_tier: z.string().nullable(),
  reason: z.string().nullable(),
});

export type ProductAccessResponse = z.infer<typeof ProductAccessResponseSchema>;

// ============================================
// AGENT CONFIGURATIONS (Admin)
// ============================================

export const AgentConfigurationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  display_name_key: z.string(),
  description_key: z.string(),
  agent_type: z.string(),
  model: z.string(),
  instructions: z.string(),
  instructions_version: z.number(),
  temperature: z.number().nullable(),
  max_tokens: z.number().nullable(),
  is_active: z.boolean(),
  is_primary: z.boolean(),
  routing_category: z.string().nullable(),
  tools_config: z.unknown().nullable(),
  guardrails_config: z.unknown().nullable(),
  model_settings: z.unknown().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  created_by: z.string().nullable(),
  updated_by: z.string().nullable(),
});

export type AgentConfiguration = z.infer<typeof AgentConfigurationSchema>;

export const AgentConfigurationHistorySchema = z.object({
  id: z.string().uuid(),
  agent_configuration_id: z.string().uuid(),
  version: z.number(),
  configuration_snapshot: z.unknown(),
  change_summary: z.string(),
  changed_at: z.string(),
  changed_by: z.string().nullable(),
});

export type AgentConfigurationHistory = z.infer<typeof AgentConfigurationHistorySchema>;

// ============================================
// MESSAGE ESCALATIONS
// ============================================

export const EscalationTypeSchema = z.enum([
  "clarification",
  "follow_up",
  "concern",
  "incorrect_info",
  "other",
]);

export const EscalationStatusSchema = z.enum([
  "pending",
  "viewed",
  "in_progress",
  "resolved",
  "dismissed",
]);

export const EscalationSchema = z.object({
  id: z.string().uuid(),
  message_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  partner_id: z.string().uuid(),
  user_id: z.string().uuid(),
  escalation_type: EscalationTypeSchema,
  user_note: z.string().nullable(),
  status: EscalationStatusSchema,
  priority: z.string(),
  partner_response: z.string().nullable(),
  partner_responded_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Escalation = z.infer<typeof EscalationSchema>;

export const PartnerEscalationSchema = EscalationSchema.extend({
  context_messages: z.unknown(),
});

export type PartnerEscalation = z.infer<typeof PartnerEscalationSchema>;

// ============================================
// MEMBER ACCESS SUMMARY
// ============================================

export const MemberAccessLevelSchema = z.enum([
  "none",
  "anonymized",
  "limited",
  "full",
]);

export const ConsentStatusSchema = z.enum([
  "never_asked",
  "pending",
  "granted",
  "revoked",
  "expired",
]);

export const DataCategorySchema = z.enum([
  "health_checkins",
  "lab_results",
  "documents",
  "assessments",
  "dosing_logs",
  "study_data",
]);

export const MemberActivitySchema = z.object({
  has_recent_activity: z.boolean(),
  last_checkin_at: z.string().nullable(),
  last_document_at: z.string().nullable(),
  last_lab_result_at: z.string().nullable(),
  total_checkins_30d: z.number(),
});

export type MemberActivity = z.infer<typeof MemberActivitySchema>;

// ============================================
// PARTNER ACCESS
// ============================================

export const PartnerAccessLevelSchema = z.enum([
  "none",
  "basic",
  "certified",
  "premium",
]);

export const PartnerAccessResponseSchema = z.object({
  partner_id: z.string().uuid(),
  access_level: PartnerAccessLevelSchema,
  certification_status: z.string().nullable(),
  can_use_ai: z.boolean(),
  can_view_sensitive_data: z.boolean(),
});

export type PartnerAccessResponse = z.infer<typeof PartnerAccessResponseSchema>;

// ============================================
// STUDY ENROLLMENT
// ============================================

export const RegistrationStatusSchema = z.enum([
  "pending",
  "screening",
  "enrolled",
  "active",
  "paused",
  "completed",
  "withdrawn",
]);

export const StudyRegistrationSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  study_id: z.string().uuid(),
  status: RegistrationStatusSchema,
  enrolled_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  arm_code: z.string().nullable(),
  screening_data: z.unknown().nullable(),
});

export type StudyRegistration = z.infer<typeof StudyRegistrationSchema>;

// ============================================
// GUARDRAILS CONFIG (for frontend sync)
// ============================================

export const GuardrailsConfigSchema = z.object({
  maxResponseLength: z.number(),
  allowMedicalAdvice: z.boolean(),
  allowDistributionInfo: z.boolean(),
  allowStudyDetails: z.boolean(),
  allowResearchData: z.boolean(),
  requireDisclaimer: z.boolean(),
});

export type GuardrailsConfig = z.infer<typeof GuardrailsConfigSchema>;

// ============================================
// AI CHAT MESSAGE
// ============================================

export const ChatMessageSchema = z.object({
  id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  routing_category: z.string().nullable(),
  model_used: z.string().nullable(),
  tokens_input: z.number().nullable(),
  tokens_output: z.number().nullable(),
  response_time_ms: z.number().nullable(),
  created_at: z.string(),
  // Step 2 UI: link to public.ai_runs.id so the per-message Faithfulness
  // chip + Citation panel + dual-write feedback can resolve to the run row.
  // Server returns this on /chat responses as metadata.run_id; useAiChat
  // copies that value onto the assistant ChatMessage when appending to the
  // local list. NULL for history rows fetched before this feature existed
  // (historical chat_messages don't have ai_run_id stored).
  ai_run_id: z.string().uuid().nullable().optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatResponseSchema = z.object({
  conversation_id: z.string().uuid(),
  message: z.object({
    id: z.string().uuid().nullable(),
    role: z.literal("assistant"),
    content: z.string(),
    routing_category: z.string(),
    created_at: z.string(),
  }),
  metadata: z.object({
    tokens_used: z.number(),
    response_time_ms: z.number(),
    specialist_used: z.string(),
    access_level: ChatAccessLevelSchema,
    // Step 2 UI: tracer run id (from svc-ai-chat /chat response). Already
    // surfaced by the server (chat.ts:1159) — declaring here so it flows
    // through Zod validation and reaches the UI for FaithfulnessChip +
    // CitationPanel which need an ai_runs.id to query RPCs against.
    run_id: z.string().uuid().nullable().optional(),
    aisha_run_id: z.string().uuid().nullable().optional(),
  }),
});

export type ChatResponse = z.infer<typeof ChatResponseSchema>;

// ============================================
// STORY AI CONSULT
// ============================================

export const StoryConsultActionSchema = z.enum([
  "chat",
  "recap",
  "translate",
  "recommend",
  "analyze",
]);

export const StoryConsultResponseSchema = z.object({
  session_id: z.string().uuid().nullable(),
  conversation_id: z.string().uuid(),
  response: z.string(),
  action: StoryConsultActionSchema,
  tokens_used: z.number(),
  context_included: z.object({
    user_info: z.boolean(),
    health_data: z.boolean(),
    timeline_entries: z.number(),
  }),
});

export type StoryConsultResponse = z.infer<typeof StoryConsultResponseSchema>;

// ============================================
// HERO SLIDES
// ============================================

export const HeroSlidePublicSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  subtitle: z.string(),
  badge: z.string(),
  target_audience: z.string(),
  background_image_url: z.string(),
  background_gradient: z.string(),
  cta_text: z.string(),
  cta_url: z.string(),
  linked_product_id: z.string().uuid().nullable(),
  linked_product_name: z.string(),
  linked_product_price: z.number(),
  linked_product_slug: z.string(),
  sort_order: z.number(),
  circle_icon: z.string(),
  circle_text: z.string(),
});

export type HeroSlidePublic = z.infer<typeof HeroSlidePublicSchema>;

export const HeroSlideAdminSchema = z.object({
  id: z.string().uuid(),
  base_locale: z.string(),
  title_key: z.string(),
  subtitle_key: z.string(),
  badge_key: z.string(),
  target_audience: z.string(),
  background_image_url: z.string(),
  background_gradient: z.string(),
  cta_text_key: z.string(),
  cta_url: z.string(),
  linked_product_id: z.string().uuid().nullable(),
  linked_product_name: z.string(),
  is_active: z.boolean(),
  sort_order: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
  circle_icon_key: z.string(),
  circle_text_key: z.string(),
});

export type HeroSlideAdmin = z.infer<typeof HeroSlideAdminSchema>;

// ============================================
// VALIDATION HELPERS
// ============================================

/**
 * Safely parse RPC response with Zod schema.
 * Returns null if validation fails instead of throwing.
 */
export function safeParseRpcResponse<T>(
  schema: z.ZodType<T>,
  data: unknown
): T | null {
  const result = schema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  // Avoid logging raw Zod issues: they can accidentally include sensitive values.
  safeWarn("rpc-validation:parse-failed", `issues=${result.error.issues.length}`);
  return null;
}

/**
 * Parse RPC response with Zod schema.
 * Throws if validation fails.
 */
export function parseRpcResponse<T>(
  schema: z.ZodType<T>,
  data: unknown
): T {
  return schema.parse(data);
}

/**
 * Validate array response from RPC.
 */
export function parseRpcArrayResponse<T>(
  schema: z.ZodType<T>,
  data: unknown
): T[] {
  return z.array(schema).parse(data || []);
}

// ============================================
// NEWS ARTICLES
// ============================================

export const NewsArticlePublicSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title_key: z.string(),
  content_key: z.string(),
  excerpt_key: z.string().nullable(),
  image_url: z.string().nullable(),
  published_at: z.string().nullable(),
  sort_order: z.number().optional(),
});

export type NewsArticlePublic = z.infer<typeof NewsArticlePublicSchema>;

// get_news_article_by_slug — public detail read. canvas_html/css carry the
// GrapesJS body so the detail page renders it (multilingual via data-i18n-key,
// resolved by PageRenderer); plain articles fall back to the markdown content_key.
export const NewsArticleDetailSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title_key: z.string(),
  content_key: z.string(),
  excerpt_key: z.string().nullable(),
  image_url: z.string().nullable(),
  canvas_html: z.string().nullable(),
  canvas_css: z.string().nullable(),
  published_at: z.string().nullable(),
  // Ohnisko a přiblížení titulního obrázku (2026-09-24) — výřez počítá doručení.
  image_focus_x: z.coerce.number().nullable().optional(),
  image_focus_y: z.coerce.number().nullable().optional(),
  image_zoom: z.coerce.number().nullable().optional(),
});

export type NewsArticleDetail = z.infer<typeof NewsArticleDetailSchema>;

// Hlavička článku v konceptu/verzi (news_article_versions.fields) — texty po jazycích.
export const NewsArticleFieldsSchema = z.object({
  image_url: z.string().nullable().optional(),
  image_focus_x: z.coerce.number().optional(),
  image_focus_y: z.coerce.number().optional(),
  image_zoom: z.coerce.number().optional(),
  tags: z.array(z.string()).optional(),
  texts: z.record(z.string(), z.object({
    title: z.string().optional(),
    excerpt: z.string().optional(),
    content: z.string().optional(),
  })).optional(),
});

export type NewsArticleFields = z.infer<typeof NewsArticleFieldsSchema>;

export const NewsArticleDraftSchema = z.object({
  canvas_data: z.unknown().nullable(),
  canvas_html: z.string().nullable(),
  canvas_css: z.string().nullable(),
  fields: NewsArticleFieldsSchema,
  updated_at: z.string(),
});

export type NewsArticleDraft = z.infer<typeof NewsArticleDraftSchema>;

// get_news_article_admin — editor load (full canvas + draft state), admin-only.
export const NewsArticleAdminCanvasSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title_key: z.string(),
  content_key: z.string(),
  excerpt_key: z.string().nullable(),
  image_url: z.string().nullable(),
  canvas_data: z.unknown().nullable(),
  canvas_html: z.string().nullable(),
  canvas_css: z.string().nullable(),
  is_published: z.boolean(),
  tags: z.array(z.string()),
  image_focus_x: z.coerce.number(),
  image_focus_y: z.coerce.number(),
  image_zoom: z.coerce.number(),
  updated_at: z.string(),
  // Razítko stavu, který editor upravuje (novější z článku a konceptu) — posílá se
  // zpět jako p_expected_stamp; nesedí-li, zápis skončí 409 místo přepsání cizí práce.
  edit_stamp: z.string(),
  // KONCEPT zveřejněného článku, nebo null. Editor hydratuje plátno odsud, je-li.
  draft: NewsArticleDraftSchema.nullable(),
});

export type NewsArticleAdminCanvas = z.infer<typeof NewsArticleAdminCanvasSchema>;

// Dynamic archive/blog browser row — get_published_news_articles_filtered.
// Adds author + tags + created_at that power the cards + the filter.
export const NewsArticleBrowseSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title_key: z.string(),
  content_key: z.string(),
  excerpt_key: z.string().nullable(),
  image_url: z.string().nullable(),
  published_at: z.string().nullable(),
  created_at: z.string().nullable(),
  sort_order: z.number().nullable().optional(),
  created_by: z.string().uuid().nullable(),
  author_display_name: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  image_focus_x: z.coerce.number().nullable().optional(),
  image_focus_y: z.coerce.number().nullable().optional(),
  image_zoom: z.coerce.number().nullable().optional(),
});

export type NewsArticleBrowse = z.infer<typeof NewsArticleBrowseSchema>;

// get_news_tags — the in-use tag catalog that feeds the browser's filter.
export const NewsTagSchema = z.object({
  tag: z.string(),
  usage_count: z.number(),
});

export type NewsTag = z.infer<typeof NewsTagSchema>;

export const NewsArticleAdminSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title_key: z.string(),
  content_key: z.string(),
  excerpt_key: z.string().nullable(),
  image_url: z.string().nullable(),
  is_published: z.boolean(),
  published_at: z.string().nullable(),
  sort_order: z.number(),
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  // 2026-09-24: titulek/perex v jazyce rozhraní (NULL bez překladu), štítky,
  // rozdělaný koncept, razítko pro souběh, ohnisko titulního obrázku.
  title: z.string().nullable(),
  excerpt: z.string().nullable(),
  tags: z.array(z.string()),
  has_draft: z.boolean(),
  edit_stamp: z.string(),
  image_focus_x: z.coerce.number(),
  image_focus_y: z.coerce.number(),
  image_zoom: z.coerce.number(),
});

export type NewsArticleAdmin = z.infer<typeof NewsArticleAdminSchema>;

// get_news_article_versions — historie článku (bez konceptu).
export const NewsArticleVersionSchema = z.object({
  id: z.string().uuid(),
  version_number: z.number(),
  kind: z.enum(["manual", "auto", "published", "draft"]),
  label: z.string().nullable(),
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
});

export type NewsArticleVersion = z.infer<typeof NewsArticleVersionSchema>;

// get_media_assets_admin — galerie nahraných médií.
export const MediaAssetSchema = z.object({
  id: z.string().uuid(),
  bucket: z.string(),
  object_key: z.string(),
  content_type: z.string(),
  bytes: z.coerce.number(),
  original_name: z.string().nullable(),
  uploaded_by: z.string().uuid().nullable(),
  created_at: z.string(),
});

export type MediaAsset = z.infer<typeof MediaAssetSchema>;

// ============================================================================
// RAG evaluation (Step 0 of retrieval optimization plan 2026)
// ============================================================================
// Mirrors the public.rag_eval_* schema introduced in 20260518200000_rag_eval_foundation.sql.
// Returned by fn_get_rag_baseline / fn_get_rag_run_detail.

export const RagBaselineSchema = z.object({
  context_profile_slug: z.string().nullable(),
  embedding_model: z.string(),
  llm_model: z.string(),
  n_runs: z.number().int(),
  faithfulness_avg: z.number().nullable(),
  answer_relevancy_avg: z.number().nullable(),
  context_precision_avg: z.number().nullable(),
  context_recall_avg: z.number().nullable(),
  composite_avg: z.number().nullable(),
  faithfulness_p50: z.number().nullable(),
  faithfulness_p90: z.number().nullable(),
  period_start: z.string(),
  period_end: z.string(),
});

export type RagBaseline = z.infer<typeof RagBaselineSchema>;

export const RagRunDetailSchema = z.object({
  run_id: z.string().uuid(),
  golden_id: z.string().uuid(),
  golden_slug: z.string(),
  question: z.string(),
  ground_truth_answer: z.string(),
  generated_answer: z.string().nullable(),
  context_profile_slug: z.string().nullable(),
  embedding_model: z.string(),
  llm_model: z.string(),
  retrieved_chunk_ids: z.array(z.string().uuid()),
  faithfulness_score: z.number().nullable(),
  answer_relevancy_score: z.number().nullable(),
  context_precision_score: z.number().nullable(),
  context_recall_score: z.number().nullable(),
  composite_score: z.number().nullable(),
  latency_ms: z.number().nullable(),
  cost: z.number().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string(),
});

export type RagRunDetail = z.infer<typeof RagRunDetailSchema>;

// ============================================================================
// Citations / Faithfulness / Feedback (Step 2)
// ============================================================================

export const CitationSchema = z.object({
  chunk_id: z.string().uuid().nullable(),
  chunk_index: z.number().int().nullable(),
  chunk_text: z.string().nullable(),
  contextual_prefix: z.string().nullable(),
  item_id: z.string().uuid(),
  item_title: z.string(),
  item_type: z.string(),
  section_title: z.string().nullable(),
  story_id: z.string().uuid().nullable(),
  relevance_score: z.number().nullable(),
  attribution_weight: z.number().nullable(),
  usage_intensity: z.number().nullable(),
});

export type Citation = z.infer<typeof CitationSchema>;

export const FaithfulnessScoreSchema = z.object({
  run_id: z.string().uuid(),
  faithfulness: z.number().nullable(),
  citation_count: z.number().int(),
  computed_at: z.string(),
});

export type FaithfulnessScore = z.infer<typeof FaithfulnessScoreSchema>;

/**
 * Step 7.3 — Hippocampus graph explainability.
 *
 * One row = one discovered connection from a seed KnowledgeItem (the
 * citation chunk's parent) to a target graph_node at depth 1..N.
 *
 * Field semantics:
 *  - seed_*    : the starting graph_node (always a KnowledgeItem the run cited)
 *  - target_*  : the discovered node (Concept, ExpertRule, Memory, Run, etc.)
 *  - depth     : 1 = direct neighbour, 2+ = multi-hop
 *  - cumulative_confidence : product of edge confidences along the path (0..1)
 *  - last_relationship : the relationship label on the final hop (REFERENCES, CITED, …)
 *  - path      : full uuid[] of intermediate graph_node ids — useful for
 *                rendering a breadcrumb without an extra RPC call.
 *
 * Source RPC: fn_get_run_graph_context(uuid, integer, integer)
 */
export const GraphContextRowSchema = z.object({
  seed_node_id:          z.string().uuid(),
  seed_entity_type:      z.string(),
  seed_label:            z.string(),
  target_node_id:        z.string().uuid(),
  target_entity_type:    z.string(),
  target_label:          z.string(),
  depth:                 z.number().int(),
  cumulative_confidence: z.number().nullable(),
  last_relationship:     z.string().nullable(),
  path:                  z.array(z.string().uuid()),
});

export type GraphContextRow = z.infer<typeof GraphContextRowSchema>;

/**
 * Step W1 — Platform warmup wizard state.
 *
 * Sourced from fn_get_platform_warmup_state() which derives the state
 * from audit_journal rows where action='warmup.step_completed'. The
 * RPC also exposes the live KB count for the stack-default story so
 * the wizard can validate the kb_upload step against fresh data
 * (not stamped-then-stale).
 *
 *  - needs_warmup            : true until the 'complete' step is stamped
 *  - default_story_id        : nullable when ensure_stack_default_story
 *                              hasn't run yet (cold start before bootstrap)
 *  - completed_steps         : alphabetically-sorted set of step slugs
 *                              already in the audit log
 *  - last_step / last_step_at: timestamp of the most recent step row
 *  - default_story_kb_count  : live SELECT count(*) — survives admin
 *                              deleting items after marking kb_upload done
 */
export const WarmupStepSchema = z.enum([
  'welcome', 'kb_upload', 'rules_setup', 'test_query', 'complete',
]);

export type WarmupStep = z.infer<typeof WarmupStepSchema>;

export const PlatformWarmupStateSchema = z.object({
  needs_warmup:            z.boolean(),
  default_story_id:        z.string().uuid().nullable(),
  completed_steps:         z.array(WarmupStepSchema),
  last_step:               WarmupStepSchema.nullable(),
  last_step_at:            z.string().nullable(),
  default_story_kb_count:  z.number().int(),
});

export type PlatformWarmupState = z.infer<typeof PlatformWarmupStateSchema>;

export const WarmupStepCompletedSchema = z.object({
  audit_id:    z.string().uuid(),
  step:        WarmupStepSchema,
  recorded_by: z.string().uuid().nullable(),
  recorded_at: z.string(),
});

export type WarmupStepCompleted = z.infer<typeof WarmupStepCompletedSchema>;
