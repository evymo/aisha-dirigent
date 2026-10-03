/**
 * Dashboard hook — aggregated overview data for the home screen.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/config/api";
import { dashboardDataSchema } from "@/types/schemas";
import { safeError } from "@/lib/security/safeLogger";
import type { DashboardData } from "@/types/schemas";

export function useDashboard(userId: string | undefined) {
  return useQuery<DashboardData>({
    queryKey: ["dashboard", userId],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_mobile_dashboard_data", {});
      if (error) {
        safeError("useDashboard.fetch", error);
        throw error;
      }
      return dashboardDataSchema.parse(data);
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}
