/**
 * Hook for managing the Agent Catalog (admin).
 *
 * Provides list, update, and toggle operations for AI agent definitions.
 * Uses RPC-only pattern with SECURITY DEFINER + is_admin_or_staff() checks.
 *
 * @module hooks/useAgentCatalog
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "./useSession";
import { usePermissions } from "./usePermissions";
import { useAdminGuard } from "./useAdminGuard";
import { safeError } from "@/lib/security/safeLogger";
import {
  agentCatalogArraySchema,
  type AgentCatalogRow,
} from "@/lib/schemas/expertOverlaySchemas";
import type { Json } from "@/integrations/db/types";

/** Query key factory for agent catalog */
export const agentCatalogKeys = {
  all: ["agent-catalog"] as const,
  list: () => [...agentCatalogKeys.all, "list"] as const,
};

/**
 * Hook for fetching all agent catalog entries.
 *
 * @returns Query object with parsed agent catalog rows.
 * @example
 * const { data: agents, isLoading } = useAgentCatalog();
 */
export function useAgentCatalog() {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: agentCatalogKeys.list(),
    queryFn: async (): Promise<AgentCatalogRow[]> => {
      if (!isAdmin) return [];

      const { data, error } = await aisha.rpc("get_agent_catalog_admin");

      if (error) {
        safeError("useAgentCatalog.fetch", error);
        throw new Error(error.message);
      }

      return agentCatalogArraySchema.parse(data ?? []);
    },
    enabled: !!user && isAdmin,
    staleTime: 30_000,
  });
}

/**
 * Input type for updating an agent catalog entry.
 */
export interface AgentCatalogUpdateInput {
  display_name?: string;
  purpose?: string;
  default_model?: string;
  default_context_profile?: string;
  safety_level?: string;
  max_loops?: number;
  is_active?: boolean;
  model_overrides?: Record<string, unknown>;
}

/**
 * Hook for updating an agent catalog entry.
 *
 * @returns Mutation for updating agent fields.
 * @example
 * const { mutateAsync } = useUpdateAgentCatalog();
 * await mutateAsync({ id: agentId, updates: { is_active: false } });
 */
export function useUpdateAgentCatalog() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation(
      "update_agent_catalog_admin",
      async ({ id, updates }: { id: string; updates: AgentCatalogUpdateInput }) => {
        const { data, error } = await aisha.rpc("update_agent_catalog_admin", {
          p_id: id,
          p_updates: updates as unknown as Json,
        });

        if (error) {
          safeError("useUpdateAgentCatalog.update", error);
          throw new Error(error.message);
        }

        return { id: data };
      },
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentCatalogKeys.all });
    },
  });
}
