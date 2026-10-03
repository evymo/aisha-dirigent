/**
 * Zod schemas for AISHA Dirigent mobile app.
 * Validates all API responses; never trust raw data.
 */
import { z } from "zod";

/** Story / Project status — DB is unconstrained text, default 'inbox' */
export const storyStatusSchema = z.string().default("inbox");

export type StoryStatus = string;

/** Story label from JSONB array */
export const storyLabelSchema = z.object({
  label: z.string(),
  color: z.string().default("#6366F1"),
});

/** Project (story) summary — 1:1 with get_my_stories_audited TABLE output */
export const projectSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: storyStatusSchema,
  priority: z.string().nullable().default(null),
  is_starred: z.boolean().default(false),
  is_read: z.boolean().default(false),
  unread_count: z.number().int().nonnegative().default(0),
  last_activity_at: z.string(),
  last_entry_preview: z.string().nullable().default(null),
  labels: z.array(storyLabelSchema).default([]),
  user_display_name: z.string().nullable().default(null),
  study_name: z.string().nullable().default(null),
});

export type ProjectSummary = z.infer<typeof projectSummarySchema>;

// ── Story Entry (from get_story_detail_audited) ──────────────
export const storyEntrySchema = z.object({
  id: z.string().uuid(),
  parent_id: z.string().uuid().nullable().default(null),
  entry_type: z.string(),
  content: z.string().nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).nullable().default(null),
  is_internal: z.boolean().default(false),
  is_pinned: z.boolean().default(false),
  document_id: z.string().uuid().nullable().default(null),
  created_by: z.string().uuid().nullable().default(null),
  created_at: z.string(),
  created_by_name: z.string().nullable().default(null),
  document_preview: z.unknown().nullable().default(null),
});
export type StoryEntry = z.infer<typeof storyEntrySchema>;

export const storyReminderSchema = z.object({
  id: z.string(),
  title: z.string(),
  due_at: z.string().nullable().default(null),
  is_completed: z.boolean().default(false),
});
export type StoryReminder = z.infer<typeof storyReminderSchema>;

/** Project detail — 1:1 with get_story_detail_audited output */
export const projectDetailSchema = projectSummarySchema.extend({
  description: z.string().nullable().default(null),
  created_at: z.string(),
  updated_at: z.string().nullable().default(null),
  entries: z.array(storyEntrySchema).default([]),
  reminders: z.array(storyReminderSchema).default([]),
});

export type ProjectDetail = z.infer<typeof projectDetailSchema>;

/** Chat message */
export const chatMessageSchema = z.object({
  id: z.string().uuid(),
  // Optional: get_chat_messages_audited omits conversation_id (the caller
  // already queried by it) and metadata. `.nullish()` = the key may be absent
  // or null — the RPC's real row shape must validate, or every message is
  // silently dropped by parseMessageArray.
  conversation_id: z.string().uuid().nullish(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  created_at: z.string(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** Chat conversation */
export const chatConversationSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  // Optional: get_my_chat_conversations (and the chat_conversations table) do
  // not carry story_id. `.nullish()` lets the real row validate instead of
  // parseConversationArray silently dropping every conversation.
  story_id: z.string().uuid().nullish(),
  last_message_at: z.string().nullable(),
  message_count: z.number().int().nonnegative(),
});

export type ChatConversation = z.infer<typeof chatConversationSchema>;

/** Sentry issue */
export const sentryIssueSchema = z.object({
  id: z.string(),
  title: z.string(),
  culprit: z.string().nullable(),
  level: z.enum(["fatal", "error", "warning", "info", "debug"]),
  status: z.enum(["unresolved", "resolved", "ignored"]),
  count: z.number().int(),
  first_seen: z.string(),
  last_seen: z.string(),
  project_slug: z.string(),
  short_id: z.string().nullable(),
  aisha_suggestion: z.string().nullable(),
});

export type SentryIssue = z.infer<typeof sentryIssueSchema>;

/** Metrics / API stats */
export const apiMetricsSchema = z.object({
  total_requests_24h: z.number().int().nonnegative(),
  error_rate_24h: z.number().min(0).max(100),
  avg_response_ms: z.number().nonnegative(),
  active_users_24h: z.number().int().nonnegative(),
  rpc_calls_24h: z.number().int().nonnegative(),
  top_endpoints: z.array(
    z.object({
      name: z.string(),
      count: z.number().int(),
      avg_ms: z.number(),
    })
  ),
});

export type ApiMetrics = z.infer<typeof apiMetricsSchema>;

/** AI agent status */
export const agentStatusSchema = z.object({
  slug: z.string(),
  name: z.string(),
  status: z.enum(["idle", "running", "error", "disabled"]),
  last_run_at: z.string().nullable(),
  total_runs_24h: z.number().int().nonnegative(),
  model: z.string().nullable(),
});

export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const tokenomicsOverviewSchema = z.object({
  token_configs: z.array(z.record(z.string(), z.unknown())).default([]),
  transaction_summary: z.array(z.record(z.string(), z.unknown())).default([]),
  active_locks: z.array(z.record(z.string(), z.unknown())).default([]),
  burn_summary: z.array(z.record(z.string(), z.unknown())).default([]),
});

export type TokenomicsOverview = z.infer<typeof tokenomicsOverviewSchema>;

/** Vulnerability item */
export const vulnerabilitySchema = z.object({
  id: z.string(),
  package_name: z.string(),
  severity: z.enum(["critical", "high", "moderate", "low", "info"]),
  title: z.string(),
  fixed_in: z.string().nullable(),
  url: z.string().nullable(),
});

export type Vulnerability = z.infer<typeof vulnerabilitySchema>;

/** Dashboard aggregate (from get_mobile_dashboard_data RPC) */
export const dashboardDataSchema = z.object({
  user_stats: z.object({
    total_points: z.number().nonnegative().default(0),
    weekly_points: z.number().nonnegative().default(0),
    current_streak: z.number().int().nonnegative().default(0),
    best_streak: z.number().int().nonnegative().default(0),
    weekly_rank: z.number().int().nonnegative().nullable().default(null),
  }).default({ total_points: 0, weekly_points: 0, current_streak: 0, best_streak: 0, weekly_rank: null }),
  todays_reminders: z.array(z.object({
    id: z.string(),
    title: z.string(),
    due_at: z.string().nullable().default(null),
    time: z.string().nullable().default(null),
    completed: z.boolean().default(false),
    points: z.number().nonnegative().default(0),
  })).default([]),
  recent_health_data: z.object({
    avg_pain_7d: z.number().nullable().default(null),
    avg_energy_7d: z.number().nullable().default(null),
    avg_sleep_7d: z.number().nullable().default(null),
    avg_mood_7d: z.number().nullable().default(null),
    avg_steps_7d: z.number().nullable().default(null),
    avg_heart_rate_7d: z.number().nullable().default(null),
    trend: z.string().nullable().default(null),
  }).default({ avg_pain_7d: null, avg_energy_7d: null, avg_sleep_7d: null, avg_mood_7d: null, avg_steps_7d: null, avg_heart_rate_7d: null, trend: null }),
  active_studies: z.array(z.object({
    id: z.string(),
    title: z.string(),
    status: z.string().default("active"),
    pending_questionnaires: z.number().int().nonnegative().default(0),
    registration_status: z.string().nullable().default(null),
  })).default([]),
});

export type DashboardData = z.infer<typeof dashboardDataSchema>;

// ── Member Gamification ──────────────────────────────────────
export const gamificationStatsSchema = z.object({
  total_points: z.number().nonnegative().default(0),
  weekly_points: z.number().nonnegative().default(0),
  monthly_points: z.number().nonnegative().default(0),
  current_streak: z.number().int().nonnegative().default(0),
  best_streak: z.number().int().nonnegative().default(0),
  weekly_rank: z.number().int().nonnegative().nullable().default(null),
  monthly_rank: z.number().int().nonnegative().nullable().default(null),
  total_completions: z.number().int().nonnegative().default(0),
  total_check_ins: z.number().int().nonnegative().default(0),
});
export type GamificationStats = z.infer<typeof gamificationStatsSchema>;

// ── Leaderboard ──────────────────────────────────────────────
export const leaderboardEntrySchema = z.object({
  rank: z.number().int().positive(),
  display_name: z.string(),
  avatar_url: z.string().nullable().default(null),
  total_tokens: z.number().nonnegative().default(0),
  governance_tokens: z.number().nonnegative().default(0),
  impact_tokens: z.number().nonnegative().default(0),
  data_tokens: z.number().nonnegative().default(0),
  is_current_user: z.boolean().default(false),
});
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;

export const myLeaderboardPositionSchema = z.object({
  rank: z.number().int().nonnegative().nullable().default(null),
  total_tokens: z.number().nonnegative().default(0),
  governance_tokens: z.number().nonnegative().default(0),
  impact_tokens: z.number().nonnegative().default(0),
  data_tokens: z.number().nonnegative().default(0),
});
export type MyLeaderboardPosition = z.infer<typeof myLeaderboardPositionSchema>;

// ── Tracking Check-in ──────────────────────────────────────────
export const trackingCheckInSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  check_in_type: z.enum(["morning", "evening", "weekly", "monthly"]).default("morning"),
  pain_level: z.number().min(0).max(10).nullable().default(null),
  sleep_quality: z.number().min(0).max(10).nullable().default(null),
  sleep_hours: z.number().min(0).max(24).nullable().default(null),
  energy_level: z.number().min(0).max(10).nullable().default(null),
  mood_level: z.number().min(0).max(10).nullable().default(null),
  steps_count: z.number().int().nonnegative().nullable().default(null),
  activity_minutes: z.number().int().nonnegative().nullable().default(null),
  exercise_type: z.string().nullable().default(null),
  took_medication: z.boolean().nullable().default(null),
  medication_notes: z.string().nullable().default(null),
  side_effects: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
  created_at: z.string(),
});
export type TrackingCheckIn = z.infer<typeof trackingCheckInSchema>;

// ── Health depth ────────────────────────────────────────────
export const healthTrendPointSchema = z.object({
  period_start: z.string(),
  period_end: z.string(),
  avg_value: z.coerce.number().nullable().default(null),
  min_value: z.coerce.number().nullable().default(null),
  max_value: z.coerce.number().nullable().default(null),
  count: z.coerce.number().int().default(0),
});
export type HealthTrendPoint = z.infer<typeof healthTrendPointSchema>;

export const healthTrendsResultSchema = z.object({
  trends: z.array(healthTrendPointSchema).default([]),
  error: z.string().nullable().default(null),
});
export type HealthTrendsResult = z.infer<typeof healthTrendsResultSchema>;

export const labResultSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid().nullable().default(null),
  study_registration_id: z.string().uuid().nullable().default(null),
  document_id: z.string().uuid().nullable().default(null),
  test_date: z.string().nullable().default(null),
  result_date: z.string().nullable().default(null),
  lab_name: z.string().nullable().default(null),
  status: z.string().nullable().default(null),
  crp: z.coerce.number().nullable().default(null),
  glucose: z.coerce.number().nullable().default(null),
  hba1c: z.coerce.number().nullable().default(null),
  vitamin_d: z.coerce.number().nullable().default(null),
  cholesterol_total: z.coerce.number().nullable().default(null),
  ldl: z.coerce.number().nullable().default(null),
  hdl: z.coerce.number().nullable().default(null),
  triglycerides: z.coerce.number().nullable().default(null),
  results: z.unknown().nullable().default(null),
  file_url: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
  created_at: z.string().nullable().default(null),
});
export type LabResult = z.infer<typeof labResultSchema>;

export const dosingLogSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid().nullable().default(null),
  product_id: z.string().uuid().nullable().default(null),
  study_registration_id: z.string().uuid().nullable().default(null),
  logged_at: z.string(),
  dose_amount: z.string().nullable().default(null),
  dose_unit: z.string().nullable().default(null),
  dose_count: z.coerce.number().int().nullable().default(null),
  taken_with_food: z.boolean().nullable().default(null),
  notes: z.string().nullable().default(null),
  created_at: z.string().nullable().default(null),
});
export type DosingLog = z.infer<typeof dosingLogSchema>;

export const ongoingSymptomSchema = z.object({
  id: z.string().uuid(),
  state_id: z.string().uuid().nullable().default(null),
  state_name: z.string().nullable().default(null),
  state_name_key: z.string().nullable().default(null),
  severity: z.coerce.number().int().nullable().default(null),
  started_at: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
  duration_hours: z.coerce.number().nullable().default(null),
});
export type OngoingSymptom = z.infer<typeof ongoingSymptomSchema>;

// ── Token Balance ────────────────────────────────────────────
export const tokenTransactionSchema = z.object({
  id: z.string().uuid(),
  token_type: z.enum(["aisha", "governance", "impact", "data"]),
  amount: z.number(),
  transaction_type: z.string(),
  description: z.string().nullable().default(null),
  balance_after: z.number().nonnegative().default(0),
  created_at: z.string(),
});
export type TokenTransaction = z.infer<typeof tokenTransactionSchema>;

// ── Reward Claims ────────────────────────────────────────────
export const rewardClaimSchema = z.object({
  id: z.string().uuid(),
  amount: z.number(),
  denom: z.string(),
  status: z.enum(["pending", "fulfilled", "failed"]),
  tx_hash: z.string().nullable().default(null),
  fulfilled_at: z.string().nullable().default(null),
  created_at: z.string(),
});
export type RewardClaim = z.infer<typeof rewardClaimSchema>;

// ── Profile Completeness ─────────────────────────────────────
export const profileCompletenessSchema = z.object({
  has_display_name: z.boolean().default(false),
  has_umbrella_registration: z.boolean().default(false),
  is_new_user: z.boolean().default(true),
  is_complete: z.boolean().default(false),
});
export type ProfileCompleteness = z.infer<typeof profileCompletenessSchema>;

// ── Membership ───────────────────────────────────────────────
export const membershipSchema = z.object({
  tokens_aisha: z.number().nonnegative().default(0),
  tokens_governance: z.number().nonnegative().default(0),
  tokens_impact: z.number().nonnegative().default(0),
  tokens_data: z.number().nonnegative().default(0),
  subscription_tier: z.enum(["free", "premium", "enterprise"]).default("free"),
});
export type Membership = z.infer<typeof membershipSchema>;

// ── Notification ─────────────────────────────────────────────
export const notificationSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  message: z.string().nullable().default(null),
  is_read: z.boolean().default(false),
  notification_type: z.string().nullable().default(null),
  created_at: z.string(),
});
export type Notification = z.infer<typeof notificationSchema>;

// ── Voice / Consultation Call ────────────────────────────────
export const livekitTokenSchema = z.object({
  token: z.string(),
  identity: z.string(),
  name: z.string(),
  roomName: z.string(),
});
export type LivekitToken = z.infer<typeof livekitTokenSchema>;

export const consultationSessionSchema = z.object({
  id: z.string().uuid(),
  voice_room_id: z.string().uuid(),
  caller_id: z.string().uuid(),
  callee_id: z.string().uuid(),
  story_id: z.string().uuid().nullable(),
  status: z.enum(["ringing", "active", "ended", "declined", "missed"]),
  started_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  created_at: z.string(),
});
export type ConsultationSession = z.infer<typeof consultationSessionSchema>;

export const voiceRoomSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  livekit_room_name: z.string(),
  room_type: z.enum(["consultation", "ptt", "group"]),
  story_id: z.string().uuid().nullable(),
  is_active: z.boolean(),
  max_participants: z.number().int().positive(),
  created_by: z.string().uuid(),
  created_at: z.string(),
});
export type VoiceRoom = z.infer<typeof voiceRoomSchema>;

// ── Matrix / Messaging ───────────────────────────────────────
export const matrixTokenSchema = z.object({
  access_token: z.string(),
  user_id: z.string(),
  home_server: z.string(),
});
export type MatrixToken = z.infer<typeof matrixTokenSchema>;

export const storyMatrixRoomSchema = z.object({
  id: z.string().uuid(),
  story_id: z.string().uuid(),
  matrix_room_id: z.string(),
  room_type: z.enum(["general", "voice", "bridge", "bot"]),
  bridge_type: z.string().nullable(),
  display_name: z.string().nullable(),
  is_active: z.boolean(),
  created_at: z.string(),
});
export type StoryMatrixRoom = z.infer<typeof storyMatrixRoomSchema>;

export const matrixMessageSchema = z.object({
  event_id: z.string(),
  sender: z.string(),
  content: z.object({
    msgtype: z.string(),
    body: z.string(),
  }),
  origin_server_ts: z.number(),
  type: z.string(),
});
export type MatrixMessageRaw = z.infer<typeof matrixMessageSchema>;

// ── Kanban board (1:1 with kanban_stories_view) ──────────────
// Rows self-describe their column (status_sort_order / label / color) so the
// board can build swimlanes without a separate columns query. numeric/bigint
// fields serialize as strings over PostgREST → z.coerce.number.
export const kanbanStorySchema = z.object({
  story_id: z.string().uuid(),
  partner_id: z.string().uuid().nullable().default(null),
  user_id: z.string().uuid().nullable().default(null),
  is_stack_default: z.boolean().default(false),
  title: z.string(),
  status: z.string().default("inbox"),
  status_label_i18n_key: z.string().nullable().default(null),
  status_sort_order: z.number().int().nullable().default(null),
  status_swimlane_color: z.string().nullable().default(null),
  status_is_terminal: z.boolean().default(false),
  priority: z.string().default("normal"),
  is_starred: z.boolean().default(false),
  last_activity_at: z.string(),
  default_branch: z.string().nullable().default(null),
  latest_run_id: z.string().uuid().nullable().default(null),
  current_agent_slug: z.string().nullable().default(null),
  current_run_status: z.string().nullable().default(null),
  last_event_at: z.string().nullable().default(null),
  cost_to_date_usd: z.coerce.number().default(0),
  tokens_to_date: z.coerce.number().default(0),
  budget_cost_limit_usd: z.coerce.number().nullable().default(null),
  budget_consumed_usd: z.coerce.number().nullable().default(null),
  budget_state: z.string().nullable().default(null),
});
export type KanbanStory = z.infer<typeof kanbanStorySchema>;

// ── Story timeline (1:1 with story_timeline) ─────────────────
// The auto-populated feed: UNION of ai_trace_events + rollback_history +
// blue/green switches. event_kind ∈ 'trace' | 'rollback' | 'bg_switch'.
export const storyTimelineEventSchema = z.object({
  event_id: z.string(),
  event_kind: z.string(),
  trace_event_type: z.string().nullable().default(null),
  ts: z.string(),
  agent_slug: z.string().nullable().default(null),
  operation: z.string().nullable().default(null),
  status: z.string().nullable().default(null),
  duration_ms: z.number().int().nullable().default(null),
  cost_usd: z.coerce.number().nullable().default(null),
  run_id: z.string().uuid().nullable().default(null),
  app_name: z.string().nullable().default(null),
  files_changed: z.array(z.string()).nullable().default(null),
  payload: z.record(z.string(), z.unknown()).nullable().default(null),
});
export type StoryTimelineEvent = z.infer<typeof storyTimelineEventSchema>;

// ── Studies (clusters / areas of interest) ──────────────────
/** 1:1 with get_active_studies row. */
export const studySummarySchema = z.object({
  id: z.string().uuid(),
  code: z.string().nullable().default(null),
  name: z.string(),
  description: z.string().nullable().default(null),
  study_type: z.string().nullable().default(null),
  target_condition: z.string().nullable().default(null),
  products: z.array(z.string()).nullable().default(null),
  duration_weeks: z.number().int().nullable().default(null),
  target_registration: z.number().int().nullable().default(null),
  current_registration: z.number().int().nullable().default(null),
  is_blinded: z.boolean().default(false),
  is_active: z.boolean().default(true),
  starts_at: z.string().nullable().default(null),
  ends_at: z.string().nullable().default(null),
  protocol_url: z.string().nullable().default(null),
});
export type StudySummary = z.infer<typeof studySummarySchema>;

/** 1:1 with get_study_detail (adds funding + umbrella + counts). */
export const studyDetailSchema = studySummarySchema.extend({
  is_umbrella: z.boolean().default(false),
  funding_goal: z.coerce.number().nullable().default(null),
  current_funding: z.coerce.number().nullable().default(null),
  funding_status: z.string().nullable().default(null),
  min_participants: z.number().int().nullable().default(null),
  max_participants: z.number().int().nullable().default(null),
  consultant_count: z.coerce.number().nullable().default(null),
  contribution_count: z.coerce.number().nullable().default(null),
});
export type StudyDetail = z.infer<typeof studyDetailSchema>;

/** 1:1 with get_my_study_registrations row. */
export const studyRegistrationSchema = z.object({
  id: z.string().uuid(),
  study_id: z.string().uuid(),
  study_name: z.string(),
  study_code: z.string().nullable().default(null),
  status: z.string().default("pending"),
  group_assignment: z.string().nullable().default(null),
  enrolled_at: z.string().nullable().default(null),
  completed_at: z.string().nullable().default(null),
  consultant_id: z.string().uuid().nullable().default(null),
  created_at: z.string(),
});
export type StudyRegistration = z.infer<typeof studyRegistrationSchema>;

/** A scheduled study questionnaire item from get_study_questionnaires_mobile. */
export const studyQuestionnaireMobileSchema = z.object({
  id: z.string().uuid(),
  study_id: z.string().uuid().nullable().default(null),
  study_registration_id: z.string().uuid().nullable().default(null),
  questionnaire_id: z.string().uuid().nullable().default(null),
  title: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  frequency_type: z.string().nullable().default(null),
  frequency_days: z.number().int().nullable().default(null),
  points_reward: z.coerce.number().default(0),
  status: z.string().default("pending"),
  can_submit: z.boolean().default(false),
  due_date: z.string().nullable().default(null),
});
export type StudyQuestionnaireMobile = z.infer<typeof studyQuestionnaireMobileSchema>;

/** Top-level result of get_study_questionnaires_mobile. */
export const studyQuestionnairesResultSchema = z.object({
  questionnaires: z.array(studyQuestionnaireMobileSchema).default([]),
  total_pending: z.coerce.number().int().default(0),
  total_completed: z.coerce.number().int().default(0),
  notice: z.string().nullable().default(null),
});
export type StudyQuestionnairesResult = z.infer<typeof studyQuestionnairesResultSchema>;

/** A consent item from get_combined_study_consents (display). */
export const studyConsentItemSchema = z.object({
  id: z.string().uuid(),
  consent_key: z.string(),
  title: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  checkbox_label: z.string().nullable().default(null),
  is_required: z.boolean().default(false),
  display_order: z.number().int().default(0),
  document_url: z.string().nullable().default(null),
  study_code: z.string().nullable().default(null),
  is_umbrella: z.boolean().default(false),
});
export type StudyConsentItem = z.infer<typeof studyConsentItemSchema>;

/** Requirement row from get_combined_consent_requirements_localized (submit mapping). */
export const studyConsentRequirementSchema = z.object({
  id: z.string().uuid(),
  consent_template_id: z.string().uuid(),
  is_required: z.boolean().default(false),
  sort_order: z.number().int().default(0),
  template_key: z.string(),
  title: z.string().nullable().default(null),
  content: z.string().nullable().default(null),
  version: z.string().nullable().default(null),
  requires_signature: z.boolean().default(false),
  study_id: z.string().uuid(),
  study_name: z.string().nullable().default(null),
});
export type StudyConsentRequirement = z.infer<typeof studyConsentRequirementSchema>;

// ── Services / consumption: subscriptions + product access ───
/** 1:1 with get_my_subscriptions row. */
export const subscriptionSchema = z.object({
  id: z.string().uuid(),
  package_name: z.string().nullable().default(null),
  package_tier: z.string().nullable().default(null),
  package_period: z.string().nullable().default(null),
  status: z.string().default("active"),
  period_start: z.string().nullable().default(null),
  period_end: z.string().nullable().default(null),
  next_billing_date: z.string().nullable().default(null),
  amount_paid: z.coerce.number().nullable().default(null),
  currency: z.string().nullable().default(null),
  cancel_at_period_end: z.boolean().default(false),
  payment_type: z.string().nullable().default(null),
  tokens_governance: z.coerce.number().int().default(0),
  tokens_impact: z.coerce.number().int().default(0),
  tokens_data: z.coerce.number().int().default(0),
});
export type Subscription = z.infer<typeof subscriptionSchema>;

/** 1:1 with get_my_product_access row. */
export const productAccessSchema = z.object({
  id: z.string().uuid(),
  product_id: z.string().uuid(),
  access_type: z.string().default("member_access"),
  granted_at: z.string().nullable().default(null),
  expires_at: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
});
export type ProductAccess = z.infer<typeof productAccessSchema>;

/** 1:1 with get_subscription_packages row (localized public catalog). */
export const subscriptionPackageSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable().default(null),
  tier: z.string().nullable().default(null),
  period: z.string().nullable().default(null),
  price: z.coerce.number().default(0),
  currency: z.string().nullable().default(null),
  is_active: z.boolean().default(true),
  is_recurring: z.boolean().default(false),
  allow_one_time_payment: z.boolean().default(false),
  allow_recurring_payment: z.boolean().default(false),
  billing_interval_months: z.coerce.number().int().nullable().default(null),
  min_billing_months: z.coerce.number().int().nullable().default(null),
  governance_tokens: z.coerce.number().int().default(0),
  impact_tokens: z.coerce.number().int().default(0),
  tokens_governance: z.coerce.number().int().default(0),
  tokens_impact: z.coerce.number().int().default(0),
  tokens_data: z.coerce.number().int().default(0),
  includes_products: z.array(z.string()).default([]),
  includes_diagnostics: z.array(z.string()).default([]),
  sort_order: z.coerce.number().int().default(0),
});
export type SubscriptionPackage = z.infer<typeof subscriptionPackageSchema>;

/** 1:1 with get_my_wallet_balance row. */
export const walletBalanceSchema = z.object({
  user_id: z.string().uuid(),
  aisha_tokens: z.coerce.number().default(0),
  governance_tokens: z.coerce.number().default(0),
  impact_tokens: z.coerce.number().default(0),
  data_tokens: z.coerce.number().default(0),
  updated_at: z.string().nullable().default(null),
});
export type WalletBalance = z.infer<typeof walletBalanceSchema>;

/** 1:1 with get_token_reward_rules_localized JSON item. */
export const tokenRewardRuleSchema = z.object({
  id: z.string().uuid(),
  action_type: z.string(),
  token_type: z.string(),
  action_name: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  base_amount: z.coerce.number().default(0),
  multiplier: z.coerce.number().default(1),
  min_amount: z.coerce.number().nullable().default(null),
  max_amount: z.coerce.number().nullable().default(null),
  daily_limit: z.coerce.number().int().nullable().default(null),
  weekly_limit: z.coerce.number().int().nullable().default(null),
  monthly_limit: z.coerce.number().int().nullable().default(null),
  cooldown_hours: z.coerce.number().int().nullable().default(null),
  requires_membership: z.boolean().default(false),
  membership_tier_required: z.string().nullable().default(null),
  is_active: z.boolean().default(true),
  sort_order: z.coerce.number().int().default(0),
});
export type TokenRewardRule = z.infer<typeof tokenRewardRuleSchema>;

/** 1:1 with fn_get_llm_quota_status JSON object. */
export const llmQuotaStatusSchema = z.object({
  user_id: z.string().uuid().nullable().default(null),
  tier: z.string().default("free"),
  daily_token_limit: z.coerce.number().default(0),
  daily_cost_usd_limit: z.coerce.number().default(0),
  consumed_tokens_today: z.coerce.number().default(0),
  consumed_cost_today: z.coerce.number().default(0),
  remaining_tokens: z.coerce.number().default(0),
  remaining_cost_usd: z.coerce.number().default(0),
  last_reset_at: z.string().nullable().default(null),
  reset_at: z.string().nullable().default(null),
  lazy_only: z.boolean().default(false),
});
export type LlmQuotaStatus = z.infer<typeof llmQuotaStatusSchema>;

// ── Member operations: appointments / orders / wearables ─────
export const appointmentPartnerSchema = z.object({
  display_name: z.string().nullable().default(null),
  business_name: z.string().nullable().default(null),
  city: z.string().nullable().default(null),
});
export type AppointmentPartner = z.infer<typeof appointmentPartnerSchema>;

export const appointmentSchema = z.object({
  id: z.string().uuid(),
  partner_id: z.string().uuid().nullable().default(null),
  member_id: z.string().uuid().nullable().default(null),
  appointment_date: z.string().nullable().default(null),
  start_time: z.string().nullable().default(null),
  end_time: z.string().nullable().default(null),
  appointment_type: z.string().nullable().default(null),
  status: z.string().nullable().default(null),
  service: z.string().nullable().default(null),
  created_at: z.string().nullable().default(null),
  updated_at: z.string().nullable().default(null),
  partner: z.union([appointmentPartnerSchema, z.array(appointmentPartnerSchema), z.null()]).default(null),
});
export type Appointment = z.infer<typeof appointmentSchema>;

export const orderSchema = z.object({
  id: z.string().uuid(),
  status: z.string().nullable().default(null),
  subtotal: z.coerce.number().default(0),
  shipping: z.coerce.number().default(0),
  total: z.coerce.number().default(0),
  currency: z.string().nullable().default(null),
  order_items: z.unknown().nullable().default(null),
  delivered_at: z.string().nullable().default(null),
  created_at: z.string().nullable().default(null),
  updated_at: z.string().nullable().default(null),
});
export type Order = z.infer<typeof orderSchema>;

export const cartItemSchema = z.object({
  id: z.string().uuid(),
  product_id: z.string().uuid(),
  product_name: z.string(),
  product_image_url: z.string().nullable().default(null),
  product_price: z.coerce.number().default(0),
  product_slug: z.string().nullable().default(null),
  quantity: z.coerce.number().int().default(1),
});
export type CartItem = z.infer<typeof cartItemSchema>;

export const voucherSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  product_id: z.string().uuid().nullable().default(null),
  status: z.string().default("active"),
  points_cost: z.coerce.number().nullable().default(null),
  expires_at: z.string().nullable().default(null),
  used_at: z.string().nullable().default(null),
  created_at: z.string().nullable().default(null),
});
export type Voucher = z.infer<typeof voucherSchema>;

export const wearableConnectionSchema = z.object({
  id: z.string().uuid(),
  connection_status: z.string(),
  device_model: z.string().nullable().default(null),
  device_name: z.string().nullable().default(null),
  device_type: z.string().nullable().default(null),
  platform: z.string().nullable().default(null),
  last_sync_at: z.string().nullable().default(null),
  permissions_granted: z.array(z.string()).default([]),
  sync_count: z.coerce.number().int().default(0),
  created_at: z.string().nullable().default(null),
  updated_at: z.string().nullable().default(null),
});
export type WearableConnection = z.infer<typeof wearableConnectionSchema>;

// ── Privacy & compliance ─────────────────────────────────────
/** 1:1 with get_my_consents row. */
export const consentSchema = z.object({
  id: z.string().uuid(),
  consent_type: z.string(),
  study_id: z.string().uuid().nullable().default(null),
  version: z.string().nullable().default(null),
  granted: z.boolean().default(false),
  granted_at: z.string().nullable().default(null),
  revoked_at: z.string().nullable().default(null),
  document_url: z.string().nullable().default(null),
});
export type Consent = z.infer<typeof consentSchema>;

/** 1:1 with get_my_data_sharing_consents row. */
export const dataSharingConsentSchema = z.object({
  id: z.string().uuid(),
  partner_id: z.string().uuid().nullable().default(null),
  partner_name: z.string().nullable().default(null),
  partner_email: z.string().nullable().default(null),
  granted_at: z.string().nullable().default(null),
  revoked_at: z.string().nullable().default(null),
  expires_at: z.string().nullable().default(null),
});
export type DataSharingConsent = z.infer<typeof dataSharingConsentSchema>;

/** 1:1 with get_my_compliance_summary row. */
export const complianceSummarySchema = z.object({
  total_required: z.coerce.number().int().default(0),
  total_completed: z.coerce.number().int().default(0),
  compliance_score: z.coerce.number().default(0),
  current_streak: z.coerce.number().int().default(0),
  total_tokens_earned: z.coerce.number().int().default(0),
  is_eligible_for_discount: z.boolean().default(false),
});
export type ComplianceSummary = z.infer<typeof complianceSummarySchema>;

/** 1:1 with get_my_mobile_sessions row. */
export const mobileSessionSchema = z.object({
  id: z.string().uuid(),
  device_id: z.string().nullable().default(null),
  device_platform: z.string().nullable().default(null),
  device_model: z.string().nullable().default(null),
  app_version: z.string().nullable().default(null),
  last_active_at: z.string().nullable().default(null),
  has_fcm_token: z.boolean().default(false),
  has_apns_token: z.boolean().default(false),
});
export type MobileSession = z.infer<typeof mobileSessionSchema>;

// ── Story AI parametrization (rulesets + knowledge context) ──
/** 1:1 with get_story_rulesets row (compact subset). */
export const storyRulesetSchema = z.object({
  ruleset_id: z.string().uuid(),
  ruleset_fingerprint: z.string().nullable().default(null),
  context_profile: z.string().nullable().default(null),
  rule_count: z.coerce.number().int().default(0),
  created_at: z.string().nullable().default(null),
});
export type StoryRuleset = z.infer<typeof storyRulesetSchema>;

/** 1:1 with get_story_knowledge_context row (compact subset). */
export const storyKnowledgeContextItemSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().nullable().default(null),
  title: z.string().nullable().default(null),
  category: z.string().nullable().default(null),
  has_ai_instructions: z.boolean().default(false),
  relevance_score: z.coerce.number().int().nullable().default(null),
});
export type StoryKnowledgeContextItem = z.infer<typeof storyKnowledgeContextItemSchema>;
