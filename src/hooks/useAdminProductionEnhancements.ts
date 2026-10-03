/**
 * @fileoverview Enhanced production management hooks
 * Provides React Query hooks for template versioning, flow corrections/storno,
 * sensor threshold alerts, Angels' Share reporting, and cross-batch traceability.
 * All hooks use RPC functions for secure, audited database access.
 *
 * @module hooks/useAdminProductionEnhancements
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { toJson } from "@/lib/types/json";
import { usePermissions } from "./usePermissions";
import { useAdminGuard } from "./useAdminGuard";
import {
  workflowTemplateVersionArraySchema,
  productionSensorAlertArraySchema,
  angelsShareReportArraySchema,
  crossBatchTraceabilityArraySchema,
  type WorkflowTemplateVersionRow,
  type ProductionSensorAlertRow,
  type AngelsShareReportItem,
  type CrossBatchTraceabilityItem,
} from "@/lib/schemas/adminSchemas";
import type { Node, Edge } from "@xyflow/react";
import type { WorkflowNodeData } from "@/components/production/WorkflowDesigner";

// ==================== Helper ====================

function parseRpcArraySafe<T>(
  schema: import("zod").ZodSchema<T>,
  data: unknown,
  _label: string,
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

// ==================== Template Versioning ====================

/**
 * Hook for fetching version history of a workflow template.
 *
 * @param templateId - UUID of the workflow template
 * @returns Query result with version history
 * @example
 * const { data: versions } = useWorkflowTemplateVersionsAdmin(templateId);
 */
export function useWorkflowTemplateVersionsAdmin(templateId: string | undefined) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["workflow-template-versions", templateId],
    queryFn: async (): Promise<WorkflowTemplateVersionRow[]> => {
      if (!canView || !templateId) return [];
      const { data, error } = await aisha.rpc(
        "get_production_workflow_template_versions_admin",
        { p_template_id: templateId },
      );
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(workflowTemplateVersionArraySchema.element, data, "templateVersions");
    },
    enabled: canView && !!templateId,
  });
}

/**
 * Mutation hook for saving a workflow template with versioning.
 * Automatically creates a version snapshot before updating.
 *
 * @returns Mutation for versioned template update
 * @example
 * const save = useUpdateWorkflowTemplateVersionedMutation();
 * save.mutate({ id, change_summary: "Added new step", workflow_data, workflow_steps });
 */
export function useUpdateWorkflowTemplateVersionedMutation() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();
  return useMutation({
    mutationFn: guardAdminMutation(
      "update_production_workflow_template_versioned_admin",
      async ({
        change_summary,
        id,
        workflow_data,
        workflow_steps,
      }: {
        change_summary?: string;
        id: string;
        workflow_data: { nodes: Node<WorkflowNodeData>[]; edges: Edge[] };
        workflow_steps: Array<{
          order: number;
          name: string;
          type: string;
          expectedInput?: number;
          expectedOutput?: number;
          expectedLoss?: number;
        }> | null;
      }) => {
        const { error } = await aisha.rpc(
          "update_production_workflow_template_versioned_admin",
          {
            p_change_summary: change_summary ?? undefined,
            p_id: id,
            p_workflow_data: toJson(workflow_data),
            p_workflow_steps: toJson(workflow_steps),
          },
        );
        if (error) throw new Error(error.message);
      },
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow-templates"] });
      queryClient.invalidateQueries({ queryKey: ["workflow-template-versions"] });
    },
  });
}

/**
 * Mutation hook for restoring a previous version of a workflow template.
 *
 * @returns Mutation for restoring a template version
 * @example
 * const restore = useRestoreWorkflowTemplateVersionMutation();
 * restore.mutate({ template_id: "...", version_number: 3 });
 */
export function useRestoreWorkflowTemplateVersionMutation() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();
  return useMutation({
    mutationFn: guardAdminMutation(
      "restore_production_workflow_template_version_admin",
      async ({
        template_id,
        version_number,
      }: {
        template_id: string;
        version_number: number;
      }) => {
        const { error } = await aisha.rpc(
          "restore_production_workflow_template_version_admin",
          {
            p_template_id: template_id,
            p_version_number: version_number,
          },
        );
        if (error) throw new Error(error.message);
      },
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow-templates"] });
      queryClient.invalidateQueries({ queryKey: ["workflow-template-versions"] });
    },
  });
}

// ==================== Flow Corrections ====================

/**
 * Mutation hook for creating a correction record against an existing flow record.
 * The correction record is a negative reversal of the original, with an optional
 * new correcting flow. Both are immutable and linked for audit trail.
 *
 * @returns Mutation for creating a flow correction
 * @example
 * const correct = useCreateFlowCorrectionMutation();
 * correct.mutate({
 *   original_record_id: "...",
 *   correction_reason: "Wrong volume recorded",
 *   new_volume_l: 95,
 *   new_concentration_pct: 96.0,
 * });
 */
export function useCreateFlowCorrectionMutation() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();
  return useMutation({
    mutationFn: guardAdminMutation(
      "create_production_flow_correction_admin",
      async ({
        correction_reason,
        new_concentration_pct,
        new_volume_l,
        original_record_id,
      }: {
        correction_reason: string;
        new_concentration_pct?: number;
        new_volume_l?: number;
        original_record_id: string;
      }) => {
        const { data, error } = await aisha.rpc(
          "create_production_flow_correction_admin",
          {
            p_concentration_pct: new_concentration_pct ?? undefined,
            p_correction_reason: correction_reason,
            p_original_record_id: original_record_id,
            p_volume_l: new_volume_l ?? undefined,
          },
        );
        if (error) throw new Error(error.message);
        return data;
      },
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-flow-records"] });
      queryClient.invalidateQueries({ queryKey: ["admin-flow-balance"] });
      queryClient.invalidateQueries({ queryKey: ["admin-flow-node-inventory"] });
    },
  });
}

// ==================== Sensor Alerts ====================

/**
 * Hook for fetching production sensor alerts with optional filters.
 *
 * @param filters - Optional filters for batch, node, acknowledged status
 * @returns Query result with sensor alerts
 * @example
 * const { data: alerts } = useSensorAlertsAdmin({ acknowledged: false });
 */
export function useSensorAlertsAdmin(filters?: {
  acknowledged?: boolean;
  batch_id?: string;
  severity?: string;
}) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["admin-sensor-alerts", filters],
    queryFn: async (): Promise<ProductionSensorAlertRow[]> => {
      if (!canView) return [];
      const { data, error } = await aisha.rpc(
        "get_production_sensor_alerts_admin",
        {
          p_acknowledged: filters?.acknowledged ?? undefined,
          p_batch_id: filters?.batch_id ?? undefined,
          p_severity: filters?.severity ?? undefined,
        },
      );
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(
        productionSensorAlertArraySchema.element,
        data,
        "sensorAlerts",
      );
    },
    enabled: canView,
  });
}

/**
 * Mutation hook for creating a new sensor alert.
 *
 * @returns Mutation for creating a sensor alert
 */
export function useCreateSensorAlertMutation() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();
  return useMutation({
    mutationFn: guardAdminMutation(
      "create_production_sensor_alert_admin",
      async (alert: {
        alert_type: string;
        batch_id?: string;
        equipment_id?: string;
        flow_node_id?: string;
        message: string;
        metadata?: Record<string, unknown>;
        reading_type: string;
        reading_value: number;
        sensor_reading_id?: string;
        severity?: string;
        threshold_max?: number;
        threshold_min?: number;
      }) => {
        const { error } = await aisha.rpc(
          "create_production_sensor_alert_admin",
          {
            p_alert_type: alert.alert_type,
            p_batch_id: alert.batch_id ?? undefined,
            p_equipment_id: alert.equipment_id ?? undefined,
            p_flow_node_id: alert.flow_node_id ?? undefined,
            p_message: alert.message,
            p_metadata: alert.metadata ? toJson(alert.metadata) : undefined,
            p_reading_type: alert.reading_type,
            p_reading_value: alert.reading_value,
            p_sensor_reading_id: alert.sensor_reading_id ?? undefined,
            p_severity: alert.severity ?? "warning",
            p_threshold_max: alert.threshold_max ?? undefined,
            p_threshold_min: alert.threshold_min ?? undefined,
          },
        );
        if (error) throw new Error(error.message);
      },
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-sensor-alerts"] });
    },
  });
}

/**
 * Mutation hook for acknowledging a sensor alert.
 *
 * @returns Mutation for acknowledging a sensor alert
 */
export function useAcknowledgeSensorAlertMutation() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();
  return useMutation({
    mutationFn: guardAdminMutation(
      "acknowledge_production_sensor_alert_admin",
      async (alertId: string) => {
        const { error } = await aisha.rpc(
          "acknowledge_production_sensor_alert_admin",
          { p_alert_id: alertId },
        );
        if (error) throw new Error(error.message);
      },
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-sensor-alerts"] });
    },
  });
}

// ==================== Angels' Share Report ====================

/**
 * Hook for computing the Angels' Share (production loss) report.
 * Used for customs authority reporting — generates per-batch,
 * per-substance loss analysis with pure alcohol calculations.
 *
 * @param params - Date range, optional batch and substance filters
 * @returns Query result with Angels' Share report data
 * @example
 * const { data: report } = useAngelsShareReportAdmin({
 *   date_from: "2026-01-01",
 *   date_to: "2026-01-31",
 * });
 */
export function useAngelsShareReportAdmin(params: {
  batch_id?: string;
  date_from: string;
  date_to: string;
  substance_id?: string;
}) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  const hasDateRange = !!params.date_from && !!params.date_to;
  return useQuery({
    queryKey: ["admin-angels-share-report", params],
    queryFn: async (): Promise<AngelsShareReportItem[]> => {
      if (!canView) return [];
      const { data, error } = await aisha.rpc(
        "compute_production_angels_share_report_admin",
        {
          p_batch_id: params.batch_id ?? undefined,
          p_date_from: params.date_from,
          p_date_to: params.date_to,
          p_substance_id: params.substance_id ?? undefined,
        },
      );
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(
        angelsShareReportArraySchema.element,
        data,
        "angelsShareReport",
      );
    },
    enabled: canView && hasDateRange,
  });
}

// ==================== Cross-Batch Traceability ====================

/**
 * Hook for cross-batch material traceability.
 * Traces materials recursively across batches showing provenance chain.
 *
 * @param batchId - Root batch UUID to trace from
 * @param maxDepth - Maximum recursion depth (default: 5)
 * @returns Query result with traceability tree
 * @example
 * const { data: trace } = useCrossBatchTraceabilityAdmin(batchId);
 */
export function useCrossBatchTraceabilityAdmin(
  batchId: string | undefined,
  maxDepth = 5,
) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["admin-cross-batch-traceability", batchId, maxDepth],
    queryFn: async (): Promise<CrossBatchTraceabilityItem[]> => {
      if (!canView || !batchId) return [];
      const { data, error } = await aisha.rpc(
        "get_production_cross_batch_traceability_admin",
        {
          p_batch_id: batchId,
        },
      );
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(
        crossBatchTraceabilityArraySchema.element,
        data,
        "crossBatchTraceability",
      );
    },
    enabled: canView && !!batchId,
  });
}
