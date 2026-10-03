/**
 * Hook for specialist earnings dashboard — view revenue splits, totals.
 *
 * @module hooks/useSpecialistEarnings
 */

import { useQuery, queryOptions } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import {
  earningsSummarySchema,
  type EarningsSummary,
  type EarningsItem,
} from "@/lib/schemas/marketplaceSchemas";

// =============================================================================
// Query Keys
// =============================================================================

export const earningsKeys = {
  all: ["earnings"] as const,
  summary: (period: string) => ["earnings", "summary", period] as const,
};

// =============================================================================
// Types
// =============================================================================

export type EarningsPeriod = "month" | "quarter" | "year" | "all";

// =============================================================================
// Query Options
// =============================================================================

/**
 * Query options for specialist earnings.
 */
export const earningsQueryOptions = (
  period: EarningsPeriod = "all",
  limit = 20,
  offset = 0
) =>
  queryOptions({
    queryKey: earningsKeys.summary(period),
    queryFn: async (): Promise<EarningsSummary> => {
      const { data, error } = await aisha.rpc("get_my_earnings_audited", {
        p_limit: limit,
        p_offset: offset,
        p_period: period,
      });

      if (error) {
        safeError("earnings.fetch", error);
        throw new Error(error.message);
      }

      return earningsSummarySchema.parse(data);
    },
    staleTime: 30 * 1000, // 30 seconds — earnings change often
  });

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook to view specialist's own earnings dashboard.
 *
 * @param period - Time period filter: 'month', 'quarter', 'year', or 'all'.
 * @param limit - Number of items per page.
 * @param offset - Pagination offset.
 * @returns Earnings summary with totals and itemized list.
 *
 * @example
 * const { totalEarned, totalPending, items, isLoading } = useSpecialistEarnings("month");
 */
export function useSpecialistEarnings(
  period: EarningsPeriod = "all",
  limit = 20,
  offset = 0
) {
  const query = useQuery(earningsQueryOptions(period, limit, offset));

  return {
    totalEarned: query.data?.total_earned_czk ?? 0,
    totalPending: query.data?.total_pending_czk ?? 0,
    grossRevenue: query.data?.gross_revenue_czk ?? 0,
    totalProjects: query.data?.total_projects ?? 0,
    items: query.data?.items ?? ([] as EarningsItem[]),
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
