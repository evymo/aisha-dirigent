/**
 * StoryLoop Zod Schemas
 * 
 * Type-safe validation for all StoryLoop RPC responses.
 * Following the RPC-only pattern with strict validation.
 */

import { z } from 'zod';

// =====================================================
// Enums
// =====================================================

export const StoryStatusSchema = z.enum([
  'active',
  'inbox',
  'in_progress',
  'scheduled',
  'archived',
  'trash'
]);

export const StoryPrioritySchema = z.enum([
  'low',
  'normal',
  'high',
  'urgent'
]);

export const StoryEntryTypeSchema = z.enum([
  'note',
  'action',
  'system',
  'health_event',
  'request',
  'message',
  'email',
  'ai_recap',
  'document',
  'appointment',
  'translation',
  // Structured block types
  'meeting_request',      // Request for scheduling a meeting
  'questionnaire_request', // Request to fill a questionnaire/test
  'consent_request',       // Request for consent signature
  'lab_order',             // Lab test order
  'distribution_adjustment',     // Distribution change notification
  'blood_matrix_analysis', // Blood drop matrix (3x3) analysis
  'product_info',          // Product/batch transparency info shared in story
  // Web artifact pipeline block types (story-driven web design)
  'web_artifact_upload',          // Operator uploaded a static folder
  'web_artifact_scrape',          // Operator asked to scrape a URL
  'web_artifact_aisha_proposal',  // Aisha-side: parsed/redesigned canvas ready for review
  'web_artifact_applied',         // Canvas applied to a web_pages row
  'web_artifact_published',       // web_pages.status flipped to 'published'
  'web_artifact_failed',          // Pipeline failed (parser, LLM verify, apply guard)
  // QA / Playwright pipeline block types (deployed env E2E)
  'qa_playwright_requested',      // Run queued (staging_auto from WF_DEPLOY_STORY or production_manual)
  'qa_playwright_approved',       // Admin approved a production_manual run (segregation of duties)
  'qa_playwright_passed',         // Run finished green; B/G slot marked healthy
  'qa_playwright_failed',         // Run failed/errored; staging_auto auto-requests rollback
  // Member diary block types (logged through composer or quick-actions)
  'product_log',        // Member logs product intake
  'health_log',            // Member logs health state severity
  // Flowboard automation provenance (AISHA Flowboard runs)
  'flow_run',                       // Umbrella: an automation run started
  'automation_step',                // One executed node in a Flowboard run
  // Reprice flow (hub compose → human gate → commerce-target write-back)
  'reprice_proposal',               // Reprice proposal awaiting confirm/reject on the story
]);

export type StoryEntryType = z.infer<typeof StoryEntryTypeSchema>;

// =====================================================
// Entry Block Metadata Schemas
// =====================================================

export const MeetingRequestMetadataSchema = z.object({
  type: z.literal('meeting_request'),
  proposed_times: z.array(z.object({
    start: z.string(), // ISO datetime
    end: z.string().optional(),
  })).optional(),
  meeting_type: z.enum(['onboarding', 'consultation', 'check_in', 'urgent', 'other']),
  location: z.enum(['video', 'phone', 'in_person']).optional(),
  status: z.enum(['pending', 'accepted', 'declined', 'rescheduled', 'completed']),
  accepted_time: z.string().optional(),
  notes: z.string().optional(),
});

export type MeetingRequestMetadata = z.infer<typeof MeetingRequestMetadataSchema>;

export const QuestionnaireRequestMetadataSchema = z.object({
  type: z.literal('questionnaire_request'),
  questionnaire_key: z.string(), // e.g., 'OS-SUBJECTIVE', 'WOMAC'
  questionnaire_name: z.string(),
  due_date: z.string().optional(),
  status: z.enum(['pending', 'started', 'completed', 'expired']),
  completed_at: z.string().optional(),
  response_id: z.string().uuid().optional(),
  reminder_sent: z.boolean().optional(),
  token_reward: z.number().nullable().optional(), // Reward for completion
});

export type QuestionnaireRequestMetadata = z.infer<typeof QuestionnaireRequestMetadataSchema>;

export const ConsentRequestMetadataSchema = z.object({
  type: z.literal('consent_request'),
  consent_template_key: z.string(),
  consent_name: z.string(),
  status: z.enum(['pending', 'signed', 'declined', 'expired']),
  signed_at: z.string().optional(),
  consent_id: z.string().uuid().optional(),
  requires_signature: z.boolean(),
});

export type ConsentRequestMetadata = z.infer<typeof ConsentRequestMetadataSchema>;

export const LabOrderMetadataSchema = z.object({
  type: z.literal('lab_order'),
  lab_name: z.string().optional(),
  tests: z.array(z.string()),
  scheduled_date: z.string().optional(),
  status: z.enum(['ordered', 'scheduled', 'completed', 'results_ready', 'reviewed']),
  result_id: z.string().uuid().optional(),
});

export type LabOrderMetadata = z.infer<typeof LabOrderMetadataSchema>;

export const DistributionAdjustmentMetadataSchema = z.object({
  type: z.literal('distribution_adjustment'),
  product_name: z.string(),
  previous_dose: z.string().optional(),
  new_dose: z.string(),
  effective_from: z.string(),
  reason: z.string().optional(),
  adjustment_id: z.string().uuid().optional(),
});

export type DistributionAdjustmentMetadata = z.infer<typeof DistributionAdjustmentMetadataSchema>;

const BloodMatrixCellKeySchema = z.enum([
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
]);

const BloodMatrixGradeSchema = z.enum(['0', 'I', 'II', 'III']);

const BloodMatrixCellSchema = z.object({
  grade: BloodMatrixGradeSchema,
  note: z.string().optional(),
});

const BloodMatrixMatrixSchema = z.object({
  '1': BloodMatrixCellSchema,
  '2': BloodMatrixCellSchema,
  '3': BloodMatrixCellSchema,
  '4': BloodMatrixCellSchema,
  '5': BloodMatrixCellSchema,
  '6': BloodMatrixCellSchema,
  '7': BloodMatrixCellSchema,
  '8': BloodMatrixCellSchema,
  '9': BloodMatrixCellSchema,
});

const BloodMatrixProductRecommendationSchema = z.object({
  code: z.string(),
  priority: z.enum(['core', 'support', 'optional']),
  reason_cell_keys: z.array(BloodMatrixCellKeySchema),
});

const BloodMatrixSeveritySchema = z.object({
  level: z.enum(['low', 'moderate', 'elevated', 'high']),
  protocol_steps: z.number().int(),
  recommended_days_min: z.number().int(),
  recommended_days_max: z.number().int(),
});

export const BloodMatrixAnalysisMetadataSchema = z.object({
  type: z.literal('blood_matrix_analysis'),
  sample_date: z.string(),
  analysis_source: z.enum(['manual', 'ai_photo', 'hybrid']),
  matrix: BloodMatrixMatrixSchema,
  counts: z.object({
    I: z.number().int(),
    II: z.number().int(),
    III: z.number().int(),
  }),
  weighted_score: z.number(),
  severity: BloodMatrixSeveritySchema,
  protocol_step_keys: z.array(z.string()),
  product_recommendations: z.array(BloodMatrixProductRecommendationSchema),
  severe_parasite_signal: z.boolean(),
  report_text: z.string().optional(),
  ai_prompt: z.string().optional(),
  ai_summary: z.string().optional(),
  summary_note: z.string().optional(),
  next_check_date: z.string().optional(),
});

export type BloodMatrixAnalysisMetadata = z.infer<typeof BloodMatrixAnalysisMetadataSchema>;

export const ProductInfoMetadataSchema = z.object({
  type: z.literal('product_info'),
  product_id: z.string().uuid(),
  product_name: z.string(),
  product_slug: z.string(),
  batch_code: z.string().optional(),
  batch_id: z.string().uuid().optional(),
  context: z.enum(['dispensed', 'recommended', 'info_shared']),
  notes: z.string().optional(),
  knowledge_topic_slug: z.string().optional(),
});

export type ProductInfoMetadata = z.infer<typeof ProductInfoMetadataSchema>;

// =====================================================
// Web artifact pipeline metadata schemas
// =====================================================

const WebArtifactRuntimeBlockSuggestionSchema = z.object({
  kind: z.enum(['runtime_block', 'preserve_as_static']),
  element_path: z.string(),
  suggested_block_type: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  data_block_config: z.record(z.unknown()).default({}),
  original_html_snippet: z.string(),
  reason: z.string(),
  suggested_followup_story: z.string().optional(),
});

export const WebArtifactUploadMetadataSchema = z.object({
  type: z.literal('web_artifact_upload'),
  job_id: z.string().uuid(),
  source_storage_path: z.string(),
  source_filename: z.string().optional(),
});
export type WebArtifactUploadMetadata = z.infer<typeof WebArtifactUploadMetadataSchema>;

export const WebArtifactScrapeMetadataSchema = z.object({
  type: z.literal('web_artifact_scrape'),
  job_id: z.string().uuid(),
  source_url: z.string().url(),
});
export type WebArtifactScrapeMetadata = z.infer<typeof WebArtifactScrapeMetadataSchema>;

export const WebArtifactAishaProposalMetadataSchema = z.object({
  type: z.literal('web_artifact_aisha_proposal'),
  job_id: z.string().uuid(),
  source_type: z.enum(['folder_upload', 'url_scrape', 'manual', 'default_seed', 'llm_redesign']),
  style_band: z.string().optional(),
  mock_mode: z.boolean().optional(),
  runtime_block_suggestions: z.array(WebArtifactRuntimeBlockSuggestionSchema).default([]),
});
export type WebArtifactAishaProposalMetadata = z.infer<typeof WebArtifactAishaProposalMetadataSchema>;

export const WebArtifactAppliedMetadataSchema = z.object({
  type: z.literal('web_artifact_applied'),
  job_id: z.string().uuid(),
  page_id: z.string().uuid(),
  pre_apply_version_id: z.string().uuid().optional(),
  published: z.boolean().optional(),
});
export type WebArtifactAppliedMetadata = z.infer<typeof WebArtifactAppliedMetadataSchema>;

export const WebArtifactPublishedMetadataSchema = z.object({
  type: z.literal('web_artifact_published'),
  job_id: z.string().uuid(),
  page_id: z.string().uuid(),
  slug: z.string(),
});
export type WebArtifactPublishedMetadata = z.infer<typeof WebArtifactPublishedMetadataSchema>;

export const WebArtifactFailedMetadataSchema = z.object({
  type: z.literal('web_artifact_failed'),
  job_id: z.string().uuid(),
  kind: z.enum(['ingest_upload', 'ingest_scrape', 'redesign', 'apply']),
  error_message: z.string(),
});
export type WebArtifactFailedMetadata = z.infer<typeof WebArtifactFailedMetadataSchema>;

// QA / Playwright (deployed env E2E) — mirrors web_artifact_* shape.
// `run_id` references playwright_runs.id; `app_name`/`active_slot` link the B/G slot
// whose health was updated. `rollback_id` is non-null when failed staging_auto
// auto-requested a rollback via request_rollback().

export const QaPlaywrightRequestedMetadataSchema = z.object({
  type: z.literal('qa_playwright_requested'),
  run_id: z.string().uuid(),
  trigger_kind: z.enum(['staging_auto', 'production_manual', 'scheduled']),
  target_env: z.string(),
  target_base_url: z.string().url(),
  app_name: z.string().nullable().optional(),
  active_slot: z.enum(['blue', 'green']).nullable().optional(),
  suite: z.string().default('all'),
  deploy_ref: z.string().nullable().optional(),
  approval_required: z.boolean(),
});
export type QaPlaywrightRequestedMetadata = z.infer<typeof QaPlaywrightRequestedMetadataSchema>;

export const QaPlaywrightApprovedMetadataSchema = z.object({
  type: z.literal('qa_playwright_approved'),
  run_id: z.string().uuid(),
  target_env: z.string(),
});
export type QaPlaywrightApprovedMetadata = z.infer<typeof QaPlaywrightApprovedMetadataSchema>;

export const QaPlaywrightPassedMetadataSchema = z.object({
  type: z.literal('qa_playwright_passed'),
  run_id: z.string().uuid(),
  result_status: z.literal('passed'),
  total: z.number().nullable().optional(),
  passed: z.number().nullable().optional(),
  failed: z.number().nullable().optional(),
  skipped: z.number().nullable().optional(),
  duration_ms: z.number().nullable().optional(),
  report_storage_path: z.string().nullable().optional(),
  app_name: z.string().nullable().optional(),
  active_slot: z.enum(['blue', 'green']).nullable().optional(),
  rollback_id: z.string().uuid().nullable().optional(),
});
export type QaPlaywrightPassedMetadata = z.infer<typeof QaPlaywrightPassedMetadataSchema>;

export const QaPlaywrightFailedMetadataSchema = z.object({
  type: z.literal('qa_playwright_failed'),
  run_id: z.string().uuid(),
  result_status: z.enum(['failed', 'errored']),
  total: z.number().nullable().optional(),
  passed: z.number().nullable().optional(),
  failed: z.number().nullable().optional(),
  skipped: z.number().nullable().optional(),
  duration_ms: z.number().nullable().optional(),
  report_storage_path: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  app_name: z.string().nullable().optional(),
  active_slot: z.enum(['blue', 'green']).nullable().optional(),
  rollback_id: z.string().uuid().nullable().optional(),
});
export type QaPlaywrightFailedMetadata = z.infer<typeof QaPlaywrightFailedMetadataSchema>;

// Union of all block metadata types
export const EntryBlockMetadataSchema = z.discriminatedUnion('type', [
  MeetingRequestMetadataSchema,
  QuestionnaireRequestMetadataSchema,
  ConsentRequestMetadataSchema,
  LabOrderMetadataSchema,
  DistributionAdjustmentMetadataSchema,
  BloodMatrixAnalysisMetadataSchema,
  ProductInfoMetadataSchema,
  WebArtifactUploadMetadataSchema,
  WebArtifactScrapeMetadataSchema,
  WebArtifactAishaProposalMetadataSchema,
  WebArtifactAppliedMetadataSchema,
  WebArtifactPublishedMetadataSchema,
  WebArtifactFailedMetadataSchema,
  QaPlaywrightRequestedMetadataSchema,
  QaPlaywrightApprovedMetadataSchema,
  QaPlaywrightPassedMetadataSchema,
  QaPlaywrightFailedMetadataSchema,
]);

export type EntryBlockMetadata = z.infer<typeof EntryBlockMetadataSchema>;

export const StoryAiSessionTypeSchema = z.enum([
  'consultation',
  'recap',
  'translation',
  'recommendation',
  'analysis'
]);

// =====================================================
// Label Schema
// =====================================================

export const StoryLabelSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string(),
  color: z.string(),
});

export type StoryLabel = z.infer<typeof StoryLabelSchema>;

// =====================================================
// Story List Item Schema (from get_my_stories_audited)
// =====================================================

export const StoryListItemSchema = z.object({
  id: z.string().uuid(),
  partner_id: z.string().uuid(),
  user_id: z.string().uuid(),
  study_id: z.string().uuid().nullable(),
  title: z.string(),
  status: StoryStatusSchema,
  priority: StoryPrioritySchema,
  is_starred: z.boolean(),
  is_read: z.boolean(),
  unread_count: z.number(),
  last_activity_at: z.string(),
  created_at: z.string(),
  user_display_name: z.string().nullable(),
  study_name: z.string().nullable(),
  last_entry_preview: z.string().nullable(),
  labels: z.array(StoryLabelSchema).or(z.null()).transform(v => v ?? []),
  is_shared: z.boolean().optional(),
  participation_role: z.string().nullable().optional(),
});

export type StoryListItem = z.infer<typeof StoryListItemSchema>;

// =====================================================
// Document Preview Schema
// =====================================================

export const DocumentPreviewSchema = z.object({
  file_name: z.string(),
  mime_type: z.string().nullable(),
  category: z.string(),
});

export type DocumentPreview = z.infer<typeof DocumentPreviewSchema>;

// =====================================================
// Story Entry Schema
// =====================================================

export const StoryEntrySchema = z.object({
  id: z.string().uuid(),
  parent_id: z.string().uuid().nullable(),
  entry_type: StoryEntryTypeSchema,
  content: z.string().nullable(),
  metadata: z.record(z.unknown()),
  is_internal: z.boolean(),
  is_pinned: z.boolean(),
  document_id: z.string().uuid().nullable(),
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
  created_by_name: z.string().nullable(),
  document_preview: DocumentPreviewSchema.nullable(),
});

export type StoryEntry = z.infer<typeof StoryEntrySchema>;

// =====================================================
// Story Reminder Schema
// =====================================================

export const StoryReminderSchema = z.object({
  id: z.string().uuid(),
  remind_at: z.string(),
  message: z.string().nullable(),
  is_completed: z.boolean(),
});

export type StoryReminder = z.infer<typeof StoryReminderSchema>;

// =====================================================
// Story Participant Schema
// =====================================================

export const StoryParticipantRoleSchema = z.enum([
  'member',
  'partner',
  'guild_expert',
  'aisha',
]);

export type StoryParticipantRole = z.infer<typeof StoryParticipantRoleSchema>;

export const StoryParticipantSchema = z.object({
  user_id: z.string().uuid(),
  role: z.string(),
  joined_at: z.string(),
  display_name: z.string().nullable(),
  avatar_url: z.string().nullable().optional(),
  certification_level: z.string().nullable().optional(),
  business_name: z.string().nullable().optional(),
});

export type StoryParticipant = z.infer<typeof StoryParticipantSchema>;

// =====================================================
// Story Detail Schema (from get_story_detail_audited)
// =====================================================

export const StoryDetailSchema = z.object({
  id: z.string().uuid(),
  partner_id: z.string().uuid(),
  user_id: z.string().uuid(),
  study_id: z.string().uuid().nullable(),
  title: z.string(),
  status: StoryStatusSchema,
  priority: StoryPrioritySchema,
  is_starred: z.boolean(),
  is_read: z.boolean(),
  unread_count: z.number(),
  last_activity_at: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  user_display_name: z.string().nullable(),
  study_name: z.string().nullable(),
  labels: z.array(StoryLabelSchema).or(z.null()).transform(v => v ?? []),
  entries: z.array(StoryEntrySchema).or(z.null()).transform(v => v ?? []),
  reminders: z.array(StoryReminderSchema).or(z.null()).transform(v => v ?? []),
  participants: z.array(StoryParticipantSchema).or(z.null()).transform(v => v ?? []).optional(),
  viewer_role: z.string().nullable().optional(),
  is_shared: z.boolean().optional(),
});

export type StoryDetail = z.infer<typeof StoryDetailSchema>;

// =====================================================
// Story Stats Schema (from get_partner_story_stats)
// =====================================================

export const StoryStatsSchema = z.object({
  active_count: z.number(),
  inbox_count: z.number(),
  in_progress_count: z.number(),
  scheduled_count: z.number(),
  archived_count: z.number(),
  starred_count: z.number(),
  unread_total: z.number(),
});

export type StoryStats = z.infer<typeof StoryStatsSchema>;

// =====================================================
// Admin StoryLoop Overview Schema (non-sensitive aggregates)
// =====================================================

export const AdminStoryLoopOverviewSchema = z.object({
  total_stories: z.coerce.number(),
  active_stories: z.coerce.number(),
  stories_active_7d: z.coerce.number(),
  stories_active_30d: z.coerce.number(),
  inbox_count: z.coerce.number(),
  in_progress_count: z.coerce.number(),
  scheduled_count: z.coerce.number(),
  archived_count: z.coerce.number(),
  trash_count: z.coerce.number(),
  starred_count: z.coerce.number(),
  unread_total: z.coerce.number(),
  total_entries: z.coerce.number(),
  entries_7d: z.coerce.number(),
  entries_30d: z.coerce.number(),
  reminders_upcoming_7d: z.coerce.number(),
  reminders_overdue: z.coerce.number(),
  partners_active: z.coerce.number(),
  members_covered: z.coerce.number(),
});

export type AdminStoryLoopOverview = z.infer<typeof AdminStoryLoopOverviewSchema>;

// =====================================================
// Admin Story List Item Schema (from get_all_stories_admin_audited)
// =====================================================

export const AdminStoryListItemSchema = z.object({
  id: z.string().uuid(),
  partner_id: z.string().uuid(),
  user_id: z.string().uuid(),
  study_id: z.string().uuid().nullable(),
  title: z.string(),
  status: StoryStatusSchema,
  priority: StoryPrioritySchema,
  is_starred: z.boolean(),
  is_read: z.boolean(),
  unread_count: z.number(),
  last_activity_at: z.string(),
  created_at: z.string(),
  user_display_name: z.string().nullable(),
  partner_display_name: z.string().nullable(),
  study_name: z.string().nullable(),
  last_entry_preview: z.string().nullable(),
  labels: z.array(StoryLabelSchema).or(z.null()).transform(v => v ?? []),
  entry_count: z.coerce.number(),
  total_count: z.coerce.number(),
});

export type AdminStoryListItem = z.infer<typeof AdminStoryListItemSchema>;

// =====================================================
// Upcoming Reminder Schema
// =====================================================

export const UpcomingReminderSchema = z.object({
  id: z.string().uuid(),
  story_id: z.string().uuid(),
  story_title: z.string(),
  user_display_name: z.string().nullable(),
  remind_at: z.string(),
  message: z.string().nullable(),
  is_overdue: z.boolean(),
});

export type UpcomingReminder = z.infer<typeof UpcomingReminderSchema>;

// =====================================================
// Label Stats Schema
// =====================================================

export const LabelStatsSchema = z.object({
  label: z.string(),
  color: z.string(),
  story_count: z.number(),
});

export type LabelStats = z.infer<typeof LabelStatsSchema>;

// =====================================================
// AI Context Schema (from get_story_context_for_ai_audited)
// =====================================================

export const StoryAiContextSchema = z.object({
  story_id: z.string().uuid(),
  study_id: z.string().uuid().nullable(),
  has_consent: z.boolean(),
  viewer_mode: z.string().optional(),
  timeline_summary: z.array(z.object({
    type: StoryEntryTypeSchema,
    date: z.string(),
    preview: z.string().nullable(),
  })).nullable(),
  study_info: z.object({
    name: z.string(),
    status: z.string(),
  }).nullable(),
  recent_checkins: z.array(z.object({
    date: z.string(),
    type: z.string(),
    pain_level: z.number().nullable(),
    energy_level: z.number().nullable(),
    mood_level: z.number().nullable(),
  })).nullable().optional(),
  shared_documents_count: z.number().optional(),
});

export type StoryAiContext = z.infer<typeof StoryAiContextSchema>;

// =====================================================
// AI Consult Request/Response Schemas
// =====================================================

export const AiConsultActionSchema = z.enum([
  'chat',
  'recap',
  'translate',
  'recommend',
  'analyze'
]);

export type AiConsultAction = z.infer<typeof AiConsultActionSchema>;

export const AiConsultRequestSchema = z.object({
  story_id: z.string().uuid(),
  action: AiConsultActionSchema,
  message: z.string().optional(),
  target_language: z.string().optional(),
  entry_ids: z.array(z.string().uuid()).optional(),
  include_health_data: z.boolean().optional(),
  conversation_id: z.string().uuid().optional(),
  language: z.enum(["cs", "en"]).optional(),
});

export type AiConsultRequest = z.infer<typeof AiConsultRequestSchema>;

/**
 * Brain-aware metadata returned by svc-ai-chat /story-consult orchestrace.
 * Reflects Tao + Psyche + Hippocampus + Ragnarok integraci.
 *
 * Všechna pole jsou optional pro backward compatibility se starším klientem.
 */
export const AiConsultMetadataSchema = z.object({
  response_time_ms: z.number().optional(),
  model: z.string().optional(),
  /** "maestro" pokud byl použit Maestro dialog management (multi-turn USP), jinak undefined. */
  provider: z.string().optional(),
  /** Personality trait slugs (Psyche DNA + Hippocampus evolved) použité v system promptu. */
  personality_traits_used: z.array(z.string()).optional(),
  /** Počet Tao governance principles aplikovaných (warmth floor, no-punitivity, …). */
  governance_tao_applied: z.number().optional(),
  /** Počet KB chunks z compose_context (pgvector + Ragnarok hybrid). */
  kb_retrieval_chunks: z.number().optional(),
  /** Detekované escalation signaly z user message: frustration / compliance / incident / highValue. */
  escalation_signals: z.array(z.string()).optional(),
  /** TRUE pokud Maestro úspěšně obsloužil (multi-turn coherence aktivní). */
  used_maestro_dialog: z.boolean().optional(),
});

export type AiConsultMetadata = z.infer<typeof AiConsultMetadataSchema>;

export const AiConsultResponseSchema = z.object({
  session_id: z.string().uuid().nullable().optional(),
  conversation_id: z.string().uuid(),
  response: z.string(),
  action: AiConsultActionSchema,
  tokens_used: z.number(),
  context_included: z.object({
    user_info: z.boolean(),
    health_data: z.boolean(),
    timeline_entries: z.number(),
  }).optional(),
  metadata: AiConsultMetadataSchema.optional(),
  message: z.object({
    id: z.string().uuid().nullable().optional(),
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
    routing_category: z.string().optional().default(''),
    created_at: z.string(),
  }).optional(),
});

export type AiConsultResponse = z.infer<typeof AiConsultResponseSchema>;

// =====================================================
// Create Entry Request Schema
// =====================================================

export const CreateStoryEntryRequestSchema = z.object({
  story_id: z.string().uuid(),
  entry_type: StoryEntryTypeSchema,
  content: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  is_internal: z.boolean().optional(),
  parent_id: z.string().uuid().optional(),
  document_id: z.string().uuid().optional(),
});

export type CreateStoryEntryRequest = z.infer<typeof CreateStoryEntryRequestSchema>;
