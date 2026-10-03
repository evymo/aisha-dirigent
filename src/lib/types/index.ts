/**
 * Type utilities and helpers - central export
 * 
 * This module re-exports all type utilities for convenient access:
 * - nullToUndefined: Transform Supabase null to undefined
 * - guards: Runtime type checking utilities
 * - supabaseHelpers: DB types and enum re-exports
 * 
 * @module lib/types
 */

// Null handling utilities
export {
  isDefined,
  isNullish,
  withDefault,
  undefinedToNull,
  undefinedToNullDeep,
  filterNullish,
  compactMap,
  safeGet,
} from "./nullToUndefined";

// Type guards
export {
  isString,
  isNonEmptyString,
  isNumber,
  isFiniteNumber,
  isBoolean,
  isUUID,
  isDate,
  isISODateString,
  isObject,
  isArray,
  isArrayOf,
  isJson,
  safeJsonParse,
  getJsonProperty,
  createEnumGuard,
  isSupabaseError,
  hasRequiredProperties,
} from "./guards";

// Supabase type helpers
export {
  // Base types
  type Database,
  type Tables,
  type TablesInsert,
  type TablesUpdate,
  type Enums,
  type Json,
  
  // Enum aliases
  type AppRole,
  type AdminSection,
  type BatchStatus,
  type BatchPurpose,
  type BlockchainEventType,
  type CheckInType,
  type ConsentType,
  type ConsultantRole,
  type ConsultantStatus,
  type ContributionStatus,
  type ContributionType,
  type DocumentProcessingStatus,
  type TrackingDocumentCategory,
  type JournalActionType,
  type JournalArea,
  type JournalSeverity,
  type LabResultStatus,
  type MembershipStatus,
  type MembershipTier,
  type PartnerCertificationLevel,
  type PaymentType,
  type PermissionType,
  type StudyStatus,
  type StudyType,
  type SubscriptionPeriod,
  type VialContentType,
  type VialStatus,
  type WorkflowStepStatus,
  
  // Table row aliases
  type ProfileRow,
  type MembershipRow,
  type StudyRow,
  type StudyRegistrationRow,
  type HealthCheckInRow,
  type LabResultRow,
  type PartnerProfileRow,
  type PartnerAppointmentRow,
  type AuditJournalRow,
  type ConsentRow,
  type OrderRow,
  type ProductRow,
  type ProductionBatchRow,
  type DistributionProtocolRow,
  type MemberTrackingDocumentRow,
  type DosingLogRow,
  type QuestionnaireResponseRow,
  type QuestionnaireRow,
  
  // Insert/Update aliases
  type ProfileInsert,
  type ProfileUpdate,
  type HealthCheckInInsert,
  type HealthCheckInUpdate,
  type LabResultInsert,
  type LabResultUpdate,
  type ConsentInsert,
  type ConsentUpdate,
  type DosingLogInsert,
  type DosingLogUpdate,
  
  // Schema helpers
  type PublicSchema,
  type DatabaseFunctions,
  type RpcReturnType,
  type RpcArgs,
  
  // Runtime enum constants
  APP_ROLES,
  CHECK_IN_TYPES,
  CONSENT_TYPES,
  JOURNAL_AREAS,
  JOURNAL_ACTION_TYPES,
  JOURNAL_SEVERITY_LEVELS,
  MEMBERSHIP_TIERS,
  MEMBERSHIP_STATUSES,
  STUDY_TYPES,
  STUDY_STATUSES,
  BATCH_STATUSES,
  VIAL_STATUSES,
  LAB_RESULT_STATUSES,
} from "./dbHelpers";
