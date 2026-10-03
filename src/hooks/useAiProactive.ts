/**
 * AI Proactive Triggers & Scheduled Jobs admin hooks.
 *
 * Phase 6 — Proactive Agents & Triggers: provides React Query hooks for:
 * - Listing and managing proactive trigger definitions (admin)
 * - Viewing proactive trigger run history (admin)
 * - Listing and managing scheduled AI jobs (admin)
 * - Creating new triggers and scheduled jobs (admin)
 *
 * @module hooks/useAiProactive
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

const TriggerConditionSchema = z.object({
  field: z.string().optional(),
  operator: z.string().optional(),
  value: z.union([z.number(), z.string()]).optional(),
  consecutive_days: z.number().optional(),
  check: z.string().optional(),
  days: z.number().optional(),
}).passthrough();

const TriggerDefinitionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  display_name: z.string().nullable(),
  description: z.string().nullable(),
  source_table: z.string(),
  source_event: z.string(),
  condition: TriggerConditionSchema,
  action_type: z.enum(["analyze", "alert", "story_entry", "notification", "escalation"]),
  agent_name: z.string().nullable(),
  workflow_name: z.string().nullable(),
  action_config: z.record(z.unknown()),
  target_roles: z.array(z.string()).nullable(),
  priority: z.enum(["low", "normal", "high", "critical"]),
  is_active: z.boolean(),
  cooldown_minutes: z.number(),
  metadata: z.record(z.unknown()).nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const TriggerDefinitionDetailSchema = TriggerDefinitionSchema.extend({
  created_by: z.string().uuid().nullable(),
  updated_by: z.string().uuid().nullable(),
});

const ProactiveRunSchema = z.object({
  id: z.string().uuid(),
  trigger_definition_id: z.string().uuid(),
  trigger_name: z.string().nullable(),
  user_id: z.string().uuid(),
  source_record_id: z.string().uuid().nullable(),
  status: z.enum(["pending", "running", "completed", "failed", "skipped", "cooldown"]),
  action_taken: z.string().nullable(),
  output_text: z.string().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  duration_ms: z.number().nullable(),
  tokens_input: z.number().nullable(),
  tokens_output: z.number().nullable(),
  error_message: z.string().nullable(),
  created_at: z.string(),
});

const ScheduledJobSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  display_name: z.string().nullable(),
  description: z.string().nullable(),
  cron_expression: z.string(),
  job_type: z.string(),
  agent_name: z.string().nullable(),
  workflow_name: z.string().nullable(),
  job_config: z.record(z.unknown()),
  is_active: z.boolean(),
  last_run_at: z.string().nullable(),
  last_run_status: z.string().nullable(),
  last_run_duration_ms: z.number().nullable(),
  next_run_at: z.string().nullable(),
  total_runs: z.number().nullable(),
  successful_runs: z.number().nullable(),
  failed_runs: z.number().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  created_at: z.string(),
});

// ============================================================================
// Exported Types
// ============================================================================

/** Proactive trigger definition (admin view). */
export type TriggerDefinition = z.infer<typeof TriggerDefinitionSchema>;

/** Proactive trigger definition detail (admin view). */
export type TriggerDefinitionDetail = z.infer<typeof TriggerDefinitionDetailSchema>;

/** Proactive trigger run (admin view). */
export type ProactiveRun = z.infer<typeof ProactiveRunSchema>;

/** Scheduled job definition (admin view). */
export type ScheduledJob = z.infer<typeof ScheduledJobSchema>;

/** Trigger condition shape. */
export type TriggerCondition = z.infer<typeof TriggerConditionSchema>;

// ============================================================================
// Query Keys
// ============================================================================

/** Query key factory for proactive trigger hooks. */
export const aiProactiveKeys = {
  triggers: ["ai-proactive-triggers"] as const,
  trigger: (id: string) => ["ai-proactive-trigger", id] as const,
  runs: (filters?: Record<string, unknown>) => ["ai-proactive-runs", filters] as const,
  scheduledJobs: ["ai-scheduled-jobs"] as const,
};

// ============================================================================
// Safe parse helper
// ============================================================================

function parseRpcArraySafe<T>(
  data: unknown,
  schema: z.ZodType<T>,
): T[] {
  if (!Array.isArray(data)) return [];
  const results = data.map((item) => schema.safeParse(item));
  const dropped = results.filter((r) => !r.success).length;
  if (dropped > 0) {
    safeError("parseRpcArraySafe.dropped", { dropped, total: data.length });
  }
  return results
    .filter((r): r is z.SafeParseSuccess<T> => r.success)
    .map((r) => r.data);
}

// ============================================================================
// Hooks: Trigger Definitions
// ============================================================================

/**
 * Hook to list all proactive trigger definitions (admin).
 *
 * @returns Query result with array of trigger definitions.
 * @example
 * const { data: triggers } = useAiTriggers();
 */
export function useAiTriggers() {
  const { hasPermission } = usePermissions();

  return useQuery({
    queryKey: aiProactiveKeys.triggers,
    queryFn: async (): Promise<TriggerDefinition[]> => {
      const { data, error } = await aisha.rpc("get_ai_triggers_admin");
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(data, TriggerDefinitionSchema);
    },
    enabled: hasPermission("manage_ai_settings"),
    staleTime: 30_000,
  });
}

/**
 * Hook to get a single proactive trigger definition (admin).
 *
 * @param triggerId - UUID of the trigger definition.
 * @returns Query result with trigger definition detail.
 * @example
 * const { data: trigger } = useAiTrigger(triggerId);
 */
export function useAiTrigger(triggerId: string | undefined) {
  const { hasPermission } = usePermissions();

  return useQuery({
    queryKey: aiProactiveKeys.trigger(triggerId ?? ""),
    queryFn: async (): Promise<TriggerDefinitionDetail | null> => {
      if (!triggerId) return null;
      const { data, error } = await aisha.rpc("get_ai_trigger_admin", {
        p_trigger_id: triggerId,
      });
      if (error) throw new Error(error.message);
      const results = parseRpcArraySafe(data, TriggerDefinitionDetailSchema);
      return results[0] ?? null;
    },
    enabled: !!triggerId && hasPermission("manage_ai_settings"),
    staleTime: 30_000,
  });
}

/**
 * Hook to create a new proactive trigger definition (admin).
 *
 * @returns Mutation to create a new trigger.
 * @example
 * const { mutateAsync: create } = useCreateAiTrigger();
 * await create({ name: "high_pain", display_name: "High Pain", source_table: "health_check_ins" });
 */
export function useCreateAiTrigger() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      name: string;
      display_name: string;
      source_table: string;
      source_event?: string;
      condition?: Record<string, unknown>;
      action_type?: string;
      agent_name?: string;
      workflow_name?: string;
      action_config?: Record<string, unknown>;
      target_roles?: string[];
      priority?: string;
      is_active?: boolean;
      cooldown_minutes?: number;
      description?: string;
      metadata?: Record<string, unknown>;
    }): Promise<string> => {
      const { data, error } = await aisha.rpc("create_ai_trigger_admin", {
        p_action_config: (params.action_config ?? {}) as unknown as Json,
        p_action_type: params.action_type ?? "analyze",
        p_agent_name: params.agent_name ?? undefined,
        p_condition: (params.condition ?? {}) as unknown as Json,
        p_cooldown_minutes: params.cooldown_minutes ?? 1440,
        p_description: params.description ?? "",
        p_display_name: params.display_name,
        p_is_active: params.is_active ?? false,
        p_metadata: (params.metadata ?? {}) as unknown as Json,
      
        p_name: params.name,
        p_priority: params.priority ?? "normal",
        p_source_event: params.source_event ?? "INSERT",
        p_source_table: params.source_table,
        p_target_roles: params.target_roles ?? ["member"],
        p_workflow_name: params.workflow_name ?? undefined,});
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: aiProactiveKeys.triggers });
    },
    onError: (err) => {
      safeError("useCreateAiTrigger.failed", err);
    },
  });
}

/**
 * Hook to update a proactive trigger definition (admin).
 *
 * @returns Mutation to update a trigger.
 * @example
 * const { mutateAsync: update } = useUpdateAiTrigger();
 * await update({ trigger_id: "...", is_active: true });
 */
export function useUpdateAiTrigger() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      trigger_id: string;
      display_name?: string;
      description?: string;
      condition?: Record<string, unknown>;
      action_type?: string;
      agent_name?: string;
      workflow_name?: string;
      action_config?: Record<string, unknown>;
      target_roles?: string[];
      priority?: string;
      is_active?: boolean;
      cooldown_minutes?: number;
      metadata?: Record<string, unknown>;
    }): Promise<void> => {
      const { error } = await aisha.rpc("update_ai_trigger_admin", {
        p_action_config: (params.action_config ?? undefined) as unknown as Json | undefined,
        p_action_type: params.action_type ?? undefined,
        p_agent_name: params.agent_name ?? undefined,
        p_condition: (params.condition ?? undefined) as unknown as Json | undefined,
        p_cooldown_minutes: params.cooldown_minutes ?? undefined,
        p_description: params.description ?? undefined,
        p_display_name: params.display_name ?? undefined,
        p_is_active: params.is_active ?? undefined,
        p_metadata: (params.metadata ?? undefined) as unknown as Json | undefined,
      
        p_priority: params.priority ?? undefined,
        p_target_roles: params.target_roles ?? undefined,
        p_trigger_id: params.trigger_id,
        p_workflow_name: params.workflow_name ?? undefined,});
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: aiProactiveKeys.triggers });
    },
    onError: (err) => {
      safeError("useUpdateAiTrigger.failed", err);
    },
  });
}

/**
 * Hook to delete a proactive trigger definition (admin).
 *
 * @returns Mutation to delete a trigger.
 * @example
 * const { mutateAsync: deleteTrigger } = useDeleteAiTrigger();
 * await deleteTrigger("trigger-uuid");
 */
export function useDeleteAiTrigger() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (triggerId: string): Promise<void> => {
      const { error } = await aisha.rpc("delete_ai_trigger_admin", {
        p_trigger_id: triggerId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: aiProactiveKeys.triggers });
    },
    onError: (err) => {
      safeError("useDeleteAiTrigger.failed", err);
    },
  });
}

// ============================================================================
// Hooks: Proactive Runs
// ============================================================================

/**
 * Hook to list proactive trigger run history (admin).
 *
 * @param filters - Optional filters: trigger_id, user_id, status, limit.
 * @returns Query result with array of proactive runs.
 * @example
 * const { data: runs } = useProactiveRuns({ status: "completed", limit: 20 });
 */
export function useProactiveRuns(filters?: {
  trigger_id?: string;
  user_id?: string;
  status?: string;
  limit?: number;
}) {
  const { hasPermission } = usePermissions();

  return useQuery({
    queryKey: aiProactiveKeys.runs(filters),
    queryFn: async (): Promise<ProactiveRun[]> => {
      const { data, error } = await aisha.rpc("get_proactive_runs_admin", {
        p_limit: filters?.limit ?? 50,
      
        p_status: filters?.status ?? undefined,
        p_trigger_id: filters?.trigger_id ?? undefined,
        p_user_id: filters?.user_id ?? undefined,});
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(data, ProactiveRunSchema);
    },
    enabled: hasPermission("manage_ai_settings"),
    staleTime: 15_000,
  });
}

// ============================================================================
// Hooks: Scheduled Jobs
// ============================================================================

/**
 * Hook to list all scheduled AI jobs (admin).
 *
 * @returns Query result with array of scheduled job definitions.
 * @example
 * const { data: jobs } = useAiScheduledJobs();
 */
export function useAiScheduledJobs() {
  const { hasPermission } = usePermissions();

  return useQuery({
    queryKey: aiProactiveKeys.scheduledJobs,
    queryFn: async (): Promise<ScheduledJob[]> => {
      const { data, error } = await aisha.rpc("get_ai_scheduled_jobs_admin");
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(data, ScheduledJobSchema);
    },
    enabled: hasPermission("manage_ai_settings"),
    staleTime: 30_000,
  });
}

/**
 * Hook to create a new scheduled AI job (admin).
 *
 * @returns Mutation to create a scheduled job.
 * @example
 * const { mutateAsync: createJob } = useCreateAiScheduledJob();
 * await createJob({ name: "daily_insights", display_name: "Daily Insights", cron_expression: "0 8 * * *" });
 */
export function useCreateAiScheduledJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      name: string;
      display_name: string;
      cron_expression: string;
      job_type?: string;
      agent_name?: string;
      workflow_name?: string;
      job_config?: Record<string, unknown>;
      is_active?: boolean;
      description?: string;
      metadata?: Record<string, unknown>;
    }): Promise<string> => {
      const { data, error } = await aisha.rpc("create_ai_scheduled_job_admin", {
        p_agent_name: params.agent_name ?? undefined,
        p_cron_expression: params.cron_expression,
        p_description: params.description ?? "",
        p_display_name: params.display_name,
        p_is_active: params.is_active ?? false,
        p_job_config: (params.job_config ?? {}) as unknown as Json,
        p_job_type: params.job_type ?? "ai_analysis",
        p_metadata: (params.metadata ?? {}) as unknown as Json,
      
        p_name: params.name,
        p_workflow_name: params.workflow_name ?? undefined,});
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: aiProactiveKeys.scheduledJobs });
    },
    onError: (err) => {
      safeError("useCreateAiScheduledJob.failed", err);
    },
  });
}
