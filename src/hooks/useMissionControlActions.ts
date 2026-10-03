/**
 * useMissionControlActions — write-side intervention hooks for Mission Control.
 *
 * Mission Control is the *control plane*: it surfaces signals and lets an
 * operator act. These two mutations are the P0 interventions:
 *   - useCancelAiRun  → cancel_ai_run (role-gated, impersonation-aware, audited)
 *   - useSetAiBudget  → set_ai_budget_audited (admin/staff per-scope spend cap)
 *
 * Both go through audited RPCs (RLS + is_admin_or_staff enforced server-side);
 * the UI only exposes the affordance.
 *
 * @module hooks/useMissionControlActions
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";

interface CancelAiRunInput {
  runId: string;
  /** Optional free-text reason recorded in the audit journal. */
  reason?: string;
}

/**
 * Cancel an in-flight ai_run. An admin/staff cancels on the owner's behalf;
 * the run owner cancels their own. Invalidates the live-agents strip + kanban
 * so the stopped run drops out immediately.
 */
export function useCancelAiRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ runId, reason }: CancelAiRunInput) => {
      const { data, error } = await aisha.rpc("cancel_ai_run", {
        p_reason: reason ?? undefined,
        p_run_id: runId,
      });
      if (error) {
        safeError("useCancelAiRun", error);
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["active_agent_runs"] });
      queryClient.invalidateQueries({ queryKey: ["kanban_stories"] });
    },
  });
}

export interface SetAiBudgetInput {
  scopeId: string;
  scopeType?: "story" | "partner" | "agent";
  /** USD ceiling. null clears the cost dimension (uncapped). */
  costUsdLimit?: number | null;
  /** Token ceiling. null clears the token dimension (uncapped). */
  tokenLimit?: number | null;
  period?: "lifetime" | "daily" | "monthly";
}

/**
 * Upsert a per-scope budget cap (default scope = story, period = lifetime).
 * Invalidates the kanban so the new budget chip / state appears.
 */
export function useSetAiBudget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SetAiBudgetInput) => {
      const { data, error } = await aisha.rpc("set_ai_budget_audited", {
        p_cost_limit: input.costUsdLimit ?? undefined,
        p_period: input.period ?? "lifetime",
        p_scope_id: input.scopeId,
        p_scope_type: input.scopeType ?? "story",
        p_token_limit: input.tokenLimit ?? undefined,
      });
      if (error) {
        safeError("useSetAiBudget", error);
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kanban_stories"] });
    },
  });
}
