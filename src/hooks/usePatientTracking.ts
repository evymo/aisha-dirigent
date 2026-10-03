/**
 * User Tracking Data Hook
 *
 * Fetches health data for a user in StoryLoop context.
 * **Fail-closed**: consent is checked INTERNALLY — callers cannot bypass.
 *
 * Security layers (defense-in-depth):
 * 1. Hook-level consent guard (this file)
 * 2. RPC-level authorization (server-side `get_user_health_check_ins_summary_audited`)
 * 3. RLS policies on underlying tables
 *
 * Uses existing audited RPC functions:
 * - get_consent_status (typed — in Supabase types.ts)
 * - get_user_health_check_ins_summary_audited
 * - get_user_dosing_logs_summary_audited
 *
 * @module useUserTracking
 */

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { aisha } from '@/integrations/db/client';
import { useSession } from '@/hooks/useSession';
import { safeError } from '@/lib/security/safeLogger';

// =====================================================
// Schemas — matching RPC return types
// =====================================================

const TrackingCheckInSchema = z.object({
  id: z.string().uuid(),
  check_in_date: z.string(),
  energy_level: z.number().nullable(),
  mood_level: z.number().nullable(),
  pain_level: z.number().nullable(),
  sleep_quality: z.number().nullable(),
});

const DosingLogSchema = z.object({
  dose_count: z.number().nullable(),
  logged_at: z.string(),
  product_name: z.string().nullable(),
});

const TrackingMetricsSchema = z.object({
  avg_energy_7d: z.number().nullable(),
  avg_mood_7d: z.number().nullable(),
  avg_pain_7d: z.number().nullable(),
  avg_sleep_7d: z.number().nullable(),
  checkin_streak: z.number(),
  last_checkin_date: z.string().nullable(),
  trend: z.enum(['improving', 'stable', 'declining']),
});

const DataSharingConsentStatusSchema = z.enum([
  'granted',
  'revoked',
  'expired',
  'pending',
  'none',
]);

const SymptomLogSchema = z.object({
  category: z.string().nullable(),
  ended_at: z.string().nullable(),
  id: z.string().uuid(),
  logged_at: z.string(),
  notes: z.string().nullable(),
  severity: z.number().nullable(),
  started_at: z.string().nullable(),
  symptom_code: z.string().nullable(),
  symptom_name: z.string().nullable(),
});

export type TrackingCheckIn = z.infer<typeof TrackingCheckInSchema>;
export type DosingLog = z.infer<typeof DosingLogSchema>;
export type TrackingMetrics = z.infer<typeof TrackingMetricsSchema>;
export type SymptomLog = z.infer<typeof SymptomLogSchema>;
export type DataSharingConsentStatus = z.infer<typeof DataSharingConsentStatusSchema>;

// =====================================================
// Query Keys
// =====================================================

/**
 * React Query keys for user health data.
 */
export const userTrackingKeys = {
  all: ['user-health'] as const,
  checkIns: (userId: string) => [...userTrackingKeys.all, 'check-ins', userId] as const,
  consent: (userId: string, partnerId: string) => [...userTrackingKeys.all, 'consent', userId, partnerId] as const,
  dosingLogs: (userId: string) => [...userTrackingKeys.all, 'dosing-logs', userId] as const,
  metrics: (userId: string) => [...userTrackingKeys.all, 'metrics', userId] as const,
  symptomLogs: (userId: string) => [...userTrackingKeys.all, 'symptom-logs', userId] as const,
};

// =====================================================
// Consent Hook — typed RPC, no rpcUnsafe
// =====================================================

/**
 * Fetch data sharing consent status for the current partner and user.
 *
 * Uses typed RPC call to get_consent_status — no rpcUnsafe bypass.
 * Consent status is validated with Zod before returning.
 */
export function useUserConsentStatus(userId: string | null) {
  const { user } = useSession();

  return useQuery({
    queryKey: userTrackingKeys.consent(userId ?? '', user?.id ?? ''),
    queryFn: async (): Promise<DataSharingConsentStatus> => {
      if (!user?.id || !userId) return 'none';

      const { data, error } = await aisha.rpc('get_consent_status', {
        p_partner_user_id: user.id,
        p_user_id: userId,
      });

      if (error) {
        safeError('useUserTracking.consentStatus', error);
        return 'none';
      }

      const parsed = DataSharingConsentStatusSchema.safeParse(data);
      if (!parsed.success) {
        safeError('useUserTracking.consentStatus.validation', parsed.error);
        return 'none';
      }

      return parsed.data;
    },
    enabled: !!user?.id && !!userId,
    staleTime: 2 * 60 * 1000, // 2 min — consent changes are infrequent
  });
}

// =====================================================
// sensitive data Data Hooks — consent-gated internally
// =====================================================

/**
 * Fetch user's health check-ins via audited RPC.
 *
 * **Fail-closed**: `enabled` requires consent to be 'granted'.
 * Even if enabled, server-side RPC re-validates authorization.
 *
 * @param userId - User UUID
 * @param consentStatus - Consent status from `useUserConsentStatus`
 */
export function useUserCheckIns(
  userId: string | null,
  consentStatus: DataSharingConsentStatus | null | undefined,
) {
  const { user } = useSession();
  const isAuthorized = !!user && !!userId && consentStatus === 'granted';

  return useQuery({
    queryKey: userTrackingKeys.checkIns(userId ?? ''),
    queryFn: async (): Promise<TrackingCheckIn[]> => {
      if (!isAuthorized || !userId) return [];

      const { data, error } = await aisha.rpc('get_user_health_check_ins_summary_audited', {
        p_user_id: userId,
      });

      if (error) {
        safeError('useUserTracking.checkIns', error);
        throw new Error(error.message);
      }
      if (!data) return [];

      return z.array(TrackingCheckInSchema).parse(data);
    },
    enabled: isAuthorized,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch user's dosing/product logs via audited RPC.
 *
 * **Fail-closed**: `enabled` requires consent to be 'granted'.
 *
 * @param userId - User UUID
 * @param consentStatus - Consent status from `useUserConsentStatus`
 */
export function useUserDosingLogs(
  userId: string | null,
  consentStatus: DataSharingConsentStatus | null | undefined,
) {
  const { user } = useSession();
  const isAuthorized = !!user && !!userId && consentStatus === 'granted';

  return useQuery({
    queryKey: userTrackingKeys.dosingLogs(userId ?? ''),
    queryFn: async (): Promise<DosingLog[]> => {
      if (!isAuthorized || !userId) return [];

      const { data, error } = await aisha.rpc('get_user_dosing_logs_summary_audited', {
        p_user_id: userId,
      });

      if (error) {
        safeError('useUserTracking.dosingLogs', error);
        throw new Error(error.message);
      }
      if (!data) return [];

      return z.array(DosingLogSchema).parse(data);
    },
    enabled: isAuthorized,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch user's symptom logs via audited RPC.
 *
 * Returns symptom history with severity, duration, and notes.
 * **Fail-closed**: `enabled` requires consent to be 'granted'.
 *
 * @param userId - User UUID
 * @param consentStatus - Consent status from `useUserConsentStatus`
 */
export function useUserSymptomLogs(
  userId: string | null,
  consentStatus: DataSharingConsentStatus | null | undefined,
) {
  const { user } = useSession();
  const isAuthorized = !!user && !!userId && consentStatus === 'granted';

  return useQuery({
    queryKey: userTrackingKeys.symptomLogs(userId ?? ''),
    queryFn: async (): Promise<SymptomLog[]> => {
      if (!isAuthorized || !userId) return [];

      const { data, error } = await aisha.rpc('get_user_symptom_logs_audited', {
        p_user_id: userId,
      });

      if (error) {
        safeError('useUserTracking.symptomLogs', error);
        throw new Error(error.message);
      }
      if (!data) return [];

      return z.array(SymptomLogSchema).parse(data);
    },
    enabled: isAuthorized,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Calculate health metrics from check-ins (client-side derived query).
 *
 * Depends on `useUserCheckIns` — inherits its consent gating.
 */
export function useUserTrackingMetrics(userId: string | null) {
  const { data: consentStatus } = useUserConsentStatus(userId);
  const { data: checkIns } = useUserCheckIns(userId, consentStatus);

  return useQuery({
    queryKey: userTrackingKeys.metrics(userId ?? ''),
    queryFn: async (): Promise<TrackingMetrics | null> => {
      if (!checkIns || checkIns.length === 0) return null;

      // Get last 7 days of data
      const last7 = checkIns.slice(0, 7);

      return {
        avg_energy_7d: calculateAverage(last7.map(c => c.energy_level)),
        avg_mood_7d: calculateAverage(last7.map(c => c.mood_level)),
        avg_pain_7d: calculateAverage(last7.map(c => c.pain_level)),
        avg_sleep_7d: calculateAverage(last7.map(c => c.sleep_quality)),
        checkin_streak: calculateStreak(checkIns.map(c => c.check_in_date)),
        last_checkin_date: checkIns[0]?.check_in_date ?? null,
        trend: determineTrend(checkIns),
      };
    },
    enabled: !!userId && !!checkIns && checkIns.length > 0,
  });
}

/**
 * Combined hook for all user health data.
 *
 * **Consent is internal** — callers pass only `userId`.
 * The hook itself fetches consent status and gates all sub-queries.
 * Callers can still read `consentStatus` to show UI indicators.
 *
 * @param userId - User UUID (or null to disable)
 *
 * @example
 * ```tsx
 * const { checkIns, metrics, consentStatus, isLoading } = useUserTrackingData(userId);
 *
 * if (consentStatus !== 'granted') {
 *   return <ConsentRequiredBanner />;
 * }
 * ```
 */
export function useUserTrackingData(userId: string | null) {
  const consent = useUserConsentStatus(userId);
  const consentStatus = consent.data ?? null;

  const checkIns = useUserCheckIns(userId, consentStatus);
  const dosingLogs = useUserDosingLogs(userId, consentStatus);
  const symptomLogs = useUserSymptomLogs(userId, consentStatus);
  const metrics = useUserTrackingMetrics(userId);

  return {
    checkIns: checkIns.data ?? [],
    consentStatus,
    dosingLogs: dosingLogs.data ?? [],
    error: consent.error || checkIns.error || dosingLogs.error || symptomLogs.error || metrics.error,
    isConsentLoading: consent.isLoading,
    isLoading: consent.isLoading || checkIns.isLoading || dosingLogs.isLoading || symptomLogs.isLoading || metrics.isLoading,
    metrics: metrics.data ?? null,
    symptomLogs: symptomLogs.data ?? [],
  };
}

// =====================================================
// Pure utility functions
// =====================================================

/** @internal */
export function calculateAverage(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length === 0) return null;
  return Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10;
}

/** @internal */
export function determineTrend(checkIns: TrackingCheckIn[]): 'improving' | 'stable' | 'declining' {
  if (checkIns.length < 4) return 'stable';

  const mid = Math.floor(checkIns.length / 2);
  const recent = checkIns.slice(0, mid);
  const older = checkIns.slice(mid);

  const recentMood = calculateAverage(recent.map(c => c.mood_level)) ?? 0;
  const olderMood = calculateAverage(older.map(c => c.mood_level)) ?? 0;
  const recentEnergy = calculateAverage(recent.map(c => c.energy_level)) ?? 0;
  const olderEnergy = calculateAverage(older.map(c => c.energy_level)) ?? 0;

  const diff = ((recentMood - olderMood) + (recentEnergy - olderEnergy)) / 2;

  if (diff > 0.5) return 'improving';
  if (diff < -0.5) return 'declining';
  return 'stable';
}

/** @internal */
export function calculateStreak(dates: string[]): number {
  if (dates.length === 0) return 0;

  let streak = 1;

  for (let i = 0; i < dates.length - 1; i++) {
    const current = new Date(dates[i]);
    const next = new Date(dates[i + 1]);
    current.setHours(0, 0, 0, 0);
    next.setHours(0, 0, 0, 0);

    const diffDays = Math.floor((current.getTime() - next.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}
