import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHookWithProviders } from "@/tests/utils/test-utils";
import {
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
} from "@/hooks/useAdminProductionErpExtended";

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

describe("useAdminProductionErpExtended", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.hasPermissionMock.mockReturnValue(true);
  });

  // ==================== Suppliers ====================

  describe("useProductionSuppliersAdmin", () => {
    it("should call get_production_suppliers_admin RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [
          {
            id: "10000000-0000-0000-0010-000000000001",
            supplier_code: "SUP-001",
            supplier_name: "Masokombinát Příbram a.s.",
            country: "CZ",
            contacts: { email: "odber@masopribram.cz" },
            qualification_status: "qualified",
            approved_at: "2024-06-15T00:00:00Z",
            approved_by: "00000000-0000-0000-0000-000000000001",
            risk_level: "low",
            certificates: [],
            audit_history: [],
            is_active: true,
            notes: null,
            metadata: {},
            created_at: "2026-01-01T00:00:00Z",
            updated_at: null,
            created_by: "00000000-0000-0000-0000-000000000001",
          },
        ],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useProductionSuppliersAdmin({ qualification_status: "qualified" }),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Unset filter args are now omitted (PostgREST uses SQL DEFAULT NULL).
      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_suppliers_admin",
        expect.objectContaining({
          p_qualification_status: "qualified",
        }),
      );
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].supplier_code).toBe("SUP-001");
    });

    it("should return empty array when permission denied", async () => {
      hoisted.hasPermissionMock.mockReturnValue(false);

      const { result } = renderHookWithProviders(() =>
        useProductionSuppliersAdmin(),
      );

      await vi.waitFor(() => expect(result.current.isFetching).toBe(false));
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });
  });

  describe("useUpsertProductionSupplierMutation", () => {
    it("should call upsert_production_supplier_admin RPC with alphabetical params", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: "10000000-0000-0000-0010-000000000001",
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useUpsertProductionSupplierMutation(),
      );

      await result.current.mutateAsync({
        supplier_code: "SUP-NEW",
        supplier_name: "Nový dodavatel",
        country: "CZ",
        qualification_status: "pending",
        risk_level: "medium",
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "upsert_production_supplier_admin",
        expect.objectContaining({
          p_supplier_code: "SUP-NEW",
          p_supplier_name: "Nový dodavatel",
          p_country: "CZ",
          p_qualification_status: "pending",
          p_risk_level: "medium",
        }),
      );
    });

    it("should handle RPC error", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: "Supplier code already exists", code: "23505" },
      });

      const { result } = renderHookWithProviders(() =>
        useUpsertProductionSupplierMutation(),
      );

      await expect(
        result.current.mutateAsync({
          supplier_code: "SUP-DUP",
          supplier_name: "Duplicate",
        }),
      ).rejects.toEqual(
        expect.objectContaining({ message: "Supplier code already exists" }),
      );
    });
  });

  // ==================== Locations ====================

  describe("useProductionLocationsAdmin", () => {
    it("should call get_production_locations_admin RPC with filter", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [
          {
            id: "10000000-0000-0000-0011-000000000001",
            location_code: "LOC-PLANT-01",
            location_name: "Výrobní závod Příbram",
            location_type: "plant",
            address: null,
            gmp_zone: "A",
            temp_range_min: 15,
            temp_range_max: 25,
            humidity_range_min: 30,
            humidity_range_max: 65,
            parent_location_id: null,
            is_active: true,
            notes: null,
            metadata: {},
            created_at: "2026-01-01T00:00:00Z",
            updated_at: null,
            created_by: null,
          },
        ],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useProductionLocationsAdmin({ location_type: "plant" }),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_locations_admin",
        { p_location_type: "plant" },
      );
      expect(result.current.data).toHaveLength(1);
    });
  });

  describe("useUpsertProductionLocationMutation", () => {
    it("should call upsert_production_location_admin RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: "10000000-0000-0000-0011-000000000001",
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useUpsertProductionLocationMutation(),
      );

      await result.current.mutateAsync({
        location_code: "LOC-WH-01",
        location_name: "Sklad surovin",
        location_type: "warehouse",
        gmp_zone: "D",
        temp_range_min: 10,
        temp_range_max: 25,
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "upsert_production_location_admin",
        expect.objectContaining({
          p_location_code: "LOC-WH-01",
          p_location_name: "Sklad surovin",
          p_location_type: "warehouse",
          p_gmp_zone: "D",
        }),
      );
    });
  });

  // ==================== Equipment ====================

  describe("useProductionEquipmentAdmin", () => {
    it("should call get_production_equipment_admin RPC with filters", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [
          {
            id: "10000000-0000-0000-0012-000000000001",
            asset_tag: "EQ-VEN-001",
            equipment_name: "Venticel T48",
            model: "T48",
            serial_no: "VEN-2020-001",
            manufacturer: "Labio",
            resource_id: "10000000-0000-0000-0002-000000000001",
            location_id: "10000000-0000-0000-0011-000000000002",
            gmp_criticality: "critical",
            qualification_status: "qualified",
            last_qualified_at: "2025-11-01T00:00:00Z",
            next_qualification_due: "2026-11-01T00:00:00Z",
            power_kw: 18.5,
            is_active: true,
            notes: null,
            metadata: {},
            created_at: "2026-01-01T00:00:00Z",
            updated_at: null,
            created_by: null,
          },
        ],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useProductionEquipmentAdmin({ gmp_criticality: "critical" }),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Unset filter args are now omitted (PostgREST uses SQL DEFAULT NULL).
      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_equipment_admin",
        expect.objectContaining({
          p_gmp_criticality: "critical",
        }),
      );
      expect(result.current.data?.[0].asset_tag).toBe("EQ-VEN-001");
    });
  });

  describe("useUpsertProductionEquipmentMutation", () => {
    it("should call upsert_production_equipment_admin RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: "10000000-0000-0000-0012-000000000001",
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useUpsertProductionEquipmentMutation(),
      );

      await result.current.mutateAsync({
        asset_tag: "EQ-NEW-001",
        equipment_name: "New Equipment",
        gmp_criticality: "standard",
        qualification_status: "pending",
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "upsert_production_equipment_admin",
        expect.objectContaining({
          p_asset_tag: "EQ-NEW-001",
          p_equipment_name: "New Equipment",
          p_gmp_criticality: "standard",
          p_qualification_status: "pending",
        }),
      );
    });
  });

  // ==================== Lots ====================

  describe("useProductionLotsAdmin", () => {
    it("should call get_production_lots_admin RPC with filters", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [
          {
            id: "10000000-0000-0000-0013-000000000001",
            lot_number: "LOT-BLD-2025-001",
            item_id: "10000000-0000-0000-0001-000000000001",
            supplier_id: "10000000-0000-0000-0010-000000000001",
            supplier_lot: "MK-2025-1234",
            received_at: "2025-12-01T06:00:00Z",
            manufactured_at: null,
            expires_at: "2025-12-02T06:00:00Z",
            quantity: 200.0,
            remaining_quantity: 180.0,
            uom: "L",
            status: "released",
            coa_document_id: null,
            storage_location_id: "10000000-0000-0000-0011-000000000004",
            batch_id: null,
            notes: null,
            metadata: {},
            created_at: "2026-01-01T00:00:00Z",
            updated_at: null,
            created_by: null,
          },
        ],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useProductionLotsAdmin({ status: "released" }),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Unset filter args are now omitted (PostgREST uses SQL DEFAULT NULL).
      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_lots_admin",
        expect.objectContaining({
          p_status: "released",
        }),
      );
      expect(result.current.data?.[0].lot_number).toBe("LOT-BLD-2025-001");
    });
  });

  describe("useUpsertProductionLotMutation", () => {
    it("should call upsert_production_lot_admin RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: "10000000-0000-0000-0013-000000000001",
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useUpsertProductionLotMutation(),
      );

      await result.current.mutateAsync({
        lot_number: "LOT-NEW-001",
        item_id: "10000000-0000-0000-0001-000000000001",
        quantity: 100,
        uom: "L",
        status: "quarantine",
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "upsert_production_lot_admin",
        expect.objectContaining({
          p_lot_number: "LOT-NEW-001",
          p_item_id: "10000000-0000-0000-0001-000000000001",
          p_quantity: 100,
          p_uom: "L",
          p_status: "quarantine",
        }),
      );
    });
  });

  // ==================== Inventory Events ====================

  describe("useProductionInventoryEventsAdmin", () => {
    it("should call get_production_inventory_events_admin RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [
          {
            id: "10000000-0000-0000-0014-000000000001",
            lot_id: "10000000-0000-0000-0013-000000000001",
            location_id: "10000000-0000-0000-0011-000000000004",
            event_type: "receipt",
            quantity: 200.0,
            uom: "L",
            ref_type: null,
            ref_id: null,
            reason: "Příjem čerstvé krve od dodavatele",
            performed_by: "00000000-0000-0000-0000-000000000001",
            performed_at: "2025-12-01T06:00:00Z",
            metadata: {},
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useProductionInventoryEventsAdmin({ event_type: "receipt" }),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Unset filter args are now omitted (PostgREST uses SQL DEFAULT NULL).
      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_inventory_events_admin",
        expect.objectContaining({
          p_event_type: "receipt",
        }),
      );
      expect(result.current.data?.[0].event_type).toBe("receipt");
    });
  });

  describe("useCreateProductionInventoryEventMutation", () => {
    it("should call create_production_inventory_event_admin RPC (immutable)", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: "10000000-0000-0000-0014-000000000099",
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useCreateProductionInventoryEventMutation(),
      );

      await result.current.mutateAsync({
        event_type: "issue",
        lot_id: "10000000-0000-0000-0013-000000000001",
        quantity: 50,
        uom: "L",
        reason: "Vydej do výroby",
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "create_production_inventory_event_admin",
        expect.objectContaining({
          p_event_type: "issue",
          p_lot_id: "10000000-0000-0000-0013-000000000001",
          p_quantity: 50,
          p_uom: "L",
          p_reason: "Vydej do výroby",
        }),
      );
    });
  });

  // ==================== Batch Materials ====================

  describe("useProductionBatchMaterialsAdmin", () => {
    it("should call get_production_batch_materials_admin RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [
          {
            id: "10000000-0000-0000-0015-000000000001",
            batch_id: "10000000-0000-0000-0009-000000000001",
            step_id: null,
            lot_id: "10000000-0000-0000-0013-000000000001",
            item_id: "10000000-0000-0000-0001-000000000001",
            direction: "IN",
            planned_qty: 175.0,
            actual_qty: 178.5,
            uom: "L",
            variance_pct: 2.0,
            notes: null,
            metadata: {},
            created_at: "2026-01-01T00:00:00Z",
            updated_at: null,
            created_by: null,
          },
        ],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useProductionBatchMaterialsAdmin({
          batch_id: "10000000-0000-0000-0009-000000000001",
        }),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Unset filter args are now omitted (PostgREST uses SQL DEFAULT NULL).
      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_batch_materials_admin",
        expect.objectContaining({
          p_batch_id: "10000000-0000-0000-0009-000000000001",
        }),
      );
      expect(result.current.data?.[0].direction).toBe("IN");
      expect(result.current.data?.[0].variance_pct).toBe(2.0);
    });
  });

  describe("useUpsertProductionBatchMaterialMutation", () => {
    it("should call upsert_production_batch_material_admin RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: "10000000-0000-0000-0015-000000000001",
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useUpsertProductionBatchMaterialMutation(),
      );

      await result.current.mutateAsync({
        batch_id: "10000000-0000-0000-0009-000000000001",
        item_id: "10000000-0000-0000-0001-000000000001",
        direction: "IN",
        planned_qty: 175.0,
        actual_qty: 178.5,
        uom: "L",
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "upsert_production_batch_material_admin",
        expect.objectContaining({
          p_batch_id: "10000000-0000-0000-0009-000000000001",
          p_item_id: "10000000-0000-0000-0001-000000000001",
          p_direction: "IN",
          p_planned_qty: 175.0,
          p_actual_qty: 178.5,
        }),
      );
    });
  });

  // ==================== Deviations ====================

  describe("useProductionDeviationsAdmin", () => {
    it("should call get_production_deviations_admin RPC with filters", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [
          {
            id: "10000000-0000-0000-0016-000000000001",
            deviation_number: "DEV-2025-001",
            batch_id: "10000000-0000-0000-0009-000000000001",
            step_id: null,
            equipment_id: "10000000-0000-0000-0012-000000000001",
            lot_id: null,
            severity: "minor",
            category: "process",
            title: "Teplota sušení mimo rozmezí",
            description: "Teplota v sušárně klesla pod 35°C na 15 minut",
            root_cause: "Výpadek ventilátoru",
            immediate_action: "Restart ventilátoru, prodloužení doby sušení",
            disposition: "continue_with_justification",
            status: "closed",
            initiated_at: "2025-12-02T10:00:00Z",
            initiated_by: "00000000-0000-0000-0000-000000000001",
            investigated_by: "00000000-0000-0000-0000-000000000001",
            resolved_at: "2025-12-02T14:00:00Z",
            resolved_by: "00000000-0000-0000-0000-000000000001",
            approved_by: "00000000-0000-0000-0000-000000000001",
            approved_at: "2025-12-02T16:00:00Z",
            notes: null,
            metadata: {},
            created_at: "2026-01-01T00:00:00Z",
            updated_at: null,
          },
        ],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useProductionDeviationsAdmin({ severity: "minor", status: "closed" }),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Unset filter args are now omitted (PostgREST uses SQL DEFAULT NULL).
      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_deviations_admin",
        expect.objectContaining({
          p_severity: "minor",
          p_status: "closed",
        }),
      );
      expect(result.current.data?.[0].deviation_number).toBe("DEV-2025-001");
    });
  });

  describe("useUpsertProductionDeviationMutation", () => {
    it("should call upsert_production_deviation_admin RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: "10000000-0000-0000-0016-000000000002",
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useUpsertProductionDeviationMutation(),
      );

      await result.current.mutateAsync({
        deviation_number: "DEV-2025-002",
        title: "Kontaminace šarže",
        description: "Zjištěna mikrobní kontaminace",
        severity: "critical",
        status: "open",
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "upsert_production_deviation_admin",
        expect.objectContaining({
          p_deviation_number: "DEV-2025-002",
          p_title: "Kontaminace šarže",
          p_description: "Zjištěna mikrobní kontaminace",
          p_severity: "critical",
          p_status: "open",
        }),
      );
    });
  });

  // ==================== CAPA ====================

  describe("useProductionCapaAdmin", () => {
    it("should call get_production_capa_admin RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [
          {
            id: "10000000-0000-0000-0017-000000000001",
            capa_number: "CAPA-2025-001",
            source_deviation_id: "10000000-0000-0000-0016-000000000001",
            capa_type: "corrective",
            title: "Oprava ventilátoru sušárny",
            description: "Preventivní výměna ložisek ventilátoru",
            actions: [{ step: "Výměna ložisek", due: "2026-01-15" }],
            owner_id: "00000000-0000-0000-0000-000000000001",
            due_date: "2026-01-31",
            status: "in_progress",
            effectiveness_check: null,
            effectiveness_verified_at: null,
            effectiveness_verified_by: null,
            closed_at: null,
            closed_by: null,
            notes: null,
            metadata: {},
            created_at: "2026-01-01T00:00:00Z",
            updated_at: null,
            created_by: "00000000-0000-0000-0000-000000000001",
          },
        ],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useProductionCapaAdmin({ status: "in_progress" }),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Unset filter args are now omitted (PostgREST uses SQL DEFAULT NULL).
      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_capa_admin",
        expect.objectContaining({
          p_status: "in_progress",
        }),
      );
      expect(result.current.data?.[0].capa_number).toBe("CAPA-2025-001");
    });
  });

  describe("useUpsertProductionCapaMutation", () => {
    it("should call upsert_production_capa_admin RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: "10000000-0000-0000-0017-000000000001",
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useUpsertProductionCapaMutation(),
      );

      await result.current.mutateAsync({
        capa_number: "CAPA-2025-002",
        title: "Preventivní údržba",
        description: "Zavedení pravidelné kontroly ventilátorů",
        capa_type: "preventive",
        status: "open",
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "upsert_production_capa_admin",
        expect.objectContaining({
          p_capa_number: "CAPA-2025-002",
          p_title: "Preventivní údržba",
          p_capa_type: "preventive",
          p_status: "open",
        }),
      );
    });
  });

  // ==================== Release Decisions ====================

  describe("useProductionReleaseDecisionsAdmin", () => {
    it("should call get_production_release_decisions_admin RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [
          {
            id: "10000000-0000-0000-0018-000000000001",
            batch_id: "10000000-0000-0000-0009-000000000001",
            decision: "approved",
            decision_at: "2025-12-15T14:00:00Z",
            decided_by: "00000000-0000-0000-0000-000000000001",
            reason: "Všechny QC testy v normě",
            linked_deviation_id: null,
            conditions: null,
            review_checklist: { qc_passed: true, documentation_complete: true },
            review_notes: null,
            metadata: {},
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useProductionReleaseDecisionsAdmin({ decision: "approved" }),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Unset filter args are now omitted (PostgREST uses SQL DEFAULT NULL).
      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_release_decisions_admin",
        expect.objectContaining({
          p_decision: "approved",
        }),
      );
      expect(result.current.data?.[0].decision).toBe("approved");
    });
  });

  describe("useCreateProductionReleaseDecisionMutation", () => {
    it("should call create_production_release_decision_admin RPC (immutable)", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: "10000000-0000-0000-0018-000000000099",
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useCreateProductionReleaseDecisionMutation(),
      );

      await result.current.mutateAsync({
        batch_id: "10000000-0000-0000-0009-000000000002",
        decision: "rejected",
        reason: "Kontaminace",
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "create_production_release_decision_admin",
        expect.objectContaining({
          p_batch_id: "10000000-0000-0000-0009-000000000002",
          p_decision: "rejected",
          p_reason: "Kontaminace",
        }),
      );
    });
  });

  // ==================== Equipment Calibrations ====================

  describe("useProductionEquipmentCalibrationsAdmin", () => {
    it("should call get_production_equipment_calibrations_admin RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [
          {
            id: "10000000-0000-0000-0019-000000000001",
            equipment_id: "10000000-0000-0000-0012-000000000001",
            calibration_type: "temperature",
            performed_at: "2025-11-01T08:00:00Z",
            next_due_at: "2026-02-01T00:00:00Z",
            result: "pass",
            certificate_doc_id: null,
            reference_standard: "ČSN EN 60751",
            deviation_found: 0.3,
            deviation_limit: 1.0,
            adjustment_made: false,
            performed_by: "00000000-0000-0000-0000-000000000001",
            verified_by: null,
            verified_at: null,
            notes: null,
            metadata: {},
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useProductionEquipmentCalibrationsAdmin({ result: "pass" }),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Unset filter args are now omitted (PostgREST uses SQL DEFAULT NULL).
      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_equipment_calibrations_admin",
        expect.objectContaining({
          p_result: "pass",
        }),
      );
      expect(result.current.data?.[0].deviation_found).toBe(0.3);
    });
  });

  describe("useCreateProductionEquipmentCalibrationMutation", () => {
    it("should call create_production_equipment_calibration_admin RPC (immutable)", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: "10000000-0000-0000-0019-000000000099",
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useCreateProductionEquipmentCalibrationMutation(),
      );

      await result.current.mutateAsync({
        equipment_id: "10000000-0000-0000-0012-000000000001",
        calibration_type: "pressure",
        result: "pass",
        reference_standard: "ČSN EN 837-1",
        deviation_found: 0.1,
        deviation_limit: 0.5,
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "create_production_equipment_calibration_admin",
        expect.objectContaining({
          p_equipment_id: "10000000-0000-0000-0012-000000000001",
          p_calibration_type: "pressure",
          p_result: "pass",
          p_reference_standard: "ČSN EN 837-1",
        }),
      );
    });
  });

  // ==================== Equipment Cleaning ====================

  describe("useProductionEquipmentCleaningAdmin", () => {
    it("should call get_production_equipment_cleaning_admin RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [
          {
            id: "10000000-0000-0000-0020-000000000001",
            equipment_id: "10000000-0000-0000-0012-000000000001",
            cleaning_method: "CIP",
            cleaning_agent: "NaOH 2%",
            performed_at: "2025-12-10T06:00:00Z",
            performed_by: "00000000-0000-0000-0000-000000000001",
            verified_by: "00000000-0000-0000-0000-000000000001",
            verified_at: "2025-12-10T07:00:00Z",
            swab_results: { residue_ppm: 2.1, limit_ppm: 10.0 },
            visual_inspection: "pass",
            status: "verified",
            batch_id_before: "10000000-0000-0000-0009-000000000001",
            batch_id_after: null,
            notes: null,
            metadata: {},
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useProductionEquipmentCleaningAdmin({ status: "verified" }),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Unset filter args are now omitted (PostgREST uses SQL DEFAULT NULL).
      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_equipment_cleaning_admin",
        expect.objectContaining({
          p_status: "verified",
        }),
      );
      expect(result.current.data?.[0].cleaning_method).toBe("CIP");
    });
  });

  describe("useCreateProductionEquipmentCleaningMutation", () => {
    it("should call create_production_equipment_cleaning_admin RPC (immutable)", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: "10000000-0000-0000-0020-000000000099",
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useCreateProductionEquipmentCleaningMutation(),
      );

      await result.current.mutateAsync({
        equipment_id: "10000000-0000-0000-0012-000000000002",
        cleaning_method: "manual",
        cleaning_agent: "IPA 70%",
        status: "completed",
        visual_inspection: "pass",
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "create_production_equipment_cleaning_admin",
        expect.objectContaining({
          p_equipment_id: "10000000-0000-0000-0012-000000000002",
          p_cleaning_method: "manual",
          p_cleaning_agent: "IPA 70%",
          p_status: "completed",
        }),
      );
    });
  });

  // ==================== QC Test Definitions ====================

  describe("useProductionQcTestDefinitionsAdmin", () => {
    it("should call get_production_qc_test_definitions_admin RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [
          {
            id: "10000000-0000-0000-0021-000000000001",
            test_code: "QC-MOIST",
            test_name: "Vlhkost prášku",
            method_ref: "ČL 2017, 2.2.32",
            description: "Stanovení zbytkové vlhkosti sušeného materiálu",
            units: "%",
            spec_limit_low: null,
            spec_limit_high: 8.0,
            target_value: 5.0,
            sampling_plan: null,
            applicable_products: ["Retisin", "Lyastin"],
            applicable_steps: ["drying"],
            frequency: "per_batch",
            version: "1.0",
            is_active: true,
            notes: null,
            metadata: {},
            created_at: "2026-01-01T00:00:00Z",
            updated_at: null,
            created_by: null,
          },
        ],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useProductionQcTestDefinitionsAdmin({ is_active: true }),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Unset filter args are now omitted (PostgREST uses SQL DEFAULT NULL).
      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_qc_test_definitions_admin",
        expect.objectContaining({
          p_is_active: true,
        }),
      );
      expect(result.current.data?.[0].test_code).toBe("QC-MOIST");
    });
  });

  describe("useUpsertProductionQcTestDefinitionMutation", () => {
    it("should call upsert_production_qc_test_definition_admin RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: "10000000-0000-0000-0021-000000000001",
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useUpsertProductionQcTestDefinitionMutation(),
      );

      await result.current.mutateAsync({
        test_code: "QC-NEW",
        test_name: "Nový test",
        frequency: "per_batch",
        units: "mg/L",
        spec_limit_high: 100,
        version: "1.0",
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "upsert_production_qc_test_definition_admin",
        expect.objectContaining({
          p_test_code: "QC-NEW",
          p_test_name: "Nový test",
          p_frequency: "per_batch",
          p_units: "mg/L",
          p_spec_limit_high: 100,
        }),
      );
    });
  });

  // ==================== Sensor Readings ====================

  describe("useProductionSensorReadingsAdmin", () => {
    it("should call get_production_sensor_readings_admin RPC with default limit", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [
          {
            id: "10000000-0000-0000-0022-000000000001",
            sensor_code: "TEMP-VEN-001",
            location_id: "10000000-0000-0000-0011-000000000002",
            equipment_id: "10000000-0000-0000-0012-000000000001",
            batch_id: "10000000-0000-0000-0009-000000000001",
            flow_node_id: null,
            reading_type: "temperature",
            value: 42.3,
            unit: "°C",
            recorded_at: "2025-12-02T08:00:00Z",
            source: "homeassistant",
            is_excursion: false,
            excursion_severity: null,
            excursion_acknowledged_by: null,
            excursion_acknowledged_at: null,
            metadata: {},
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useProductionSensorReadingsAdmin({ reading_type: "temperature" }),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Unset filter args are now omitted (PostgREST uses SQL DEFAULT NULL).
      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_sensor_readings_admin",
        expect.objectContaining({
          p_limit: 500,
          p_reading_type: "temperature",
        }),
      );
      expect(result.current.data?.[0].value).toBe(42.3);
    });

    it("should filter excursions only", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [
          {
            id: "10000000-0000-0000-0022-000000000010",
            sensor_code: "TEMP-WH-001",
            location_id: null,
            equipment_id: null,
            batch_id: null,
            flow_node_id: null,
            reading_type: "temperature",
            value: 28.5,
            unit: "°C",
            recorded_at: "2025-12-18T14:00:00Z",
            source: "homeassistant",
            is_excursion: true,
            excursion_severity: "warning",
            excursion_acknowledged_by: null,
            excursion_acknowledged_at: null,
            metadata: {},
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useProductionSensorReadingsAdmin({ is_excursion: true }),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_sensor_readings_admin",
        expect.objectContaining({
          p_is_excursion: true,
        }),
      );
      expect(result.current.data?.[0].is_excursion).toBe(true);
    });
  });

  describe("useCreateProductionSensorReadingMutation", () => {
    it("should call create_production_sensor_reading_admin RPC (immutable)", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: "10000000-0000-0000-0022-000000000099",
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useCreateProductionSensorReadingMutation(),
      );

      await result.current.mutateAsync({
        sensor_code: "HUM-LAB-001",
        reading_type: "humidity",
        value: 55.2,
        unit: "%RH",
        source: "homeassistant",
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "create_production_sensor_reading_admin",
        expect.objectContaining({
          p_sensor_code: "HUM-LAB-001",
          p_reading_type: "humidity",
          p_value: 55.2,
          p_unit: "%RH",
          p_source: "homeassistant",
        }),
      );
    });

    it("should handle excursion creation", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: "10000000-0000-0000-0022-000000000098",
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useCreateProductionSensorReadingMutation(),
      );

      await result.current.mutateAsync({
        sensor_code: "TEMP-WH-002",
        reading_type: "temperature",
        value: 30.5,
        unit: "°C",
        is_excursion: true,
        excursion_severity: "critical",
        source: "homeassistant",
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "create_production_sensor_reading_admin",
        expect.objectContaining({
          p_is_excursion: true,
          p_excursion_severity: "critical",
        }),
      );
    });
  });

  // ==================== Permission Guard ====================

  describe("permission guards", () => {
    it("should not fetch any data when view_admin_dashboard permission is denied", async () => {
      hoisted.hasPermissionMock.mockReturnValue(false);

      const hooks: Array<() => { isFetching: boolean }> = [
        () => useProductionSuppliersAdmin(),
        () => useProductionLocationsAdmin(),
        () => useProductionEquipmentAdmin(),
        () => useProductionLotsAdmin(),
        () => useProductionInventoryEventsAdmin(),
        () => useProductionBatchMaterialsAdmin(),
        () => useProductionDeviationsAdmin(),
        () => useProductionCapaAdmin(),
        () => useProductionReleaseDecisionsAdmin(),
        () => useProductionEquipmentCalibrationsAdmin(),
        () => useProductionEquipmentCleaningAdmin(),
        () => useProductionQcTestDefinitionsAdmin(),
        () => useProductionSensorReadingsAdmin(),
      ];

      for (const hookFn of hooks) {
        hoisted.rpcMock.mockClear();
        const { result } = renderHookWithProviders(hookFn);
        await vi.waitFor(() => expect(result.current.isFetching).toBe(false));
        expect(hoisted.rpcMock).not.toHaveBeenCalled();
      }
    });
  });

  // ==================== Zod Validation ====================

  describe("Zod schema validation", () => {
    it("should filter out invalid supplier items via parseRpcArraySafe", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [
          {
            id: "10000000-0000-0000-0010-000000000001",
            supplier_code: "SUP-001",
            supplier_name: "Valid Supplier",
            country: "CZ",
            contacts: null,
            qualification_status: "qualified",
            approved_at: null,
            approved_by: null,
            risk_level: "low",
            certificates: null,
            audit_history: null,
            is_active: true,
            notes: null,
            metadata: null,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: null,
            created_by: null,
          },
          {
            // Invalid — missing required fields
            id: "invalid-uuid-format",
            supplier_code: 123, // wrong type
          },
        ],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useProductionSuppliersAdmin(),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
      // Only the valid item should pass Zod validation
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].supplier_code).toBe("SUP-001");
    });

    it("should return empty array for null RPC response", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useProductionLocationsAdmin(),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toHaveLength(0);
    });
  });
});
