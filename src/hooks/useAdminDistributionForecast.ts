import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { parseArrayResponse, forecastDataArraySchema, type ForecastData } from "@/lib/schemas/adminSchemas";
import { z } from "zod";
import { usePermissions } from "./usePermissions";
import { useSession } from "./useSession";
import { useAdminGuard } from "@/hooks/useAdminGuard";

// Schema for study (simplified)
const studySimpleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  is_active: z.boolean().optional(),
});

export type StudySimple = z.infer<typeof studySimpleSchema>;
export { type ForecastData };

export interface MonthlyStats {
  total_packages: number;
  total_value: number;
  total_members: number;
  vip_members: number;
}

/**
 * Hook for fetching distribution forecasts
 */
export function useDistributionForecastsAdmin(month: string, studyId: string | undefined) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  const studyIdParam = studyId === "all" ? null : studyId ?? null;

  return useQuery({
    queryKey: ["admin-distribution-forecasts", month, studyId],
    queryFn: async () => {
      if (!isAdmin || !user) return { forecasts: [], stats: { total_packages: 0, total_value: 0, total_members: 0, vip_members: 0 } };
      const monthStart = `${month}-01`;

      const { data, error } = await aisha.rpc("get_distribution_forecasts_admin", {
        p_month: monthStart,
        p_study_id: studyIdParam ?? undefined,
      });

      if (error) {
        safeError("admin.forecast.fetchFailed", error);
        throw new Error(error.message);
      }

      const validated = parseArrayResponse(forecastDataArraySchema, data, "distributionForecasts");

      // Calculate stats
      const stats = validated.reduce(
        (acc: MonthlyStats, f: ForecastData) => ({
          total_packages: acc.total_packages + (f.required_packages || 0),
          total_value: acc.total_value + (f.compensated_value || 0),
          total_members: acc.total_members + (f.total_members || 0),
          vip_members: acc.vip_members + (f.vip_members || 0),
        }),
        { total_packages: 0, total_value: 0, total_members: 0, vip_members: 0 }
      );

      return { forecasts: validated, stats };
    },
    enabled: isAdmin && !!user,
  });
}

/**
 * Hook for fetching studies for filter
 */
export function useStudiesForForecast() {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["admin-studies-for-forecast"],
    queryFn: async (): Promise<StudySimple[]> => {
      if (!isAdmin || !user) return [];
      const { data, error } = await aisha.rpc("get_studies_admin");
      if (error) {
        safeError("admin.studies.fetchFailed", error);
        throw new Error(error.message);
      }

      const parsed = z.array(studySimpleSchema).safeParse(data);
      if (!parsed.success) {
        safeError("admin.studies.parseFailed", { issues: parsed.error.issues.length });
        return [];
      }

      return parsed.data
        .filter((s) => s.is_active !== false)
        .map((s) => ({ id: s.id, name: s.name, code: s.code }));
    },
    enabled: isAdmin && !!user,
  });
}

/**
 * Hook for recalculating forecasts
 */
export function useRecalculateForecast() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("recalculate_distribution_forecasts_admin", async ({ month, studyId }: { month: string; studyId: string | undefined }) => {
      const monthStart = `${month}-01`;
      const studyIdParam = studyId === "all" ? null : studyId ?? null;

      const { error } = await aisha.rpc("recalculate_distribution_forecasts_admin", {
        p_month: monthStart,
        p_study_id: studyIdParam ?? undefined,
      });

      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-distribution-forecasts"] });
    },
    onError: (error) => {
      safeError("admin.forecast.recalculateFailed", error);
    },
  });
}

/**
 * Hook for updating production status
 */
export function useUpdateForecastStatus() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("update_distribution_forecast_status_admin", async ({ forecastId, status }: { forecastId: string; status: string }) => {
      const { error } = await aisha.rpc("update_distribution_forecast_status_admin", {
        p_id: forecastId,
        p_production_status: status,
      });

      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-distribution-forecasts"] });
    },
    onError: (error) => {
      safeError("admin.forecast.statusFailed", error);
    },
  });
}
