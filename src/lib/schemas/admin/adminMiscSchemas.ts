/**
 * Admin Misc Schemas — notifications, test questions, partners, archive
 */

import { z } from "zod";

// ==========================================
// Admin Notifications Schemas
// ==========================================

export const notificationCampaignSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  title_key: z.string(),
  body_key: z.string(),
  base_locale: z.string(),
  link: z.string().nullable(),
  data: z.record(z.unknown()).nullable(),
  audience_type: z.string(),
  audience_filter: z.record(z.unknown()).nullable(),
  send_push: z.boolean(),
  send_inapp: z.boolean(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  schedule_count: z.number().int().optional(),
});

export type NotificationCampaignRow = z.infer<typeof notificationCampaignSchema>;
export const notificationCampaignArraySchema = z.array(notificationCampaignSchema);

export const notificationCampaignScheduleSchema = z.object({
  id: z.string().uuid(),
  campaign_id: z.string().uuid(),
  run_at: z.string(),
  next_run_at: z.string(),
  repeat_interval_minutes: z.number().int().nullable(),
  status: z.string(),
  last_run_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type NotificationCampaignScheduleRow = z.infer<typeof notificationCampaignScheduleSchema>;
export const notificationCampaignScheduleArraySchema = z.array(notificationCampaignScheduleSchema);

export const notificationCampaignRunSchema = z.object({
  id: z.string().uuid(),
  campaign_id: z.string().uuid(),
  schedule_id: z.string().uuid().nullable(),
  run_at: z.string(),
  status: z.string(),
  recipients_count: z.number().int(),
  push_sent: z.number().int(),
  inapp_sent: z.number().int(),
  errors: z.array(z.string()).nullable(),
});

export type NotificationCampaignRunRow = z.infer<typeof notificationCampaignRunSchema>;
export const notificationCampaignRunArraySchema = z.array(notificationCampaignRunSchema);

export const notificationCampaignDeliverySchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  profile_display_name: z.string().nullable(),
  profile_email: z.string().nullable(),
  title: z.string(),
  message: z.string().nullable(),
  type: z.string(),
  link: z.string().nullable(),
  schedule_id: z.string().uuid().nullable(),
  is_read: z.boolean(),
  created_at: z.string(),
});

export type NotificationCampaignDeliveryRow = z.infer<typeof notificationCampaignDeliverySchema>;
export const notificationCampaignDeliveryArraySchema = z.array(notificationCampaignDeliverySchema);

// ==========================================
// AdminTestQuestions Schemas
// ==========================================

export const testResultRowSchema = z.object({
  id: z.string().uuid(),
  profiles: z.object({
    display_name: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
  }).nullable().optional(),
  passed: z.boolean(),
  score: z.number(),
  created_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
});

export type TestResultRow = z.infer<typeof testResultRowSchema>;

export const testResultArraySchema = z.array(testResultRowSchema);

// ==========================================
// Partner Profile Full Schema
// ==========================================

export const partnerProfileFullSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  certification_level: z.enum(["certified_partner", "certified_provider"]),
  is_production_provider: z.boolean(),
  business_name: z.string().nullable().optional(),
  display_name: z.string(),
  description: z.string().nullable().optional(),
  notes_for_visitors: z.string().nullable().optional(),
  city: z.string(),
  country: z.string(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  services: z.array(z.string()).default([]),
  languages: z.array(z.string()).nullable().optional(),
  is_visible: z.boolean(),
  accepts_online_appointments: z.boolean(),
  accepts_in_person_appointments: z.boolean(),
  certification_passed_at: z.string().nullable().optional(),
  certification_score: z.number().nullable().optional(),
  avatar_url: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type PartnerProfileFull = z.infer<typeof partnerProfileFullSchema>;

export const partnerProfileArraySchema = z.array(partnerProfileFullSchema.partial());

// ==========================================
// Admin Archive
// ==========================================

// Schema must match RPC return column order (alphabetical) with COALESCE defaults
export const adminArchiveDocumentSchema = z.object({
  content: z.string(),
  created_at: z.string(),
  decade: z.string(),
  description: z.string(),
  description_key: z.string(),
  document_type: z.string(),
  editorial_note: z.string(),
  editorial_note_key: z.string(),
  facility: z.string(),
  id: z.string().uuid(),
  is_current_version: z.boolean(),
  is_download_public: z.boolean(),
  is_featured: z.boolean(),
  is_public: z.boolean(),
  keywords: z.array(z.string()),
  original_language: z.string(),
  page_count: z.number().int(),
  parent_document_id: z.string(),
  people: z.array(z.string()),
  place: z.string(),
  preparation: z.string(),
  provenance_badge: z.string(),
  related_documents: z.array(z.string()),
  scan_url: z.string(),
  slug: z.string(),
  source_publication: z.string(),
  standards_context: z.string(),
  standards_context_key: z.string(),
  storage_path: z.string(),
  summary_key: z.string(),
  title: z.string(),
  title_key: z.string(),
  transcript_url: z.string(),
  updated_at: z.string(),
  version: z.string(),
  version_date: z.string(),
  version_notes: z.string(),
  what_you_are_looking_at: z.string(),
  what_you_are_looking_at_key: z.string(),
  year: z.number().int(),
});

export type AdminArchiveDocument = z.infer<typeof adminArchiveDocumentSchema>;
export const adminArchiveDocumentArraySchema = z.array(adminArchiveDocumentSchema);
