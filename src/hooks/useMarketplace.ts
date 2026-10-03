/**
 * Hooks for Marketplace — browse specialists, pricing, availability.
 *
 * @module hooks/useMarketplace
 */

import { useQuery, queryOptions } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import {
  marketplaceListResponseSchema,
  type MarketplaceMember,
  type MarketplaceListResponse,
} from "@/lib/schemas/marketplaceSchemas";
import type { Database } from "@/integrations/db/types";

type AvailabilityStatus = Database["public"]["Enums"]["availability_status"];

// =============================================================================
// Query Keys
// =============================================================================

export const marketplaceKeys = {
  all: ["marketplace"] as const,
  members: (filters: MarketplaceFilters) =>
    ["marketplace", "members", filters] as const,
};

// =============================================================================
// Types
// =============================================================================

export interface MarketplaceFilters {
  expertiseSlug?: string;
  search?: string;
  minRating?: number;
  minHourlyRate?: number;
  maxHourlyRate?: number;
  availability?: AvailabilityStatus;
  instantBooking?: boolean;
  sortBy?: "relevance" | "price_asc" | "price_desc" | "rating" | "activity";
  limit?: number;
  offset?: number;
}

// =============================================================================
// Query Options
// =============================================================================

/**
 * Query options for marketplace specialist listing.
 * Can be used in route loaders for prefetching.
 */
export const marketplaceMembersQueryOptions = (filters: MarketplaceFilters = {}) =>
  queryOptions({
    queryKey: marketplaceKeys.members(filters),
    queryFn: async (): Promise<MarketplaceListResponse> => {
      const { data, error } = await aisha.rpc("get_guild_members_marketplace", {
        p_availability_status: filters.availability ?? undefined,
        p_expertise_slug: filters.expertiseSlug ?? undefined,
        p_instant_booking: filters.instantBooking ?? undefined,
        p_limit: filters.limit ?? 20,
        p_max_hourly_rate: filters.maxHourlyRate ?? undefined,
        p_min_hourly_rate: filters.minHourlyRate ?? undefined,
        p_min_rating: filters.minRating ?? undefined,
        p_offset: filters.offset ?? 0,
        p_search: filters.search ?? undefined,
        p_sort_by: filters.sortBy ?? "relevance",
      });

      if (error) {
        safeError("marketplace.fetch", error);
        throw new Error(error.message);
      }

      return marketplaceListResponseSchema.parse(data);
    },
    staleTime: 60 * 1000, // 1 minute
  });

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook to browse marketplace specialists with filtering, sorting, pagination.
 *
 * @param filters - Filter and pagination options.
 * @returns Query with marketplace members list, total count, pagination info.
 *
 * @example
 * const { members, total, isLoading } = useMarketplaceMembers({
 *   expertiseSlug: "react",
 *   sortBy: "rating",
 *   limit: 20,
 * });
 */
export function useMarketplaceMembers(filters: MarketplaceFilters = {}) {
  const query = useQuery(marketplaceMembersQueryOptions(filters));

  return {
    members: query.data?.items ?? [] as MarketplaceMember[],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
