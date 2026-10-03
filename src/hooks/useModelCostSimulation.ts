/**
 * Hook for simulating model tier costs.
 *
 * Provides cost simulation for different task types and call volumes.
 * Uses simulate_model_tier_cost RPC function.
 *
 * @module hooks/useModelCostSimulation
 */

import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "./useSession";
import { usePermissions } from "./usePermissions";
import { safeError } from "@/lib/security/safeLogger";
import {
  costSimulationArraySchema,
  type CostSimulationResult,
} from "@/lib/schemas/improvementProposalSchemas";

/** Query key factory for model cost simulation */
export const modelCostSimulationKeys = {
  all: ["model-cost-simulation"] as const,
  simulate: (monthlyCallCount: number, taskType: string) =>
    [...modelCostSimulationKeys.all, taskType, monthlyCallCount] as const,
};

/**
 * Hook for running a model tier cost simulation.
 *
 * @param monthlyCallCount - Expected monthly API call count
 * @param taskType - Task type to simulate (e.g. 'chat', 'project_delivery')
 * @returns Query object with parsed cost simulation results per model tier.
 */
export function useModelCostSimulation(
  monthlyCallCount: number,
  taskType: string,
) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: modelCostSimulationKeys.simulate(monthlyCallCount, taskType),
    queryFn: async (): Promise<CostSimulationResult[]> => {
      const { data, error } = await aisha.rpc("simulate_model_tier_cost", {
        p_monthly_call_count: monthlyCallCount,
        p_task_type: taskType,
      });

      if (error) {
        safeError("useModelCostSimulation.simulate", error);
        throw new Error(error.message);
      }

      return costSimulationArraySchema.parse(data ?? []);
    },
    enabled: !!user && isAdmin && monthlyCallCount > 0 && !!taskType,
    staleTime: 5 * 60_000,
  });
}
