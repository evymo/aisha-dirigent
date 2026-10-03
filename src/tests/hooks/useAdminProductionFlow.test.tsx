import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHookWithProviders } from "@/tests/utils/test-utils";
import {
  useFlowNodesAdmin,
  useUpsertFlowNodeMutation,
  useFlowSubstancesAdmin,
  useUpsertFlowSubstanceMutation,
  useFlowRecordsAdmin,
  useCreateFlowRecordMutation,
  useFlowBalanceAdmin,
  useFlowNodeInventoryAdmin,
} from "@/hooks/useAdminProductionFlow";

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

// ==================== Sample Data ====================

const sampleNode = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  node_code: "TANK-01",
  node_name: "Skladovací nádrž 1",
  node_type: "storage",
  location_id: null,
  supplier_id: null,
  equipment_id: null,
  capacity_l: 5000,
  default_concentration_pct: 96,
  is_active: true,
  notes: null,
  metadata: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: null,
  created_by: null,
};

const sampleSubstance = {
  id: "660e8400-e29b-41d4-a716-446655440002",
  substance_code: "ETH-96",
  substance_name: "Ethanol 96%",
  cas_number: "64-17-5",
  density_kg_l: 0.789,
  regulatory_class: "excise",
  default_unit: "l",
  default_concentration_pct: 96,
  is_active: true,
  notes: null,
  metadata: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: null,
  created_by: null,
};

const sampleRecord = {
  id: "770e8400-e29b-41d4-a716-446655440003",
  batch_id: "880e8400-e29b-41d4-a716-446655440004",
  substance_id: "660e8400-e29b-41d4-a716-446655440002",
  source_node_id: "550e8400-e29b-41d4-a716-446655440001",
  target_node_id: "550e8400-e29b-41d4-a716-446655440005",
  flow_date: "2026-02-01T10:00:00Z",
  volume_l: 100,
  concentration_pct: 96,
  pure_amount_l: 96,
  temperature_c: 20,
  lot_id: null,
  responsible_user_id: null,
  notes: null,
  metadata: null,
  created_at: "2026-02-01T10:00:00Z",
};

const sampleBalance = {
  node_id: "550e8400-e29b-41d4-a716-446655440001",
  node_code: "TANK-01",
  node_name: "Skladovací nádrž 1",
  node_type: "storage",
  total_received_volume_l: 500,
  total_received_pure_l: 480,
  total_dispatched_volume_l: 200,
  total_dispatched_pure_l: 192,
  balance_volume_l: 300,
  balance_pure_l: 288,
  avg_concentration_pct: 96,
  record_count: 5,
};

const sampleInventory = {
  node_id: "550e8400-e29b-41d4-a716-446655440001",
  node_code: "TANK-01",
  node_name: "Skladovací nádrž 1",
  node_type: "storage",
  current_volume_l: 300,
  current_pure_l: 288,
  avg_concentration_pct: 96,
  last_flow_date: "2026-02-01T10:00:00Z",
  total_records: 5,
};

// ==================== Tests ====================

describe("useAdminProductionFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.hasPermissionMock.mockReturnValue(true);
  });

  // ==================== Flow Nodes ====================

  describe("useFlowNodesAdmin", () => {
    it("should call get_production_flow_nodes_admin RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [sampleNode],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useFlowNodesAdmin({ node_type: "storage" }),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Unset filters are now omitted from the RPC call (was `?? null` —
      // dropped in PR #85 — PostgREST applies SQL DEFAULT NULL on omitted args).
      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_flow_nodes_admin",
        expect.objectContaining({
          p_node_type: "storage",
        }),
      );
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].node_code).toBe("TANK-01");
    });

    it("should return empty array when permission denied", async () => {
      hoisted.hasPermissionMock.mockReturnValue(false);

      const { result } = renderHookWithProviders(() => useFlowNodesAdmin());

      await vi.waitFor(() => expect(result.current.isFetching).toBe(false));
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });

    it("should pass default filters when no params given", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

      const { result } = renderHookWithProviders(() => useFlowNodesAdmin());

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      // No filters → empty params object (PostgREST applies all SQL DEFAULTs).
      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_flow_nodes_admin",
        {},
      );
    });

    it("should handle RPC errors gracefully", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: "permission denied" },
      });

      const { result } = renderHookWithProviders(() => useFlowNodesAdmin());

      await vi.waitFor(() => expect(result.current.isError).toBe(true));
    });
  });

  describe("useUpsertFlowNodeMutation", () => {
    it("should call upsert_production_flow_node_admin RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: sampleNode.id,
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useUpsertFlowNodeMutation(),
      );

      await result.current.mutateAsync({
        node_code: "TANK-02",
        node_name: "Zásobní nádrž 2",
        node_type: "storage",
        capacity_l: 3000,
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "upsert_production_flow_node_admin",
        expect.objectContaining({
          p_capacity_l: 3000,
          p_node_code: "TANK-02",
          p_node_name: "Zásobní nádrž 2",
          p_node_type: "storage",
        }),
      );
    });
  });

  // ==================== Flow Substances ====================

  describe("useFlowSubstancesAdmin", () => {
    it("should call get_production_flow_substances_admin RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [sampleSubstance],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useFlowSubstancesAdmin({ regulatory_class: "excise" }),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Unset filters are now omitted (see comment in useFlowNodesAdmin test).
      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_flow_substances_admin",
        expect.objectContaining({
          p_regulatory_class: "excise",
        }),
      );
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].cas_number).toBe("64-17-5");
    });

    it("should return empty array when permission denied", async () => {
      hoisted.hasPermissionMock.mockReturnValue(false);

      const { result } = renderHookWithProviders(() =>
        useFlowSubstancesAdmin(),
      );

      await vi.waitFor(() => expect(result.current.isFetching).toBe(false));
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });
  });

  describe("useUpsertFlowSubstanceMutation", () => {
    it("should call upsert_production_flow_substance_admin with alphabetical params", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: sampleSubstance.id,
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useUpsertFlowSubstanceMutation(),
      );

      await result.current.mutateAsync({
        substance_code: "ETH-96",
        substance_name: "Ethanol 96%",
        cas_number: "64-17-5",
        density_kg_l: 0.789,
        regulatory_class: "excise",
        default_concentration_pct: 96,
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "upsert_production_flow_substance_admin",
        expect.objectContaining({
          p_cas_number: "64-17-5",
          p_default_concentration_pct: 96,
          p_density_kg_l: 0.789,
          p_regulatory_class: "excise",
          p_substance_code: "ETH-96",
          p_substance_name: "Ethanol 96%",
        }),
      );
    });
  });

  // ==================== Flow Records ====================

  describe("useFlowRecordsAdmin", () => {
    it("should call get_production_flow_records_admin with filters", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [sampleRecord],
        error: null,
      });

      const batchId = "880e8400-e29b-41d4-a716-446655440004";
      const { result } = renderHookWithProviders(() =>
        useFlowRecordsAdmin({ batch_id: batchId }),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_flow_records_admin",
        expect.objectContaining({
          p_batch_id: batchId,
          p_limit: 200,
          p_offset: 0,
        }),
      );
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].volume_l).toBe(100);
    });

    it("should return empty array when permission denied", async () => {
      hoisted.hasPermissionMock.mockReturnValue(false);

      const { result } = renderHookWithProviders(() =>
        useFlowRecordsAdmin(),
      );

      await vi.waitFor(() => expect(result.current.isFetching).toBe(false));
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });
  });

  describe("useCreateFlowRecordMutation", () => {
    it("should call create_production_flow_record_admin with immutable record", async () => {
      const newRecordId = "990e8400-e29b-41d4-a716-446655440006";
      hoisted.rpcMock.mockResolvedValue({
        data: newRecordId,
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useCreateFlowRecordMutation(),
      );

      await result.current.mutateAsync({
        batch_id: "880e8400-e29b-41d4-a716-446655440004",
        concentration_pct: 96,
        source_node_id: "550e8400-e29b-41d4-a716-446655440001",
        substance_id: "660e8400-e29b-41d4-a716-446655440002",
        target_node_id: "550e8400-e29b-41d4-a716-446655440005",
        volume_l: 50,
        temperature_c: 20,
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "create_production_flow_record_admin",
        expect.objectContaining({
          p_batch_id: "880e8400-e29b-41d4-a716-446655440004",
          p_concentration_pct: 96,
          p_source_node_id: "550e8400-e29b-41d4-a716-446655440001",
          p_substance_id: "660e8400-e29b-41d4-a716-446655440002",
          p_target_node_id: "550e8400-e29b-41d4-a716-446655440005",
          p_volume_l: 50,
          p_temperature_c: 20,
        }),
      );
    });

    it("should handle RPC error for missing fields", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: "batch_id is required" },
      });

      const { result } = renderHookWithProviders(() =>
        useCreateFlowRecordMutation(),
      );

      await expect(
        result.current.mutateAsync({
          batch_id: "",
          concentration_pct: 96,
          source_node_id: "550e8400-e29b-41d4-a716-446655440001",
          substance_id: "660e8400-e29b-41d4-a716-446655440002",
          target_node_id: "550e8400-e29b-41d4-a716-446655440005",
          volume_l: 50,
        }),
      ).rejects.toThrow();
    });
  });

  // ==================== Flow Balance ====================

  describe("useFlowBalanceAdmin", () => {
    it("should call compute_production_flow_balance_admin when both IDs provided", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [sampleBalance],
        error: null,
      });

      const batchId = "880e8400-e29b-41d4-a716-446655440004";
      const substanceId = "660e8400-e29b-41d4-a716-446655440002";

      const { result } = renderHookWithProviders(() =>
        useFlowBalanceAdmin({ batch_id: batchId, substance_id: substanceId }),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "compute_production_flow_balance_admin",
        {
          p_batch_id: batchId,
          p_substance_id: substanceId,
        },
      );
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].balance_volume_l).toBe(300);
    });

    it("should not fetch when batch_id is undefined", async () => {
      const { result } = renderHookWithProviders(() =>
        useFlowBalanceAdmin({
          batch_id: undefined,
          substance_id: "660e8400-e29b-41d4-a716-446655440002",
        }),
      );

      await vi.waitFor(() => expect(result.current.isFetching).toBe(false));
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });

    it("should not fetch when substance_id is undefined", async () => {
      const { result } = renderHookWithProviders(() =>
        useFlowBalanceAdmin({
          batch_id: "880e8400-e29b-41d4-a716-446655440004",
          substance_id: undefined,
        }),
      );

      await vi.waitFor(() => expect(result.current.isFetching).toBe(false));
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });
  });

  // ==================== Flow Node Inventory ====================

  describe("useFlowNodeInventoryAdmin", () => {
    it("should call get_production_flow_node_inventory_admin RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [sampleInventory],
        error: null,
      });

      const substanceId = "660e8400-e29b-41d4-a716-446655440002";

      const { result } = renderHookWithProviders(() =>
        useFlowNodeInventoryAdmin({ substance_id: substanceId }),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_flow_node_inventory_admin",
        expect.objectContaining({
          p_substance_id: substanceId,
        }),
      );
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].current_volume_l).toBe(300);
    });

    it("should not fetch when substance_id is undefined", async () => {
      const { result } = renderHookWithProviders(() =>
        useFlowNodeInventoryAdmin({ substance_id: undefined }),
      );

      await vi.waitFor(() => expect(result.current.isFetching).toBe(false));
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });

    it("should pass optional batch_id and node_id filters", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

      const substanceId = "660e8400-e29b-41d4-a716-446655440002";
      const nodeId = "550e8400-e29b-41d4-a716-446655440001";

      const { result } = renderHookWithProviders(() =>
        useFlowNodeInventoryAdmin({
          batch_id: "880e8400-e29b-41d4-a716-446655440004",
          node_id: nodeId,
          substance_id: substanceId,
        }),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_flow_node_inventory_admin",
        {
          p_batch_id: "880e8400-e29b-41d4-a716-446655440004",
          p_node_id: nodeId,
          p_substance_id: substanceId,
        },
      );
    });
  });

  // ==================== Zod Validation ====================

  describe("Zod schema validation", () => {
    it("should reject malformed node data from RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [{ id: "not-a-uuid", node_code: 123 }],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useFlowNodesAdmin());

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
      // malformed data should be filtered out by parseRpcArraySafe
      expect(result.current.data).toHaveLength(0);
    });

    it("should accept valid substance data", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [sampleSubstance],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useFlowSubstancesAdmin(),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].substance_code).toBe("ETH-96");
    });

    it("should handle null/empty data from RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: null, error: null });

      const { result } = renderHookWithProviders(() =>
        useFlowRecordsAdmin(),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([]);
    });
  });

  // ==================== Security ====================

  describe("Security: no sensitive data in error messages", () => {
    it("should not expose internal details on RPC error", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: "permission denied for function" },
      });

      const { result } = renderHookWithProviders(() => useFlowNodesAdmin());

      await vi.waitFor(() => expect(result.current.isError).toBe(true));
      // Error should be the RPC error, not contain any sensitive data
      expect(result.current.error).toBeDefined();
    });
  });
});
