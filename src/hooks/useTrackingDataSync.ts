import { useCallback, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { aisha } from '@/integrations/db/client';
import { useSession } from './useSession';
import { safeError } from '@/lib/security/safeLogger';
import { toast } from 'sonner';
import i18n from '@/i18n';
import { z } from 'zod';

/**
 * Supported health data types for sync.
 * These map to HealthKit (iOS) and Health Connect (Android) metrics.
 */
export type TrackingDataType =
  | 'steps'
  | 'heart_rate'
  | 'blood_pressure'
  | 'sleep'
  | 'active_energy'
  | 'weight'
  | 'distance';

/**
 * Represents a single health data entry.
 */
export interface TrackingDataEntry {
  id?: string;
  data_type: TrackingDataType;
  value: number;
  unit: string;
  metadata?: Record<string, unknown>;
  recorded_at: string;
  source: 'healthkit' | 'health_connect' | 'manual';
}

const healthDataEntrySchema = z.object({
  data_type: z.enum(['steps', 'heart_rate', 'blood_pressure', 'sleep', 'active_energy', 'weight', 'distance']),
  value: z.number().finite(),
  unit: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
  recorded_at: z.string().datetime(),
  source: z.enum(['healthkit', 'health_connect', 'manual']),
});

const healthDataEntriesSchema = z.array(healthDataEntrySchema);

/**
 * Tracking data record from the database.
 */
export interface TrackingDataRecord extends TrackingDataEntry {
  id: string;
  user_id: string;
  created_at: string;
}

/**
 * Aggregated health summary.
 */
export interface TrackingSummary {
  period_days: number;
  steps: {
    total: number;
    avg_daily: number;
    max_daily: number;
  };
  heart_rate: {
    avg: number;
    min: number;
    max: number;
  };
  sleep: {
    total_hours: number;
    avg_hours: number;
  };
  active_energy: {
    total: number;
    avg_daily: number;
  };
  weight: {
    latest: number;
    unit: string;
    recorded_at: string;
  } | null;
}

/**
 * Hook for syncing health data from Apple Health (HealthKit) or Google Fit (Health Connect).
 *
 * Usage:
 * ```tsx
 * const { syncTrackingData, healthData, summary, isSyncing } = useTrackingDataSync();
 *
 * // Sync data from mobile device
 * await syncTrackingData([
 *   { data_type: 'steps', value: 5000, unit: 'count', recorded_at: '2026-01-03T10:00:00Z', source: 'healthkit' },
 *   { data_type: 'heart_rate', value: 72, unit: 'bpm', recorded_at: '2026-01-03T10:00:00Z', source: 'healthkit' },
 * ]);
 * ```
 */
export function useTrackingDataSync(options?: {
  /** Filter by data type */
  dataType?: TrackingDataType;
  /** Start date for filtering */
  fromDate?: Date;
  /** End date for filtering */
  toDate?: Date;
  /** Maximum records to fetch */
  limit?: number;
  /** Summary period in days */
  summaryDays?: number;
}) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const [isSyncing, setIsSyncing] = useState(false);

  const {
    dataType,
    fromDate,
    toDate,
    limit = 100,
    summaryDays = 7,
  } = options ?? {};

  // Fetch health data
  const healthDataQuery = useQuery({
    queryKey: ['health-data', user?.id, dataType, fromDate?.toISOString(), toDate?.toISOString(), limit],
    queryFn: async (): Promise<TrackingDataRecord[]> => {
      if (!user?.id) return [];

      const { data, error } = await aisha.rpc('get_my_health_data', {
        p_data_type: dataType ?? undefined,
        p_from_date: fromDate?.toISOString() ?? undefined,
        p_limit: limit
,
        p_to_date: toDate?.toISOString() ?? undefined
    });

      if (error) throw new Error(error.message);
      // RPC returns validated data; array fallback for safety
      return (data ?? []) as TrackingDataRecord[];
    },
    enabled: !!user?.id,
  });

  // Fetch health summary
  const summaryQuery = useQuery({
    queryKey: ['health-summary', user?.id, summaryDays],
    queryFn: async (): Promise<TrackingSummary | null> => {
      if (!user?.id) return null;

      const { data, error } = await aisha.rpc('get_health_summary', {
        p_days: summaryDays,
      });

      if (error) throw new Error(error.message);
      return data as TrackingSummary | null;
    },
    enabled: !!user?.id,
  });

  // Sync health data mutation
  const syncMutation = useMutation({
    mutationFn: async (entries: TrackingDataEntry[]) => {
      if (!user?.id) throw new Error('Not authenticated');

      const parsed = healthDataEntriesSchema.safeParse(entries);
      if (!parsed.success) {
        safeError('useTrackingDataSync.sync.validate', parsed.error);
        throw new Error('TrackingData.invalidEntries');
      }

      const { data, error } = await aisha.rpc('sync_health_data', {
        p_health_entries: JSON.parse(JSON.stringify(parsed.data)),
      });

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['health-data'] });
      queryClient.invalidateQueries({ queryKey: ['health-summary'] });

      // Type guard for success response
      if (data && typeof data === 'object' && 'synced_count' in data) {
        const count = (data as { synced_count: number }).synced_count;
        toast.success(i18n.t('tracking.syncSuccess', { count }));
      }
    },
    onError: (error) => {
      safeError('useTrackingDataSync.sync', error);
      toast.error(i18n.t('tracking.syncError'));
    },
  });

  /**
   * Sync health data entries to the backend.
   */
  const syncTrackingData = useCallback(
    async (entries: TrackingDataEntry[]) => {
      setIsSyncing(true);
      try {
        await syncMutation.mutateAsync(entries);
      } finally {
        setIsSyncing(false);
      }
    },
    [syncMutation]
  );

  /**
   * Get the latest value for a specific data type.
   */
  const getLatestValue = useCallback(
    (type: TrackingDataType): TrackingDataRecord | undefined => {
      return healthDataQuery.data?.find((d) => d.data_type === type);
    },
    [healthDataQuery.data]
  );

  /**
   * Get daily aggregates for a specific data type.
   */
  const getDailyData = useCallback(
    (type: TrackingDataType, days: number = 7): { date: string; value: number }[] => {
      if (!healthDataQuery.data) return [];

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const filtered = healthDataQuery.data.filter(
        (d) =>
          d.data_type === type &&
          new Date(d.recorded_at) >= startDate &&
          new Date(d.recorded_at) <= endDate
      );

      // Group by date
      const dailyMap = new Map<string, number[]>();
      filtered.forEach((entry) => {
        const date = entry.recorded_at.split('T')[0];
        if (!dailyMap.has(date)) {
          dailyMap.set(date, []);
        }
        dailyMap.get(date)!.push(entry.value);
      });

      // Aggregate (sum for steps/energy/distance, avg for others)
      const aggregateTypes = ['steps', 'active_energy', 'distance'];
      const result: { date: string; value: number }[] = [];

      dailyMap.forEach((values, date) => {
        const value = aggregateTypes.includes(type)
          ? values.reduce((a, b) => a + b, 0)
          : values.reduce((a, b) => a + b, 0) / values.length;
        result.push({ date, value: Math.round(value * 100) / 100 });
      });

      return result.sort((a, b) => a.date.localeCompare(b.date));
    },
    [healthDataQuery.data]
  );

  return {
    // Data
    healthData: healthDataQuery.data ?? [],
    summary: summaryQuery.data,

    // Loading states
    isLoading: healthDataQuery.isLoading || summaryQuery.isLoading,
    isSyncing,

    // Errors
    error: healthDataQuery.error || summaryQuery.error,

    // Actions
    syncTrackingData,
    refetch: () => {
      healthDataQuery.refetch();
      summaryQuery.refetch();
    },

    // Helpers
    getLatestValue,
    getDailyData,
  };
}

/**
 * Hook to check if health sync is available on the device.
 * This should be called from a React Native context.
 */
export function useTrackingSyncAvailability() {
  const [isHealthKitAvailable] = useState(false);
  const [isHealthConnectAvailable] = useState(false);

  // This would be populated by native modules in React Native
  // For web, both will be false
  return {
    isHealthKitAvailable,
    isHealthConnectAvailable,
    isAnyAvailable: isHealthKitAvailable || isHealthConnectAvailable,
    platform: isHealthKitAvailable ? 'ios' : isHealthConnectAvailable ? 'android' : 'web',
  };
}

/**
 * Utility to format health data for display.
 */
export const trackingDataFormatters = {
  steps: (value: number) => `${value.toLocaleString()} ${i18n.t('tracking.units.steps')}`,
  heart_rate: (value: number) => `${value} ${i18n.t('tracking.units.bpm')}`,
  blood_pressure: (value: number, metadata?: { systolic?: number; diastolic?: number }) =>
    metadata?.systolic && metadata?.diastolic
      ? `${metadata.systolic}/${metadata.diastolic} mmHg`
      : `${value} mmHg`,
  sleep: (value: number) => `${value.toFixed(1)} ${i18n.t('tracking.units.hours')}`,
  active_energy: (value: number) => `${value.toLocaleString()} ${i18n.t('tracking.units.kcal')}`,
  weight: (value: number, unit: string = 'kg') => `${value.toFixed(1)} ${unit}`,
  distance: (value: number) => `${value.toFixed(2)} ${i18n.t('tracking.units.km')}`,
};

/**
 * Get icon for health data type.
 */
export const trackingDataIcons: Record<TrackingDataType, string> = {
  steps: 'footprints',
  heart_rate: 'heart-pulse',
  blood_pressure: 'activity',
  sleep: 'moon',
  active_energy: 'flame',
  weight: 'scale',
  distance: 'map-pin',
};
