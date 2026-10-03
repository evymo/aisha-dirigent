import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHookWithProviders } from "@/tests/utils/test-utils";
import {
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
} from "@/hooks/useAdminProductionErp";

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  hasPermissionMock: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPermission: hoisted.hasPermissionMock,
  }),
}));

describe("useAdminProductionErp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.hasPermissionMock.mockReturnValue(true);
  });

  // ==================== Materials ====================

  describe("useProductionMaterialsAdmin", () => {
    it("should call get_production_materials_admin RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [
          {
            id: "550e8400-e29b-41d4-a716-446655440001",
            item_code: "BLOOD-RAW",
            item_name: "Hovězí krev čerstvá",
            item_type: "RAW",
            uom: "L",
            category: "Retisin",
            description: null,
            cas_number: null,
            supplier_default: null,
            min_stock_qty: null,
            reorder_point: null,
            shelf_life_days: null,
            storage_conditions: null,
            is_active: true,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: null,
          },
        ],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useProductionMaterialsAdmin({ category: "Retisin" }),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Unset filters are now omitted; PostgREST applies SQL DEFAULT NULL.
      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_materials_admin",
        expect.objectContaining({
          p_category: "Retisin",
        }),
      );
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].item_code).toBe("BLOOD-RAW");
    });

    it("should return empty array when permission denied", async () => {
      hoisted.hasPermissionMock.mockReturnValue(false);

      const { result } = renderHookWithProviders(() =>
        useProductionMaterialsAdmin(),
      );

      await vi.waitFor(() => expect(result.current.isFetching).toBe(false));
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });
  });

  describe("useUpsertProductionMaterialMutation", () => {
    it("should call upsert_production_material_admin RPC with alphabetical params", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: "550e8400-e29b-41d4-a716-446655440001",
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useUpsertProductionMaterialMutation(),
      );

      await result.current.mutateAsync({
        item_code: "HERB-FRESH",
        item_name: "Třezalka čerstvá",
        item_type: "RAW",
        uom: "kg",
        category: "Floristen",
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "upsert_production_material_admin",
        expect.objectContaining({
          p_item_code: "HERB-FRESH",
          p_item_name: "Třezalka čerstvá",
          p_item_type: "RAW",
          p_uom: "kg",
          p_category: "Floristen",
        }),
      );
    });
  });

  // ==================== Coefficients ====================

  describe("useProductionCoefficientsAdmin", () => {
    it("should call get_production_coefficients_admin RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [
          {
            id: "550e8400-e29b-41d4-a716-446655440002",
            product: "Floristen",
            coefficient_name: "k_sesych",
            symbol: "k_sesych",
            value: 3.543,
            unit: "kg/kg",
            definition: "čerstvá / suchá (22935/6473)",
            source: "measured",
            confidence: "validated",
            valid_from: null,
            valid_to: null,
            is_active: true,
            notes: null,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: null,
          },
        ],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useProductionCoefficientsAdmin("Floristen"),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_coefficients_admin",
        { p_product: "Floristen" },
      );
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].value).toBe(3.543);
      expect(result.current.data?.[0].symbol).toBe("k_sesych");
    });
  });

  describe("useUpsertProductionCoefficientMutation", () => {
    it("should call upsert_production_coefficient_admin with correct params", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: "550e8400-e29b-41d4-a716-446655440002",
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useUpsertProductionCoefficientMutation(),
      );

      await result.current.mutateAsync({
        product: "Retisin",
        coefficient_name: "k_blood_dry",
        symbol: "k_blood_dry",
        value: 8.75,
        unit: "L/kg",
        definition: "L čerstvé / kg suché (175/20)",
        source: "measured",
        confidence: "validated",
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "upsert_production_coefficient_admin",
        expect.objectContaining({
          p_coefficient_name: "k_blood_dry",
          p_product: "Retisin",
          p_value: 8.75,
          p_unit: "L/kg",
        }),
      );
    });
  });

  // ==================== BOM ====================

  describe("useProductionBomAdmin", () => {
    it("should call get_production_bom_admin RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [
          {
            id: "550e8400-e29b-41d4-a716-446655440003",
            parent_item_id: "550e8400-e29b-41d4-a716-446655440010",
            parent_item_code: "HERB-DRY",
            parent_item_name: "Třezalka sušená",
            child_item_id: "550e8400-e29b-41d4-a716-446655440011",
            child_item_code: "HERB-FRESH",
            child_item_name: "Třezalka čerstvá",
            qty_per: 3.543,
            uom: "kg/kg",
            step_code: "DRYING",
            variant_code: null,
            sort_order: 0,
            is_active: true,
          },
        ],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useProductionBomAdmin({ parent_item_code: "HERB-DRY" }),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Unset filters are now omitted; PostgREST applies SQL DEFAULT NULL.
      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_bom_admin",
        expect.objectContaining({
          p_parent_item_code: "HERB-DRY",
        }),
      );
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].qty_per).toBe(3.543);
    });
  });

  // ==================== Cost Overview ====================

  describe("useProductionCostOverviewAdmin", () => {
    it("should call get_production_cost_overview_admin RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [
          {
            scenario_id: "550e8400-e29b-41d4-a716-446655440004",
            scenario_code: "BASE",
            scenario_name: "Aktuální náklady",
            output_qty_mg: 1028125,
            cost_line_id: "550e8400-e29b-41d4-a716-446655440005",
            cost_element: "LABOR",
            bucket_code: "B01",
            amount: 90000,
            basis: "per_batch",
            source: "actual",
            notes: null,
          },
        ],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useProductionCostOverviewAdmin({ scenario_code: "BASE" }),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Unset filters are now omitted; PostgREST applies SQL DEFAULT NULL.
      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_cost_overview_admin",
        expect.objectContaining({
          p_scenario_code: "BASE",
        }),
      );
      expect(result.current.data?.[0].amount).toBe(90000);
    });
  });

  describe("useUpsertProductionCostLineMutation", () => {
    it("should call upsert_production_cost_line_admin with correct params", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: "550e8400-e29b-41d4-a716-446655440005",
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useUpsertProductionCostLineMutation(),
      );

      await result.current.mutateAsync({
        cost_element: "LABOR",
        amount: 90000,
        bucket_code: "B01",
        scenario_id: "550e8400-e29b-41d4-a716-446655440004",
        basis: "per_batch",
        source: "actual",
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "upsert_production_cost_line_admin",
        expect.objectContaining({
          p_cost_element: "LABOR",
          p_amount: 90000,
          p_bucket_code: "B01",
          p_scenario_id: "550e8400-e29b-41d4-a716-446655440004",
        }),
      );
    });
  });

  // ==================== Variants ====================

  describe("useProductionVariantsAdmin", () => {
    it("should call get_production_variants_admin RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [
          {
            id: "550e8400-e29b-41d4-a716-446655440006",
            variant_code: "SPO",
            variant_name: "Spofa standard",
            product: "Retisin",
            description: "Standardní Soxhlet 30L/krok",
            process_params: { soxhlet_volume_l: 30 },
            is_active: true,
            is_default: true,
            sort_order: 0,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: null,
          },
        ],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useProductionVariantsAdmin("Retisin"),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_variants_admin",
        { p_product: "Retisin" },
      );
      expect(result.current.data?.[0].variant_code).toBe("SPO");
    });
  });

  // ==================== Resources ====================

  describe("useProductionResourcesAdmin", () => {
    it("should call get_production_resources_admin RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [
          {
            id: "550e8400-e29b-41d4-a716-446655440007",
            resource_code: "WC-DRY-01",
            resource_name: "Venticel 707",
            resource_type: "MACHINE",
            power_kw: 5.4,
            location: "Sušárna",
            capacity_info: null,
            operating_cost_per_hour: null,
            is_active: true,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: null,
          },
        ],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useProductionResourcesAdmin("MACHINE"),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_resources_admin",
        { p_resource_type: "MACHINE" },
      );
      expect(result.current.data?.[0].power_kw).toBe(5.4);
    });
  });

  // ==================== Quality Params ====================

  describe("useProductionQualityParamsAdmin", () => {
    it("should call get_production_quality_params_admin RPC", async () => {
      const batchId = "550e8400-e29b-41d4-a716-446655440008";
      hoisted.rpcMock.mockResolvedValue({
        data: [
          {
            id: "550e8400-e29b-41d4-a716-446655440009",
            batch_id: batchId,
            step_seq: 1,
            parameter: "LOD",
            value: 8.6435,
            value_text: null,
            uom: "%",
            limit_low: 5.0,
            limit_high: 12.0,
            method: "gravimetric",
            result: "pass",
            measured_at: "2026-01-15T10:00:00Z",
            measured_by: null,
            notes: null,
            created_at: "2026-01-15T10:00:00Z",
          },
        ],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useProductionQualityParamsAdmin({ batch_id: batchId }),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Unset filters are now omitted; PostgREST applies SQL DEFAULT NULL.
      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_quality_params_admin",
        expect.objectContaining({
          p_batch_id: batchId,
        }),
      );
      expect(result.current.data?.[0].parameter).toBe("LOD");
      expect(result.current.data?.[0].value).toBe(8.6435);
      expect(result.current.data?.[0].result).toBe("pass");
    });
  });

  // ==================== Cost Rates ====================

  describe("useProductionCostRatesAdmin", () => {
    it("should call get_production_cost_rates_admin RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [
          {
            id: "550e8400-e29b-41d4-a716-446655440010",
            cost_element_code: "ENERGY_WINTER",
            cost_element_name: "Energie (zimní tarif)",
            cost_group: "SECONDARY",
            rate: 11.55,
            uom: "CZK/kWh",
            valid_from: "2026-01-01",
            valid_to: "2026-03-22",
            is_active: true,
            notes: null,
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useProductionCostRatesAdmin({ cost_element_code: "ENERGY_WINTER" }),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_cost_rates_admin",
        expect.objectContaining({
          p_cost_element_code: "ENERGY_WINTER",
          p_current_only: true,
        }),
      );
      expect(result.current.data?.[0].rate).toBe(11.55);
      expect(result.current.data?.[0].uom).toBe("CZK/kWh");
    });
  });

  // ==================== Error Handling ====================

  describe("error handling", () => {
    it("should propagate RPC errors in materials query", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: "Database error" },
      });

      const { result } = renderHookWithProviders(() =>
        useProductionMaterialsAdmin(),
      );

      await vi.waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeTruthy();
    });

    it("should propagate RPC errors in coefficient mutation", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: "Validation failed" },
      });

      const { result } = renderHookWithProviders(() =>
        useUpsertProductionCoefficientMutation(),
      );

      await expect(
        result.current.mutateAsync({
          product: "Floristen",
          coefficient_name: "k_sesych",
          value: 3.543,
        }),
      ).rejects.toBeTruthy();
    });
  });
});
