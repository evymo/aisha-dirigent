/**
 * Hook for managing Context Profiles (admin).
 *
 * Provides list and update operations for AI context profile definitions
 * (token budgets, layer configurations, priority ordering).
 * Uses RPC-only pattern with SECURITY DEFINER + is_admin_or_staff() checks.
 *
 * @module hooks/useContextProfiles
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "./useSession";
import { usePermissions } from "./usePermissions";
import { useAdminGuard } from "./useAdminGuard";
import { safeError } from "@/lib/security/safeLogger";
import {
  contextProfileArraySchema,
  type ContextProfileRow,
} from "@/lib/schemas/expertOverlaySchemas";
import type { Json } from "@/integrations/db/types";

/** Query key factory for context profiles */
export const contextProfileKeys = {
  all: ["context-profiles"] as const,
  list: () => [...contextProfileKeys.all, "list"] as const,
};

/**
 * Hook for fetching all context profiles.
 *
 * @returns Query object with parsed context profile rows.
 * @example
 * const { data: profiles, isLoading } = useContextProfiles();
 */
export function useContextProfiles() {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: contextProfileKeys.list(),
    queryFn: async (): Promise<ContextProfileRow[]> => {
      if (!isAdmin) return [];

      const { data, error } = await aisha.rpc("get_context_profiles_admin");

      if (error) {
        safeError("useContextProfiles.fetch", error);
        throw new Error(error.message);
      }

      return contextProfileArraySchema.parse(data ?? []);
    },
    enabled: !!user && isAdmin,
    staleTime: 30_000,
  });
}

/**
 * Input type for updating a context profile.
 */
export interface ContextProfileUpdateInput {
  display_name?: string;
  description?: string | null;
  token_budget?: number;
  is_active?: boolean;
  layers?: Record<string, unknown>;
}

/**
 * Hook for updating a context profile.
 *
 * @returns Mutation for updating context profile fields.
 * @example
 * const { mutateAsync } = useUpdateContextProfile();
 * await mutateAsync({ id: profileId, updates: { token_budget: 16000 } });
 */
export function useUpdateContextProfile() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation(
      "update_context_profile_admin",
      async ({ id, updates }: { id: string; updates: ContextProfileUpdateInput }) => {
        const { data, error } = await aisha.rpc("update_context_profile_admin", {
          p_id: id,
          p_updates: updates as unknown as Json,
        });

        if (error) {
          safeError("useUpdateContextProfile.update", error);
          throw new Error(error.message);
        }

        return { id: data };
      },
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contextProfileKeys.all });
    },
  });
}
