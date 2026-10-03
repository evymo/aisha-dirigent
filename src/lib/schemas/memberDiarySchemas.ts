/**
 * Member Diary (StoryLoop) Zod Schemas
 * Validation schemas for products, tracking states, and dashboard widgets
 * Aligned with database RPC return types
 */

import { z } from "zod";

// =====================================================
// PRODUCTS - aligned with get_my_products_audited
// =====================================================

export const memberProductSchema = z.object({
  category: z.string().nullable(),
  created_at: z.string(),
  created_by: z.string().uuid().nullable(),
  default_dose_amount: z.number().nullable(),
  default_dose_timing: z.array(z.string()).nullable(),
  default_dose_unit: z.string().nullable(),
  default_doses_per_day: z.number().nullable(),
  description: z.string().nullable(),
  id: z.string().uuid(),
  is_public: z.boolean(),
  name: z.string(),
  package_size: z.number().nullable(),
  package_unit: z.string().nullable(),
  usage_count: z.number(),
});

export type MemberProduct = z.infer<typeof memberProductSchema>;

// =====================================================
// TRACKING STATES - aligned with get_my_health_states_audited
// =====================================================

export const memberTrackingStateSchema = z.object({
  color: z.string().nullable(),
  created_at: z.string(),
  current_severity: z.number().nullable().optional(), // From latest health log
  custom_name: z.string().nullable(),
  dashboard_position: z.record(z.unknown()).nullable(),
  icon: z.string().nullable(),
  id: z.string().uuid(),
  is_active: z.boolean(),
  last_logged_at: z.string().nullable().optional(), // Timestamp of last health log
  name_key: z.string(),
  severity_scale: z.number(),
  show_on_dashboard: z.boolean(),
  updated_at: z.string(),
  user_id: z.string().uuid(),
});

export type MemberTrackingState = z.infer<typeof memberTrackingStateSchema>;

export const memberTrackingLogSchema = z.object({
  id: z.string().uuid(),
  state_id: z.string().uuid(),
  logged_at: z.string(),
  severity: z.number().nullable(),
  started_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  notes: z.string().nullable(),
});

export type MemberTrackingLog = z.infer<typeof memberTrackingLogSchema>;

// =====================================================
// PRODUCT PLANS - aligned with get_my_product_plans_audited
// =====================================================

export const memberProductPlanSchema = z.object({
  created_at: z.string(),
  custom_distribution_instructions: z.string().nullable(),
  dose_amount: z.number(),
  dose_timing: z.array(z.string()).nullable(),
  dose_unit: z.string(),
  doses_per_day: z.number(),
  id: z.string().uuid(),
  is_active: z.boolean(),
  last_taken_at: z.string().nullable(),
  next_reminder_at: z.string().nullable(),
  notes: z.string().nullable(),
  package_quantity: z.number().nullable(),
  protocol_id: z.string().uuid().nullable().optional(),
  protocol_name: z.string().nullable().optional(),
  catalog_product_id: z.string().uuid().nullable().optional(),
  catalog_product_name: z.string().nullable().optional(),
  product_id: z.string().uuid().nullable(),
  product_name: z.string(),
  remaining_doses: z.number().nullable(),
  reminder_enabled: z.boolean(),
  reminder_minutes_before: z.number(),
  reminder_mode: z.string().nullable(),
  updated_at: z.string(),
  user_id: z.string().uuid(),
  // Distribution info
  last_distribution_date: z.string().nullable(),
  last_distribution_vials: z.number().nullable(),
});

export type MemberProductPlan = z.infer<typeof memberProductPlanSchema>;

// =====================================================
// DASHBOARD WIDGETS - aligned with get_member_dashboard_widgets_audited
// =====================================================

export const memberDashboardWidgetSchema = z.object({
  created_at: z.string(),
  id: z.string().uuid(),
  is_visible: z.boolean(),
  position: z.record(z.unknown()),
  reference_id: z.string().uuid().nullable(),
  settings: z.record(z.unknown()).nullable(),
  updated_at: z.string(),
  user_id: z.string().uuid(),
  widget_type: z.string(),
});

export type MemberDashboardWidget = z.infer<typeof memberDashboardWidgetSchema>;

export const widgetPositionSchema = z.object({
  row: z.number(),
  col: z.number(),
  width: z.number().optional().default(1),
  height: z.number().optional().default(1),
});

export type WidgetPosition = z.infer<typeof widgetPositionSchema>;

// =====================================================
// CALENDAR - aligned with get_member_diary_calendar_audited (returns JSONB)
// =====================================================

export const diaryCalendarDaySchema = z.object({
  date: z.string(),
  products_taken: z.number(),
  states_logged: z.number(),
  has_active_issues: z.boolean(),
  distribution_received: z.boolean(),
});

export type DiaryCalendarDay = z.infer<typeof diaryCalendarDaySchema>;

export const calendarDistributionSchema = z.object({
  date: z.string(),
  status: z.string(),
  vial_count: z.number().nullable(),
  tracking_number: z.string().nullable(),
  carrier: z.string().nullable(),
  shipped_at: z.string().nullable(),
  delivered_at: z.string().nullable(),
});

export type CalendarDistribution = z.infer<typeof calendarDistributionSchema>;

export const memberDiaryCalendarResponseSchema = z.object({
  month: z.string(),
  days: z.array(diaryCalendarDaySchema),
  distributions: z.array(calendarDistributionSchema),
});

export type MemberDiaryCalendarResponse = z.infer<typeof memberDiaryCalendarResponseSchema>;

// =====================================================
// PARTNER VIEW - aligned with get_member_diary_for_partner_audited (returns JSONB)
// =====================================================

export const partnerTrackingLogSchema = z.object({
  id: z.string().uuid(),
  state_name: z.string().nullable(),
  severity: z.number().nullable(),
  logged_at: z.string(),
  started_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  notes: z.string().nullable(),
});

export const partnerTrackingStateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  is_active: z.boolean(),
});

export const partnerProductLogSchema = z.object({
  id: z.string().uuid(),
  plan_id: z.string().uuid(),
  logged_at: z.string(),
  dose_taken: z.number().nullable(),
  notes: z.string().nullable(),
});

export const partnerProductPlanSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  dose_amount: z.number().nullable(),
  dose_unit: z.string().nullable(),
  doses_per_day: z.number().nullable(),
  is_active: z.boolean(),
});

export const memberPartnerDiaryViewSchema = z.object({
  health_logs: z.array(partnerTrackingLogSchema),
  health_states: z.array(partnerTrackingStateSchema),
  product_logs: z.array(partnerProductLogSchema),
  product_plans: z.array(partnerProductPlanSchema),
});

export type MemberPartnerDiaryView = z.infer<typeof memberPartnerDiaryViewSchema>;




// =====================================================
// DISTRIBUTION HISTORY - aligned with get_my_distribution_history_audited
// =====================================================

export const distributionHistoryItemSchema = z.object({
  carrier: z.string().nullable(),
  created_at: z.string(),
  delivered_at: z.string().nullable(),
  id: z.string().uuid(),
  scheduled_date: z.string(),
  shipped_at: z.string().nullable(),
  status: z.string(),
  study_id: z.string().uuid().nullable(),
  study_name: z.string(),
  tracking_number: z.string().nullable(),
  user_id: z.string().uuid(),
  vial_count: z.number(),
});

export type DistributionHistoryItem = z.infer<typeof distributionHistoryItemSchema>;

// =====================================================
// FORM INPUTS
// =====================================================

export const createProductInputSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  category: z.enum(["product", "medication", "herb", "other"]).default("product"),
  default_dose_amount: z.number().positive().optional(),
  default_dose_unit: z.string().default("mg"),
  default_doses_per_day: z.number().int().positive().default(1),
  default_dose_timing: z.array(z.string()).default(["morning"]),
  package_size: z.number().positive().optional(),
  package_unit: z.string().optional(),
  is_public: z.boolean().default(false),
});

export type CreateProductInput = z.infer<typeof createProductInputSchema>;

export const createTrackingStateInputSchema = z.object({
  name_key: z.string().min(1, "Name is required"),
  custom_name: z.string().optional(),
  severity_scale: z.union([z.literal(5), z.literal(10)]).default(5),
  icon: z.string().default("help-circle"),
  color: z.string().default("#6366f1"),
  show_on_dashboard: z.boolean().default(true),
});

export type CreateTrackingStateInput = z.infer<typeof createTrackingStateInputSchema>;

export const logTrackingStateInputSchema = z.object({
  state_id: z.string().uuid(),
  severity: z.number().int().min(1).max(10),
  started_at: z.string().optional(),
  ended_at: z.string().optional(),
  notes: z.string().optional(),
});

export type LogTrackingStateInput = z.infer<typeof logTrackingStateInputSchema>;

export const createProductPlanInputSchema = z.object({
  name: z.string().min(1, "Name is required").optional(), // Optional with default in hook
  product_id: z.string().uuid().optional(),
  protocol_id: z.string().uuid().optional(),
  catalog_product_id: z.string().uuid().optional(),
  dose_amount: z.number().positive().default(1),
  dose_unit: z.string().default("dose"),
  doses_per_day: z.number().int().positive().default(1),
  dose_timing: z.array(z.string()).default(["08:00"]),
  package_quantity: z.number().int().positive().default(1),
  reminder_enabled: z.boolean().default(true),
  reminder_minutes_before: z.number().int().positive().default(15),
  custom_distribution_instructions: z.string().optional(), // User's own dosing instructions (e.g. "2 sprays morning, 1 evening")
  notes: z.string().optional(), // General notes/comments
});

export type CreateProductPlanInput = z.infer<typeof createProductPlanInputSchema>;

export const confirmProductTakenInputSchema = z.object({
  plan_id: z.string().uuid(),
  taken_at: z.string().optional(),
  dose_taken: z.number().positive().optional(), // Custom dose amount (default = plan dose)
  notes: z.string().optional(),
});

export type ConfirmProductTakenInput = z.infer<typeof confirmProductTakenInputSchema>;

export const updateProductLogInputSchema = z.object({
  log_id: z.string().uuid(),
  dose_taken: z.number().positive().optional(),
  taken_at: z.string().optional(),
  notes: z.string().optional(),
});

export type UpdateProductLogInput = z.infer<typeof updateProductLogInputSchema>;

// =====================================================
// PREDEFINED STATE KEYS
// =====================================================

export const TRACKING_STATE_PRESETS = [
  { key: "asthma", icon: "wind", color: "#3b82f6" },
  { key: "allergy", icon: "flower-2", color: "#f59e0b" },
  { key: "cough", icon: "thermometer", color: "#ef4444" },
  { key: "headache", icon: "brain", color: "#8b5cf6" },
  { key: "fatigue", icon: "battery-low", color: "#6366f1" },
  { key: "pain", icon: "alert-circle", color: "#dc2626" },
  { key: "rash", icon: "circle-dot", color: "#f43f5e" },
  { key: "nausea", icon: "frown", color: "#22c55e" },
  { key: "anxiety", icon: "heart-pulse", color: "#0ea5e9" },
  { key: "custom", icon: "help-circle", color: "#6b7280" },
] as const;

export const DOSE_TIMING_OPTIONS = [
  "08:00",
  "12:00",
  "18:00",
  "22:00",
  "morning",
  "afternoon",
  "evening",
  "night",
  "with_breakfast",
  "with_lunch",
  "with_dinner",
  "before_bed",
  "empty_stomach",
] as const;

export const PRODUCT_CATEGORIES = [
  "product",
  "medication",
  "herb",
  "other",
] as const;

