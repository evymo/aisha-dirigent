/**
 * Health depth hooks — trends, labs, dosing, and symptoms.
 *
 * These hooks surface existing member-facing RPCs. PHI reads stay server-side
 * gated and audited by the RPC implementations.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/config/api";
import {
  dosingLogSchema,
  healthTrendsResultSchema,
  labResultSchema,
  ongoingSymptomSchema,
} from "@/types/schemas";
import { safeError } from "@/lib/security/safeLogger";
import type { DosingLog, HealthTrendsResult, LabResult, OngoingSymptom } from "@/types/schemas";

function parseArray<T>(
  data: unknown,
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
): T[] {
  if (!Array.isArray(data)) return [];
  return data.reduce<T[]>((acc, item) => {
    const result = schema.safeParse(item);
    if (result.success && result.data !== undefined) acc.push(result.data);
    return acc;
  }, []);
}

function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export type HealthTrendMetric = "steps" | "heart_rate" | "sleep_hours" | "active_energy" | "distance";
export type HealthTrendPeriod = "daily" | "weekly" | "monthly";

export function useHealthTrends(
  userId: string | undefined,
  metric: HealthTrendMetric = "steps",
  period: HealthTrendPeriod = "daily",
  days = 30,
) {
  const range = useMemo(
    () => ({ start: isoDateDaysAgo(days), end: new Date().toISOString() }),
    [days],
  );

  return useQuery<HealthTrendsResult>({
    queryKey: ["health-trends", userId, metric, period, days],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_health_trends", {
        p_end_date: range.end,
        p_metric: metric,
        p_period: period,
        p_start_date: range.start,
      });
      if (error) {
        safeError("useHealthTrends.fetch", error);
        throw error;
      }
      const parsed = healthTrendsResultSchema.safeParse(data);
      return parsed.success ? parsed.data : { trends: [], error: null };
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useMyLabResults(userId: string | undefined, limit = 10) {
  return useQuery<LabResult[]>({
    queryKey: ["my-lab-results", userId, limit],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_my_lab_results_audited", { p_limit: limit });
      if (error) {
        safeError("useMyLabResults.fetch", error);
        throw error;
      }
      return parseArray<LabResult>(data, labResultSchema);
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useMyDosingLogs(userId: string | undefined, limit = 10) {
  return useQuery<DosingLog[]>({
    queryKey: ["my-dosing-logs", userId, limit],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_my_dosing_logs_audited", { p_limit: limit });
      if (error) {
        safeError("useMyDosingLogs.fetch", error);
        throw error;
      }
      return parseArray<DosingLog>(data, dosingLogSchema);
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useMyOngoingSymptoms(userId: string | undefined, limit = 10) {
  return useQuery<OngoingSymptom[]>({
    queryKey: ["my-ongoing-symptoms", userId, limit],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_my_ongoing_symptoms_audited", { p_limit: limit });
      if (error) {
        safeError("useMyOngoingSymptoms.fetch", error);
        throw error;
      }
      return parseArray<OngoingSymptom>(data, ongoingSymptomSchema);
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}
