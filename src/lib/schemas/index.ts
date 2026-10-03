/**
 * Zod schemas - central export
 * 
 * @module lib/schemas
 */

// Base primitives
export {
  uuidSchema,
  isoDateSchema,
  emailSchema,
  phoneSchema,
  nullableToOptional,
  optionalString,
  optionalNumber,
  optionalBoolean,
  optionalUuid,
  optionalDate,
  optionalStringArray,
  addressSchema,
  contactInfoSchema,
  paginationSchema,
  dateRangeSchema,
  baseEntitySchema,
  userOwnedEntitySchema,
} from "./_base";

// Tracking schemas
export {
  checkInTypeSchema,
  labResultStatusSchema,
  trackingDocumentCategorySchema,
  documentProcessingStatusSchema,
  trackingCheckInBaseSchema,
  trackingCheckInArraySchema,
  labResultBaseSchema,
  labResultArraySchema,
  trackingDocumentBaseSchema,
  type TrackingCheckInBase,
  type LabResultBase,
  type TrackingDocumentBase,
} from "./trackingSchemas";

// Admin schemas (existing)
export * from "./adminSchemas";

// Archive document schemas
export * from "./archiveDocumentSchemas";

// Study schemas
export * from "./studySchemas";

// Operational assessment schemas
export * from "./operationalAssessmentSchemas";

// Role schemas
export * from "./roleSchemas";

// Notification schemas
export * from "./notificationSchemas";

// Test question schemas
export * from "./testQuestionSchemas";

// Tracking document schemas
export * from "./trackingDocumentSchemas";

// Order review schemas
export * from "./orderReviewSchemas";

// Partner review schemas
export * from "./partnerReviewSchemas";

// Role definition schemas (excluding duplicates from adminSchemas)
export {
  roleDefinitionRpcSchema,
  roleDefinitionArraySchema,
  type RoleDefinitionRpc,
} from "./roleDefinitionSchemas";

// Tracking data schemas
export * from "./trackingDataSchemas";

// Guild of Experts + Expert Rules schemas
export * from "./guildSchemas";

// Expert Overlay / AI Orchestrator schemas (Phase 3)
export * from "./expertOverlaySchemas";

// GitHub App + Integration schemas
export * from "./githubSchemas";

// Occipitum design profile + canvas proposal schemas
export * from "./designSchemas";

// Re-export key RPC validation schemas
export {
  parseRpcArray,
  parseRpcResponse,
  auditStatsRowSchema,
  userCheckInSummarySchema,
  userLabResultSchema,
  userDosingLogSummarySchema,
  userQuestionnaireResponseSchema,
  userConsentSchema,
  consultantUserRawSchema,
  dataSharingConsentRawSchema,
  consultantUserRegistrationSchema,
  certifiedPartnerRowSchema,
} from "../validation/rpcSchemas";

// Plugin system schemas
export {
  pluginKindSchema,
  pluginTrustTierSchema,
  pluginStatusSchema,
  pluginLoadStrategySchema,
  pluginHealthEventKindSchema,
  pluginSandboxPolicySchema,
  pluginManifestSchema,
  pluginCatalogSchema,
  pluginVersionSchema,
  effectivePluginConfigSchema,
  pluginHealthSummarySchema,
  sandboxRpcRequestSchema,
  sandboxKvRequestSchema,
  sandboxStorageRequestSchema,
  sandboxLlmRequestSchema,
  sandboxEventRequestSchema,
  sandboxNotifyRequestSchema,
  sandboxFetchRequestSchema,
  sandboxApiRequestSchema,
} from "./pluginSchemas";
export type {
  PluginManifest,
  PluginCatalogEntry,
  PluginVersion,
  EffectivePluginConfig,
  PluginHealthSummary,
  SandboxApiRequest,
} from "./pluginSchemas";
