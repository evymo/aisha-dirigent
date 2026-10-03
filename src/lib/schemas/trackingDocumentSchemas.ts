/**
 * Zod validation schemas for Tracking Documents RPC responses
 * 
 * @module lib/schemas/trackingDocumentSchemas
 */

import { z } from "zod";

// ==========================================
// Tracking Document Processing Status Enum
// ==========================================

export const documentProcessingStatusSchema = z.enum([
  "pending",
  "processing",
  "completed",
  "failed",
  "skipped",
]);

// ==========================================
// Tracking Document Category Enum
// ==========================================

export const trackingDocumentCategorySchema = z.enum([
  "lab_result",
  "medical_report",
  "prescription",
  "imaging",
  "certificate",
  "other",
]);

// ==========================================
// Tracking Document Schema
// ==========================================

export const trackingDocumentSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  study_registration_id: z.string().uuid().nullable(),
  file_name: z.string(),
  file_path: z.string(),
  file_size: z.number().nullable(),
  mime_type: z.string().nullable(),
  category: trackingDocumentCategorySchema,
  title: z.string().nullable(),
  description: z.string().nullable(),
  document_date: z.string().nullable(),
  processing_status: documentProcessingStatusSchema,
  processed_at: z.string().nullable(),
  extracted_data: z.unknown().nullable(),
  extracted_text: z.string().nullable(),
  ai_summary: z.string().nullable(),
  ai_insights: z.unknown().nullable(),
  ai_categories: z.array(z.string()).nullable(),
  tokens_awarded: z.number(),
  tokens_awarded_at: z.string().nullable(),
  contributed_to_statistics: z.boolean(),
  contributed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type TrackingDocumentRpc = z.infer<typeof trackingDocumentSchema>;

export const trackingDocumentArraySchema = z.array(trackingDocumentSchema);

// ==========================================
// Document Sharing Permission Schema
// ==========================================

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
  // Optional partner info from join
  partner_display_name: z.string().nullable().optional(),
  partner_business_name: z.string().nullable().optional(),
});

export type DocumentSharingPermissionRpc = z.infer<typeof documentSharingPermissionSchema>;

export const documentSharingPermissionArraySchema = z.array(documentSharingPermissionSchema);
