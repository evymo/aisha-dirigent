/**
 * Lab Tests Utility Functions
 * 
 * Helper functions for working with lab test catalog and RTN panels.
 * 
 * @module lib/lab-tests/labTestUtils
 */

import { BASE_CURRENCY_FALLBACK } from "@/lib/currency/constants";
import type {
  LabTestDefinition,
  LabTestsCatalog,
  RtnPanelsConfig,
  LabTestPanel,
  PanelTest,
  EnrichedLabTest,
  RtnProduct,
  PanelTiming,
  TestPriority,
  SampleType,
  RecommendationSummary,
  LabTestRecommendation,
  PanelRecommendation,
} from "@/schemas/labTestSchemas";

import labTestsCatalogJson from "./lab-tests-catalog.json";
import rtnPanelsConfigJson from "./rtn-panels-config.json";

/** Translation function type for i18n key resolution */
export type TFunction = (key: string) => string;

// =============================================================================
// DATA LOADING
// =============================================================================

/**
 * Get the lab tests catalog
 */
export function getLabTestsCatalog(): LabTestsCatalog {
  return labTestsCatalogJson as LabTestsCatalog;
}

/**
 * Get the RTN panels configuration
 */
export function getRtnPanelsConfig(): RtnPanelsConfig {
  return rtnPanelsConfigJson as unknown as RtnPanelsConfig;
}

// =============================================================================
// CATALOG LOOKUPS
// =============================================================================

/**
 * Find a test by its code
 */
export function findTestByCode(code: string): LabTestDefinition | undefined {
  const catalog = getLabTestsCatalog();
  return catalog.tests.find((test) => test.code === code);
}

/**
 * Find multiple tests by codes
 */
export function findTestsByCodes(codes: string[]): LabTestDefinition[] {
  const catalog = getLabTestsCatalog();
  const codeSet = new Set(codes);
  return catalog.tests.filter((test) => codeSet.has(test.code));
}

/**
 * Get tests by category
 */
export function getTestsByCategory(categoryId: string): LabTestDefinition[] {
  const catalog = getLabTestsCatalog();
  return catalog.tests.filter((test) => test.category === categoryId);
}

/**
 * Get category name by ID
 */
export function getCategoryName(
  categoryId: string,
  t: TFunction
): string {
  const catalog = getLabTestsCatalog();
  const category = catalog.categories.find((cat) => cat.id === categoryId);
  if (!category) return categoryId;
  return t(category.name_key);
}

// =============================================================================
// PANEL LOOKUPS
// =============================================================================

/**
 * Get a panel by ID
 */
export function getPanel(panelId: string): LabTestPanel | undefined {
  const config = getRtnPanelsConfig();
  return config.panels[panelId];
}

/**
 * Get all panels for a product
 */
export function getPanelsForProduct(productId: RtnProduct): LabTestPanel[] {
  const config = getRtnPanelsConfig();
  return Object.values(config.panels).filter((panel) =>
    panel.applicable_products.includes(productId)
  );
}

/**
 * Get panels by timing
 */
export function getPanelsByTiming(timing: PanelTiming): LabTestPanel[] {
  const config = getRtnPanelsConfig();
  return Object.values(config.panels).filter((panel) => panel.timing === timing);
}

/**
 * Get mandatory panels for products
 */
export function getMandatoryPanels(products: RtnProduct[]): LabTestPanel[] {
  const config = getRtnPanelsConfig();
  const productSet = new Set(products);
  
  return Object.values(config.panels).filter(
    (panel) =>
      panel.is_mandatory &&
      panel.applicable_products.some((p) => productSet.has(p))
  );
}

/**
 * Get panels suggested for conditions
 */
export function getPanelsForConditions(conditions: string[]): LabTestPanel[] {
  const config = getRtnPanelsConfig();
  const suggestedPanelIds = new Set<string>();
  
  for (const condition of conditions) {
    const mapping = config.condition_mappings[condition];
    if (mapping) {
      mapping.suggested_panels.forEach((id) => suggestedPanelIds.add(id));
    }
  }
  
  return Array.from(suggestedPanelIds)
    .map((id) => config.panels[id])
    .filter(Boolean);
}

// =============================================================================
// ENRICHMENT
// =============================================================================

/**
 * Enrich panel tests with full catalog data
 */
export function enrichPanelTests(
  panel: LabTestPanel,
  t: TFunction
): EnrichedLabTest[] {
  const catalog = getLabTestsCatalog();
  const testMap = new Map(catalog.tests.map((t) => [t.code, t]));
  
  return panel.tests
    .map((panelTest): EnrichedLabTest | null => {
      const catalogTest = testMap.get(panelTest.code);
      if (!catalogTest) {
        // Test not found in catalog - skip silently (may be deprecated/removed)
        return null;
      }
      
      return {
        ...catalogTest,
        priority: panelTest.priority,
        reason: t(panelTest.reason_key),
        panel_id: panel.id,
      };
    })
    .filter((test): test is EnrichedLabTest => test !== null);
}

/**
 * Convert panel test to recommendation format
 */
export function panelTestToRecommendation(
  panelTest: PanelTest,
  t: TFunction
): LabTestRecommendation | null {
  const catalogTest = findTestByCode(panelTest.code);
  if (!catalogTest) return null;
  
  return {
    code: catalogTest.code,
    name: t(catalogTest.name_key),
    category: getCategoryName(catalogTest.category, t),
    priority: panelTest.priority,
    reason: t(panelTest.reason_key),
    price: catalogTest.price,
    sample_type: catalogTest.sample_type,
    requires_fasting: catalogTest.requires_fasting,
  };
}

/**
 * Convert panel to recommendation format
 */
export function panelToRecommendation(
  panel: LabTestPanel,
  reason: string,
  t: TFunction
): PanelRecommendation {
  const tests = panel.tests
    .map((pt) => panelTestToRecommendation(pt, t))
    .filter((pt): pt is LabTestRecommendation => pt !== null);
  
  const totalPrice = tests.reduce((sum, pt) => sum + pt.price, 0);
  
  return {
    panel_id: panel.id,
    panel_name: t(panel.name_key),
    panel_description: t(panel.description_key),
    timing: panel.timing,
    is_mandatory: panel.is_mandatory,
    tests,
    total_price: totalPrice,
    reason,
  };
}

// =============================================================================
// GROUPING & FILTERING
// =============================================================================

/**
 * Group tests by sample type
 */
export function groupTestsBySampleType(
  tests: EnrichedLabTest[]
): Record<SampleType, EnrichedLabTest[]> {
  const groups: Record<SampleType, EnrichedLabTest[]> = {
    blood: [],
    urine: [],
    stool: [],
    saliva: [],
  };
  
  for (const test of tests) {
    groups[test.sample_type].push(test);
  }
  
  return groups;
}

/**
 * Group tests by priority
 */
export function groupTestsByPriority(
  tests: EnrichedLabTest[]
): Record<TestPriority, EnrichedLabTest[]> {
  const groups: Record<TestPriority, EnrichedLabTest[]> = {
    required: [],
    recommended: [],
    conditional: [],
    optional: [],
  };
  
  for (const test of tests) {
    groups[test.priority].push(test);
  }
  
  return groups;
}

/**
 * Filter tests by priority threshold
 */
export function filterTestsByMinPriority(
  tests: EnrichedLabTest[],
  minPriority: TestPriority
): EnrichedLabTest[] {
  const priorityOrder: TestPriority[] = ["required", "recommended", "conditional", "optional"];
  const minIndex = priorityOrder.indexOf(minPriority);
  
  return tests.filter((test) => {
    const testIndex = priorityOrder.indexOf(test.priority);
    return testIndex <= minIndex;
  });
}

/**
 * Deduplicate tests (keep highest priority)
 */
export function deduplicateTests(tests: EnrichedLabTest[]): EnrichedLabTest[] {
  const priorityOrder: TestPriority[] = ["required", "recommended", "conditional", "optional"];
  const testMap = new Map<string, EnrichedLabTest>();
  
  for (const test of tests) {
    const existing = testMap.get(test.code);
    if (!existing) {
      testMap.set(test.code, test);
    } else {
      const existingPriority = priorityOrder.indexOf(existing.priority);
      const newPriority = priorityOrder.indexOf(test.priority);
      if (newPriority < existingPriority) {
        testMap.set(test.code, test);
      }
    }
  }
  
  return Array.from(testMap.values());
}

// =============================================================================
// CALCULATIONS
// =============================================================================

/**
 * Calculate total price for tests
 */
export function calculateTotalPrice(tests: { price: number }[]): number {
  return tests.reduce((sum, test) => sum + test.price, 0);
}

/**
 * Check if any test requires fasting
 */
export function requiresFasting(tests: { requires_fasting: boolean }[]): boolean {
  return tests.some((test) => test.requires_fasting);
}

/**
 * Get unique sample types required
 */
export function getRequiredSampleTypes(tests: { sample_type: SampleType }[]): SampleType[] {
  return [...new Set(tests.map((test) => test.sample_type))];
}

/**
 * Generate recommendation summary
 */
export function generateSummary(tests: EnrichedLabTest[]): RecommendationSummary {
  const byPriority = groupTestsByPriority(tests);
  
  return {
    total_tests: tests.length,
    required_tests: byPriority.required.length,
    recommended_tests: byPriority.recommended.length,
    conditional_tests: byPriority.conditional.length,
    optional_tests: byPriority.optional.length,
    total_price: calculateTotalPrice(tests),
    requires_fasting: requiresFasting(tests),
    sample_types: getRequiredSampleTypes(tests),
    panels_count: new Set(tests.map((t) => t.panel_id)).size,
  };
}

// =============================================================================
// LABEL HELPERS
// =============================================================================

/**
 * Get priority label
 */
export function getPriorityLabel(
  priority: TestPriority,
  t: TFunction
): string {
  const config = getRtnPanelsConfig();
  const def = config.priority_definitions[priority];
  if (!def) return priority;
  return t(def.label_key);
}

/**
 * Get timing label
 */
export function getTimingLabel(
  timing: PanelTiming,
  t: TFunction
): string {
  const config = getRtnPanelsConfig();
  const def = config.timing_definitions[timing];
  if (!def) return timing;
  return t(def.label_key);
}

/**
 * Get sample type label
 */
export function getSampleTypeLabel(
  sampleType: SampleType,
  t: TFunction
): string {
  return t(`lab.sampleTypes.${sampleType}`);
}

/**
 * Get product name
 */
export function getProductName(
  productId: RtnProduct,
  t: TFunction
): string {
  const config = getRtnPanelsConfig();
  const product = config.products[productId];
  if (!product) return productId;
  return t(product.name_key);
}

// =============================================================================
// FORMATTERS
// =============================================================================

/**
 * Format price in CZK
 */
export function formatPriceCZK(price: number): string {
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency: BASE_CURRENCY_FALLBACK,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

/**
 * Get priority color class (Tailwind)
 */
export function getPriorityColorClass(priority: TestPriority): string {
  switch (priority) {
    case "required":
      return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300";
    case "recommended":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300";
    case "conditional":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
    case "optional":
      return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

/**
 * Get sample type icon name
 */
export function getSampleTypeIcon(sampleType: SampleType): string {
  switch (sampleType) {
    case "blood":
      return "droplet";
    case "urine":
      return "flask-conical";
    case "stool":
      return "package";
    case "saliva":
      return "pipette";
    default:
      return "test-tube";
  }
}
