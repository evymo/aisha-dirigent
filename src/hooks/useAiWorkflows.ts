/**
 * AI Workflow admin hooks for managing workflow definitions and viewing
 * workflow run node execution history.
 *
 * Phase 5 — Dynamic Composition: provides React Query hooks for:
 * - Listing workflow definitions (admin)
 * - CRUD on workflow definitions (admin)
 * - Viewing workflow node execution history per run (admin)
 *
 * @module hooks/useAiWorkflows
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import type { Json } from "@/integrations/db/types";
import { usePermissions } from "@/hooks/usePermissions";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";

// ============================================================================
// Zod Schemas
// ============================================================================

const WorkflowNodeSchema = z.object({
  type: z.enum(["classifier", "agent", "parallel", "critic", "guardrails"]),
  agent: z.string().optional(),
  description: z.string().optional(),
  next: z.string().nullable().optional(),
  transitions: z.record(z.string()).optional(),
  children: z.union([z.string(), z.array(z.string())]).optional(),
  merge_strategy: z.enum(["concatenate", "best", "structured"]).optional(),
  target_node: z.string().optional(),
  config: z.record(z.unknown()).optional(),
});

const WorkflowGraphSchema = z.object({
  entry: z.string(),
  nodes: z.record(WorkflowNodeSchema),
});

const WorkflowDefinitionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  display_name: z.string().nullable(),
  description: z.string().nullable(),
  graph: WorkflowGraphSchema,
  context: z.string(),
  is_active: z.boolean(),
  version: z.number(),
  metadata: z.record(z.unknown()).nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  created_by: z.string().uuid().nullable(),
  updated_by: z.string().uuid().nullable(),
});

const WorkflowNodeRunSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  node_id: z.string(),
  node_type: z.string(),
  agent_name: z.string().nullable(),
  status: z.enum(["pending", "running", "completed", "failed", "skipped"]),
  output_data: z.record(z.unknown()).nullable(),
  transition_key: z.string().nullable(),
  started_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  duration_ms: z.number().nullable(),
  tokens_input: z.number().nullable(),
  tokens_output: z.number().nullable(),
  error_message: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
});

// ============================================================================
// Exported Types
// ============================================================================

/** Workflow definition (admin view). */
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

/** Workflow graph structure. */
export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;

/** Workflow graph node definition. */
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

/** Workflow node execution run record. */
export type WorkflowNodeRun = z.infer<typeof WorkflowNodeRunSchema>;

// ============================================================================
// Query Key Factory
// ============================================================================

/** Query key factory for AI workflows. */
export const aiWorkflowKeys = {
  all: ["ai-workflows"] as const,
  list: () => [...aiWorkflowKeys.all, "list"] as const,
  detail: (id: string | null | undefined) =>
    [...aiWorkflowKeys.all, "detail", id] as const,
  nodeRuns: (runId: string | null | undefined) =>
    [...aiWorkflowKeys.all, "node-runs", runId] as const,
};

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * List all workflow definitions (admin only).
 *
 * @returns Query with array of workflow definitions
 * @example
 * const { data: workflows } = useAiWorkflows();
 */
export function useAiWorkflows() {
  const { hasPermission } = usePermissions();

  return useQuery({
    queryKey: aiWorkflowKeys.list(),
    queryFn: async (): Promise<WorkflowDefinition[]> => {
      const { data, error } = await aisha.rpc("get_ai_workflows_admin");

      if (error) throw new Error(error.message);
      if (!data || !Array.isArray(data)) return [];

      const parsed = z.array(WorkflowDefinitionSchema).safeParse(data);
      if (!parsed.success) {
        safeError("useAiWorkflows.list", parsed.error);
        return [];
      }
      return parsed.data;
    },
    enabled: hasPermission("manage_ai_workflows"),
    staleTime: 30_000,
  });
}

/**
 * Get a single workflow definition by ID (admin only).
 *
 * @param workflowId - UUID of the workflow definition
 * @returns Query with workflow definition or null
 * @example
 * const { data: workflow } = useAiWorkflow(workflowId);
 */
export function useAiWorkflow(workflowId: string | null | undefined) {
  const { hasPermission } = usePermissions();

  return useQuery({
    queryKey: aiWorkflowKeys.detail(workflowId),
    queryFn: async (): Promise<WorkflowDefinition | null> => {
      if (!workflowId) return null;

      const { data, error } = await aisha.rpc("get_ai_workflow_admin", {
        p_workflow_id: workflowId,
      });

      if (error) throw new Error(error.message);
      if (!data || !Array.isArray(data) || data.length === 0) return null;

      const parsed = WorkflowDefinitionSchema.safeParse(data[0]);
      if (!parsed.success) {
        safeError("useAiWorkflow.detail", parsed.error);
        return null;
      }
      return parsed.data;
    },
    enabled: !!workflowId && hasPermission("manage_ai_workflows"),
    staleTime: 30_000,
  });
}

/**
 * Get node execution runs for a specific AI run (admin only).
 *
 * Shows the step-by-step workflow execution history for a run.
 *
 * @param runId - UUID of the AI run
 * @returns Query with array of workflow node runs
 * @example
 * const { data: nodeRuns } = useAiWorkflowNodeRuns(runId);
 */
export function useAiWorkflowNodeRuns(runId: string | null | undefined) {
  const { hasPermission } = usePermissions();

  return useQuery({
    queryKey: aiWorkflowKeys.nodeRuns(runId),
    queryFn: async (): Promise<WorkflowNodeRun[]> => {
      if (!runId) return [];

      const { data, error } = await aisha.rpc("get_workflow_run_nodes_admin", {
        p_run_id: runId,
      });

      if (error) throw new Error(error.message);
      if (!data || !Array.isArray(data)) return [];

      const parsed = z.array(WorkflowNodeRunSchema).safeParse(data);
      if (!parsed.success) {
        safeError("useAiWorkflowNodeRuns.parse", parsed.error);
        return [];
      }
      return parsed.data;
    },
    enabled: !!runId && hasPermission("manage_ai_workflows"),
    staleTime: 10_000,
  });
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Create a new workflow definition (admin only).
 *
 * @returns Mutation for creating a workflow
 * @example
 * const { mutateAsync: createWorkflow } = useCreateAiWorkflow();
 * await createWorkflow({ name: "my-workflow", graph: { entry: "n1", nodes: {} } });
 */
export function useCreateAiWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      name: string;
      display_name?: string;
      description?: string;
      graph: WorkflowGraph;
      context?: string;
      is_active?: boolean;
      metadata?: Record<string, unknown>;
    }): Promise<string> => {
      const metaPayload = (params.metadata ?? {}) as unknown as Json;
      const graphPayload = params.graph as unknown as Json;
      const { data, error } = await aisha.rpc("create_ai_workflow_admin", {
        p_context: params.context ?? "chat",
        p_description: params.description ?? undefined,
        p_display_name: params.display_name ?? params.name,
        p_graph: graphPayload,
        p_is_active: params.is_active ?? false,
        p_metadata: metaPayload,
        p_name: params.name,
      });

      if (error) throw new Error(error.message);
      return (data as unknown as string) ?? "";
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aiWorkflowKeys.all });
    },
    onError: (error) => {
      safeError("useCreateAiWorkflow", error);
    },
  });
}

/**
 * Update an existing workflow definition (admin only).
 *
 * @returns Mutation for updating a workflow
 * @example
 * const { mutateAsync: updateWorkflow } = useUpdateAiWorkflow();
 * await updateWorkflow({ workflow_id: "...", display_name: "Updated Name" });
 */
export function useUpdateAiWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      workflow_id: string;
      display_name?: string;
      description?: string;
      graph?: WorkflowGraph;
      is_active?: boolean;
      metadata?: Record<string, unknown>;
    }): Promise<void> => {
      const { error } = await aisha.rpc("update_ai_workflow_admin", {
        p_description: params.description ?? undefined,
        p_display_name: params.display_name ?? undefined,
        p_graph: params.graph ?? undefined
          ? (params.graph as unknown as Json)
          : null,
        p_is_active: params.is_active ?? undefined,
        p_metadata: params.metadata ?? undefined
          ? (params.metadata as unknown as Json)
          : null,
      
        p_workflow_id: params.workflow_id,});

      if (error) throw new Error(error.message);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: aiWorkflowKeys.all });
      queryClient.invalidateQueries({
        queryKey: aiWorkflowKeys.detail(variables.workflow_id),
      });
    },
    onError: (error) => {
      safeError("useUpdateAiWorkflow", error);
    },
  });
}

/**
 * Delete a workflow definition (admin only).
 *
 * @returns Mutation for deleting a workflow
 * @example
 * const { mutateAsync: deleteWorkflow } = useDeleteAiWorkflow();
 * await deleteWorkflow("workflow-uuid");
 */
export function useDeleteAiWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (workflowId: string): Promise<void> => {
      const { error } = await aisha.rpc("delete_ai_workflow_admin", {
        p_workflow_id: workflowId,
      });

      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aiWorkflowKeys.all });
    },
    onError: (error) => {
      safeError("useDeleteAiWorkflow", error);
    },
  });
}
