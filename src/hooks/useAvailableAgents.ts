/**
 * Hooks for the agent marketplace — browse published agents and install one as
 * a consumer-owned story (run-as-story).
 *
 * Reuses the plugin control plane: the listing is get_available_plugins filtered
 * to kind='agent' (canary/ga), and install goes through install_agent_as_story.
 * Mirrors useExpertRules (per-type hook, React Query, namespaced keys).
 *
 * @module hooks/useAvailableAgents
 */

import { useQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { parseRpcArray } from "@/lib/validation/rpcSchemas";
import {
  availableAgentSchema,
  agentInstallResultSchema,
  type AvailableAgent,
  type AgentInstallResult,
  type InstallAgentParams,
} from "@/lib/schemas/agentMarketplaceSchemas";

// =============================================================================
// Query Keys
// =============================================================================

export const availableAgentKeys = {
  all: ["available-agents"] as const,
  list: () => ["available-agents", "list"] as const,
  detail: (slug: string) => ["available-agents", "detail", slug] as const,
};

// =============================================================================
// Query Options (for route loaders)
// =============================================================================

/** Query options for the list of installable marketplace agents (canary/ga). */
export const availableAgentsQueryOptions = () =>
  queryOptions({
    queryKey: availableAgentKeys.list(),
    queryFn: async (): Promise<AvailableAgent[]> => {
      const { data, error } = await aisha.rpc("get_available_plugins", {
        p_kind: "agent",
        p_tenant_id: undefined,
      });
      if (error) throw new Error(error.message);
      const rows = parseRpcArray(availableAgentSchema, data, "get_available_plugins");
      return rows.map((agent) => ({ ...agent, capabilities: agent.capabilities ?? [] }));
    },
    staleTime: 2 * 60 * 1000,
  });

// =============================================================================
// Hooks — Read
// =============================================================================

/** Browse installable marketplace agents. */
export function useAvailableAgents() {
  return useQuery(availableAgentsQueryOptions());
}

/**
 * Fetch a single agent by slug. Derived from the list (no dedicated detail RPC
 * in Phase 1) so it shares the cache with the listing.
 */
export function useAvailableAgent(slug: string | undefined) {
  return useQuery({
    ...availableAgentsQueryOptions(),
    staleTime: 2 * 60 * 1000,
    select: (agents: AvailableAgent[]) => agents.find((a) => a.slug === slug) ?? null,
    enabled: !!slug,
  });
}

// =============================================================================
// Hooks — Mutations
// =============================================================================

/** Install an agent as a new consumer-owned story (run-as-story). */
export function useInstallAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: InstallAgentParams): Promise<AgentInstallResult> => {
      // Keys alphabetical (p_partner_id, p_plugin_id, p_title) per the
      // rpc-params-alphabetical gate; named params, so order is cosmetic.
      const { data, error } = await aisha.rpc("install_agent_as_story", {
        p_partner_id: params.partnerId ?? undefined,
        p_plugin_id: params.pluginId,
        p_title: params.title ?? undefined,
      });
      if (error) throw new Error(error.message);
      return agentInstallResultSchema.parse(data);
    },
    onSuccess: () => {
      // The install minted a new story — refresh story lists.
      void queryClient.invalidateQueries({ queryKey: ["partner-stories"] });
      void queryClient.invalidateQueries({ queryKey: ["stories"] });
    },
    onError: (error) => {
      safeError("useInstallAgent.failed", error);
    },
  });
}
