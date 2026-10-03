/**
 * @fileoverview Tests for useAdminProductionEnhancements hooks
 * Tests template versioning, flow corrections, sensor alerts,
 * angels' share report, and cross-batch traceability hooks.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHookWithProviders } from "@/tests/utils/test-utils";
import {
  useWorkflowTemplateVersionsAdmin,
  useUpdateWorkflowTemplateVersionedMutation,
  useRestoreWorkflowTemplateVersionMutation,
  useCreateFlowCorrectionMutation,
  useSensorAlertsAdmin,
  useCreateSensorAlertMutation,
  useAcknowledgeSensorAlertMutation,
  useAngelsShareReportAdmin,
  useCrossBatchTraceabilityAdmin,
} from "@/hooks/useAdminProductionEnhancements";

// ==================== Mocks ====================

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

const sampleVersion = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  template_id: "550e8400-e29b-41d4-a716-446655440002",
  version_number: 1,
  workflow_data: { nodes: [], edges: [] },
  workflow_steps: [{ order: 1, name: "Maceration", type: "process" }],
  change_summary: "Initial version",
  created_by: "550e8400-e29b-41d4-a716-446655440003",
  created_at: "2026-01-15T00:00:00Z",
};

const sampleSensorAlert = {
  id: "550e8400-e29b-41d4-a716-446655440010",
  batch_id: "550e8400-e29b-41d4-a716-446655440011",
  node_id: "550e8400-e29b-41d4-a716-446655440012",
  alert_type: "threshold_exceeded",
  severity: "warning",
  metric_name: "temperature",
  threshold_value: 40,
  actual_value: 45.2,
  message: null,
  acknowledged_at: null,
  acknowledged_by: null,
  resolved_at: null,
  metadata: null,
  created_at: "2026-01-15T10:00:00Z",
};

const sampleAngelsShareItem = {
  batch_id: "550e8400-e29b-41d4-a716-446655440020",
  batch_code: "RTN-2026-001",
  substance_id: "550e8400-e29b-41d4-a716-446655440021",
  substance_code: "ETH-96",
  substance_name: "Ethanol 96%",
  total_input_volume_l: 1000,
  total_output_volume_l: 950,
  total_loss_volume_l: 50,
  loss_pct: 5.0,
  avg_input_concentration_pct: 96.0,
  avg_output_concentration_pct: 94.5,
  pure_alcohol_loss_l: 47.5,
  record_count: 12,
  first_flow_date: "2026-01-01T00:00:00Z",
  last_flow_date: "2026-01-15T00:00:00Z",
};

const sampleTraceabilityItem = {
  trace_level: 0,
  batch_id: "550e8400-e29b-41d4-a716-446655440030",
  batch_code: "RTN-2026-001",
  material_id: "550e8400-e29b-41d4-a716-446655440031",
  material_code: "ETH-96",
  material_name: "Ethanol 96%",
  total_volume_l: 500,
  total_pure_l: 480,
  record_count: 5,
};

// ==================== Tests ====================

describe("useAdminProductionEnhancements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.hasPermissionMock.mockReturnValue(true);
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });
  });

  // ==================== Template Versioning ====================

  describe("useWorkflowTemplateVersionsAdmin", () => {
    it("fetches template versions via RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [sampleVersion],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useWorkflowTemplateVersionsAdmin(sampleVersion.template_id),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_workflow_template_versions_admin",
        { p_template_id: sampleVersion.template_id },
      );
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0]?.version_number).toBe(1);
      expect(result.current.data?.[0]?.change_summary).toBe("Initial version");
    });

    it("returns empty when no permission", async () => {
      hoisted.hasPermissionMock.mockReturnValue(false);

      const { result } = renderHookWithProviders(() =>
        useWorkflowTemplateVersionsAdmin(sampleVersion.template_id),
      );

      // Query should not be enabled
      expect(result.current.fetchStatus).toBe("idle");
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });

    it("returns empty when no templateId", async () => {
      const { result } = renderHookWithProviders(() =>
        useWorkflowTemplateVersionsAdmin(undefined),
      );

      expect(result.current.fetchStatus).toBe("idle");
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });

    it("filters invalid data via Zod", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [{ invalid: true }],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useWorkflowTemplateVersionsAdmin(sampleVersion.template_id),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toHaveLength(0);
    });
  });

  describe("useUpdateWorkflowTemplateVersionedMutation", () => {
    it("calls versioned update RPC with correct params", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: null, error: null });

      const { result } = renderHookWithProviders(() =>
        useUpdateWorkflowTemplateVersionedMutation(),
      );

      await result.current.mutateAsync({
        id: "template-id",
        change_summary: "Updated filtration step",
        workflow_data: { nodes: [], edges: [] },
        workflow_steps: [{ order: 1, name: "Filtration", type: "process" }],
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "update_production_workflow_template_versioned_admin",
        expect.objectContaining({
          p_id: "template-id",
          p_change_summary: "Updated filtration step",
        }),
      );
    });

    it("blocks when permission denied", async () => {
      hoisted.hasPermissionMock.mockReturnValue(false);

      const { result } = renderHookWithProviders(() =>
        useUpdateWorkflowTemplateVersionedMutation(),
      );

      await expect(
        result.current.mutateAsync({
          id: "id",
          workflow_data: { nodes: [], edges: [] },
          workflow_steps: null,
        }),
      ).rejects.toThrow();

      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });
  });

  describe("useRestoreWorkflowTemplateVersionMutation", () => {
    it("calls restore RPC with template_id and version_number", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: null, error: null });

      const { result } = renderHookWithProviders(() =>
        useRestoreWorkflowTemplateVersionMutation(),
      );

      await result.current.mutateAsync({
        template_id: "t-id",
        version_number: 3,
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "restore_production_workflow_template_version_admin",
        { p_template_id: "t-id", p_version_number: 3 },
      );
    });
  });

  // ==================== Flow Corrections ====================

  describe("useCreateFlowCorrectionMutation", () => {
    it("calls correction RPC with correct params", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: "new-id", error: null });

      const { result } = renderHookWithProviders(() =>
        useCreateFlowCorrectionMutation(),
      );

      await result.current.mutateAsync({
        original_record_id: "orig-id",
        correction_reason: "Wrong volume",
        new_volume_l: 95,
        new_concentration_pct: 96.0,
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "create_production_flow_correction_admin",
        expect.objectContaining({
          p_original_record_id: "orig-id",
          p_correction_reason: "Wrong volume",
          p_volume_l: 95,
          p_concentration_pct: 96.0,
        }),
      );
    });

    it("sends null for optional params when not provided", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: "new-id", error: null });

      const { result } = renderHookWithProviders(() =>
        useCreateFlowCorrectionMutation(),
      );

      await result.current.mutateAsync({
        original_record_id: "orig-id",
        correction_reason: "Storno - duplicate entry",
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "create_production_flow_correction_admin",
        expect.objectContaining({
          p_volume_l: undefined,
          p_concentration_pct: undefined,
        }),
      );
    });

    it("blocks when permission denied", async () => {
      hoisted.hasPermissionMock.mockReturnValue(false);

      const { result } = renderHookWithProviders(() =>
        useCreateFlowCorrectionMutation(),
      );

      await expect(
        result.current.mutateAsync({
          original_record_id: "id",
          correction_reason: "test",
        }),
      ).rejects.toThrow();

      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });
  });

  // ==================== Sensor Alerts ====================

  describe("useSensorAlertsAdmin", () => {
    it("fetches sensor alerts via RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [sampleSensorAlert],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useSensorAlertsAdmin(),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_sensor_alerts_admin",
        expect.objectContaining({
          p_acknowledged: undefined,
          p_batch_id: undefined,
          p_severity: undefined,
        }),
      );
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0]?.severity).toBe("warning");
      expect(result.current.data?.[0]?.actual_value).toBe(45.2);
    });

    it("passes filter parameters correctly", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

      renderHookWithProviders(() =>
        useSensorAlertsAdmin({
          batch_id: "b-id",
          acknowledged: false,
          severity: "warning",
        }),
      );

      await vi.waitFor(() =>
        expect(hoisted.rpcMock).toHaveBeenCalledWith(
          "get_production_sensor_alerts_admin",
          {
            p_acknowledged: false,
            p_batch_id: "b-id",
            p_severity: "warning",
          },
        ),
      );
    });

    it("returns empty when no permission", async () => {
      hoisted.hasPermissionMock.mockReturnValue(false);

      const { result } = renderHookWithProviders(() =>
        useSensorAlertsAdmin(),
      );

      expect(result.current.fetchStatus).toBe("idle");
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });

    it("filters invalid data via Zod", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [{ bad_field: "invalid" }],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useSensorAlertsAdmin(),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toHaveLength(0);
    });
  });

  describe("useCreateSensorAlertMutation", () => {
    it("calls create alert RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: null, error: null });

      const { result } = renderHookWithProviders(() =>
        useCreateSensorAlertMutation(),
      );

      await result.current.mutateAsync({
        alert_type: "threshold_exceeded",
        batch_id: "b-id",
        message: "Temperature exceeded threshold",
        reading_type: "temperature",
        reading_value: 45.2,
        severity: "warning",
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "create_production_sensor_alert_admin",
        expect.objectContaining({
          p_alert_type: "threshold_exceeded",
          p_batch_id: "b-id",
          p_message: "Temperature exceeded threshold",
          p_reading_type: "temperature",
          p_reading_value: 45.2,
          p_severity: "warning",
        }),
      );
    });
  });

  describe("useAcknowledgeSensorAlertMutation", () => {
    it("calls acknowledge RPC with alert ID", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: null, error: null });

      const { result } = renderHookWithProviders(() =>
        useAcknowledgeSensorAlertMutation(),
      );

      await result.current.mutateAsync("alert-id");

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "acknowledge_production_sensor_alert_admin",
        { p_alert_id: "alert-id" },
      );
    });
  });

  // ==================== Angels' Share Report ====================

  describe("useAngelsShareReportAdmin", () => {
    it("fetches angels share report via RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [sampleAngelsShareItem],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useAngelsShareReportAdmin({
          date_from: "2026-01-01",
          date_to: "2026-01-31",
        }),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "compute_production_angels_share_report_admin",
        expect.objectContaining({
          p_batch_id: undefined,
          p_date_from: "2026-01-01",
          p_date_to: "2026-01-31",
          p_substance_id: undefined,
        }),
      );
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0]?.loss_pct).toBe(5.0);
      expect(result.current.data?.[0]?.pure_alcohol_loss_l).toBe(47.5);
    });

    it("passes optional filters", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

      renderHookWithProviders(() =>
        useAngelsShareReportAdmin({
          batch_id: "b-id",
          date_from: "2026-01-01",
          date_to: "2026-01-31",
          substance_id: "s-id",
        }),
      );

      await vi.waitFor(() =>
        expect(hoisted.rpcMock).toHaveBeenCalledWith(
          "compute_production_angels_share_report_admin",
          {
            p_batch_id: "b-id",
            p_date_from: "2026-01-01",
            p_date_to: "2026-01-31",
            p_substance_id: "s-id",
          },
        ),
      );
    });

    it("does not execute without date range", async () => {
      const { result } = renderHookWithProviders(() =>
        useAngelsShareReportAdmin({
          date_from: "",
          date_to: "",
        }),
      );

      expect(result.current.fetchStatus).toBe("idle");
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });

    it("filters invalid data via Zod", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [{ invalid_field: true }],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useAngelsShareReportAdmin({
          date_from: "2026-01-01",
          date_to: "2026-01-31",
        }),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toHaveLength(0);
    });
  });

  // ==================== Cross-Batch Traceability ====================

  describe("useCrossBatchTraceabilityAdmin", () => {
    it("fetches traceability data via RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [sampleTraceabilityItem],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useCrossBatchTraceabilityAdmin("batch-id"),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_production_cross_batch_traceability_admin",
        { p_batch_id: "batch-id" },
      );
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0]?.trace_level).toBe(0);
      expect(result.current.data?.[0]?.batch_code).toBe("RTN-2026-001");
    });

    it("uses custom max depth", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

      renderHookWithProviders(() =>
        useCrossBatchTraceabilityAdmin("batch-id", 10),
      );

      await vi.waitFor(() =>
        expect(hoisted.rpcMock).toHaveBeenCalledWith(
          "get_production_cross_batch_traceability_admin",
          { p_batch_id: "batch-id" },
        ),
      );
    });

    it("returns empty when no batchId", async () => {
      const { result } = renderHookWithProviders(() =>
        useCrossBatchTraceabilityAdmin(undefined),
      );

      expect(result.current.fetchStatus).toBe("idle");
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });

    it("returns empty when no permission", async () => {
      hoisted.hasPermissionMock.mockReturnValue(false);

      const { result } = renderHookWithProviders(() =>
        useCrossBatchTraceabilityAdmin("batch-id"),
      );

      expect(result.current.fetchStatus).toBe("idle");
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });

    it("filters invalid data via Zod", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [{ junk: true }],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useCrossBatchTraceabilityAdmin("batch-id"),
      );

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toHaveLength(0);
    });
  });

  // ==================== Security ====================

  describe("Security", () => {
    it("no sensitive data is exposed in error messages", async () => {
      const rpcError = {
        data: null,
        error: { message: "database error", code: "PGRST" },
      };
      hoisted.rpcMock.mockResolvedValue(rpcError);

      const { result } = renderHookWithProviders(() =>
        useSensorAlertsAdmin(),
      );

      await vi.waitFor(() => expect(result.current.isError).toBe(true));

      const errorMessage = result.current.error?.message ?? "";
      expect(errorMessage).not.toContain("@");
      expect(errorMessage).not.toContain("password");
    });
  });
});
