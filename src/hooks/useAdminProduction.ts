/**
 * @fileoverview Admin production management hooks
 * Provides React Query hooks for production batches, workflow templates, and protocol steps management.
 * All hooks use RPC functions for secure, audited database access.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { toJson } from "@/lib/types/json";
import { usePermissions } from "./usePermissions";
import { useAdminGuard } from "./useAdminGuard";
import {
  parseArrayResponse,
  productionBatchArraySchema,
  productListArraySchema,
  productionWorkflowStepArraySchema,
  productionMilestoneArraySchema,
  productVialArraySchema,
  workflowTemplateArraySchema,
  productionProtocolStepAdminArraySchema,
  type ProductionBatchRpc,
  type ProductionProtocolStepAdminRow,
} from "@/lib/schemas/adminSchemas";
import { parseRpcArray, studyListItemSchema } from "@/lib/validation/rpcSchemas.admin";
import type { Tables, Enums } from "@/integrations/db/types";
import type { Node, Edge } from "@xyflow/react";
import type { WorkflowNodeData } from "@/components/production/WorkflowDesigner";

// ==================== Types ====================

export type ProductionBatch = Tables<"production_batches">;
type BatchStatus = Enums<"batch_status">;
type BatchPurpose = Enums<"batch_purpose">;
type VialContentType = Enums<"vial_content_type">;

export interface ProductionBatchWithRelations extends Omit<ProductionBatchRpc, 'product_name'> {
  product: { name: string } | null;
  study: { name: string; code: string } | null;
}

export interface BatchFormData {
  batch_code: string;
  product_name: string;
  product_id: string | null;
  study_id: string | null;
  purpose: BatchPurpose;
  target_quantity: number;
  unit: string;
  raw_material_lot: string;
  expiry_date: string;
  content_type: VialContentType | null;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string | null;
  product_id: string | null;
  is_default: boolean;
  created_at: string;
  product: { name: string } | null;
  current_version_number: number | null;
  workflow_data: {
    nodes: Node<WorkflowNodeData>[];
    edges: Edge[];
  } | null;
  workflow_steps: Array<{
    order: number;
    name: string;
    type: string;
    expectedInput?: number;
    expectedOutput?: number;
    expectedLoss?: number;
  }> | null;
}

export type ProtocolStep = ProductionProtocolStepAdminRow;

// ==================== Query Hooks ====================

/**
 * Hook for fetching production batches
 */
export function useProductionBatchesAdmin(filters?: {
  status?: BatchStatus;
  purpose?: BatchPurpose;
  product_id?: string;
}) {
  const { hasPermission } = usePermissions();
  const canViewAdminDashboard = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["admin-batches", filters],
    queryFn: async (): Promise<ProductionBatchWithRelations[]> => {
      if (!canViewAdminDashboard) return [];
      const { data, error } = await aisha.rpc("get_production_batches_admin", {
        p_product_id: filters?.product_id ?? undefined,
        p_purpose: filters?.purpose ?? undefined,
        p_status: filters?.status ?? undefined,
      });
      if (error) throw new Error(error.message);

      const validatedData = parseArrayResponse(productionBatchArraySchema, data, "productionBatches");
      return validatedData.map(({ product_name, ...batch }): ProductionBatchWithRelations => ({
        ...batch,
        product: product_name ? { name: product_name } : null,
        study: null,
      }));
    },
    enabled: canViewAdminDashboard,
  });
}

/**
 * Hook for fetching products list for production
 */
export function useProductionProductsAdmin() {
  const { hasPermission } = usePermissions();
  const canViewAdminDashboard = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["products-list"],
    queryFn: async () => {
      if (!canViewAdminDashboard) return [];
      const { data, error } = await aisha.rpc("get_production_products_admin");
      if (error) throw new Error(error.message);
      const validated = parseArrayResponse(productListArraySchema, data, "productsList");
      return validated
        .map((p) => ({ id: p.id, name: p.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled: canViewAdminDashboard,
  });
}

/**
 * Hook for fetching studies list for production
 */
export function useProductionStudiesAdmin() {
  const { hasPermission } = usePermissions();
  const canViewAdminDashboard = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["studies-list"],
    queryFn: async () => {
      if (!canViewAdminDashboard) return [];
      const { data, error } = await aisha.rpc("get_production_studies_admin");
      if (error) throw new Error(error.message);
      return parseRpcArray(studyListItemSchema, data, "studiesList");
    },
    enabled: canViewAdminDashboard,
  });
}

/**
 * Hook for fetching workflow steps for a batch
 */
export function useBatchWorkflowStepsAdmin(batchId: string | undefined) {
  const { hasPermission } = usePermissions();
  const canViewAdminDashboard = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["batch-workflow", batchId],
    queryFn: async () => {
      if (!canViewAdminDashboard || !batchId) return [];
      const { data, error } = await aisha.rpc("get_production_workflow_steps_admin", {
        p_batch_id: batchId,
      });
      if (error) throw new Error(error.message);
      return parseArrayResponse(productionWorkflowStepArraySchema, data, "productionWorkflowSteps");
    },
    enabled: canViewAdminDashboard && !!batchId,
  });
}

/**
 * Hook for fetching milestones for a batch
 */
export function useBatchMilestonesAdmin(batchId: string | undefined) {
  const { hasPermission } = usePermissions();
  const canViewAdminDashboard = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["batch-milestones", batchId],
    queryFn: async () => {
      if (!canViewAdminDashboard || !batchId) return [];
      const { data, error } = await aisha.rpc("get_production_milestones_admin", {
        p_batch_id: batchId,
      });
      if (error) throw new Error(error.message);
      return parseArrayResponse(productionMilestoneArraySchema, data, "productionMilestones");
    },
    enabled: canViewAdminDashboard && !!batchId,
  });
}

/**
 * Hook for fetching vials for a batch
 */
export function useBatchVialsAdmin(batchId: string | undefined) {
  const { hasPermission } = usePermissions();
  const canViewAdminDashboard = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["batch-vials", batchId],
    queryFn: async () => {
      if (!canViewAdminDashboard || !batchId) return [];
      const { data, error } = await aisha.rpc("get_product_vials_admin", {
        p_batch_id: batchId,
      });
      if (error) throw new Error(error.message);
      return parseArrayResponse(productVialArraySchema, data, "productVials");
    },
    enabled: canViewAdminDashboard && !!batchId,
  });
}

/**
 * Hook for fetching workflow templates
 */
export function useWorkflowTemplatesAdmin(productId?: string) {
  const { hasPermission } = usePermissions();
  const canViewAdminDashboard = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["workflow-templates", productId],
    queryFn: async () => {
      if (!canViewAdminDashboard) return [];
      const { data, error } = await aisha.rpc("get_production_workflow_templates_admin", {
        p_product_id: productId === "all" ? undefined : (productId ?? undefined),
      });
      if (error) throw new Error(error.message);
      const validated = parseArrayResponse(workflowTemplateArraySchema, data, "workflowTemplates");
      return validated as WorkflowTemplate[];
    },
    enabled: canViewAdminDashboard,
  });
}

/**
 * Hook for fetching protocol steps for a batch
 */
export function useProtocolStepsAdmin(batchId: string) {
  const { hasPermission } = usePermissions();
  const canViewAdminDashboard = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["protocol-steps", batchId],
    queryFn: async () => {
      if (!canViewAdminDashboard || !batchId) return [];
      const { data, error } = await aisha.rpc("get_production_protocol_steps_admin", {
        p_batch_id: batchId,
      });
      if (error) throw new Error(error.message);
      return parseArrayResponse(
        productionProtocolStepAdminArraySchema,
        data,
        "get_production_protocol_steps_admin"
      );
    },
    enabled: canViewAdminDashboard && !!batchId,
  });
}

// ==================== Mutation Hooks ====================

/**
 * Hook for creating a production batch
 */
export function useCreateProductionBatchMutation() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();
  return useMutation({
    mutationFn: guardAdminMutation("create_production_batch_admin", async (data: BatchFormData) => {
      const { error } = await aisha.rpc("create_production_batch_admin", {
        p_batch_code: data.batch_code,
        p_content_type: data.content_type ?? undefined,
        p_expiry_date: data.expiry_date || undefined,
        p_product_id: data.product_id ?? "",
        p_product_name: data.product_name,
        p_purpose: data.purpose,
        p_raw_material_lot: data.raw_material_lot || undefined,
        p_study_id: data.study_id ?? undefined,
        p_target_quantity: data.target_quantity,
        p_unit: data.unit,
      });
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-batches"] });
    },
  });
}

/**
 * Hook for updating a production batch
 */
export function useUpdateProductionBatchMutation() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();
  return useMutation({
    mutationFn: guardAdminMutation(
      "update_production_batch_admin",
      async ({ id, data }: { id: string; data: Partial<ProductionBatch> }) => {
      const { error } = await aisha.rpc("update_production_batch_admin", {
        p_actual_quantity: data.actual_quantity ?? undefined,
        p_batch_id: id,
        p_qc_notes: data.qc_notes ?? undefined,
        p_released_at: data.released_at ?? undefined,
        p_status: data.status || "draft",
      });
      if (error) throw new Error(error.message);
      }
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-batches"] });
    },
  });
}

/**
 * Hook for updating batch status
 */
export function useUpdateBatchStatusMutation() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();
  return useMutation({
    mutationFn: guardAdminMutation(
      "update_production_batch_admin",
      async ({ id, status }: { id: string; status: BatchStatus }) => {
      const releasedAt = status === "released" ? new Date().toISOString() : undefined;
      const { error } = await aisha.rpc("update_production_batch_admin", {
        p_actual_quantity: undefined,
        p_batch_id: id,
        p_qc_notes: undefined,
        p_released_at: releasedAt,
        p_status: status,
      });
      if (error) throw new Error(error.message);
      }
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-batches"] });
    },
  });
}

/**
 * Hook for creating a workflow template
 */
export function useCreateWorkflowTemplateMutation() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();
  return useMutation({
    mutationFn: guardAdminMutation(
      "create_production_workflow_template_admin",
      async (data: { name: string; product_id: string | null }) => {
      const emptyWorkflowData = toJson({ nodes: [], edges: [] });
      const emptyWorkflowSteps = toJson([]);
      const { error } = await aisha.rpc("create_production_workflow_template_admin", {
        p_description: undefined,
        p_name: data.name,
        p_product_id: data.product_id ?? undefined,
        p_workflow_data: emptyWorkflowData,
        p_workflow_steps: emptyWorkflowSteps,
      });
      if (error) throw new Error(error.message);
      }
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow-templates"] });
    },
  });
}

/**
 * Hook for updating a workflow template (saving workflow data)
 */
export function useUpdateWorkflowTemplateMutation() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();
  return useMutation({
    mutationFn: guardAdminMutation(
      "update_production_workflow_template_admin",
      async ({
        id,
        workflow_data,
        workflow_steps,
      }: {
        id: string;
        workflow_data: { nodes: Node<WorkflowNodeData>[]; edges: Edge[] };
        workflow_steps: WorkflowTemplate["workflow_steps"];
      }) => {
      const { error } = await aisha.rpc("update_production_workflow_template_admin", {
        p_id: id,
        p_workflow_data: toJson(workflow_data),
        p_workflow_steps: toJson(workflow_steps),
      });
      if (error) throw new Error(error.message);
      }
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow-templates"] });
    },
  });
}

/**
 * Hook for setting a workflow template as default
 */
export function useSetWorkflowTemplateDefaultMutation() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();
  return useMutation({
    mutationFn: guardAdminMutation(
      "set_production_workflow_template_default_admin",
      async ({ id }: { id: string; productId?: string | null }) => {
      const { error } = await aisha.rpc("set_production_workflow_template_default_admin", {
        p_id: id,
      });
      if (error) throw new Error(error.message);
      }
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow-templates"] });
    },
  });
}

/**
 * Hook for deleting a workflow template
 */
export function useDeleteWorkflowTemplateMutation() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();
  return useMutation({
    mutationFn: guardAdminMutation("delete_production_workflow_template_admin", async (id: string) => {
      const { error } = await aisha.rpc("delete_production_workflow_template_admin", {
        p_id: id,
      });
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow-templates"] });
    },
  });
}

/**
 * Hook for updating a protocol step
 */
export function useUpdateProtocolStepMutation(batchId: string) {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();
  return useMutation({
    mutationFn: guardAdminMutation(
      "update_production_protocol_step_admin",
      async ({
        id,
        updates,
      }: {
        id: string;
        updates: Partial<ProtocolStep>;
      }) => {
      const { error } = await aisha.rpc("update_production_protocol_step_admin", {
        p_patch: updates,
        p_step_id: id,
      });
      if (error) throw new Error(error.message);
      }
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["protocol-steps", batchId] });
    },
  });
}
