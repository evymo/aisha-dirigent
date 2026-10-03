/**
 * Hooks for Guild of Experts — guild members, expertise areas.
 *
 * @module hooks/useGuild
 */

import { useQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { parseRpcArray } from "@/lib/validation/rpcSchemas";
import {
  expertiseAreaSchema,
  guildMemberSchema,
  guildMemberDetailSchema,
  expertiseEntrySchema,
  type ExpertiseArea,
  type GuildMember,
  type GuildMemberDetail,
  type ExpertiseEntry,
} from "@/lib/schemas/guildSchemas";
import { z } from "zod";

// =============================================================================
// Query Keys
// =============================================================================

export const guildKeys = {
  all: ["guild"] as const,
  expertiseAreas: () => ["guild", "expertise-areas"] as const,
  members: (filters: Record<string, unknown>) => ["guild", "members", filters] as const,
  memberDetail: (partnerId: string) => ["guild", "member", partnerId] as const,
};

// =============================================================================
// Query Options (for route loaders)
// =============================================================================

/**
 * Query options for expertise areas list.
 * Can be used in route loaders for prefetching.
 */
export const expertiseAreasQueryOptions = () =>
  queryOptions({
    queryKey: guildKeys.expertiseAreas(),
    queryFn: async (): Promise<ExpertiseArea[]> => {
      const { data, error } = await aisha.rpc("get_expertise_areas");
      if (error) throw new Error(error.message);
      return parseRpcArray(expertiseAreaSchema, data, "get_expertise_areas");
    },
    staleTime: 5 * 60 * 1000, // 5 minutes — rarely changes
  });

/**
 * Query options for guild members list.
 */
export const guildMembersQueryOptions = (opts?: {
  expertiseSlug?: string;
  search?: string;
  limit?: number;
  offset?: number;
}) =>
  queryOptions({
    queryKey: guildKeys.members({
      expertiseSlug: opts?.expertiseSlug,
      search: opts?.search,
      limit: opts?.limit,
      offset: opts?.offset,
    }),
    queryFn: async (): Promise<GuildMember[]> => {
      const { data, error } = await aisha.rpc("get_guild_members", {
        p_expertise_slug: opts?.expertiseSlug ?? undefined,
        p_limit: opts?.limit ?? 50,
        p_offset: opts?.offset ?? 0,
      
        p_search: opts?.search ?? undefined,});
      if (error) throw new Error(error.message);
      return parseRpcArray(guildMemberSchema, data, "get_guild_members") as GuildMember[];
    },
    staleTime: 2 * 60 * 1000,
  });

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook to fetch all active expertise areas.
 *
 * @returns Query with expertise areas including member/rule counts.
 */
export function useExpertiseAreas() {
  return useQuery(expertiseAreasQueryOptions());
}

/**
 * Hook to fetch guild members with optional filtering.
 *
 * @param opts - Filter options: expertiseSlug, search, limit, offset.
 * @returns Query with guild members list.
 */
export function useGuildMembers(opts?: {
  expertiseSlug?: string;
  search?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery(guildMembersQueryOptions(opts));
}

/**
 * Hook to fetch a single guild member's detail profile.
 *
 * @param partnerId - UUID of the partner profile.
 * @returns Query with full guild member detail including expertise + published rules.
 */
export function useGuildMemberDetail(partnerId: string | undefined) {
  return useQuery({
    queryKey: guildKeys.memberDetail(partnerId ?? ""),
    queryFn: async (): Promise<GuildMemberDetail | null> => {
      if (!partnerId) return null;
      const { data, error } = await aisha.rpc("get_guild_member_detail", {
        p_partner_id: partnerId,
      });
      if (error) throw new Error(error.message);
      if (!data || (Array.isArray(data) && data.length === 0)) return null;
      const row = Array.isArray(data) ? data[0] : data;
      return guildMemberDetailSchema.parse(row);
    },
    enabled: !!partnerId,
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Hook for partner to manage their own expertise areas.
 *
 * @returns Mutation to set/update expertise entries.
 */
export function useManageGuildExpertise() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (entries: ExpertiseEntry[]) => {
      // Validate entries before sending
      const validated = z.array(expertiseEntrySchema).parse(entries);

      const { error } = await aisha.rpc("manage_guild_member_expertise", {
        p_expertise_entries: JSON.parse(JSON.stringify(validated)),
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: guildKeys.all });
    },
    onError: (error) => {
      safeError("useManageExpertise.failed", error);
    },
  });
}
