/**
 * @fileoverview Admin production ERP hooks
 * Provides React Query hooks for production materials, coefficients, BOM,
 * cost scenarios, cost lines, resources, variants, and quality parameters.
 * All hooks use RPC functions for secure, audited database access.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { usePermissions } from "./usePermissions";
import { z } from "zod";

// ==================== Schemas ====================

const productionMaterialSchema = z.object({
  id: z.string().uuid(),
  item_code: z.string(),
  item_name: z.string(),
  item_type: z.string(),
  uom: z.string(),
  category: z.string().nullable(),
  description: z.string().nullable(),
  cas_number: z.string().nullable(),
  supplier_default: z.string().nullable(),
  min_stock_qty: z.number().nullable(),
  reorder_point: z.number().nullable(),
  shelf_life_days: z.number().nullable(),
  storage_conditions: z.string().nullable(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
});

const productionCoefficientSchema = z.object({
  id: z.string().uuid(),
  product: z.string(),
  coefficient_name: z.string(),
  symbol: z.string().nullable(),
  value: z.number(),
  unit: z.string().nullable(),
  definition: z.string().nullable(),
  source: z.string().nullable(),
  confidence: z.string().nullable(),
  valid_from: z.string().nullable(),
  valid_to: z.string().nullable(),
  is_active: z.boolean(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
});

const productionBomEntrySchema = z.object({
  id: z.string().uuid(),
  parent_item_id: z.string().uuid(),
  parent_item_code: z.string(),
  parent_item_name: z.string(),
  child_item_id: z.string().uuid(),
  child_item_code: z.string(),
  child_item_name: z.string(),
  qty_per: z.number(),
  uom: z.string(),
  step_code: z.string().nullable(),
  variant_code: z.string().nullable(),
  sort_order: z.number(),
  is_active: z.boolean(),
});

const productionCostOverviewSchema = z.object({
  scenario_id: z.string().uuid(),
  scenario_code: z.string(),
  scenario_name: z.string(),
  output_qty_mg: z.number().nullable(),
  cost_line_id: z.string().uuid().nullable(),
  cost_element: z.string().nullable(),
  bucket_code: z.string().nullable(),
  amount: z.number().nullable(),
  basis: z.string().nullable(),
  source: z.string().nullable(),
  notes: z.string().nullable(),
});

const productionVariantSchema = z.object({
  id: z.string().uuid(),
  variant_code: z.string(),
  variant_name: z.string(),
  product: z.string(),
  description: z.string().nullable(),
  process_params: z.record(z.unknown()).nullable(),
  is_active: z.boolean(),
  is_default: z.boolean(),
  sort_order: z.number(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
});

const productionResourceSchema = z.object({
  id: z.string().uuid(),
  resource_code: z.string(),
  resource_name: z.string(),
  resource_type: z.string(),
  power_kw: z.number().nullable(),
  location: z.string().nullable(),
  capacity_info: z.string().nullable(),
  operating_cost_per_hour: z.number().nullable(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
});

const productionQualityParamSchema = z.object({
  id: z.string().uuid(),
  batch_id: z.string().uuid(),
  step_seq: z.number().nullable(),
  parameter: z.string(),
  value: z.number().nullable(),
  value_text: z.string().nullable(),
  uom: z.string().nullable(),
  limit_low: z.number().nullable(),
  limit_high: z.number().nullable(),
  method: z.string().nullable(),
  result: z.string(),
  measured_at: z.string().nullable(),
  measured_by: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
});

const productionCostRateSchema = z.object({
  id: z.string().uuid(),
  cost_element_code: z.string(),
  cost_element_name: z.string(),
  cost_group: z.string(),
  rate: z.number(),
  uom: z.string(),
  valid_from: z.string(),
  valid_to: z.string().nullable(),
  is_active: z.boolean(),
  notes: z.string().nullable(),
  created_at: z.string(),
});

// ==================== Types ====================

export type ProductionMaterial = z.infer<typeof productionMaterialSchema>;
export type ProductionCoefficient = z.infer<typeof productionCoefficientSchema>;
export type ProductionBomEntry = z.infer<typeof productionBomEntrySchema>;
export type ProductionCostOverview = z.infer<typeof productionCostOverviewSchema>;
export type ProductionVariant = z.infer<typeof productionVariantSchema>;
export type ProductionResource = z.infer<typeof productionResourceSchema>;
export type ProductionQualityParam = z.infer<typeof productionQualityParamSchema>;
export type ProductionCostRate = z.infer<typeof productionCostRateSchema>;

// ==================== Helper ====================

function parseRpcArraySafe<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  label: string,
): T[] {
  if (!data || !Array.isArray(data)) return [];
  const result: T[] = [];
  for (const item of data) {
    const parsed = schema.safeParse(item);
    if (parsed.success) {
      result.push(parsed.data);
    }
  }
  return result;
}

// ==================== Materials ====================

/**
 * Hook for fetching production materials (master data items).
 *
 * @param filters - Optional filters for category and item_type
 * @returns Query result with production materials
 * @example
 * const { data: materials } = useProductionMaterialsAdmin({ category: "Demo Product 1" });
 */
export function useProductionMaterialsAdmin(filters?: {
  category?: string;
  item_type?: string;
}) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["admin-production-materials", filters],
    queryFn: async (): Promise<ProductionMaterial[]> => {
      if (!canView) return [];
      const { data, error } = await aisha.rpc("get_production_materials_admin", {
        p_category: filters?.category,
        p_item_type: filters?.item_type,
      });
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(productionMaterialSchema, data, "productionMaterials");
    },
    enabled: canView,
  });
}

/**
 * Mutation hook for creating/updating production materials.
 *
 * @returns Mutation for upserting a production material
 */
export function useUpsertProductionMaterialMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (material: Partial<ProductionMaterial> & {
      item_code: string;
      item_name: string;
    }) => {
      // Partial<DBRow>: coerce null → undefined for RPC arg compatibility.
      const { data, error } = await aisha.rpc("upsert_production_material_admin", {
        p_cas_number: material.cas_number ?? undefined,
        p_category: material.category ?? undefined,
        p_description: material.description ?? undefined,
        p_id: material.id ?? undefined,
        p_is_active: material.is_active ?? true,
        p_item_code: material.item_code,
        p_item_name: material.item_name,
        p_item_type: material.item_type ?? "RAW",
        p_min_stock_qty: material.min_stock_qty ?? undefined,
        p_reorder_point: material.reorder_point ?? undefined,
        p_shelf_life_days: material.shelf_life_days ?? undefined,
        p_storage_conditions: material.storage_conditions ?? undefined,
        p_supplier_default: material.supplier_default ?? undefined,
        p_uom: material.uom ?? "kg",
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-production-materials"] });
    },
  });
}

// ==================== Coefficients ====================

/**
 * Hook for fetching production coefficients (process conversion factors).
 *
 * @param product - Optional product filter (Demo Product 2, Demo Product 1, Demo Product 3)
 * @returns Query result with production coefficients
 * @example
 * const { data: coefficients } = useProductionCoefficientsAdmin("Demo Product 2");
 */
export function useProductionCoefficientsAdmin(product?: string) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["admin-production-coefficients", product],
    queryFn: async (): Promise<ProductionCoefficient[]> => {
      if (!canView) return [];
      const { data, error } = await aisha.rpc("get_production_coefficients_admin", {
        p_product: product,
      });
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(productionCoefficientSchema, data, "productionCoefficients");
    },
    enabled: canView,
  });
}

/**
 * Mutation hook for creating/updating production coefficients.
 *
 * @returns Mutation for upserting a production coefficient
 */
export function useUpsertProductionCoefficientMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (coeff: Partial<ProductionCoefficient> & {
      coefficient_name: string;
      product: string;
      value: number;
    }) => {
      // Partial<DBRow>: coerce null → undefined for RPC arg compatibility.
      const { data, error } = await aisha.rpc("upsert_production_coefficient_admin", {
        p_coefficient_name: coeff.coefficient_name,
        p_confidence: coeff.confidence ?? "measured",
        p_definition: coeff.definition ?? undefined,
        p_id: coeff.id ?? undefined,
        p_is_active: coeff.is_active ?? true,
        p_notes: coeff.notes ?? undefined,
        p_product: coeff.product,
        p_source: coeff.source ?? "measured",
        p_symbol: coeff.symbol ?? undefined,
        p_unit: coeff.unit ?? undefined,
        p_valid_from: coeff.valid_from ?? undefined,
        p_valid_to: coeff.valid_to ?? undefined,
        p_value: coeff.value,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-production-coefficients"] });
    },
  });
}

// ==================== BOM ====================

/**
 * Hook for fetching production BOM entries with resolved material names.
 *
 * @param filters - Optional filters for parent item code and variant
 * @returns Query result with BOM entries
 */
export function useProductionBomAdmin(filters?: {
  parent_item_code?: string;
  variant_code?: string;
}) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["admin-production-bom", filters],
    queryFn: async (): Promise<ProductionBomEntry[]> => {
      if (!canView) return [];
      const { data, error } = await aisha.rpc("get_production_bom_admin", {
        p_parent_item_code: filters?.parent_item_code,
        p_variant_code: filters?.variant_code,
      });
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(productionBomEntrySchema, data, "productionBom");
    },
    enabled: canView,
  });
}

// ==================== Cost Scenarios & Lines ====================

/**
 * Hook for fetching cost overview (scenarios with line items).
 *
 * @param filters - Optional filters for batch or scenario
 * @returns Query result with cost overview data
 */
export function useProductionCostOverviewAdmin(filters?: {
  batch_id?: string;
  scenario_code?: string;
}) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["admin-production-costs", filters],
    queryFn: async (): Promise<ProductionCostOverview[]> => {
      if (!canView) return [];
      const { data, error } = await aisha.rpc("get_production_cost_overview_admin", {
        p_batch_id: filters?.batch_id,
        p_scenario_code: filters?.scenario_code,
      });
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(productionCostOverviewSchema, data, "productionCosts");
    },
    enabled: canView,
  });
}

/**
 * Mutation hook for creating/updating cost line items.
 *
 * @returns Mutation for upserting a cost line
 */
export function useUpsertProductionCostLineMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (line: {
      amount: number;
      basis?: string;
      batch_id?: string;
      bucket_code?: string;
      cost_element: string;
      id?: string;
      notes?: string;
      scenario_id?: string;
      source?: string;
    }) => {
      const { data, error } = await aisha.rpc("upsert_production_cost_line_admin", {
        p_amount: line.amount,
        p_basis: line.basis,
        p_batch_id: line.batch_id,
        p_bucket_code: line.bucket_code,
        p_cost_element: line.cost_element,
        p_id: line.id,
        p_notes: line.notes,
        p_scenario_id: line.scenario_id,
        p_source: line.source,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-production-costs"] });
    },
  });
}

// ==================== Cost Rates ====================

/**
 * Hook for fetching production cost rates (energy prices, labor rates).
 *
 * @param filters - Optional filters
 * @returns Query result with cost rates
 */
export function useProductionCostRatesAdmin(filters?: {
  cost_element_code?: string;
  current_only?: boolean;
}) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["admin-production-cost-rates", filters],
    queryFn: async (): Promise<ProductionCostRate[]> => {
      if (!canView) return [];
      const { data, error } = await aisha.rpc("get_production_cost_rates_admin", {
        p_cost_element_code: filters?.cost_element_code,
        p_current_only: filters?.current_only ?? true,
      });
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(productionCostRateSchema, data, "productionCostRates");
    },
    enabled: canView,
  });
}

// ==================== Variants ====================

/**
 * Hook for fetching production process variants.
 *
 * @param product - Optional product filter
 * @returns Query result with production variants
 */
export function useProductionVariantsAdmin(product?: string) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["admin-production-variants", product],
    queryFn: async (): Promise<ProductionVariant[]> => {
      if (!canView) return [];
      const { data, error } = await aisha.rpc("get_production_variants_admin", {
        p_product: product,
      });
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(productionVariantSchema, data, "productionVariants");
    },
    enabled: canView,
  });
}

// ==================== Resources ====================

/**
 * Hook for fetching production resources (equipment, work centers).
 *
 * @param resourceType - Optional filter by resource type
 * @returns Query result with production resources
 */
export function useProductionResourcesAdmin(resourceType?: string) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["admin-production-resources", resourceType],
    queryFn: async (): Promise<ProductionResource[]> => {
      if (!canView) return [];
      const { data, error } = await aisha.rpc("get_production_resources_admin", {
        p_resource_type: resourceType,
      });
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(productionResourceSchema, data, "productionResources");
    },
    enabled: canView,
  });
}

// ==================== Quality Parameters ====================

/**
 * Hook for fetching production quality parameters for a batch.
 *
 * @param filters - Optional filters for batch or result status
 * @returns Query result with quality parameters
 */
export function useProductionQualityParamsAdmin(filters?: {
  batch_id?: string;
  result?: string;
}) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["admin-production-quality", filters],
    queryFn: async (): Promise<ProductionQualityParam[]> => {
      if (!canView) return [];
      const { data, error } = await aisha.rpc("get_production_quality_params_admin", {
        p_batch_id: filters?.batch_id,
        p_result: filters?.result,
      });
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(productionQualityParamSchema, data, "productionQuality");
    },
    enabled: canView,
  });
}
