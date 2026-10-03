/**
 * Member Access Schemas
 * 
 * Defines access levels and permissions based on data sharing consent.
 */

import { z } from 'zod';

// =====================================================
// Access Level Schema
// =====================================================

export const MemberAccessLevelSchema = z.enum([
  'full',          // Full consent - all data accessible
  'limited',       // Partial consent - some data categories
  'anonymized',    // No consent - only aggregate/cohort data
  'none',          // No access at all (not in study, no relationship)
]);

export type MemberAccessLevel = z.infer<typeof MemberAccessLevelSchema>;

// =====================================================
// Consent Status Schema
// =====================================================

export const ConsentStatusSchema = z.enum([
  'granted',       // Active consent
  'pending',       // Consent requested, waiting for response
  'revoked',       // Previously granted, now revoked
  'expired',       // Consent expired
  'never_asked',   // Never requested
]);

export type ConsentStatus = z.infer<typeof ConsentStatusSchema>;

// =====================================================
// Data Category Permissions
// =====================================================

export const DataCategorySchema = z.enum([
  'health_checkins',    // Daily/weekly check-ins (pain, energy, mood)
  'lab_results',        // Laboratory test results
  'documents',          // Uploaded health documents
  'assessments',        // Operational assessments/questionnaires
  'dosing_logs',        // Medication/product dosing logs
  'study_data',         // Study-specific data
]);

export type DataCategory = z.infer<typeof DataCategorySchema>;

export const DataCategoryPermissionSchema = z.object({
  category: DataCategorySchema,
  can_view: z.boolean(),
  can_use_for_research: z.boolean(),
  can_use_for_statistics: z.boolean(),
});

export type DataCategoryPermission = z.infer<typeof DataCategoryPermissionSchema>;

// =====================================================
// Member Access Summary (for partner view)
// =====================================================

export const MemberAccessSummarySchema = z.object({
  member_id: z.string().uuid(),
  member_token: z.string().optional(), // Anonymized token
  display_name: z.string().optional(), // Only if consent granted
  
  // Access level determination
  access_level: MemberAccessLevelSchema,
  consent_status: ConsentStatusSchema,
  consent_granted_at: z.string().optional(),
  consent_expires_at: z.string().optional(),
  
  // Study relationship
  study_id: z.string().uuid().optional(),
  study_name: z.string().optional(),
  study_code: z.string().optional(),
  registration_id: z.string().uuid().optional(),
  registration_status: z.string().optional(),
  enrolled_at: z.string().optional(),
  
  // Category-level permissions
  permissions: z.array(DataCategoryPermissionSchema),
  
  // Activity metadata (only if has access)
  last_activity_at: z.string().optional(),
  member_since: z.string().optional(),
  
  // Aggregate stats (always available for enrolled members)
  total_check_ins: z.number().optional(),
  total_documents: z.number().optional(),
  has_recent_activity: z.boolean().optional(),
});

export type MemberAccessSummary = z.infer<typeof MemberAccessSummarySchema>;

// =====================================================
// Helper Functions
// =====================================================

/**
 * Determines access level based on consent status and permissions
 */
export function determineAccessLevel(
  consentStatus: ConsentStatus,
  permissions: DataCategoryPermission[]
): MemberAccessLevel {
  if (consentStatus !== 'granted') {
    // Without active consent, only anonymized aggregate data
    return 'anonymized';
  }
  
  const hasFullAccess = permissions.every(p => p.can_view);
  const hasPartialAccess = permissions.some(p => p.can_view);
  
  if (hasFullAccess) return 'full';
  if (hasPartialAccess) return 'limited';
  return 'anonymized';
}

/**
 * Default permissions when no explicit consent
 */
export function getDefaultPermissions(): DataCategoryPermission[] {
  const categories: DataCategory[] = [
    'health_checkins',
    'lab_results',
    'documents',
    'assessments',
    'dosing_logs',
    'study_data',
  ];
  
  return categories.map(category => ({
    category,
    can_view: false,
    can_use_for_research: false,
    can_use_for_statistics: true, // Anonymized stats always allowed for enrolled members
  }));
}

/**
 * Full access permissions
 */
export function getFullAccessPermissions(): DataCategoryPermission[] {
  const categories: DataCategory[] = [
    'health_checkins',
    'lab_results',
    'documents',
    'assessments',
    'dosing_logs',
    'study_data',
  ];
  
  return categories.map(category => ({
    category,
    can_view: true,
    can_use_for_research: true,
    can_use_for_statistics: true,
  }));
}
