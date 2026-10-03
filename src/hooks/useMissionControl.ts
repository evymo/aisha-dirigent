/**
 * useMissionControl — hook collection for the mission-control landing.
 *
 * Bundles the five live data sources for the six panes (kanban-mini reuses
 * useKanbanBoard). Each hook leverages useLiveTable for refcounted realtime
 * subscriptions where appropriate.
 *
 *   useLiveAgentRuns   — list_active_agent_runs   (ai_runs UPDATE)
 *   useDeployState     — get_active_slots         (coolify_app_slots UPDATE)
 *   useDriftCount      — get_unresolved_drift_count (drift_state INSERT)
 *   useRollbackBoard   — get_pending_rollback_count + get_rollback_history
 *                                                  (rollback_history UPDATE)
 *   useAuditFeed       — get_audit_journal (filtered to severity ≥ warning)
 *                                                  (audit_journal INSERT)
 *
 * @module hooks/useMissionControl
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { useLiveTable } from "@/hooks/useLiveTable";

// ============================================================================
// 1. useLiveAgentRuns — list_active_agent_runs + ai_runs realtime
// ============================================================================

const ActiveAgentRunSchema = z.object({
  run_id: z.string().uuid(),
  kind: z.string(),
  story_id: z.string().uuid().nullable(),
  story_title: z.string().nullable(),
  is_stack_default: z.boolean(),
  status: z.string(),
  started_at: z.string(),
  elapsed_ms: z.number().int(),
  current_agent_slug: z.string().nullable(),
  current_step: z.string().nullable(),
  step_count: z.number().int(),
  cost_total: z.number().nullable(),
});

const ActiveAgentRunArraySchema = z.array(ActiveAgentRunSchema);

export type ActiveAgentRun = z.infer<typeof ActiveAgentRunSchema>;

export function useLiveAgentRuns(opts: { limit?: number; enabled?: boolean } = {}) {
  const { limit = 20, enabled = true } = opts;
  return useLiveTable<ActiveAgentRun>({
    table: "ai_runs",
    queryKey: ["active_agent_runs", limit],
    enabled,
    rpc: async () => {
      const { data, error } = await aisha.rpc("list_active_agent_runs", {
        p_limit: limit,
      });
      if (error) {
        safeError("useLiveAgentRuns", error);
        throw error;
      }
      return ActiveAgentRunArraySchema.parse(data ?? []);
    },
  });
}

// ============================================================================
// 1b. useClaudeApprovals — list_pending_claude_approvals + approve_claude_run
//     A claude_cli_task whose fn_admit_clow verdict was 'ask' is held pending
//     approval; this surfaces the queue + the approve action (Mission Control).
// ============================================================================

const PendingClaudeApprovalSchema = z.object({
  run_id: z.string().uuid(),
  story_id: z.string().uuid().nullable(),
  source: z.string().nullable(),
  awaiting: z.string().nullable(),
  decision_id: z.string().uuid().nullable(),
  risk_level: z.string().nullable(),
  requested_by: z.string().uuid().nullable(),
  created_at: z.string(),
});

const PendingClaudeApprovalArraySchema = z.array(PendingClaudeApprovalSchema);

export type PendingClaudeApproval = z.infer<typeof PendingClaudeApprovalSchema>;

export function useClaudeApprovals(opts: { enabled?: boolean } = {}) {
  const { enabled = true } = opts;
  return useLiveTable<PendingClaudeApproval>({
    table: "agent_runs",
    queryKey: ["pending_claude_approvals"],
    enabled,
    rpc: async () => {
      const { data, error } = await aisha.rpc("list_pending_claude_approvals");
      if (error) {
        safeError("useClaudeApprovals", error);
        throw error;
      }
      return PendingClaudeApprovalArraySchema.parse(data ?? []);
    },
  });
}

/** Approve a held claude_cli_task — clears the hold so the poller drains it.
 *  Invalidates the pending-approvals query so the row drops out on success. */
export function useApproveClaudeRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const { error } = await aisha.rpc("approve_claude_run", { p_run_id: runId });
      if (error) {
        safeError("useApproveClaudeRun", error);
        throw error;
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["pending_claude_approvals"] });
    },
  });
}

// ============================================================================
// 2. useDeployState — get_active_slots + coolify_app_slots realtime
// ============================================================================

const DeploySlotSchema = z.object({
  app_name: z.string(),
  active_slot: z.string(),
  active_image_tag: z.string().nullable(),
  active_health: z.string().nullable(),
  inactive_slot: z.string().nullable(),
  inactive_image_tag: z.string().nullable(),
  inactive_health: z.string().nullable(),
  last_switch_at: z.string().nullable(),
  last_switch_by: z.string().uuid().nullable(),
  switch_lock: z.boolean(),
  switch_lock_age_min: z.number().int().nullable(),
  domain: z.string().nullable(),
  story_id: z.string().uuid().nullable(),
  managed_kind: z.string().nullable(),
});

const DeploySlotArraySchema = z.array(DeploySlotSchema);

export type DeploySlot = z.infer<typeof DeploySlotSchema>;

export function useDeployState(opts: { enabled?: boolean } = {}) {
  const { enabled = true } = opts;
  return useLiveTable<DeploySlot>({
    table: "coolify_app_slots",
    queryKey: ["deploy_state"],
    enabled,
    rpc: async () => {
      const { data, error } = await aisha.rpc("get_active_slots");
      if (error) {
        safeError("useDeployState", error);
        throw error;
      }
      return DeploySlotArraySchema.parse(data ?? []);
    },
  });
}

// ============================================================================
// 3. useDriftCount — get_unresolved_drift_count + drift_state realtime
// ============================================================================

const DriftCountSchema = z.number().int();

export function useDriftCount(
  opts: { minRisk?: "low" | "medium" | "high" | "critical"; enabled?: boolean } = {},
) {
  const { minRisk = "low", enabled = true } = opts;
  return useLiveTable<{ count: number }>({
    table: "drift_state",
    queryKey: ["drift_count", minRisk],
    enabled,
    rpc: async () => {
      const { data, error } = await aisha.rpc("get_unresolved_drift_count", {
        p_min_risk: minRisk,
      });
      if (error) {
        safeError("useDriftCount", error);
        throw error;
      }
      const n = DriftCountSchema.parse(typeof data === "number" ? data : Number(data));
      // useLiveTable wraps array; wrap scalar count as single-element list.
      return [{ count: n }];
    },
  });
}

// ============================================================================
// 4. useRollbackBoard — get_pending_rollback_count + get_rollback_history
// ============================================================================

const RollbackHistoryRowSchema = z.object({
  id: z.string().uuid(),
  app_name: z.string(),
  triggered_at: z.string(),
  triggered_by: z.string(),
  from_slot: z.string(),
  to_slot: z.string(),
  from_image_tag: z.string().nullable(),
  to_image_tag: z.string().nullable(),
  approval_status: z.string(),
  approved_by: z.string().uuid().nullable(),
  approved_at: z.string().nullable(),
  executed_at: z.string().nullable(),
  execution_status: z.string().nullable(),
  age_minutes: z.number().int().nullable(),
});

const RollbackHistoryArraySchema = z.array(RollbackHistoryRowSchema);

export type RollbackHistoryRow = z.infer<typeof RollbackHistoryRowSchema>;

const RollbackBoardEntrySchema = z.object({
  pending_count: z.number().int(),
  history: RollbackHistoryArraySchema,
});

type RollbackBoardEntry = z.infer<typeof RollbackBoardEntrySchema>;

export function useRollbackBoard(opts: { historyLimit?: number; enabled?: boolean } = {}) {
  const { historyLimit = 5, enabled = true } = opts;
  return useLiveTable<RollbackBoardEntry>({
    table: "rollback_history",
    queryKey: ["rollback_board", historyLimit],
    enabled,
    rpc: async () => {
      const [countRes, historyRes] = await Promise.all([
        aisha.rpc("get_pending_rollback_count"),
        aisha.rpc("get_rollback_history", { p_limit: historyLimit }),
      ]);
      if (countRes.error) {
        safeError("useRollbackBoard.count", countRes.error);
        throw countRes.error;
      }
      if (historyRes.error) {
        safeError("useRollbackBoard.history", historyRes.error);
        throw historyRes.error;
      }
      const pending = typeof countRes.data === "number"
        ? countRes.data
        : Number(countRes.data ?? 0);
      const history = RollbackHistoryArraySchema.parse(historyRes.data ?? []);
      return [{ pending_count: pending, history }];
    },
  });
}

// ============================================================================
// 5. useAuditFeed — get_audit_journal filtered to severity ≥ warning
// ============================================================================

const AuditJournalRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid().nullable(),
  user_email: z.string().nullable(),
  user_role: z.string().nullable(),
  action_type: z.string(),
  entity_type: z.string().nullable(),
  entity_id: z.string().nullable(),
  area: z.string().nullable(),
  severity: z.string(),
  summary: z.string().nullable(),
  details: z.unknown().nullable(),
  // additional fields exist (old_values, new_values, etc.); we ignore the
  // tail to keep the wire payload tight. Zod strips unknowns by default.
});

const AuditJournalArraySchema = z.array(AuditJournalRowSchema);

export type AuditJournalRow = z.infer<typeof AuditJournalRowSchema>;

const ELEVATED_SEVERITIES = new Set(["warning", "warn", "error", "critical"]);

export function useAuditFeed(opts: { limit?: number; enabled?: boolean } = {}) {
  const { limit = 20, enabled = true } = opts;
  return useLiveTable<AuditJournalRow>({
    table: "audit_journal",
    queryKey: ["audit_feed", limit],
    enabled,
    rpc: async () => {
      const { data, error } = await aisha.rpc("get_audit_journal", {
        p_limit: limit * 5, // overfetch since we client-filter for severity
      });
      if (error) {
        safeError("useAuditFeed", error);
        throw error;
      }
      const rows = AuditJournalArraySchema.parse(data ?? []);
      return rows
        .filter((r) => ELEVATED_SEVERITIES.has(r.severity.toLowerCase()))
        .slice(0, limit);
    },
  });
}
