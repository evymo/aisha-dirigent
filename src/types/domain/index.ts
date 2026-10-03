/**
 * Domain types - central export
 * 
 * Re-exports all domain interfaces for convenient access.
 * These interfaces represent the "frontend shape" of data.
 * 
 * @module types/domain
 */

// Base types
export type {
  BaseEntity,
  UserOwnedEntity,
  AuditableEntity,
  LocalizedContent,
  LocalizedEntity,
  Address,
  ContactInfo,
  PaginationParams,
  PaginatedResponse,
  DateRange,
  SortOptions,
  StatusInfo,
  ProcessingState,
  SelectableItem,
  TabDefinition,
  FieldError,
  FormResult,
  ApiSuccessResponse,
  ApiErrorResponse,
  ApiResponse,
  PartialBy,
  RequiredBy,
  NonNullableFields,
} from "./base";

// Tracking types
export type {
  TrackingCheckIn,
  TrackingCheckInSummary,
  TrackingCheckInFormValues,
  TrackingCheckInFilters,
  LabResult,
  LabResultSummary,
  LabResultFilters,
  TrackingDocument,
  TrackingDocumentUpload,
  TrackingSummary,
  BiomarkerDataPoint,
  BiomarkerTrend,
} from "./tracking";

// Profile types
export type {
  UserProfile,
  ProfileFormValues,
  NotificationPreferences,
  Membership,
  MembershipSummary,
  MembershipUpgradeOption,
  UserRole,
  UserWithRoles,
  ConsultantProfile,
  ConsultantAssignment,
  OnboardingResponses,
  OnboardingStep,
  OnboardingProgress,
} from "./profile";

// Partner types
export type {
  PartnerProfile,
  PartnerListItem,
  PartnerRegistrationFormValues,
  PartnerSearchFilters,
  AvailabilitySlot,
  BookableSlot,
  PartnerAvailabilityConfig,
  Appointment,
  AppointmentStatus,
  AppointmentBookingFormValues,
  AppointmentFilters,
  AppointmentReview,
  PartnerRatingSummary,
  ReviewFormValues,
  CertificationResult,
  CertificationQuestion,
  CertificationOption,
  CertificationTestState,
} from "./partner";

// Expert Overlay Layer types (Phase 3)
export type {
  AgentSafetyLevel,
  ModelTier,
  AgentCatalogEntry,
  ContextLayerName,
  ProjectContextLayerConfig,
  RulesetLayerConfig,
  KbRetrievalLayerConfig,
  MemoryLayerConfig,
  ContextLayersConfig,
  ContextProfile,
  ContextBundle,
  ProjectContextData,
  RulesetContextData,
  RulesetRule,
  KbRetrievalContextData,
  KbChunk,
  MemoryContextData,
  MemoryEvent,
  TaskKind,
  RiskProfile,
  TaskEnvelope,
  RouteAgentStep,
  StopConditions,
  RoutePlan,
  McpTokenScope,
  McpAuthToken,
  McpTokenCreationResult,
  McpTokenValidationResult,
  AiRunStatus,
  AiRun,
  AiEventType,
  TraceEventStatus,
  AiTraceEvent,
  GateVerdict,
  GateType,
  QualityGateResult,
  GateFinding,
  ComplianceContext,
  RouteTaskParams,
  ComposeContextParams,
  LogAiTraceEventParams,
  FinishAiRunParams,
  ValidateMcpTokenParams,
  CreateMcpTokenParams,
  GetComplianceContextParams,
} from "./expert-overlay";
