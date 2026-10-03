/**
 * Lab Tests Module
 *
 * Provides comprehensive utilities for working with lab tests catalog,
 * RTN product panels, and test recommendations.
 *
 * @module lib/lab-tests
 *
 * @example
 * ```typescript
 * import {
 *   findTestByCode,
 *   getMandatoryPanels,
 *   enrichPanelTests,
 *   formatPriceCZK,
 * } from '@/lib/lab-tests';
 *
 * // Get baseline panel for Retisin
 * const panels = getMandatoryPanels(['retisin']);
 * const baselinePanel = panels.find(p => p.id === 'baseline');
 *
 * // Enrich with full catalog data
 * const tests = enrichPanelTests(baselinePanel, 'cs');
 *
 * // Calculate total price
 * const total = formatPriceCZK(calculateTotalPrice(tests));
 * ```
 */

// Re-export all utilities
export * from "./labTestUtils";

// Re-export schemas and types
export {
  // Enums
  SampleTypeSchema,
  TestPrioritySchema,
  PanelTimingSchema,
  RtnProductSchema,
  LabOrderStatusSchema,
  BiochemicalCategorySchema,
  
  // Catalog schemas
  LabTestCategorySchema,
  LabTestDefinitionSchema,
  LabTestsCatalogSchema,
  
  // Panel schemas
  RtnProductDefinitionSchema,
  PanelTestSchema,
  LabTestPanelSchema,
  RtnPanelsConfigSchema,
  
  // Runtime schemas
  LabTestRecommendationSchema,
  PanelRecommendationSchema,
  LabTestRecommendationResponseSchema,
  
  // Order schemas
  LabOrderTestSchema,
  LabOrderMetadataSchema,
  
  // AI schemas
  AiLabRecommendationRequestSchema,
  AiLabRecommendationResponseSchema,
  
  // Utility schemas
  EnrichedLabTestSchema,
  TestsBySampleTypeSchema,
  RecommendationSummarySchema,
} from "@/schemas/labTestSchemas";

export type {
  // Enum types
  SampleType,
  TestPriority,
  PanelTiming,
  RtnProduct,
  LabOrderStatus,
  BiochemicalCategory,
  
  // Catalog types
  LabTestCategory,
  LabTestDefinition,
  LabTestsCatalog,
  
  // Panel types
  RtnProductDefinition,
  PanelTest,
  LabTestPanel,
  ConditionMapping,
  PriorityDefinition,
  TimingDefinition,
  RtnPanelsConfig,
  
  // Runtime types
  LabTestRecommendation,
  PanelRecommendation,
  LabTestRecommendationResponse,
  
  // Order types
  LabOrderTest,
  LabOrderMetadata,
  
  // AI types
  AiLabRecommendationRequest,
  AiLabRecommendationResponse,
  
  // Utility types
  EnrichedLabTest,
  TestsBySampleType,
  RecommendationSummary,
} from "@/schemas/labTestSchemas";
