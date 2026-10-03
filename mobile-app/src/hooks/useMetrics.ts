/**
 * Metrics hook — API traffic, response times, agent performance.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/config/api";
import { apiMetricsSchema, agentStatusSchema, tokenomicsOverviewSchema } from "@/types/schemas";
import { safeError } from "@/lib/security/safeLogger";
import type { ApiMetrics, AgentStatus, TokenomicsOverview } from "@/types/schemas";

export function useApiMetrics(userId: string | undefined) {
  return useQuery<ApiMetrics>({
    queryKey: ["api-metrics", userId],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_mobile_api_stats", {});
      if (error) {
        safeError("useApiMetrics.fetch", error);
        throw error;
      }
      return apiMetricsSchema.parse(data);
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

function parseAgentArray(data: unknown): AgentStatus[] {
  if (!Array.isArray(data)) return [];
  return data.reduce<AgentStatus[]>((acc, item) => {
    const result = agentStatusSchema.safeParse(item);
    if (result.success) acc.push(result.data);
    return acc;
  }, []);
}

export function useAgentStatuses(userId: string | undefined) {
  return useQuery({
    queryKey: ["agent-statuses", userId],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_ai_agent_metrics", {});
      if (error) {
        safeError("useAgentStatuses.fetch", error);
        throw error;
      }
      return parseAgentArray(data);
    },
    enabled: !!userId,
    staleTime: 60 * 1000,
  });
}

export function useTokenomicsOverview(userId: string | undefined) {
  return useQuery<TokenomicsOverview>({
    queryKey: ["tokenomics-overview", userId],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_tokenomics_overview");
      if (error) {
        safeError("useTokenomicsOverview.fetch", error);
        throw error;
      }
      return tokenomicsOverviewSchema.parse(data);
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}
