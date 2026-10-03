import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { z } from "zod";
import { safeError } from "@/lib/security/safeLogger";
import { PUBLIC_QUERY_OPTIONS } from "@/lib/reactQuery/queryDefaults";

/**
 * Schema for public homepage stats RPC response
 */
const publicStatsSchema = z.object({
  member_count: z.number(),
  study_count: z.number(),
  partner_count: z.number(),
  completed_registrations: z.number(),
});

export type PublicStats = z.infer<typeof publicStatsSchema>;

export const publicStatsQueryKey = ["public-homepage-stats"] as const;

export async function fetchPublicStats(): Promise<PublicStats> {
  const { data, error } = await aisha.rpc("get_public_homepage_stats");

  if (error) {
    safeError("PublicStats.fetch", error);
    throw new Error(error.message);
  }

  const parsed = publicStatsSchema.safeParse(data);
  if (!parsed.success) {
    safeError("PublicStats.parse", parsed.error);
    throw new Error("PublicStats.invalidResponse");
  }

  return parsed.data;
}

export function publicStatsQueryOptions() {
  return {
    queryKey: publicStatsQueryKey,
    queryFn: fetchPublicStats,
    ...PUBLIC_QUERY_OPTIONS,
    placeholderData: keepPreviousData,
  } as const;
}

/**
 * Hook for fetching public homepage statistics.
 * Uses RPC-only pattern with Zod validation.
 * No authentication required - uses anon key.
 */
export function usePublicStats() {
  return useQuery(publicStatsQueryOptions());
}
