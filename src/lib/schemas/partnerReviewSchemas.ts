/**
 * Zod validation schemas for Partner Reviews RPC responses
 * 
 * @module lib/schemas/partnerReviewSchemas
 */

import { z } from "zod";

// ==========================================
// Partner Appointment Review Schema
// ==========================================

export const partnerAppointmentReviewSchema = z.object({
  id: z.string().uuid(),
  appointment_id: z.string().uuid(),
  member_id: z.string().uuid(),
  partner_id: z.string().uuid(),
  rating: z.number().min(1).max(5),
  comment: z.string().nullable(),
  is_visible: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  // Optional profile info from join
  member_display_name: z.string().nullable().optional(),
});

export type PartnerAppointmentReviewRpc = z.infer<typeof partnerAppointmentReviewSchema>;

export const partnerAppointmentReviewArraySchema = z.array(partnerAppointmentReviewSchema);

// ==========================================
// Partner Review (General) Schema
// ==========================================

export const partnerReviewSchema = z.object({
  id: z.string().uuid(),
  partner_id: z.string().uuid(),
  member_id: z.string().uuid(),
  rating: z.number().min(1).max(5),
  comment: z.string().nullable(),
  is_visible: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  // Optional profile info from join
  member_display_name: z.string().nullable().optional(),
});

export type PartnerReviewRpc = z.infer<typeof partnerReviewSchema>;

export const partnerReviewArraySchema = z.array(partnerReviewSchema);
