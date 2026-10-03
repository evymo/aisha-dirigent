/**
 * Hooks for the partner publish side of the agent marketplace — a certified
 * guild member authors an agent, submits it (submit_plugin), and sends it for
 * compliance review (publish_agent). The "my agents" listing comes from
 * get_my_agents (the partner's own agents in ANY status, with agent_spec).
 *
 * Symmetric to useAvailableAgents (the consumer browse/install side). Mirrors
 * useExpertRules' partner hooks (create/publish + my-contributed listing).
 *
 * @module hooks/usePartnerAgents
 */

import { useQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import type { Json } from "@/integrations/db/types";
import { safeError } from "@/lib/security/safeLogger";
import { parseRpcArray } from "@/lib/validation/rpcSchemas";
import {
  myAgentSchema,
  submitAgentResultSchema,
  publishAgentResultSchema,
  type MyAgent,
  type SubmitAgentResult,
  type PublishAgentResult,
  type SubmitAgentParams,
} from "@/lib/schemas/agentMarketplaceSchemas";

// =============================================================================
// Query Keys
// =============================================================================

export const partnerAgentKeys = {
  all: ["my-agents"] as const,
  list: () => ["my-agents", "list"] as const,
  detail: (slug: string) => ["my-agents", "detail", slug] as const,
};

// =============================================================================
// Query Options (for route loaders)
// =============================================================================

/** The caller's own agents (any status), newest first. */
export const myAgentsQueryOptions = () =>
  queryOptions({
    queryKey: partnerAgentKeys.list(),
    queryFn: async (): Promise<MyAgent[]> => {
      const { data, error } = await aisha.rpc("get_my_agents");
      if (error) throw new Error(error.message);
      // parseRpcArray infers T from the schema's INPUT type; myAgentSchema's
      // output differs (capabilities .default([]) → required; agent_spec passthrough),
      // so narrow the validated rows to the output-typed MyAgent.
      return parseRpcArray(myAgentSchema, data, "get_my_agents") as MyAgent[];
    },
    staleTime: 60 * 1000,
  });

// =============================================================================
// Hooks — Read
// =============================================================================

/** List the partner's own agents (drafts, in-review, published). */
export function useMyAgents() {
  return useQuery(myAgentsQueryOptions());
}

/**
 * A single own agent by slug. Derived from the list (which already carries
 * agent_spec) so the edit form hydrates without a second round-trip.
 */
export function useMyAgent(slug: string | undefined) {
  return useQuery({
    ...myAgentsQueryOptions(),
    staleTime: 60 * 1000,
    select: (agents: MyAgent[]) => agents.find((a) => a.slug === slug) ?? null,
    enabled: !!slug,
  });
}

// =============================================================================
// Hooks — Mutations
// =============================================================================

/**
 * Submit (create or re-submit) an agent. Declarative run-as-story agents carry
 * no artifact, so both artifact params default to null. The catalog row is
 * identity-bound to the calling partner server-side.
 */
export function useSubmitAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: SubmitAgentParams): Promise<SubmitAgentResult> => {
      // Keys alphabetical (p_artifact_sha256, p_artifact_url, p_manifest) per the
      // rpc-params-alphabetical gate; named params, so order is cosmetic.
      const { data, error } = await aisha.rpc("submit_plugin", {
        p_artifact_sha256: params.artifactSha256 ?? undefined,
        p_artifact_url: params.artifactUrl ?? undefined,
        p_manifest: params.manifest as unknown as Json,
      });
      if (error) throw new Error(error.message);
      return submitAgentResultSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: partnerAgentKeys.all });
    },
    onError: (error) => {
      safeError("useSubmitAgent.failed", error);
    },
  });
}

/** Send a submitted agent for AISHA compliance review (→ reviewing). */
export function usePublishAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (pluginId: string): Promise<PublishAgentResult> => {
      const { data, error } = await aisha.rpc("publish_agent", {
        p_plugin_id: pluginId,
      });
      if (error) throw new Error(error.message);
      return publishAgentResultSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: partnerAgentKeys.all });
    },
    onError: (error) => {
      safeError("usePublishAgent.failed", error);
    },
  });
}
