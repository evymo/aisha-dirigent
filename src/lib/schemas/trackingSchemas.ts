/**
 * Tracking domain Zod schemas
 * 
 * sensitive data data validation with strict runtime checking.
 * 
 * @module lib/schemas/trackingSchemas
 */

import { z } from "zod";
import { optionalString, optionalNumber, optionalBoolean, optionalDate, userOwnedEntitySchema } from "./_base";

// ==========================================
// Enums (matching DB)
// ==========================================

export const checkInTypeSchema = z.enum(["morning", "evening", "weekly", "monthly"]);
export const labResultStatusSchema = z.enum(["pending", "completed", "reviewed"]);
export const trackingDocumentCategorySchema = z.enum([
  "lab_results", "imaging", "prescription", "medical_report",
  "consultation_notes", "diagnostic_test", "vaccination_record", "other"
]);
export const documentProcessingStatusSchema = z.enum(["pending", "processing", "completed", "failed"]);

// ==========================================
// Tracking Check-In Schemas
// ==========================================

export const trackingCheckInBaseSchema = userOwnedEntitySchema.extend({
  check_in_date: z.string(),
  check_in_type: checkInTypeSchema,
  study_registration_id: optionalString,
  mood_level: optionalNumber,
  energy_level: optionalNumber,
  pain_level: optionalNumber,
  sleep_quality: optionalNumber,
  sleep_hours: optionalNumber,
  steps_count: optionalNumber,
  activity_minutes: optionalNumber,
  pain_location: optionalString,
  pain_notes: optionalString,
  took_medication: optionalBoolean,
  medication_notes: optionalString,
  side_effects: optionalString,
  exercise_type: optionalString,
  general_notes: optionalString,
  womac_pain: optionalNumber,
  womac_stiffness: optionalNumber,
  womac_function: optionalNumber,
});

export type TrackingCheckInBase = z.infer<typeof trackingCheckInBaseSchema>;

export const trackingCheckInArraySchema = z.array(trackingCheckInBaseSchema);

// ==========================================
// Lab Result Schemas
// ==========================================

export const labResultBaseSchema = userOwnedEntitySchema.extend({
  test_date: z.string(),
  status: labResultStatusSchema,
  lab_name: optionalString,
  study_registration_id: optionalString,
  notes: optionalString,
  glucose: optionalNumber,
  hba1c: optionalNumber,
  cholesterol_total: optionalNumber,
  hdl: optionalNumber,
  ldl: optionalNumber,
  triglycerides: optionalNumber,
  crp: optionalNumber,
  vitamin_d: optionalNumber,
  reviewed_by: optionalString,
  reviewed_at: optionalDate,
});

export type LabResultBase = z.infer<typeof labResultBaseSchema>;

export const labResultArraySchema = z.array(labResultBaseSchema);

// ==========================================
// Tracking Document Schemas
// ==========================================

export const trackingDocumentBaseSchema = userOwnedEntitySchema.extend({
  file_name: z.string(),
  file_path: z.string(),
  file_size: optionalNumber,
  mime_type: optionalString,
  category: trackingDocumentCategorySchema,
  title: optionalString,
  description: optionalString,
  document_date: optionalDate,
  processing_status: documentProcessingStatusSchema,
  processed_at: optionalDate,
  ai_summary: optionalString,
  study_registration_id: optionalString,
});

export type TrackingDocumentBase = z.infer<typeof trackingDocumentBaseSchema>;
