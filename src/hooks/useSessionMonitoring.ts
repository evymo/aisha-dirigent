import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { aisha } from '@/integrations/db/client';
import { toast } from "sonner";
import { safeError } from "@/lib/security/safeLogger";
import { parseUserAgent } from "@/lib/monitoring/rozborUserAgentu";
import type { Database } from '@/integrations/db/types';

// Type for audit journal details with expected shape for session monitoring
interface AuditJournalDetails {
  country?: string | null;
  city?: string | null;
  location_change?: boolean;
  failed_attempts?: number;
  requests_per_minute?: number;
  concurrent_sessions?: number;
  records_accessed?: number;
  [key: string]: unknown;
}

// Type for audit journal row from the select query
type AuditJournalRow = Database["public"]["Tables"]["audit_journal"]["Row"];

// Extended type that includes the joined security_event_resolutions (kept for reference)
// type AuditJournalWithResolutions = Pick<AuditJournalRow, 'id' | 'user_id' | 'user_email' | 'ip_address' | 'created_at' | 'details' | 'severity' | 'tags'> & {
//   security_event_resolutions?: Array<{ resolved_at: string | null; resolved_by: string | null; resolution_notes: string | null; }> | null;
// };

/**
 * Session Activity Monitoring Hook
 * 
 * Provides real-time monitoring of user sessions for security purposes:
 * - Active session tracking
 * - Suspicious activity detection
 * - Session management (force logout)
 * - Geographic anomaly detection
 * - Rate limiting violation tracking
 */

export interface SessionActivity {
  id: string;
  user_id: string;
  user_email: string | null;
  user_role: string | null;
  session_id: string;
  ip_address: string | null;
  user_agent: string | null;
  country: string | null;
  city: string | null;
  device_type: string | null;
  browser: string | null;
  os: string | null;
  first_seen_at: string;
  last_activity_at: string;
  activity_count: number;
  is_active: boolean;
  is_suspicious: boolean;
  suspicious_reason: string | null;
  risk_score: number;
}

export interface SuspiciousPattern {
  id: string;
  pattern_type: 'rapid_requests' | 'geo_anomaly' | 'brute_force' | 'unusual_hours' | 'multiple_sessions' | 'data_exfiltration';
  user_id: string | null;
  user_email: string | null;
  ip_address: string | null;
  details: Record<string, unknown>;
  severity: 'low' | 'medium' | 'high' | 'critical';
  detected_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_notes: string | null;
}

export interface SessionStats {
  totalActiveSessions: number;
  uniqueUsers: number;
  suspiciousSessions: number;
  avgSessionDuration: number;
  peakHour: number;
  hourlyActivity: { hour: string; sessions: number }[];
  topCountries: { country: string; count: number }[];
  deviceBreakdown: { device: string; count: number }[];
  recentLogins: number;
  failedLogins: number;
  rateLimit: {
    violations: number;
    violationIPs: string[];
  };
}

export interface UseSessionMonitoringFilters {
  activeOnly?: boolean;
  suspiciousOnly?: boolean;
  userId?: string;
  ipAddress?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}

// Calculate risk score based on various factors (currently unused, kept for future use)
// function calculateRiskScore(session: Partial<SessionActivity>, patterns: SuspiciousPattern[]): number {
//   let score = 0;
//   if (session.activity_count && session.activity_count > 100) score += 20;
//   if (session.activity_count && session.activity_count > 500) score += 30;
//   const userPatterns = patterns.filter(p => p.user_id === session.user_id);
//   score += userPatterns.length * 15;
//   const criticalPatterns = userPatterns.filter(p => p.severity === 'critical');
//   score += criticalPatterns.length * 25;
//   if (!session.country) score += 10;
//   if (session.device_type === 'Unknown') score += 5;
//   return Math.min(score, 100);
// }

/**
 * Hook for monitoring user sessions and activity.
 *
 * This hook fetches session data from the audit journal, aggregates it by session ID,
 * and calculates risk scores and suspicious activity flags.
 *
 * @param filters - Optional filters for the session query.
 * @returns Query result containing a list of session activities.
 */
export function useSessionMonitoring(filters: UseSessionMonitoringFilters = {}) {
  const { limit = 100 } = filters;

  return useQuery({
    queryKey: ['session-monitoring', filters],
    queryFn: async (): Promise<SessionActivity[]> => {
      // Query audit_journal for auth events via RPC
      const { data: auditData, error } = await aisha.rpc("get_session_monitoring_data", {
        p_end_date: filters.endDate?.toISOString(),
        p_ip_address: filters.ipAddress,
        p_limit: limit * 10
,
        p_start_date: filters.startDate?.toISOString(),
        p_user_id: filters.userId
    });

      if (error) throw new Error(error.message);

      // Aggregate by session_id
      const sessionMap = new Map<string, SessionActivity>();

      for (const entry of (auditData || []) as { id: string; user_id: string; user_email: string | null; user_role: string | null; session_id: string | null; ip_address: string | null; user_agent: string | null; created_at: string; action: string | null; metadata: AuditJournalDetails | null }[]) {
        const sessionId = entry.session_id || entry.user_id || 'unknown';
        const existing = sessionMap.get(sessionId);
        const { device, browser, os } = parseUserAgent(entry.user_agent);

        if (existing) {
          existing.activity_count += 1;
          if (new Date(entry.created_at) > new Date(existing.last_activity_at)) {
            existing.last_activity_at = entry.created_at;
          }
          if (new Date(entry.created_at) < new Date(existing.first_seen_at)) {
            existing.first_seen_at = entry.created_at;
          }
        } else {
          const entryMetadata = entry.metadata as AuditJournalDetails | null;
          const session: SessionActivity = {
            id: entry.id,
            user_id: entry.user_id || '',
            user_email: entry.user_email,
            user_role: entry.user_role,
            session_id: sessionId,
            ip_address: entry.ip_address,
            user_agent: entry.user_agent,
            country: entryMetadata?.country || null,
            city: entryMetadata?.city || null,
            device_type: device,
            browser: browser,
            os: os,
            first_seen_at: entry.created_at,
            last_activity_at: entry.created_at,
            activity_count: 1,
            is_active: isSessionActive(entry.created_at),
            is_suspicious: false,
            suspicious_reason: null,
            risk_score: 0,
          };
          sessionMap.set(sessionId, session);
        }
      }

      let sessions = Array.from(sessionMap.values());

      // Apply filters
      if (filters.activeOnly) {
        sessions = sessions.filter(s => s.is_active);
      }
      if (filters.suspiciousOnly) {
        sessions = sessions.filter(s => s.is_suspicious || s.risk_score > 50);
      }

      // Sort by last activity
      sessions.sort((a, b) => 
        new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime()
      );

      return sessions.slice(0, limit);
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });
}

function isSessionActive(lastActivity: string): boolean {
  const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
  return new Date(lastActivity).getTime() > thirtyMinutesAgo;
}

/**
 * Hook for fetching suspicious activity patterns.
 *
 * This hook retrieves detected suspicious patterns (e.g., brute force attempts,
 * geo anomalies) from the backend.
 *
 * @param filters - Optional filters for resolved status and severity.
 * @returns Query result containing a list of suspicious patterns.
 */
export function useSuspiciousPatterns(filters: { resolved?: boolean; severity?: string } = {}) {
  return useQuery({
    queryKey: ['suspicious-patterns', filters],
    queryFn: async (): Promise<SuspiciousPattern[]> => {
      // Query for suspicious patterns via RPC
      const { data, error } = await aisha.rpc("get_suspicious_patterns", {
        p_resolved: filters.resolved,
        p_severity: filters.severity,
      });

      if (error) throw new Error(error.message);

      return ((data || []) as {
        id: string;
        user_id: string | null;
        user_email: string | null;
        ip_address: string | null;
        created_at: string;
        metadata: unknown;
        severity: string;
        tags: string[] | null;
        resolved_at: string | null;
        resolved_by: string | null;
        resolution_notes: string | null;
      }[]).map((entry) => {
        const entryMetadata = (entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)) 
          ? entry.metadata as Record<string, unknown> 
          : {};
        return {
          id: entry.id,
          pattern_type: detectPatternType({ tags: entry.tags, details: entryMetadata as AuditJournalRow['details'] }),
          user_id: entry.user_id ?? null,
          user_email: entry.user_email ?? null,
          ip_address: entry.ip_address ?? null,
          details: entryMetadata,
          severity: entry.severity as SuspiciousPattern['severity'],
          detected_at: entry.created_at,
          resolved_at: entry.resolved_at ?? null,
          resolved_by: entry.resolved_by ?? null,
          resolution_notes: entry.resolution_notes ?? null,
        };
      });
    },
  });
}

function detectPatternType(entry: Pick<AuditJournalRow, 'tags' | 'details'>): SuspiciousPattern['pattern_type'] {
  const tags = entry.tags || [];
  const details = (entry.details as AuditJournalDetails) || {};

  const failedAttempts = details.failed_attempts ?? 0;
  const requestsPerMinute = details.requests_per_minute ?? 0;
  const concurrentSessions = details.concurrent_sessions ?? 0;
  const recordsAccessed = details.records_accessed ?? 0;
  const locationChange = details.location_change ?? false;

  if (tags.includes('brute_force') || failedAttempts > 5) return 'brute_force';
/**
 * Hook for calculating aggregated session statistics.
 *
 * This hook combines data from `useSessionMonitoring` and `useSuspiciousPatterns`
 * to provide high-level statistics like total active sessions, unique users,
 * and peak activity hours.
 *
 * @returns Memoized session statistics object.
 */
  if (tags.includes('geo_anomaly') || locationChange) return 'geo_anomaly';
  if (tags.includes('rate_limit') || requestsPerMinute > 100) return 'rapid_requests';
  if (tags.includes('unusual_hours')) return 'unusual_hours';
  if (tags.includes('multiple_sessions') || concurrentSessions > 3) return 'multiple_sessions';
  if (tags.includes('bulk_export') || recordsAccessed > 1000) return 'data_exfiltration';

  return 'rapid_requests';
}

export function useSessionStats() {
  const { data: sessions } = useSessionMonitoring({ limit: 500 });
  const { data: patterns } = useSuspiciousPatterns();

  return useMemo((): SessionStats => {
    if (!sessions) {
      return {
        totalActiveSessions: 0,
        uniqueUsers: 0,
        suspiciousSessions: 0,
        avgSessionDuration: 0,
        peakHour: 0,
        hourlyActivity: [],
        topCountries: [],
        deviceBreakdown: [],
        recentLogins: 0,
        failedLogins: 0,
        rateLimit: { violations: 0, violationIPs: [] },
      };
    }

    const activeSessions = sessions.filter(s => s.is_active);
    const uniqueUsers = new Set(sessions.map(s => s.user_id)).size;
    const suspiciousSessions = sessions.filter(s => s.is_suspicious || s.risk_score > 50).length;

    // Calculate average session duration
    const durations = sessions.map(s => 
      new Date(s.last_activity_at).getTime() - new Date(s.first_seen_at).getTime()
    );
    const avgDuration = durations.length > 0 
      ? durations.reduce((a, b) => a + b, 0) / durations.length / 1000 / 60 // in minutes
      : 0;

    // Find peak hour
    const hourCounts = new Array(24).fill(0);
    sessions.forEach(s => {
      const hour = new Date(s.last_activity_at).getHours();
      hourCounts[hour]++;
    });
    const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
    const hourlyActivity = hourCounts.map((count, i) => ({
      hour: `${i}:00`,
      sessions: count,
    }));

    // Top countries
    const countryCounts = new Map<string, number>();
    sessions.forEach(s => {
      const country = s.country || 'Unknown';
      countryCounts.set(country, (countryCounts.get(country) || 0) + 1);
    });
    const topCountries = Array.from(countryCounts.entries())
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Device breakdown
    const deviceCounts = new Map<string, number>();
    sessions.forEach(s => {
      const device = s.device_type || 'Unknown';
      deviceCounts.set(device, (deviceCounts.get(device) || 0) + 1);
    });
    const deviceBreakdown = Array.from(deviceCounts.entries())
      .map(([device, count]) => ({ device, count }))
      .sort((a, b) => b.count - a.count);

    // Recent logins (last 24h)
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recentLogins = sessions.filter(s => 
      new Date(s.first_seen_at).getTime() > oneDayAgo
    ).length;

    // Failed logins from patterns
    const failedLogins = patterns?.filter(p => p.pattern_type === 'brute_force').length || 0;

    // Rate limit violations
    const rateLimitPatterns = patterns?.filter(p => p.pattern_type === 'rapid_requests') || [];
    const violationIPs = [...new Set(rateLimitPatterns.map(p => p.ip_address).filter(Boolean))] as string[];

    return {
      totalActiveSessions: activeSessions.length,
      uniqueUsers,
      suspiciousSessions,
      avgSessionDuration: Math.round(avgDuration),
      peakHour,
      hourlyActivity,
      topCountries,
      deviceBreakdown,
      recentLogins,
/**
 * Hook for resolving a suspicious pattern.
 *
 * This hook provides a mutation to mark a suspicious pattern as resolved,
 * optionally adding resolution notes.
 *
 * @returns Mutation object for resolving patterns.
 */
      failedLogins,
      rateLimit: {
        violations: rateLimitPatterns.length,
        violationIPs,
      },
    };
  }, [sessions, patterns]);
}

export function useResolvePattern() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ patternId, notes }: { patternId: string; notes: string }) => {
      const { error } = await aisha.rpc("resolve_security_pattern", {
        p_notes: notes
,
        p_pattern_id: patternId
    });

      if (error) throw new Error(error.message);

      return { patternId, notes };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suspicious-patterns'] });
      toast.success('Pattern vyřešen', { description: 'Podezřelý pattern byl označen jako vyřešený.' });
    },
    onError: (error) => {
      safeError('Resolve pattern failed', error);
      toast.error('Chyba', { description: 'Nepodařilo se označit pattern jako vyřešený.' });
    },
  });
}
