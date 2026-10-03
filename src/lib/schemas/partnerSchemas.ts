/**
 * Zod schemas for partner-related entities
 * 
 * @module lib/schemas/partnerSchemas
 */

import { z } from "zod";

/**
 * Schema for partner certification from RPC
 */
export const partnerCertificationSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  score: z.number(),
  passed: z.boolean(),
  answers: z.record(z.string()),
  completed_at: z.string(),
  created_at: z.string(),
});

export const partnerCertificationArraySchema = z.array(partnerCertificationSchema);

/**
 * Schema for document sharing permission
 */
export const documentSharingPermissionSchema = z.object({
  id: z.string().uuid(),
  document_id: z.string().uuid(),
  user_id: z.string().uuid(),
  shared_with_partner_id: z.string().uuid().nullable(),
  shared_with_study_id: z.string().uuid().nullable(),
  can_view: z.boolean().nullable(),
  can_use_for_research: z.boolean().nullable(),
  can_use_for_statistics: z.boolean().nullable(),
  granted_at: z.string(),
  revoked_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const documentSharingPermissionArraySchema = z.array(documentSharingPermissionSchema);

/**
 * Schema for tracking data record from RPC
 */
export const trackingDataRecordSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  data_type: z.string(),
  value: z.number(),
  unit: z.string(),
  metadata: z.record(z.unknown()).nullable().optional(),
  recorded_at: z.string(),
  source: z.string().nullable(),
  created_at: z.string().nullable(),
});

export const trackingDataRecordArraySchema = z.array(trackingDataRecordSchema);

export type PartnerCertificationRow = z.infer<typeof partnerCertificationSchema>;
export type DocumentSharingPermissionRow = z.infer<typeof documentSharingPermissionSchema>;
export type TrackingDataRecordRow = z.infer<typeof trackingDataRecordSchema>;
