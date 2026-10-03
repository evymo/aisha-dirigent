/**
 * Hook for AI async task management.
 *
 * Provides React Query hooks for creating, polling, cancelling,
 * and listing long-running AI tasks.
 *
 * Tasks support progress tracking and periodic polling for status updates.
 *
 * @module hooks/useAiTasks
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "@/hooks/useSession";
import { usePermissions } from "@/hooks/usePermissions";
import { safeError } from "@/lib/security/safeLogger";
import { toJson } from "@/lib/types/json";
import { z } from "zod";

// ============================================================================
// Zod Schemas
// ============================================================================

const AiTaskStatusSchema = z.object({
  task_id: z.string().uuid(),
  task_type: z.string(),
  status: z.enum(["queued", "running", "done", "failed", "cancelled"]),
  progress: z.number().min(0).max(100),
  current_step: z.number().nullable(),
  max_steps: z.number().nullable(),
  result: z.unknown().nullable(),
  error_message: z.string().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  created_at: z.string(),
});

const AiTaskListItemSchema = z.object({
  task_id: z.string().uuid(),
  task_type: z.string(),
  status: z.string(),
  progress: z.number(),
  created_at: z.string(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
});

// ============================================================================
// Exported Types
// ============================================================================

/** Full task status with result/error. */
export type AiTaskStatus = z.infer<typeof AiTaskStatusSchema>;

/** Task list item (summary view). */
export type AiTaskListItem = z.infer<typeof AiTaskListItemSchema>;

// ============================================================================
// Query Key Factory
// ============================================================================

/** Query key factory for AI tasks. */
export const aiTaskKeys = {
  all: ["ai-tasks"] as const,
  list: (status?: string) => [...aiTaskKeys.all, "list", status] as const,
  detail: (taskId: string | null | undefined) =>
    [...aiTaskKeys.all, "detail", taskId] as const,
  admin: (limit?: number) => [...aiTaskKeys.all, "admin", limit] as const,
};

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * List own AI tasks with optional status filter.
 *
 * @param options - Optional filters: status, limit
 * @returns Query with array of task list items
 * @example
 * const { data: tasks } = useAiTasks({ status: "running" });
 */
export function useAiTasks(options?: {
  status?: string;
  limit?: number;
}) {
  const { user } = useSession();
  const limit = options?.limit ?? 20;

  return useQuery({
    queryKey: aiTaskKeys.list(options?.status),
    queryFn: async (): Promise<AiTaskListItem[]> => {
      const params: Record<string, unknown> = { p_limit: limit };
      if (options?.status) {
        params.p_status = options.status;
      }

      const { data, error } = await aisha.rpc("get_my_ai_tasks", params);

      if (error) throw new Error(error.message);
      if (!data || !Array.isArray(data)) return [];

      return data
        .map((item) => {
          const parsed = AiTaskListItemSchema.safeParse(item);
          return parsed.success ? parsed.data : null;
        })
        .filter((x): x is AiTaskListItem => x !== null);
    },
    enabled: !!user,
    staleTime: 5_000,
  });
}

/**
 * Get detailed status of a specific task with auto-polling.
 *
 * Polls every 3 seconds for active tasks (queued/running),
 * stops polling once completed/failed/cancelled.
 *
 * @param taskId - UUID of the task
 * @returns Query with task status details
 * @example
 * const { data: status } = useAiTaskStatus(taskId);
 */
export function useAiTaskStatus(taskId: string | null | undefined) {
  const { user } = useSession();

  return useQuery({
    queryKey: aiTaskKeys.detail(taskId),
    queryFn: async (): Promise<AiTaskStatus | null> => {
      if (!taskId) return null;

      const { data, error } = await aisha.rpc("get_ai_task_status", {
        p_task_id: taskId,
      });

      if (error) {
        if (error.message.includes("not found")) return null;
        throw new Error(error.message);
      }

      const parsed = AiTaskStatusSchema.safeParse(data);
      return parsed.success ? parsed.data : null;
    },
    enabled: !!user && !!taskId,
    staleTime: 2_000,
    refetchInterval: (query) => {
      const status = query.state?.data?.status;
      // Auto-poll for active tasks
      if (status === "queued" || status === "running") return 3_000;
      return false;
    },
  });
}

/**
 * Admin: list all AI tasks across the platform.
 *
 * @param limit - Maximum results (default 100)
 */
export function useAdminAiTasks(limit = 100) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();

  return useQuery({
    queryKey: aiTaskKeys.admin(limit),
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_admin_ai_tasks", {
        p_limit: limit,
      });

      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!user && hasPermission("view_admin_panel"),
    staleTime: 10_000,
  });
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Create a new async AI task.
 *
 * @example
 * const { mutateAsync: createTask } = useCreateAiTask();
 * const result = await createTask({ task_type: "batch_analysis", input: { ... } });
 */
export function useCreateAiTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      task_type: string;
      input?: Record<string, unknown>;
    }): Promise<{ task_id: string; status: string }> => {
      const { data, error } = await aisha.rpc("create_ai_task", {
        p_input: toJson(input.input ?? {}),
      
        p_task_type: input.task_type,});

      if (error) throw new Error(error.message);
      return data as { task_id: string; status: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aiTaskKeys.all });
    },
    onError: (error) => {
      safeError("useCreateAiTask.failed", error);
    },
  });
}

/**
 * Cancel a queued or running task.
 *
 * @example
 * const { mutateAsync: cancelTask } = useCancelAiTask();
 * await cancelTask(taskId);
 */
export function useCancelAiTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (taskId: string): Promise<boolean> => {
      const { data, error } = await aisha.rpc("cancel_ai_task", {
        p_task_id: taskId,
      });

      if (error) throw new Error(error.message);
      return data === true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aiTaskKeys.all });
    },
    onError: (error) => {
      safeError("useCancelAiTask.failed", error);
    },
  });
}
