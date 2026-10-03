/**
 * Zod validation schemas for Tracking Data Sync RPC responses
 * 
 * @module lib/schemas/trackingDataSchemas
 */

import { z } from "zod";

// ==========================================
// Tracking Data Record Schema
// ==========================================

export const trackingDataRecordSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  data_type: z.string(),
  value: z.number(),
  unit: z.string(),
  recorded_at: z.string(),
  source: z.string().nullable(),
  metadata: z.unknown().nullable(),
  created_at: z.string().nullable(),
});

export type TrackingDataRecordRpc = z.infer<typeof trackingDataRecordSchema>;

export const trackingDataRecordArraySchema = z.array(trackingDataRecordSchema);

// ==========================================
// Tracking Check-In Schema
// ==========================================

export const trackingCheckInSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  study_registration_id: z.string().uuid().nullable(),
  check_in_date: z.string(),
  check_in_type: z.string(),
  pain_level: z.number().nullable(),
  pain_location: z.string().nullable(),
  pain_notes: z.string().nullable(),
  energy_level: z.number().nullable(),
  mood_level: z.number().nullable(),
  sleep_hours: z.number().nullable(),
  sleep_quality: z.number().nullable(),
  activity_minutes: z.number().nullable(),
  steps_count: z.number().nullable(),
  exercise_type: z.string().nullable(),
  took_medication: z.boolean().nullable(),
  medication_notes: z.string().nullable(),
  side_effects: z.string().nullable(),
  general_notes: z.string().nullable(),
  womac_pain: z.number().nullable(),
  womac_stiffness: z.number().nullable(),
  womac_function: z.number().nullable(),
  created_at: z.string(),
});

export type TrackingCheckInRpc = z.infer<typeof trackingCheckInSchema>;

export const trackingCheckInArraySchema = z.array(trackingCheckInSchema);

// ==========================================
// Dosing Log Schema
// ==========================================

export const dosingLogSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  study_registration_id: z.string().uuid().nullable(),
  distribution_protocol_id: z.string().uuid().nullable(),
  product_id: z.string().uuid().nullable(),
  logged_at: z.string(),
  dose_amount: z.string().nullable(),
  dose_unit: z.string().nullable(),
  dose_count: z.number().nullable(),
  is_custom_distribution: z.boolean().nullable(),
  report_type: z.string().nullable(),
  report_period_start: z.string().nullable(),
  report_period_end: z.string().nullable(),
  taken_with_food: z.boolean().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
});

export type DosingLogRpc = z.infer<typeof dosingLogSchema>;

export const dosingLogArraySchema = z.array(dosingLogSchema);
