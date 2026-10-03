import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { aisha } from "@/integrations/db/client";
import { usePermissions } from "./usePermissions";
import { useSession } from "./useSession";
import { parseRpcArray } from "@/lib/validation/rpcSchemas";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Granularity for health trend aggregation */
export type TrendGranularity = "weekly" | "monthly";

/** Check-in type filter value */
export type CheckInTypeFilter = "morning" | "evening" | "weekly" | "monthly";

/** Predefined age group for filtering */
export interface AgeGroup {
  /** Display label i18n key */
  labelKey: string;
  /** Maximum age (inclusive), null = no upper bound */
  max: number | null;
  /** Minimum age (inclusive) */
  min: number;
  /** Machine-readable value */
  value: string;
}

/** Active filters for health trend data */
export interface TrackingTrendFilters {
  /** Maximum age (inclusive) */
  ageMax: number | null;
  /** Minimum age (inclusive) */
  ageMin: number | null;
  /** Filter by check-in type */
  checkInType: CheckInTypeFilter | null;
  /** Filter by gender */
  gender: string | null;
  /** Filter by study UUID */
  studyId: string | null;
}

/** A single period bucket with aggregated health metrics */
export interface TrackingTrendPeriod {
  /** Average energy level (0-10) */
  avgEnergy: number | null;
  /** Average mood level (0-10) */
  avgMood: number | null;
  /** Average pain level (0-10) */
  avgPain: number | null;
  /** Average sleep quality (0-10) */
  avgSleep: number | null;
  /** Number of check-ins in this period */
  checkInCount: number;
  /** Start date of the period (ISO string) */
  periodStart: string;
  /** Number of unique users who submitted check-ins */
  uniqueUsers: number;
}

/** Metric trend direction based on comparison */
export type TrendDirection = "up" | "down" | "neutral";

/** Per-metric trend comparison between current and previous period */
export interface PeriodComparison {
  /** Current period averaged value */
  current: number | null;
  /** Delta (current - previous), null if no previous data */
  delta: number | null;
  /** Previous period averaged value */
  previous: number | null;
  /** Trend direction */
  trend: TrendDirection;
}

/** Aggregated comparison for all metrics */
export interface TrendComparison {
  checkIns: PeriodComparison;
  energy: PeriodComparison;
  mood: PeriodComparison;
  pain: PeriodComparison;
  sleep: PeriodComparison;
}

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const healthTrendRowSchema = z.object({
  avg_energy: z.number().nullable(),
  avg_mood: z.number().nullable(),
  avg_pain: z.number().nullable(),
  avg_sleep: z.number().nullable(),
  check_in_count: z.number(),
  period_start: z.string(),
  unique_users: z.number(),
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Predefined age groups for filtering */
export const AGE_GROUPS: AgeGroup[] = [
  { labelKey: "admin.outcomes.filter.age18to30", max: 30, min: 18, value: "18-30" },
  { labelKey: "admin.outcomes.filter.age31to50", max: 50, min: 31, value: "31-50" },
  { labelKey: "admin.outcomes.filter.age51to70", max: 70, min: 51, value: "51-70" },
  { labelKey: "admin.outcomes.filter.age71plus", max: null, min: 71, value: "71+" },
];

const EMPTY_FILTERS: TrackingTrendFilters = {
  ageMax: null,
  ageMin: null,
  checkInType: null,
  gender: null,
  studyId: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateRange(start: Date, end: Date, granularity: TrendGranularity): string {
  const s = start.toISOString().slice(0, 10);
  const e = end.toISOString().slice(0, 10);
  return `${s} – ${e} (${granularity})`;
}

/**
 * Calculate trend direction with a ±10% threshold.
 */
function calcTrend(current: number | null, previous: number | null): TrendDirection {
  if (current === null || previous === null) return "neutral";
  if (previous === 0) return current > 0 ? "up" : "neutral";
  const ratio = current / previous;
  if (ratio > 1.1) return "up";
  if (ratio < 0.9) return "down";
  return "neutral";
}

/**
 * Average a nullable metric across periods.
 */
function avgMetric(periods: TrackingTrendPeriod[], getter: (p: TrackingTrendPeriod) => number | null): number | null {
  const values = periods.map(getter).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// ---------------------------------------------------------------------------
// Date range presets
// ---------------------------------------------------------------------------

export type RangePreset = "3m" | "6m" | "1y" | "2y" | "all";

function getPresetRange(preset: RangePreset): { end: Date; start: Date } {
  const end = new Date();
  const start = new Date();
  switch (preset) {
    case "3m":
      start.setMonth(start.getMonth() - 3);
      break;
    case "6m":
      start.setMonth(start.getMonth() - 6);
      break;
    case "1y":
      start.setFullYear(start.getFullYear() - 1);
      break;
    case "2y":
      start.setFullYear(start.getFullYear() - 2);
      break;
    case "all":
      start.setFullYear(2020, 0, 1);
      break;
  }
  return { end, start };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseAdminTrackingTrendsOptions {
  /** Enable/disable the query */
  enabled?: boolean;
  /** Initial filters */
  filters?: Partial<TrackingTrendFilters>;
  /** Initial granularity */
  granularity?: TrendGranularity;
  /** Initial range preset */
  preset?: RangePreset;
}

/**
 * Hook for fetching admin health trends with period navigation and comparison.
 *
 * Returns aggregated health metrics per period (weekly/monthly),
 * allows navigation through time ranges, and computes trend comparison
 * between the most recent two comparable periods.
 *
 * @param options - Hook configuration
 * @returns Tracking trend data with navigation and comparison
 *
 * @example
 * const { periods, comparison, granularity, setGranularity, preset, setPreset } = useAdminTrackingTrends();
 */
export function useAdminTrackingTrends(options: UseAdminTrackingTrendsOptions = {}) {
  const {
    enabled = true,
    filters: initialFilters,
    granularity: initialGranularity = "monthly",
    preset: initialPreset = "1y",
  } = options;

  const { hasPermission } = usePermissions();
  const { user } = useSession();
  const isAdmin = hasPermission("view_admin_dashboard");

  const [granularity, setGranularity] = useState<TrendGranularity>(initialGranularity);
  const [preset, setPreset] = useState<RangePreset>(initialPreset);
  const [filters, setFilters] = useState<TrackingTrendFilters>(() => ({
    ...EMPTY_FILTERS,
    ...initialFilters,
  }));

  const { end, start } = useMemo(() => getPresetRange(preset), [preset]);

  const queryKey = useMemo(
    () => [
      "admin-health-trends",
      granularity,
      start.toISOString(),
      end.toISOString(),
      filters.studyId,
      filters.ageMin,
      filters.ageMax,
      filters.gender,
      filters.checkInType,
    ],
    [granularity, start, end, filters],
  );

  const {
    data: rawPeriods,
    isLoading,
    error,
    refetch,
  } = useQuery({
    enabled: enabled && isAdmin && !!user,
    queryFn: async (): Promise<TrackingTrendPeriod[]> => {
      const rpcParams: Record<string, unknown> = {
        p_end_date: end.toISOString().slice(0, 10),
        p_granularity: granularity,
        p_start_date: start.toISOString().slice(0, 10),
      };

      // Add optional filter params only when set
      if (filters.studyId) rpcParams.p_study_id = filters.studyId;
      if (filters.gender) rpcParams.p_gender = filters.gender;
      if (filters.checkInType) rpcParams.p_check_in_type = filters.checkInType;
      if (filters.ageMin !== null) rpcParams.p_age_min = filters.ageMin;
      if (filters.ageMax !== null) rpcParams.p_age_max = filters.ageMax;

      const { data, error: rpcError } = await aisha.rpc(
        "get_admin_health_trends_audited" as const,
        rpcParams as Record<string, never>,
      );

      if (rpcError) throw new Error(rpcError.message);

      const validated = parseRpcArray(healthTrendRowSchema, data, "get_admin_health_trends_audited");

      return validated.map((row): TrackingTrendPeriod => ({
        avgEnergy: row.avg_energy,
        avgMood: row.avg_mood,
        avgPain: row.avg_pain,
        avgSleep: row.avg_sleep,
        checkInCount: row.check_in_count,
        periodStart: row.period_start,
        uniqueUsers: row.unique_users,
      }));
    },
    queryKey,
    staleTime: 5 * 60 * 1000,
  });

  const periods = useMemo(() => rawPeriods ?? [], [rawPeriods]);

  // Split periods into two halves for comparison (recent vs older)
  const comparison = useMemo((): TrendComparison => {
    const neutral: PeriodComparison = { current: null, delta: null, previous: null, trend: "neutral" };
    if (periods.length < 2) {
      return { checkIns: neutral, energy: neutral, mood: neutral, pain: neutral, sleep: neutral };
    }

    const midpoint = Math.floor(periods.length / 2);
    const olderHalf = periods.slice(0, midpoint);
    const recentHalf = periods.slice(midpoint);

    const buildComparison = (
      getter: (p: TrackingTrendPeriod) => number | null,
    ): PeriodComparison => {
      const current = avgMetric(recentHalf, getter);
      const previous = avgMetric(olderHalf, getter);
      const delta = current !== null && previous !== null ? +(current - previous).toFixed(2) : null;
      return { current, delta, previous, trend: calcTrend(current, previous) };
    };

    const buildCountComparison = (): PeriodComparison => {
      const currentTotal = recentHalf.reduce((s, p) => s + p.checkInCount, 0);
      const previousTotal = olderHalf.reduce((s, p) => s + p.checkInCount, 0);
      const avgCurrent = currentTotal / recentHalf.length;
      const avgPrevious = previousTotal / olderHalf.length;
      const delta = +(avgCurrent - avgPrevious).toFixed(2);
      return { current: avgCurrent, delta, previous: avgPrevious, trend: calcTrend(avgCurrent, avgPrevious) };
    };

    return {
      checkIns: buildCountComparison(),
      energy: buildComparison((p) => p.avgEnergy),
      mood: buildComparison((p) => p.avgMood),
      pain: buildComparison((p) => p.avgPain),
      sleep: buildComparison((p) => p.avgSleep),
    };
  }, [periods]);

  // Total stats across all loaded periods
  const totals = useMemo(() => {
    if (periods.length === 0) {
      return { avgEnergy: 0, avgMood: 0, avgPain: 0, avgSleep: 0, totalCheckIns: 0, totalUniqueUsers: 0 };
    }
    return {
      avgEnergy: avgMetric(periods, (p) => p.avgEnergy) ?? 0,
      avgMood: avgMetric(periods, (p) => p.avgMood) ?? 0,
      avgPain: avgMetric(periods, (p) => p.avgPain) ?? 0,
      avgSleep: avgMetric(periods, (p) => p.avgSleep) ?? 0,
      totalCheckIns: periods.reduce((s, p) => s + p.checkInCount, 0),
      totalUniqueUsers: new Set(periods.flatMap(() => [])).size || Math.max(...periods.map((p) => p.uniqueUsers), 0),
    };
  }, [periods]);

  const rangeLabel = useMemo(() => formatDateRange(start, end, granularity), [start, end, granularity]);

  const navigateBack = useCallback(() => {
    setPreset((p) => {
      const presets: RangePreset[] = ["3m", "6m", "1y", "2y", "all"];
      const idx = presets.indexOf(p);
      return idx < presets.length - 1 ? presets[idx + 1] : p;
    });
  }, []);

  const navigateForward = useCallback(() => {
    setPreset((p) => {
      const presets: RangePreset[] = ["3m", "6m", "1y", "2y", "all"];
      const idx = presets.indexOf(p);
      return idx > 0 ? presets[idx - 1] : p;
    });
  }, []);

  /** Update a single filter field */
  const updateFilter = useCallback(
    <K extends keyof TrackingTrendFilters>(key: K, value: TrackingTrendFilters[K]) => {
      setFilters((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  /** Reset all filters to defaults */
  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
  }, []);

  /** Whether any filter is currently active */
  const hasActiveFilters = useMemo(
    () =>
      filters.studyId !== null ||
      filters.ageMin !== null ||
      filters.ageMax !== null ||
      filters.gender !== null ||
      filters.checkInType !== null,
    [filters],
  );

  return {
    clearFilters,
    comparison,
    error: error instanceof Error ? error.message : error ? String(error) : null,
    filters,
    granularity,
    hasActiveFilters,
    isLoading,
    navigateBack,
    navigateForward,
    periods,
    preset,
    rangeLabel,
    refetch,
    setGranularity,
    setPreset,
    totals,
    updateFilter,
  };
}
