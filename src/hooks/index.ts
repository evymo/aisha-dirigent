/**
 * Barrel file for hooks
 * Enables cleaner imports: import { useSession, usePermissions } from "@/hooks"
 */

// Authentication & Session
export { useSession, SessionProvider, type AppSession } from "./useSession";
export { useAuth } from "./useAuth";
export { useSessionManagement, type SessionManagementConfig, type ActiveSession } from "./useSessionManagement";
export { useSessionMonitoring, type SessionActivity, type UseSessionMonitoringFilters } from "./useSessionMonitoring";
export { useSessionTimeout, type SessionTimeoutConfig } from "./useSessionTimeout";
export { useHasPassword } from "./useHasPassword";
export { useMustChangePassword } from "./useMustChangePassword";
export { useRequestPasswordChange } from "./useRequestPasswordChange";
export {
  useEmailBrandingConfig,
  useAuthEmailTemplateData,
  useUpdateEmailBranding,
  useEmailBrandingUpload,
  getEmailBrandingLogoUrl,
  DEFAULT_EMAIL_BRANDING,
  DEFAULT_EMAIL_LOGO_PATH,
  EMAIL_ASSETS_BUCKET,
  type EmailBrandingConfig,
} from "./useEmailBranding";
export {
  useKeyboardShortcuts,
  type KeyboardShortcutsOptions,
} from "./useKeyboardShortcuts";
export {
  useTableKeyboard,
  type TableKeyboardOptions,
  type TableKeyboardReturn,
} from "./useTableKeyboard";
export {
  useModal,
  type ModalMode,
  type UseModalReturn,
} from "./useModal";
export {
  useDomainRoutingConfig,
  useUpdateDomainRoutingConfig,
  isValidInternalServiceTarget,
  isValidRoutingDomain,
  DOMAIN_ROUTING_TARGET_TYPES,
  domainRoutingConfigSchema,
  domainRoutingRuleSchema,
  DEFAULT_DOMAIN_ROUTING_CONFIG,
  type DomainRoutingConfig,
  type DomainRoutingRule,
  type DomainRoutingTargetType,
} from "./useDomainRoutingSettings";

// Permissions & Roles
export {
  usePermissions,
  useAllPermissions,
  useRolePermissions,
  useHasPermission,
  usePermissionManagement,
  usePartnerType,
  useIsProfessionalPartner,
  type PermissionCode,
  type PartnerType,
  type PermissionDetails,
  type UsePermissionsReturn,
  type RolePermissionMapping,
} from "./usePermissions";
export { useUserRole, type AppRole, type UserRole } from "./useUserRole";
export { useRoleDefinitions, type RoleDefinition } from "./useRoleDefinitions";
export {
  useMemberProfile,
  memberProfileFormSchema,
  MEMBER_PROFILE_DEFAULTS,
  type MemberProfileData,
  type MemberProfileFormData,
} from "./useMemberProfile";

// Membership & Subscriptions
export { useMembership, type Membership, type SubscriptionPackage, type MembershipTier } from "./useMembership";
export { useRIIMembership } from "./useRIIMembership";
export { useSubscriptionPurchase, useMySubscriptions, type MySubscription } from "./useSubscriptionPurchase";
export {
  useStripeCheckout,
  type PaymentType,
} from "./useStripeCheckout";

// Checkout
export {
  useCheckoutProfilePrefill,
  usePacketaPickupPoints,
  useCreateOrder,
  useCreateCheckoutSession,
  useShippingCosts,
  type ProfilePrefill,
  type PacketaPickupPoint,
  type ShippingMethod,
  type ShippingCosts,
} from "./useCheckout";

export {
  useAvailableShippingMethods,
  type AvailableMethodsParams,
} from "./useAvailableShippingMethods";

export { useCheckoutVoucher } from "./useCheckoutVoucher";

// Company Data & Order Protocol
export { useCompanyData, type ConsentInterpolation, type UseCompanyDataReturn } from "./useCompanyData";
export {
  useOrderConsent,
  type EnrichedOrderItem,
  type OrderInterpolation,
  type UseOrderConsentReturn,
} from "./useOrderConsent";
export {
  useManufacturingProtocol,
  type ProductionProtocolInput,
  type QualityControlInput,
  type UseManufacturingProtocolReturn,
} from "./useManufacturingProtocol";

// Study Registration & Questionnaires
export {
  useStudyRegistrationQuestionnaire,
  useQuestionnaireBlocksLocalized,
  useStudyRegistrationQuestionnaireWithBlocks,
  type StudyRegistrationQuestionnaire,
  type QuestionBlock as StudyQuestionBlock,
  type QuestionnaireStep,
} from "./useStudyRegistrationQuestionnaire";

// Tracking Data
export { useTrackingDocuments, type TrackingDocument } from "./useTrackingDocuments";
export { useTrackingDocumentDownloadInfo, type TrackingDocumentDownloadInfo } from "./useTrackingDocumentDownloadInfo";
export { useTrackingCheckIns, useLabResults, useDosingLogs, type TrackingCheckIn, type LabResult, type DosingLog } from "./useTracking";
export {
  useTrackingDataSync,
  useTrackingSyncAvailability,
  trackingDataFormatters,
  trackingDataIcons,
  type TrackingDataType,
  type TrackingDataEntry,
  type TrackingDataRecord,
  type TrackingSummary,
} from "./useTrackingDataSync";
export { useBiomarkerReferenceRanges, type BiomarkerReferenceRange } from "./useBiomarkerReferenceRanges";
export { useOperationalAssessment, type AssessmentRecord } from "./useOperationalAssessment";
export {
  useBaselineComparison,
  useMetricsHistory,
  useSaveMetric,
  useBaselineTracking,
  type BaselineComparison,
  type MetricHistoryRecord,
  type MetricTrend,
  type SaveMetricInput,
} from "./useBaselineComparison";
export {
  useLongevityScore,
  useLongevityScoreHistory,
  useSubmitLongevityAssessment,
  getTrendIconName,
  getScoreColorClass,
  getDomainName,
  calculateOverallImprovement,
  getDomainsNeedingAttention,
  getStrongestDomains,
  type DomainScore,
  type LongevityScoreResult,
  type LongevityScoreHistoryEntry,
  type LongevityResponses,
} from "./useLongevityScore";
export { useLabTestRecommendations } from "./useLabTestRecommendations";

// Studies
export { useStudies, type Study, type StudyRegistration, type Consent } from "./useStudies";
export {
  useExtendedStudies,
  useStudyContributions,
  useMyContributions,
  useCreateContribution,
  useStudyConsultants,
  useMyStudyConsultantApplication,
  useApplyAsConsultant,
  useStudyRatings,
  useStudyAverageRating,
  useMyStudyRating,
  useSubmitStudyRating,
  type ExtendedStudy,
  type StudyConsultant,
  type StudyRating,
  type StudyContribution,
} from "./useStudyFunding";
export {
  useMyEffectiveDistribution,
  useMyDistributionPlans,
  useProductDistributionInfo,
  calculateBottleDuration,
  DOSAGE_TIERS,
  type DistributionProtocol,
  type EffectiveDistribution,
  type DistributionPlan,
  type DistributionTierKey,
} from "./useDistributionProtocols";
export { useDistributionAdjustments, type CreateDistributionAdjustmentParams } from "./useDistributionAdjustments";

// Qualification Test
export {
  useSubmitQualificationTest,
  useSaveQualificationResponse,
  type QualificationResult,
} from "./useQualificationTest";

// Admin Distribution Protocols
export {
  useDistributionProtocolsAdmin,
  useStudiesDropdownDistribution,
  useProductsDropdownDistribution,
  useCreateDistributionProtocol,
  useUpdateDistributionProtocol,
  useDeleteDistributionProtocol,
  type DistributionProtocol as AdminDistributionProtocol,
  type StudyDropdownDistribution,
  type ProductDropdownDistribution,
  type CreateDistributionProtocolParams,
  type UpdateDistributionProtocolParams,
} from "./useAdminDistributionProtocols";

// Admin Symptom Catalog
export {
  useSymptomCatalogAdmin,
  useCreateSymptomCatalog,
  useUpdateSymptomCatalog,
  useDeleteSymptomCatalog,
  type SymptomCatalogAdmin,
  type UpsertSymptomCatalogParams,
} from "./useAdminSymptomCatalog";

// Admin Product Catalog
export {
  useProductCatalogAdmin,
  useCreateProductCatalog,
  useUpdateProductCatalog,
  useDeleteProductCatalog,
  type ProductCatalogAdmin,
  type UpsertProductCatalogParams,
} from "./useAdminProductCatalog";

// Partners
export { usePartners, type PartnersResponse, type PartnerProfile, type PartnerProfilePreview } from "./usePartners";
export {
  useConsultantStudies,
  useUserAlerts,
  useRecentUserData,
  type ConsultantStudy,
  type UserAlert,
  type RecentUserData,
} from "./usePartnerDashboard";
export { useCertifiedPartners, type CertifiedPartnerWithAvailability, type CertifiedPartnersOptions } from "./useCertifiedPartners";
export { usePartnerReviews, type PartnerAppointmentReview } from "./usePartnerReviews";
export { useConsultantUsers, type ConsultantUser } from "./useConsultantUsers";

// Guild of Experts
export {
  useExpertiseAreas,
  useGuildMembers,
  useGuildMemberDetail,
  useManageGuildExpertise,
  guildKeys,
  expertiseAreasQueryOptions,
  guildMembersQueryOptions,
} from "./useGuild";
export {
  useExpertRules,
  useExpertRuleDetail,
  useMyContributedRules,
  useMyRuleSubscriptions,
  useStoryKnowledgeContext,
  useCreateExpertRule,
  useUpdateExpertRule,
  usePublishExpertRule,
  useSubscribeToRule,
  useUnsubscribeFromRule,
  useRateExpertRule,
  expertRuleKeys,
  expertRulesQueryOptions,
  expertRuleDetailQueryOptions,
} from "./useExpertRules";
export { useDataSharingConsents, type DataSharingConsent } from "./useDataSharingConsent";

// Marketplace
export {
  useMarketplaceMembers,
  marketplaceKeys,
  marketplaceMembersQueryOptions,
  type MarketplaceFilters,
} from "./useMarketplace";
export {
  useCreateBooking,
  useConfirmBooking,
  useCompleteBooking,
  type CreateBookingParams,
} from "./useConsultationBooking";
export {
  useSpecialistEarnings,
  earningsKeys,
  earningsQueryOptions,
  type EarningsPeriod,
} from "./useSpecialistEarnings";
export {
  useUpdateSpecialistPricing,
  pricingKeys,
  type UpdatePricingParams,
} from "./useSpecialistPricing";
export {
  useRateSpecialist,
  type RateSpecialistParams,
} from "./useSpecialistRatings";

// Products & Orders
export { useProducts, type Product } from "./useProducts";
export { useProductAccess, type ProductAccessType } from "./useProductAccess";
export { useProductReviews, type ProductReview, type ProductReviewStats } from "./useProductReviews";
export { useCart, type CartItem } from "./useCart";
export { useOrderReviews, type OrderReview } from "./useOrderReviews";

// Invoice & Payment Settings
export {
  useInvoiceHeaderConfig,
  useUpdateInvoiceHeader,
  DEFAULT_INVOICE_HEADER,
  type InvoiceHeaderConfig,
} from "./useInvoiceSettings";
export {
  usePaymentMethodsConfig,
  useUpdatePaymentMethods,
  DEFAULT_PAYMENT_METHODS,
  type PaymentMethodsConfig,
} from "./usePaymentMethodSettings";
export {
  useFioBankSettingsConfig,
  useUpdateFioBankSettings,
  useSetupBankTransfer,
  DEFAULT_FIO_BANK_SETTINGS,
  type FioBankSettingsConfig,
  type BankTransferSetupResult,
} from "./useBankTransferSettings";
export {
  useOrderBankTransfer,
  type BankTransferDetails,
} from "./useOrderBankTransfer";
export {
  useUnmatchedBankTransactions,
  useAllBankTransactions,
  useAwaitingTransferOrders,
  useMatchTransactionToOrder,
  useDismissTransaction,
  useFioBankSync,
  useFioBankSyncStatus,
  type BankTransaction,
  type AwaitingOrder,
  type FioSyncResult,
} from "./useBankReconciliation";
export {
  useGenerateInvoice,
  type GenerateInvoiceResult,
} from "./useGenerateInvoice";
export {
  useOrderInvoiceData,
  type OrderInvoiceData,
  type InvoiceItem,
} from "./useOrderInvoiceData";

export {
  useExpeditionCalendar,
  useBatchAvailability,
  useBatchAllocation,
  useBatchInventory,
} from "./useExpedition";

// Tokens & Tokenomics
export {
  useTokenConfigs,
  useUpdateTokenConfig,
  useTokenRewardRules,
  useUpdateRewardRule,
  useCreateRewardRule,
  useTokenLocks,
  useCreateTokenLock,
  useUpdateTokenLock,
  useTokenBurns,
  useCreateTokenBurn,
  useTokenAllocations,
  useCreateTokenAllocation,
  useUpdateTokenAllocation,
  useTokenomicsStats,
  type TokenConfig,
  type TokenRewardRule,
  type TokenLock,
  type TokenBurn,
  type TokenAllocation,
} from "./useTokenomics";

export {
  useIntegrationServices,
  useIntegrationServiceByName,
  useIntegrationServicesByNames,
} from "./useIntegrationServices";
export {
  useTokens,
  useAllTokenTransactions,
  type TokenTransaction,
  type TokenBalance,
  type TokenType,
  type TransactionType,
} from "./useTokens";
export { useProductionTokenStats, AUTOMATIC_TRIGGERS, PRODUCTION_TOKEN_FLOW, type ProductionTokenStats } from "./useProductionTokens";
export { useGamificationStats, GAMIFICATION_STATS_QUERY_KEY, type GamificationStats } from "./useGamificationStats";
export {
  useUserWallet,
  useTokenTransactions,
  useMyVouchers,
  usePurchaseVoucher,
  useValidateVoucher,
  useRedeemVoucher,
} from "./useVoucher";
export {
  useVouchersAdmin,
  useVoucherAnalytics,
  useCreateManualVoucher,
  type AdminVoucher,
  type VoucherAnalytics,
  type CreateManualVoucherInput,
} from "./useVoucherAdmin";
export {
  useRewardShopProducts,
  useWalletBalance,
  type RewardShopProduct,
  type WalletBalance,
} from "./useRewardShop";
export {
  useLeaderboardRewardConfigs,
  useUpsertLeaderboardRewardConfig,
  useAwardLeaderboardRewards,
  type LeaderboardRewardConfig,
  type UpsertLeaderboardRewardConfigInput,
} from "./useLeaderboardRewards";

// Tests & Qualifications
export { useTestQuestions, type TestQuestionPublic } from "./useTestQuestions";
export { useMyTestResults, useMyQualificationResults, useMyPartnerCertification } from "./useTestResults";

// Consent & Audit
export { useHasInformedConsent } from "./useInformedConsent";
export { useConsentAuditLogger } from "./useConsentAuditLogger";
export { type ConsentActionType } from "../lib/security/consentAuditLogger";
export { useAuditJournal, type UseAuditJournalFilters } from "./useAuditJournal";

// Invitations
export {
  useInvitations,
  useValidateInvitation,
  useClaimInvitation,
  InvitationClaimSchema,
  ValidateInvitationResponseSchema,
  type Invitation,
  type InvitationClaim,
  type ValidateInvitationResponse,
  type CreateInvitationInput,
} from "./useInvitations";

// Notifications
export { useNotifications, type Notification } from "./useNotifications";
export {
  useNotificationPreferences,
  type NotificationReminderPeriod,
  type UserNotificationPreferences,
  type UserNotificationPreferencesPatch,
} from "./useNotificationPreferences";
export { useBrowserNotificationBridge } from "./useBrowserNotificationBridge";
export { useWebPushSubscription, type WebPushSubscriptionRow } from "./useWebPushSubscription";

// Admin
export { useAllRegistrations, useAggregateTrackingData, useMembersSummary, type RegistrationWithDetails, type AggregateTrackingData, type MemberSummary } from "./useAdminData";
export { useAdminTrackingTrends, AGE_GROUPS, type TrendGranularity, type TrendDirection, type RangePreset, type TrackingTrendPeriod, type TrendComparison, type PeriodComparison, type TrackingTrendFilters, type CheckInTypeFilter, type AgeGroup } from "./useAdminTrackingTrends";
export {
  useAdminNotificationCampaigns,
  useNotificationCampaignSchedulesAdmin,
  useNotificationCampaignRunsAdmin,
  useNotificationCampaignDeliveriesAdmin,
  useUpsertNotificationCampaignSchedule,
  useDeleteNotificationCampaignSchedule,
  type NotificationCampaignInput,
  type NotificationCampaignScheduleInput,
} from "./useAdminNotificationCampaigns";
export {
  useStudyContributionsAdmin,
  useStudiesWithDynamicFunding,
  useUpdateStudyContributionStatus,
  type StudyWithDynamicFunding,
} from "./useAdminContributions";
export {
  useAdminStudiesOverview,
  useStudyConsultantsAdmin,
  useStudyContributionsForStudyAdmin,
  useCreateStudyAdmin,
  useUpdateStudyAdmin,
  useUpdateStudyConsultantStatusAdmin,
  useUpdateStudyFundingStatusAdmin,
  type StudyWithDynamicData,
  type ConsultantWithRelations,
  type ContributionWithStudy,
  type StudyType,
  type FundingStatus,
  type CreateStudyParams,
  type UpdateStudyParams,
} from "./useAdminStudies";
export {
  useConsentTemplatesAdmin,
  useStudyConsentRequirementsAdmin,
  useStudyQuestionnairesAdmin,
  useQuestionnairesAdmin,
  useTranslationsForKeys,
  useCreateConsentTemplateMutation,
  useDeleteConsentTemplateMutation,
  useUpsertStudyConsentRequirementMutation,
  useDeleteStudyConsentRequirementMutation,
  useUpsertStudyQuestionnaireMutation,
  useDeleteStudyQuestionnaireMutation,
  fetchTranslationsForKeys,
  type ConsentTemplateAdmin,
  type StudyConsentRequirementAdmin,
  type StudyQuestionnaireAdmin,
  type QuestionnaireAdmin,
  type SupportedLocale as StudyConsentSupportedLocale,
} from "./useAdminStudyConsents";
export {
  useQuestionnairesAdminFull,
  useQuestionBlocksAdmin,
  useCreateQuestionnaireMutation,
  useUpdateQuestionnaireMutation,
  useDeleteQuestionnaireMutation,
  useCreateQuestionBlockMutation,
  useUpdateQuestionBlockMutation,
  useDeleteQuestionBlockMutation,
  useQuestionnaireTranslations,
  QUESTIONNAIRE_TYPES,
  type QuestionnaireType,
  type QuestionnaireExtended,
  type QuestionBlock,
} from "./useAdminQuestionnaires";
export {
  useProductionBatchesAdmin,
  useProductionProductsAdmin,
  useProductionStudiesAdmin,
  useBatchWorkflowStepsAdmin,
  useBatchMilestonesAdmin,
  useBatchVialsAdmin,
  useWorkflowTemplatesAdmin,
  useProtocolStepsAdmin,
  useCreateProductionBatchMutation,
  useUpdateProductionBatchMutation,
  useUpdateBatchStatusMutation,
  useCreateWorkflowTemplateMutation,
  useUpdateWorkflowTemplateMutation,
  useSetWorkflowTemplateDefaultMutation,
  useDeleteWorkflowTemplateMutation,
  useUpdateProtocolStepMutation,
  type ProductionBatchWithRelations,
  type BatchFormData,
  type WorkflowTemplate,
  type ProtocolStep,
} from "./useAdminProduction";
export {
  useProductionMaterialsAdmin,
  useUpsertProductionMaterialMutation,
  useProductionCoefficientsAdmin,
  useUpsertProductionCoefficientMutation,
  useProductionBomAdmin,
  useProductionCostOverviewAdmin,
  useUpsertProductionCostLineMutation,
  useProductionCostRatesAdmin,
  useProductionVariantsAdmin,
  useProductionResourcesAdmin,
  useProductionQualityParamsAdmin,
  type ProductionMaterial,
  type ProductionCoefficient,
  type ProductionBomEntry,
  type ProductionCostOverview,
  type ProductionVariant,
  type ProductionResource,
  type ProductionQualityParam,
  type ProductionCostRate,
} from "./useAdminProductionErp";
export {
  useProductionSuppliersAdmin,
  useUpsertProductionSupplierMutation,
  useProductionLocationsAdmin,
  useUpsertProductionLocationMutation,
  useProductionEquipmentAdmin,
  useUpsertProductionEquipmentMutation,
  useProductionLotsAdmin,
  useUpsertProductionLotMutation,
  useProductionInventoryEventsAdmin,
  useCreateProductionInventoryEventMutation,
  useProductionBatchMaterialsAdmin,
  useUpsertProductionBatchMaterialMutation,
  useProductionDeviationsAdmin,
  useUpsertProductionDeviationMutation,
  useProductionCapaAdmin,
  useUpsertProductionCapaMutation,
  useProductionReleaseDecisionsAdmin,
  useCreateProductionReleaseDecisionMutation,
  useProductionEquipmentCalibrationsAdmin,
  useCreateProductionEquipmentCalibrationMutation,
  useProductionEquipmentCleaningAdmin,
  useCreateProductionEquipmentCleaningMutation,
  useProductionQcTestDefinitionsAdmin,
  useUpsertProductionQcTestDefinitionMutation,
  useProductionSensorReadingsAdmin,
  useCreateProductionSensorReadingMutation,
  type ProductionSupplier,
  type ProductionLocation,
  type ProductionEquipment,
  type ProductionLot,
  type ProductionInventoryEvent,
  type ProductionBatchMaterial,
  type ProductionDeviation,
  type ProductionCapa,
  type ProductionReleaseDecision,
  type ProductionEquipmentCalibration,
  type ProductionEquipmentCleaning,
  type ProductionQcTestDefinition,
  type ProductionSensorReading,
} from "./useAdminProductionErpExtended";

// Production Flow Tracking
export {
  useFlowNodesAdmin,
  useUpsertFlowNodeMutation,
  useFlowSubstancesAdmin,
  useUpsertFlowSubstanceMutation,
  useFlowRecordsAdmin,
  useLatestBatchForFlowNodeAdmin,
  useCreateFlowRecordMutation,
  useFlowBalanceAdmin,
  useFlowNodeInventoryAdmin,
  useDuplicateBatchFlowMutation,
  FLOW_NODE_TYPES,
  type FlowNode,
  type FlowRecord,
  type FlowSubstance,
  type FlowBalance,
  type FlowNodeInventory,
  type FlowNodeType,
} from "./useAdminProductionFlow";

// Production Enhancements (versioning, corrections, alerts, angels share, traceability)
export {
  useWorkflowTemplateVersionsAdmin,
  useUpdateWorkflowTemplateVersionedMutation,
  useRestoreWorkflowTemplateVersionMutation,
  useCreateFlowCorrectionMutation,
  useSensorAlertsAdmin,
  useCreateSensorAlertMutation,
  useAcknowledgeSensorAlertMutation,
  useAngelsShareReportAdmin,
  useCrossBatchTraceabilityAdmin,
} from "./useAdminProductionEnhancements";

// Flow Node IoT Config
export {
  useFlowNodeIotConfig,
  iotConfigSchema,
  iotEntityMappingSchema,
  type IotConfig,
  type IotEntityMapping,
} from "./useFlowNodeIotConfig";

// Flow Node Monitoring
export {
  useFlowNodeMonitoring,
  flowNodeSensorSummarySchema,
  type FlowNodeSensorSummary,
} from "./useFlowNodeMonitoring";

// Protocol Sensor Data
export {
  useProtocolSensorData,
  protocolSensorDataSchema,
  type ProtocolSensorData,
} from "./useProtocolSensorData";

export {
  fetchHomeAssistantSyncProfile,
  fetchHomeAssistantSyncProfileStore,
  fetchHomeAssistantSyncProfileStoreSnapshot,
  saveHomeAssistantSyncProfile,
  saveHomeAssistantSyncProfileStore,
  fetchHomeAssistantHealth,
  syncHomeAssistantProductionData,
  useHomeAssistantSyncProfile,
  useHomeAssistantSyncProfileStore,
  useHomeAssistantSyncProfileStoreSnapshot,
  useSaveHomeAssistantSyncProfile,
  useSaveHomeAssistantSyncProfileStore,
  useHomeAssistantHealthCheck,
  useHomeAssistantProductionSync,
  type HomeAssistantEntityLink,
  type HomeAssistantHealth,
  type HomeAssistantProductionSyncProfile,
  type HomeAssistantSyncProfileStoreSnapshot,
  type HomeAssistantSyncProfileStore,
  type HomeAssistantSyncProfileTemplate,
  type SaveHomeAssistantSyncProfileStoreInput,
  type HomeAssistantThreshold,
  type HomeAssistantProductionSyncInput,
  type HomeAssistantProductionSyncResult,
} from "./useHomeAssistantProductionSync";

export {
  useShipmentSettings,
  useDistributionSchedules,
  useUpdateShipmentSetting,
  useSaveShipmentSettings,
  useCreateDistributionSchedule,
  useProcessDistributionSchedule,
  DEFAULT_SHIPMENT_SETTINGS,
  type ShipmentSettings,
  type DistributionSchedule,
} from "./useAdminDistribution";

// Archive
export { useArchiveDocuments, type ArchiveDocument, type UseArchiveDocumentsOptions } from "./useArchiveDocuments";

// StoryLoop (Partner workspace)
export {
  useStories,
  useInfiniteStories,
  useStoryDetail,
  useStoryStats,
  useUpcomingReminders,
  useStoryLabels,
  useStoryAiContext,
  useCreateStory,
  useCreateStoryEntry,
  useToggleStoryStar,
  useUpdateStoryStatus,
  useCreateStoryReminder,
  storyLoopKeys,
} from "./useStoryLoop";
export {
  useStoryParticipants,
  useAddStoryParticipant,
  useRemoveStoryParticipant,
  storyParticipantKeys,
} from "./useStoryParticipants";
export { useSearchCertifiedPartners } from "./useSearchCertifiedPartners";
export { useAdminStoryLoopOverview } from "./useStoryLoopAdmin";
export {
  useStoryDeliveryContext,
  useCreateStoryRuleset,
  useUpdateStoryDeliveryContext,
  useUpdateStoryProjectPreview,
  storyDeliveryKeys,
} from "./useStoryDeliveryContext";
export { useAdminStories, adminStoriesKeys } from "./useAdminStories";
export { useEnsureMemberStory } from "./useEnsureMemberStory";
export { useConsentDetail, type ConsentDetail } from "./useConsentDetail";
export { useLabResultDetail, type LabResultDetail } from "./useLabResultDetail";
export { useQuestionnaireResponseDetail, type QuestionnaireResponseDetail } from "./useQuestionnaireResponseDetail";
export {
  useStoryLoopUiPreferences,
  STORYLOOP_UI_PREFERENCES_QUERY_KEY,
  type StoryLoopMobilePanel,
  type StoryLoopViewportBucket,
  type StoryLoopSettings,
  type StoryLoopUiPreferences,
  type StoryLoopUiPreferencesPatch,
} from "./useStoryLoopUiPreferences";

// Member Timeline (Member view of StoryLoop)
export {
  useMyTimeline,
  useAddTimelineEntry,
  useMyStories,
  useHasTimeline,
  timelineKeys,
  TimelineEntrySchema,
  TimelineStorySchema,
  TimelineResponseSchema,
  MEMBER_ALLOWED_ENTRY_TYPES,
  type TimelineEntry,
  type TimelineStory,
  type TimelineResponse,
  type MemberEntryType,
  type AddTimelineEntryRequest,
} from "./useMyTimeline";

// Public
export { usePublicStats } from "./usePublicStats";

// Translations
export {
  useDynamicTranslations,
  useDynamicTranslationsWithStatus,
  useFetchTranslationsForKeys,
  useTranslationsByKey,
  SUPPORTED_LOCALES,
  type Translation,
  type TranslationForKey,
  type TranslationWithStatus,
  type TranslationInput,
  type SupportedLocale,
} from "./useDynamicTranslations";
export { useSupportedLanguages } from "./useSupportedLanguages";

// Dynamic Onboarding
export {
  useCheckUmbrellaRegistration,
  useCreateStudyRegistration,
  useSubmitOnboardingResponse,
  useSubmitOnboardingConsents,
  useUpdateProfileDisplayName,
  useCreateMyAppointment,
  useStudyConsentRequirementsLocalized,
  useSubmitStudyConsentAcceptance,
  useInsertQuestionnaireResponse,
  useProfileContactPrefill,
  useUpdateMyPartnerProfile,
  type OnboardingSubmitData,
  type ProfileContactPrefillData,
} from "./useDynamicOnboarding";

// UI Utilities
export { useAnimatedCounter } from "./useAnimatedCounter";
export { useDebounce } from "./useDebounce";
export { useIsMobile } from "./use-mobile";
export { useIsMountedRef } from "./useIsMountedRef";
export { useNavigationState } from "./useNavigationState";
export { useRequireAuthWithReturn } from "./useRequireAuthWithReturn";
export { useScrollReveal } from "./useScrollReveal";
export { useSecureMode, type PhiModeContextValue } from "./useSecureMode";

// Monitoring
export { useSentryUser } from "./useSentryUser";

// Admin Guard
export { useAdminGuard, AdminPermissionError } from "./useAdminGuard";
export { useAccountDeletion } from "./useAccountDeletion";
export { useAdminDeletionRequests } from "./useAdminDeletionRequests";
export {
  useAdminPendingCounts,
  useAdminActivityFeed,
  type AdminPendingCounts,
  type ActivityFeedItem,
  type ActivityFeedItemType,
  type UseAdminActivityFeedParams,
} from "./useAdminActivityFeed";

// News Articles
export { useNewsArticles, useNewsArticleBySlug, type NewsArticlePublic } from "./useNewsArticles";
export { useAdminNewsArticles, type NewsArticleAdmin, type NewsArticlePayload } from "./useAdminNewsArticles";
export { useNewsDelivery } from "./useNewsDelivery";

// Expert Overlay / AI Orchestrator (Phase 3)
export {
  useAgentCatalog,
  useUpdateAgentCatalog,
  agentCatalogKeys,
  type AgentCatalogUpdateInput,
} from "./useAgentCatalog";
export {
  useContextProfiles,
  useUpdateContextProfile,
  contextProfileKeys,
  type ContextProfileUpdateInput,
} from "./useContextProfiles";
export {
  useAiRuns,
  useAiRunEvents,
  aiRunKeys,
} from "./useAiRuns";
export {
  useMcpTokens,
  useCreateMcpToken,
  useToggleMcpToken,
  useRevokeMcpToken,
  mcpTokenKeys,
  type CreateMcpTokenInput,
} from "./useMcpTokens";
export {
  useAiAgentMetrics,
  useAiAgentMetricsTimeseries,
  useAiRunSummary,
  useRefreshAiAgentMetrics,
  aiAgentMetricsKeys,
} from "./useAiAgentMetrics";
export {
  useModerationSessions,
  useModerationDecisions,
  moderationAdminKeys,
} from "./useModerationAdmin";
// useAgentTools — removed: agent_tool_bindings dropped in channel-centric migration
export {
  useEvalRuns,
  useEvalResults,
  useStartEvalRun,
  useAdminRateMessage,
  type EvalRun,
  type EvalResult,
} from "./useAiEvaluation";
export {
  useRagBaseline,
  useRagRunDetail,
  averageMetric,
} from "./useRagBaseline";
export {
  useRunCitations,
  useRunFaithfulness,
  useSubmitMessageFeedback,
  faithfulnessTier,
} from "./useRunCitations";
export {
  useRunGraphContext,
  groupByTarget,
  type GroupedGraphContext,
} from "./useRunGraphContext";
export {
  useQuarantinedKnowledge,
  useReinstateKnowledgeItem,
  type QuarantinedKnowledgeItem,
} from "./useQuarantinedKnowledge";
export {
  usePlatformWarmupState,
  useMarkWarmupStep,
} from "./usePlatformWarmupState";
export { useRateChatMessage } from "./useRateChatMessage";
export {
  useAiSessionMemory,
  useSetSessionMemory,
  useClearSessionMemory,
  sessionMemoryKeys,
  type SessionMemoryEntry,
} from "./useAiSessionMemory";
export {
  useAiUserMemory,
  useAiUserMemoryForUser,
  useAdminUserMemories,
  useSetUserMemory,
  useDeleteUserMemory,
  userMemoryKeys,
  type UserMemoryEntry,
} from "./useAiUserMemory";
export {
  useAiTasks,
  useAiTaskStatus,
  useAdminAiTasks,
  useCreateAiTask,
  useCancelAiTask,
  aiTaskKeys,
  type AiTaskStatus,
  type AiTaskListItem,
} from "./useAiTasks";
export {
  useAiWorkflows,
  useAiWorkflow,
  useAiWorkflowNodeRuns,
  useCreateAiWorkflow,
  useUpdateAiWorkflow,
  useDeleteAiWorkflow,
  aiWorkflowKeys,
  type WorkflowDefinition,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNodeRun,
} from "./useAiWorkflows";
export {
  useAiTriggers,
  useAiTrigger,
  useCreateAiTrigger,
  useUpdateAiTrigger,
  useDeleteAiTrigger,
  useProactiveRuns,
  useAiScheduledJobs,
  useCreateAiScheduledJob,
  aiProactiveKeys,
  type TriggerDefinition,
  type TriggerDefinitionDetail,
  type ProactiveRun,
  type ScheduledJob,
  type TriggerCondition,
} from "./useAiProactive";

export {
  useMonitoringConfig,
  useUpdateMonitoringConfig,
  INTERVAL_OPTIONS,
  monitoringConfigKeys,
  DEFAULT_MONITORING_CONFIG,
  type MonitoringConfig,
} from "./useMonitoringConfig";
export {
  useModelRegistry,
  useApproveModel,
  useRejectModel,
  useUpdateModelRegistry,
  type ModelRegistryRow,
  type ModelRegistryFilters,
} from "./useModelRegistry";
export {
  useSubmitAiFeedback,
  useExtractTrainingPairsFromKb,
} from "./useAleFeedback";
export {
  useUpdateStoryCanvas,
  parseCanvasData,
  storyCanvasKeys,
} from "./useStoryCanvas";

// GitHub App + Integration Events
export {
  useGitHubInstallations,
  useGitHubRepositories,
  useLinkInstallationToPartner,
  useLinkStoryToRepo,
  githubInstallationKeys,
} from "./useGitHubInstallations";
export {
  useIntegrationEventStats,
  useIntegrationEventsForStory,
  useStoryAishaMaturity,
  integrationEventKeys,
} from "./useIntegrationEvents";
export {
  useRepoOperation,
  useCreatePullRequest,
  useCommitFile,
  useCreateBranch,
  repoOpsKeys,
} from "./useRepoOperations";

// Collaboration Network
export {
  useLinkedStories,
  useStoryGraph,
  useCrossStorySummary,
  useCreateStoryLink,
  useAcceptStoryLink,
  useDismissStoryLink,
  storyLinkKeys,
} from "./useStoryLinks";
export {
  useCollaborationPreferences,
  useUpdateCollaborationPreferences,
  collaborationPreferenceKeys,
} from "./useCollaborationPreferences";

// Web Pages
export { useWebPage } from "./useWebPage";
export {
  useAdminWebPages,
  useAdminWebPage,
  useUpsertWebPage,
  useUpdateWebPageCanvas,
  useDeleteWebPage,
} from "./useAdminWebPages";
export type {
  UpsertWebPageInput,
  UpdateWebPageCanvasInput,
} from "./useAdminWebPages";

// Page Asset Upload
export { usePageAssetUpload } from "./usePageAssetUpload";

// Page Versioning
export {
  usePageVersions,
  useCreatePageVersion,
  useRestorePageVersion,
} from "./usePageVersions";
export type { PageVersion } from "./usePageVersions";

// Page Templates
export {
  usePageTemplates,
  useSavePageAsTemplate,
  useApplyPageTemplate,
} from "./usePageTemplates";
export type { PageTemplate } from "./usePageTemplates";

// Occipitum Design Profile
export {
  useDesignProfile,
  useDesignInterview,
  useOccipitumDesign,
  designProfileKeys,
} from "./useDesignProfile";

// Branding Profile (unified white-label)
export {
  useBrandingProfile,
  useUpdateBrandingProfile,
  DEFAULT_BRANDING_PROFILE,
} from "./useBrandingProfile";
export type { BrandingProfile, BrandingProfileFormData } from "./useBrandingProfile";

// Cosmos / Governance / Blockchain
export { useCosmosLedgerStatus } from "./useCosmosLedgerStatus";
export type { CosmosLedgerStatus } from "./useCosmosLedgerStatus";
export { useRegisterCosmosAddress } from "./useRegisterCosmosAddress";
export type { RegisterCosmosAddressParams } from "./useRegisterCosmosAddress";
export { useClaimCosmosReward } from "./useClaimCosmosReward";
export type { ClaimCosmosRewardParams } from "./useClaimCosmosReward";
export { useRetryBlockchainSync } from "./useRetryBlockchainSync";
export type { RetryBlockchainSyncParams } from "./useRetryBlockchainSync";
export { useGovernanceProposals, useGovernanceVote } from "./useGovernanceProposals";
export type { Proposal, VoteOption } from "./useGovernanceProposals";

// Self-Improvement & Cost Intelligence
export {
  useImprovementProposals,
  useCreateImprovementProposal,
  useApproveImprovementProposal,
  useRejectImprovementProposal,
  improvementProposalKeys,
} from "./useImprovementProposals";
export type { CreateProposalInput } from "./useImprovementProposals";
export {
  useModelCostSimulation,
  modelCostSimulationKeys,
} from "./useModelCostSimulation";

// Web Artifact pipeline (story-driven design ingest, scrape, redesign, apply, publish)
export { useStackDefaultStoryId, useEnsureStackDefaultStory } from "./useEnsureStackDefaultStory";
export { useWebArtifactJobs, webArtifactJobsKeys } from "./useWebArtifactJobs";
export { useStartIngestUpload } from "./useStartIngestUpload";
export { useStartIngestScrape } from "./useStartIngestScrape";
export { useRequestRedesign } from "./useRequestRedesign";
export { useApplyArtifact } from "./useApplyArtifact";
export { usePublishArtifact } from "./usePublishArtifact";

// Types & Utilities
export { type SafeLogLevel } from "../lib/security/safeLogger";
export { type Json } from "../integrations/db/types";
