/**
 * useSpendGovernance — Mission Control hooks for the spend-authorization lens.
 *
 *   useSpendApprovals     — runs blocked at admission awaiting human decision
 *                           (list_pending_spend_approvals + ai_runs realtime)
 *   useApproveTaskSpend   — approve_task_spend_audited (optional budget raise)
 *   useRejectTaskSpend    — reject_task_spend_audited
 *   useSpendPolicies      — list_ai_spend_policies (policy editor)
 *   useSetSpendPolicy     — set_ai_spend_policy_audited (upsert thresholds)
 *
 * All write paths go through audited SECURITY DEFINER RPCs (admin/staff
 * enforced server-side); the UI is only the affordance.
 *
 * @module hooks/useSpendGovernance
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { useLiveTable } from "@/hooks/useLiveTable";

// ============================================================================
// Schemas
// ============================================================================

const SpendApprovalSchema = z.object({
  run_id: z.string().uuid(),
  kind: z.string(),
  story_id: z.string().uuid().nullable(),
  story_title: z.string().nullable(),
  requested_at: z.string(),
  age_ms: z.number().int(),
  estimate: z.number().nullable(),
  decision_reason: z.string().nullable(),
  authorization_json: z.unknown().nullable(),
});

const SpendApprovalArraySchema = z.array(SpendApprovalSchema);

export type SpendApproval = z.infer<typeof SpendApprovalSchema>;

const SpendPolicySchema = z.object({
  policy_id: z.string().uuid(),
  scope_type: z.string(),
  scope_id: z.string().uuid().nullable(),
  story_title: z.string().nullable(),
  task_kind: z.string().nullable(),
  auto_allow_under: z.number().nullable(),
  ask_over: z.number().nullable(),
  deny_over: z.number().nullable(),
  is_active: z.boolean(),
  updated_at: z.string(),
});

const SpendPolicyArraySchema = z.array(SpendPolicySchema);

export type SpendPolicy = z.infer<typeof SpendPolicySchema>;

// ============================================================================
// Queries
// ============================================================================

export function useSpendApprovals(opts: { limit?: number; enabled?: boolean } = {}) {
  const { limit = 20, enabled = true } = opts;
  return useLiveTable<SpendApproval>({
    table: "ai_runs",
    queryKey: ["spend_approvals", limit],
    enabled,
    rpc: async () => {
      const { data, error } = await aisha.rpc("list_pending_spend_approvals", {
        p_limit: limit,
      });
      if (error) {
        safeError("useSpendApprovals", error);
        throw new Error(error.message);
      }
      const parsed = SpendApprovalArraySchema.safeParse(data);
      if (!parsed.success) {
        safeError("useSpendApprovals:parse", parsed.error);
        return [];
      }
      return parsed.data;
    },
  });
}

export function useSpendPolicies(opts: { enabled?: boolean } = {}) {
  const { enabled = true } = opts;
  return useQuery({
    queryKey: ["spend_policies"],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<SpendPolicy[]> => {
      const { data, error } = await aisha.rpc("list_ai_spend_policies");
      if (error) {
        safeError("useSpendPolicies", error);
        throw new Error(error.message);
      }
      const parsed = SpendPolicyArraySchema.safeParse(data);
      if (!parsed.success) {
        safeError("useSpendPolicies:parse", parsed.error);
        return [];
      }
      return parsed.data;
    },
  });
}

// ============================================================================
// Mutations
// ============================================================================

export function useApproveTaskSpend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { runId: string; raiseBudgetUsd?: number; note?: string }) => {
      const { data, error } = await aisha.rpc("approve_task_spend_audited", {
        p_note: input.note ?? undefined,
        p_raise_budget: input.raiseBudgetUsd ?? undefined,
        p_run_id: input.runId,
      });
      if (error) {
        safeError("useApproveTaskSpend", error);
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["spend_approvals"] });
      queryClient.invalidateQueries({ queryKey: ["active_agent_runs"] });
    },
  });
}

export function useRejectTaskSpend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { runId: string; reason?: string }) => {
      const { data, error } = await aisha.rpc("reject_task_spend_audited", {
        p_reason: input.reason ?? undefined,
        p_run_id: input.runId,
      });
      if (error) {
        safeError("useRejectTaskSpend", error);
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["spend_approvals"] });
    },
  });
}

export function useSetSpendPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      scopeType?: "global" | "story" | "partner";
      scopeId?: string | null;
      taskKind?: string | null;
      autoAllowUnderUsd?: number | null;
      askOverUsd?: number | null;
      denyOverUsd?: number | null;
      deactivate?: boolean;
    }) => {
      const { data, error } = await aisha.rpc("set_ai_spend_policy_audited", {
        p_ask_over: input.askOverUsd ?? undefined,
        p_auto_allow_under: input.autoAllowUnderUsd ?? undefined,
        p_deactivate: input.deactivate ?? undefined,
        p_deny_over: input.denyOverUsd ?? undefined,
        p_scope_id: input.scopeId ?? undefined,
        p_scope_type: input.scopeType ?? undefined,
        p_task_kind: input.taskKind ?? undefined,
      });
      if (error) {
        safeError("useSetSpendPolicy", error);
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["spend_policies"] });
    },
  });
}
