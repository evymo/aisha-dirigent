import { useQuery, queryOptions } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import type { Database } from "@/integrations/db/types";
import { parseRpcArray, auditStatsRowSchema } from "@/lib/validation/rpcSchemas";

export type JournalActionType = Database["public"]["Enums"]["journal_action_type"];
export type JournalSeverity = Database["public"]["Enums"]["journal_severity"];
export type JournalArea = Database["public"]["Enums"]["journal_area"];
export type AuditJournalEntry = Database["public"]["Functions"]["get_audit_journal"]["Returns"][number];

export interface UseAuditJournalFilters {
  area?: JournalArea;
  severity?: JournalSeverity;
  actionType?: JournalActionType;
  entityType?: string;
  startDate?: Date;
  endDate?: Date;
  search?: string;
  limit?: number;
}

/**
 * Query options for audit journal - compatible with data router
 */
export function auditJournalQueryOptions(filters: UseAuditJournalFilters = {}) {
  const { limit = 100 } = filters;

  return queryOptions({
    queryKey: ['audit-journal', filters] as const,
    queryFn: async (): Promise<AuditJournalEntry[]> => {
      // RPC-only: use get_audit_journal function - send undefined for optional params
      const { data, error } = await aisha.rpc("get_audit_journal", {
        p_action_type: filters.actionType,
        p_area: filters.area,
        p_end_date: filters.endDate?.toISOString(),
        p_entity_type: filters.entityType,
        p_limit: limit
,
        p_search: filters.search,
        p_severity: filters.severity,
        p_start_date: filters.startDate?.toISOString()
    });

      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

/**
 * Query options for audit journal 24h stats - compatible with data router
 */
export function auditJournalStatsQueryOptions() {
  return queryOptions({
    queryKey: ['audit-journal-stats'] as const,
    queryFn: async () => {
      // RPC-only: use get_audit_journal_stats_24h function
      const { data, error } = await aisha.rpc("get_audit_journal_stats_24h");

      if (error) throw new Error(error.message);

      // Validate with Zod schema
      const validatedData = parseRpcArray(auditStatsRowSchema, data, "get_audit_journal_stats_24h");

      const stats = {
        total: 0,
        byArea: {} as Record<string, number>,
        bySeverity: {} as Record<string, number>,
        byAction: {} as Record<string, number>,
      };

      // Aggregate validated entries
      // SQL returns: action, area, severity, count
      validatedData.forEach((entry) => {
        const count = entry.count;
        stats.total += count;
        if (entry.area) {
          stats.byArea[entry.area] = (stats.byArea[entry.area] || 0) + count;
        }
        if (entry.severity) {
          stats.bySeverity[entry.severity] = (stats.bySeverity[entry.severity] || 0) + count;
        }
        if (entry.action) {
          stats.byAction[entry.action] = (stats.byAction[entry.action] || 0) + count;
        }
      });

      return stats;
    },
  });
}

/**
 * Hook to fetch audit journal entries with filtering.
 * Uses RPC `get_audit_journal` for secure access to audit logs.
 *
 * @param filters - Optional filters for area, severity, action type, date range, etc.
 * @returns Query object containing list of audit journal entries.
 */
export function useAuditJournal(filters: UseAuditJournalFilters = {}) {
  return useQuery(auditJournalQueryOptions(filters));
}

/**
 * Hook to fetch 24-hour statistics for audit journal.
 * Aggregates counts by area, severity, and action type.
 *
 * @returns Query object containing audit statistics.
 */
export function useAuditJournalStats() {
  return useQuery(auditJournalStatsQueryOptions());
}
