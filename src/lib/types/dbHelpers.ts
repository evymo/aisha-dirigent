/**
 * Supabase type helpers and enum re-exports
 * 
 * This module provides:
 * - Re-exports of DB enum types for convenient access
 * - Helper types for working with Supabase responses
 * - Type utilities for RPC function responses
 * 
 * @module lib/types/supabaseHelpers
 */

import type { Database, Tables, TablesInsert, TablesUpdate, Enums, Json } from "@/integrations/db/types";

// ==========================================
// Re-export base Supabase types
// ==========================================

export type { Database, Tables, TablesInsert, TablesUpdate, Enums, Json };

// ==========================================
// DB Enum Type Aliases (convenient access)
// ==========================================

/** User application roles */
export type AppRole = Enums<"app_role">;

/** Admin section identifiers */
export type AdminSection = Enums<"admin_section">;

/** Production batch status */
export type BatchStatus = Enums<"batch_status">;

/** Production batch purpose */
export type BatchPurpose = Enums<"batch_purpose">;

/** Blockchain event types */
export type BlockchainEventType = Enums<"blockchain_event_type">;

/** Tracking check-in timing types */
export type CheckInType = Enums<"check_in_type">;

/** User consent types */
export type ConsentType = Enums<"consent_type">;

/** Consultant role types */
export type ConsultantRole = Enums<"consultant_role_enum">;

/** Consultant status types */
export type ConsultantStatus = Enums<"consultant_status_enum">;

/** Contribution status types */
export type ContributionStatus = Enums<"contribution_status_enum">;

/** Contribution types */
export type ContributionType = Enums<"contribution_type_enum">;

/** Document processing status */
export type DocumentProcessingStatus = Enums<"document_processing_status">;

/** Tracking document categories */
export type TrackingDocumentCategory = Enums<"health_document_category">;

/** Audit journal action types */
export type JournalActionType = Enums<"journal_action_type">;

/** Audit journal areas */
export type JournalArea = Enums<"journal_area">;

/** Audit journal severity levels */
export type JournalSeverity = Enums<"journal_severity">;

/** Lab result status */
export type LabResultStatus = Enums<"lab_result_status">;

/** Membership status */
export type MembershipStatus = Enums<"membership_status">;

/** Membership tier levels */
export type MembershipTier = Enums<"membership_tier">;

/** Partner certification levels */
export type PartnerCertificationLevel = Enums<"partner_certification_level">;

/** Payment types */
export type PaymentType = Enums<"payment_type">;

/** Permission types */
export type PermissionType = Enums<"permission_type">;

/** Study participant status */
export type StudyStatus = Enums<"study_status">;

/** Study types */
export type StudyType = Enums<"study_type">;

/** Subscription period options */
export type SubscriptionPeriod = Enums<"subscription_period">;

/** Product vial content types */
export type VialContentType = Enums<"vial_content_type">;

/** Product vial status */
export type VialStatus = Enums<"vial_status">;

/** Workflow step status */
export type WorkflowStepStatus = Enums<"workflow_step_status">;

// ==========================================
// Table Row Type Aliases
// ==========================================

/** Profile table row type */
export type ProfileRow = Tables<"profiles">;

/** Membership table row type */
export type MembershipRow = Tables<"memberships">;

/** Study table row type */
export type StudyRow = Tables<"studies">;

/** Study registration table row type */
export type StudyRegistrationRow = Tables<"study_registrations">;

/** Tracking check-in table row type */
export type HealthCheckInRow = Tables<"health_check_ins">;

/** Lab result table row type */
export type LabResultRow = Tables<"lab_results">;

/** Partner profile table row type */
export type PartnerProfileRow = Tables<"partner_profiles">;

/** Partner appointment table row type */
export type PartnerAppointmentRow = Tables<"partner_appointments">;

/** Audit journal table row type */
export type AuditJournalRow = Tables<"audit_journal">;

/** Consent table row type */
export type ConsentRow = Tables<"consents">;

/** Order table row type */
export type OrderRow = Tables<"orders">;

/** Product table row type */
export type ProductRow = Tables<"products">;

/** Production batch table row type */
export type ProductionBatchRow = Tables<"production_batches">;

/** Distribution protocol table row type */
export type DistributionProtocolRow = Tables<"distribution_protocols">;

/** Member tracking document table row type */
export type MemberTrackingDocumentRow = Tables<"member_health_documents">;

/** Dosing log table row type */
export type DosingLogRow = Tables<"dosing_logs">;

/** Questionnaire response table row type */
export type QuestionnaireResponseRow = Tables<"questionnaire_responses">;

/** Questionnaire table row type */
export type QuestionnaireRow = Tables<"questionnaires">;

// ==========================================
// Insert/Update Type Aliases
// ==========================================

export type ProfileInsert = TablesInsert<"profiles">;
export type ProfileUpdate = TablesUpdate<"profiles">;

export type HealthCheckInInsert = TablesInsert<"health_check_ins">;
export type HealthCheckInUpdate = TablesUpdate<"health_check_ins">;

export type LabResultInsert = TablesInsert<"lab_results">;
export type LabResultUpdate = TablesUpdate<"lab_results">;

export type ConsentInsert = TablesInsert<"consents">;
export type ConsentUpdate = TablesUpdate<"consents">;

export type DosingLogInsert = TablesInsert<"dosing_logs">;
export type DosingLogUpdate = TablesUpdate<"dosing_logs">;

// ==========================================
// RPC Response Helpers
// ==========================================

/**
 * Extract the public schema from Database type.
 */
export type PublicSchema = Database["public"];

/**
 * Get the Functions type from public schema.
 */
export type DatabaseFunctions = PublicSchema["Functions"];

/**
 * Helper to extract RPC function return type.
 * 
 * @example
 * type UserSummary = RpcReturnType<"get_user_health_summary_audited">;
 */
export type RpcReturnType<FunctionName extends keyof DatabaseFunctions> = 
  DatabaseFunctions[FunctionName] extends { Returns: infer R } ? R : never;

/**
 * Helper to extract RPC function arguments type.
 */
export type RpcArgs<FunctionName extends keyof DatabaseFunctions> = 
  DatabaseFunctions[FunctionName] extends { Args: infer A } ? A : never;

// ==========================================
// Enum Value Constants (runtime access)
// ==========================================

import { Constants } from "@/integrations/db/types";

/** All available app roles */
export const APP_ROLES = Constants.public.Enums.app_role;

/** All available check-in types */
export const CHECK_IN_TYPES = Constants.public.Enums.check_in_type;

/** All available consent types */
export const CONSENT_TYPES = Constants.public.Enums.consent_type;

/** All available journal areas */
export const JOURNAL_AREAS = Constants.public.Enums.journal_area;

/** All available journal action types */
export const JOURNAL_ACTION_TYPES = Constants.public.Enums.journal_action_type;

/** All available journal severity levels */
export const JOURNAL_SEVERITY_LEVELS = Constants.public.Enums.journal_severity;

/** All available membership tiers */
export const MEMBERSHIP_TIERS = Constants.public.Enums.membership_tier;

/** All available membership statuses */
export const MEMBERSHIP_STATUSES = Constants.public.Enums.membership_status;

/** All available study types */
export const STUDY_TYPES = Constants.public.Enums.study_type;

/** All available study statuses */
export const STUDY_STATUSES = Constants.public.Enums.study_status;

/** All available batch statuses */
export const BATCH_STATUSES = Constants.public.Enums.batch_status;

/** All available vial statuses */
export const VIAL_STATUSES = Constants.public.Enums.vial_status;

/** All available lab result statuses */
export const LAB_RESULT_STATUSES = Constants.public.Enums.lab_result_status;
