/**
 * Hook for Baseline Comparison
 * 
 * Compares current health metrics with registration baseline values.
 * Tracks trends over time for physical state, mental state, energy, stress, etc.
 * 
 * @example
 * ```tsx
 * const { comparison, history, isLoading } = useBaselineComparison(registrationId);
 * 
 * // Show improvement in energy
 * const energyTrend = comparison?.find(m => m.metric_name === 'energy_level');
 * if (energyTrend?.trend === 'improving') {
 *   // Show positive indicator
 * }
 * ```
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { aisha } from '@/integrations/db/client';
import { useSession } from '@/hooks/useSession';
import { safeError } from '@/lib/security/safeLogger';
import type { Database } from '@/integrations/db/types';

// Types from Supabase RPC
type BaselineComparisonRow = Database["public"]["Functions"]["get_baseline_comparison_audited"]["Returns"][number];
type MetricsHistoryRow = Database["public"]["Functions"]["get_health_metrics_history_audited"]["Returns"][number];

// Query keys
const BASELINE_KEYS = {
  comparison: (registrationId: string) => ['baseline-comparison', registrationId] as const,
  history: (registrationId: string, limit: number) => ['health-metrics-history', registrationId, limit] as const,
};

/**
 * Trend indicator for a health metric
 */
export type MetricTrend = 'improving' | 'stable' | 'declining' | 'neutral';

/**
 * Baseline comparison result for a single metric
 */
export interface BaselineComparison {
  /** Metric name (e.g., 'energy_level', 'stress_level') */
  metricName: string;
  /** Baseline value from registration */
  baselineValue: number | null;
  /** Baseline measurement date */
  baselineMeasuredAt: string | null;
  /** Current/latest value */
  currentValue: number | null;
  /** Current measurement date */
  currentMeasuredAt: string | null;
  /** Absolute change (current - baseline) */
  changeAbsolute: number | null;
  /** Percentage change */
  changePercent: number | null;
  /** Trend direction */
  trend: MetricTrend;
  /** Total number of measurements */
  measurementsCount: number;
}

/**
 * Tracking metric history record
 */
export interface MetricHistoryRecord {
  id: string;
  measuredAt: string;
  physicalState: number | null;
  mentalState: number | null;
  energyLevel: number | null;
  stressLevel: number | null;
  sleepQuality: number | null;
  painLevel: number | null;
  weightKg: number | null;
  source: string;
}

/**
 * Input for saving a new health metric
 */
export interface SaveMetricInput {
  studyRegistrationId?: string;
  physicalState?: number;
  mentalState?: number;
  energyLevel?: number;
  stressLevel?: number;
  sleepQuality?: number;
  painLevel?: number;
  weightKg?: number;
  heightCm?: number;
  source?: 'registration' | 'check_in' | 'wearable' | 'manual' | 'lab_result';
  sourceId?: string;
  measuredAt?: Date;
  notes?: string;
}

// Type guards
const isValidTrend = (value: unknown): value is MetricTrend => {
  return typeof value === 'string' && ['improving', 'stable', 'declining', 'neutral'].includes(value);
};

// Mappers
const mapComparisonRow = (row: BaselineComparisonRow): BaselineComparison => ({
  metricName: row.metric_name ?? '',
  baselineValue: row.baseline_value ?? null,
  baselineMeasuredAt: row.baseline_measured_at ?? null,
  currentValue: row.current_value ?? null,
  currentMeasuredAt: row.current_measured_at ?? null,
  changeAbsolute: row.change_absolute ?? null,
  changePercent: row.change_percent ?? null,
  trend: isValidTrend(row.trend) ? row.trend : 'neutral',
  measurementsCount: Number(row.measurements_count) || 0,
});

const mapHistoryRow = (row: MetricsHistoryRow): MetricHistoryRecord => ({
  id: row.id ?? '',
  measuredAt: row.measured_at ?? '',
  physicalState: row.physical_state ?? null,
  mentalState: row.mental_state ?? null,
  energyLevel: row.energy_level ?? null,
  stressLevel: row.stress_level ?? null,
  sleepQuality: row.sleep_quality ?? null,
  painLevel: row.pain_level ?? null,
  weightKg: row.weight_kg ? Number(row.weight_kg) : null,
  source: row.source ?? 'manual',
});

/**
 * Hook for fetching baseline comparison data
 * 
 * @param registrationId - Study registration ID to compare against
 * @returns Comparison data, loading state, and error
 */
export function useBaselineComparison(registrationId: string | undefined) {
  const { user } = useSession();

  const comparisonQuery = useQuery({
    queryKey: BASELINE_KEYS.comparison(registrationId ?? ''),
    queryFn: async (): Promise<BaselineComparison[]> => {
      if (!registrationId) return [];

      const { data, error } = await aisha.rpc('get_baseline_comparison_audited', {
        p_study_registration_id: registrationId,
      });

      if (error) throw new Error(error.message);
      if (!data) return [];

      return data.map(mapComparisonRow);
    },
    enabled: !!user?.id && !!registrationId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  return {
    comparison: comparisonQuery.data ?? [],
    isLoading: comparisonQuery.isLoading,
    error: comparisonQuery.error,
    refetch: comparisonQuery.refetch,
  };
}

/**
 * Hook for fetching health metrics history
 * 
 * @param registrationId - Study registration ID
 * @param limit - Maximum number of records to return
 * @returns History records, loading state, and error
 */
export function useMetricsHistory(registrationId: string | undefined, limit = 100) {
  const { user } = useSession();

  const historyQuery = useQuery({
    queryKey: BASELINE_KEYS.history(registrationId ?? '', limit),
    queryFn: async (): Promise<MetricHistoryRecord[]> => {
      if (!registrationId) return [];

      const { data, error } = await aisha.rpc('get_health_metrics_history_audited', {
        p_limit: limit
,
        p_study_registration_id: registrationId
    });

      if (error) throw new Error(error.message);
      if (!data) return [];

      return data.map(mapHistoryRow);
    },
    enabled: !!user?.id && !!registrationId,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });

  return {
    history: historyQuery.data ?? [],
    isLoading: historyQuery.isLoading,
    error: historyQuery.error,
    refetch: historyQuery.refetch,
  };
}

/**
 * Hook for saving health metrics
 * 
 * @returns Mutation for saving metrics
 */
export function useSaveMetric() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (input: SaveMetricInput): Promise<string> => {
      const { data, error } = await aisha.rpc('save_health_metric_audited', {
        p_energy_level: input.energyLevel ?? undefined,
        p_height_cm: input.heightCm ?? undefined,
        p_measured_at: input.measuredAt?.toISOString() ?? new Date().toISOString(),
        p_mental_state: input.mentalState ?? undefined,
        p_notes: input.notes ?? undefined,
        p_pain_level: input.painLevel ?? undefined,
        p_physical_state: input.physicalState ?? undefined,
        p_sleep_quality: input.sleepQuality ?? undefined,
        p_source: input.source ?? 'manual',
        p_source_id: input.sourceId ?? undefined,
        p_stress_level: input.stressLevel ?? undefined,
        p_study_registration_id: input.studyRegistrationId ?? undefined,
        p_weight_kg: input.weightKg ?? undefined,
      });

      if (error) throw new Error(error.message);
      return data ?? '';
    },
    onSuccess: (_, variables) => {
      // Invalidate related queries
      if (variables.studyRegistrationId) {
        queryClient.invalidateQueries({ 
          queryKey: BASELINE_KEYS.comparison(variables.studyRegistrationId) 
        });
        queryClient.invalidateQueries({ 
          queryKey: ['health-metrics-history', variables.studyRegistrationId] 
        });
      }
    },
    onError: (error) => {
      safeError('Error saving health metric', error);
    },
  });

  return {
    saveMetric: mutation.mutateAsync,
    isSaving: mutation.isPending,
    error: mutation.error,
  };
}

/**
 * Combined hook for baseline comparison with history and save functionality
 * 
 * @param registrationId - Study registration ID
 * @returns All baseline comparison functionality
 */
export function useBaselineTracking(registrationId: string | undefined) {
  const { comparison, isLoading: isLoadingComparison, error: comparisonError } = 
    useBaselineComparison(registrationId);
  
  const { history, isLoading: isLoadingHistory, error: historyError } = 
    useMetricsHistory(registrationId);
  
  const { saveMetric, isSaving, error: saveError } = useSaveMetric();

  // Helper: Get specific metric comparison
  const getMetricComparison = (metricName: string): BaselineComparison | undefined => {
    return comparison.find(c => c.metricName === metricName);
  };

  // Helper: Check if user has improved overall
  const hasOverallImprovement = (): boolean => {
    const improvingCount = comparison.filter(c => c.trend === 'improving').length;
    const decliningCount = comparison.filter(c => c.trend === 'declining').length;
    return improvingCount > decliningCount;
  };

  // Helper: Get metrics that need attention (declining)
  const getDecliningMetrics = (): BaselineComparison[] => {
    return comparison.filter(c => c.trend === 'declining');
  };

  return {
    // Data
    comparison,
    history,
    
    // Loading states
    isLoading: isLoadingComparison || isLoadingHistory,
    isLoadingComparison,
    isLoadingHistory,
    isSaving,
    
    // Errors
    error: comparisonError || historyError || saveError,
    
    // Actions
    saveMetric,
    
    // Helpers
    getMetricComparison,
    hasOverallImprovement,
    getDecliningMetrics,
  };
}

export default useBaselineTracking;
