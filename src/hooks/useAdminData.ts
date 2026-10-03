import { useState, useEffect, useCallback } from "react";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { getUserFacingDataErrorMessage } from "@/lib/security/userFacingErrors";
import { usePermissions } from "./usePermissions";
import { useSession } from "./useSession";
import { useIsMountedRef } from "./useIsMountedRef";
import { parseRpcArray, studyRegistrationAdminRowSchema, membersSummaryAdminRowSchema } from "@/lib/validation/rpcSchemas";

/**
 * Detailed information about a study registration, including user profile and study details.
 * Used in admin dashboards.
 */
export interface RegistrationWithDetails {
  /** Unique identifier for the registration */
  id: string;
  /** ID of the enrolled user */
  user_id: string;
  /** ID of the study */
  study_id: string;
  /** Current status of the registration */
  status: "screening" | "enrolled" | "active" | "completed" | "withdrawn";
  /** Assigned group (e.g., control, experimental) */
  group_assignment: string | null;
  /** Date of registration */
  enrolled_at: string | null;
  /** Timestamp of record creation */
  created_at: string;
  /** Admin notes */
  notes: string | null;
  /** Baseline data collected at registration */
  baseline_data: unknown;
  /** Details of the associated study */
  study: {
    id: string;
    name: string;
    code: string;
    study_type: string;
  } | null;
  /** Profile details of the enrolled user */
  profile: {
    display_name: string | null;
    email: string | null;
    phone: string | null;
    date_of_birth: string | null;
    primary_diagnosis: string | null;
    current_medications: string | null;
    medical_history: string | null;
  } | null;
}

/**
 * Aggregated health data statistics for admin overview.
 */
export interface AggregateTrackingData {
  /** Total number of check-ins recorded */
  totalCheckIns: number;
  /** Average pain level across all check-ins */
  avgPainLevel: number;
  /** Average energy level across all check-ins */
  avgEnergyLevel: number;
  /** Average sleep quality across all check-ins */
  avgSleepQuality: number;
  /** Average mood level across all check-ins */
  avgMoodLevel: number;
  /** Daily check-in counts */
  checkInsByDate: { date: string; count: number }[];
}

/**
 * Summary of a member's activity and status for admin lists.
 */
export interface MemberSummary {
  /** Unique identifier for the member record */
  id: string;
  /** User ID */
  user_id: string;
  /** Display name */
  display_name: string | null;
  /** Email address */
  email: string | null;
  /** Current membership tier */
  membership_tier: string | null;
  /** Current membership status */
  membership_status: string | null;
  /** Total number of health check-ins submitted */
  total_check_ins: number;
  /** Date of the last check-in */
  last_check_in: string | null;
  /** Number of active study registrations */
  registrations_count: number;
}

/**
 * Hook to fetch all study registrations with details.
 * Restricted to admins.
 * 
 * @returns Object containing the list of registrations, loading state, and error state.
 */
export function useAllRegistrations() {
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");
  const [registrations, setRegistrations] = useState<RegistrationWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useIsMountedRef();

  const fetchRegistrations = useCallback(async () => {
    if (!isAdmin) {
      if (isMountedRef.current) {
        setRegistrations([]);
        setLoading(false);
      }
      return;
    }

    try {
      const { data, error: registrationsError } = await aisha.rpc("get_study_registrations_admin");
      if (registrationsError) throw registrationsError;

      const validatedData = parseRpcArray(studyRegistrationAdminRowSchema, data, "get_study_registrations_admin");

      // Transform Zod validated data - explicit return type, no cast needed
      const transformed: RegistrationWithDetails[] = validatedData.map((row): RegistrationWithDetails => ({
        id: row.id,
        user_id: row.user_id,
        study_id: row.study_id,
        status: row.status as RegistrationWithDetails["status"],
        group_assignment: row.group_assignment,
        enrolled_at: row.enrolled_at,
        created_at: row.created_at,
        notes: row.notes,
        baseline_data: row.baseline_data,
        study: row.study_id
          ? {
              id: row.study_id,
              name: row.study_name,
              code: row.study_code,
              study_type: row.study_type,
            }
          : null,
        profile: {
          display_name: row.profile_display_name ?? null,
          email: row.profile_email ?? null,
          phone: row.profile_phone ?? null,
          date_of_birth: row.profile_date_of_birth ?? null,
          primary_diagnosis: row.profile_primary_diagnosis ?? null,
          current_medications: row.profile_current_medications ?? null,
          medical_history: row.profile_medical_history ?? null,
        },
      }));

      if (isMountedRef.current) {
        setRegistrations(transformed);
      }
    } catch (err) {
      safeError("Error fetching all registrations", err);
      if (isMountedRef.current) {
        setError(getUserFacingDataErrorMessage(err));
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [isAdmin, isMountedRef]);

  useEffect(() => {
    fetchRegistrations();
  }, [fetchRegistrations]);

  const updateRegistrationStatus = async (
    registrationId: string,
    status: RegistrationWithDetails["status"]
  ) => {
    try {
      const { error } = await aisha.rpc("update_study_registration_status_admin", {
        p_registration_id: registrationId,
        p_status: status,
      });

      if (error) throw new Error(error.message);
      await fetchRegistrations();
      return { error: null };
    } catch (err) {
      safeError("Error updating registration", err);
      return { error: getUserFacingDataErrorMessage(err) };
    }
  };

  return {
    registrations,
    loading,
    error,
    updateRegistrationStatus,
    refetch: fetchRegistrations,
  };
}

/**
 * Hook to fetch aggregate health data for admin dashboard.
 * Calculates averages for pain, energy, sleep, and mood levels.
 *
 * @returns Object containing aggregate health metrics and loading state.
 */
export function useAggregateTrackingData() {
  const { hasPermission } = usePermissions();
  const { user } = useSession();
  const isAdmin = hasPermission("view_admin_dashboard");
  const [data, setData] = useState<AggregateTrackingData | null>(null);
  const [loading, setLoading] = useState(true);
  const isMountedRef = useIsMountedRef();

  useEffect(() => {
    async function fetchData() {
      if (!isAdmin || !user) {
        if (isMountedRef.current) {
          setLoading(false);
        }
        return;
      }

      try {
        // Fetch all health check-ins for aggregate analysis via Audited RPC
        const { data: checkIns, error } = await aisha.rpc("get_admin_health_check_ins_audited", {
          p_limit: 1000
        });

        if (error) throw new Error(error.message);

        if (!checkIns || checkIns.length === 0) {
          if (isMountedRef.current) {
            setData({
              totalCheckIns: 0,
              avgPainLevel: 0,
              avgEnergyLevel: 0,
              avgSleepQuality: 0,
              avgMoodLevel: 0,
              checkInsByDate: [],
            });
          }
          return;
        }

        // Calculate averages
        const validPain = checkIns.filter((c) => c.pain_level !== null);
        const validEnergy = checkIns.filter((c) => c.energy_level !== null);
        const validSleep = checkIns.filter((c) => c.sleep_quality !== null);
        const validMood = checkIns.filter((c) => c.mood_level !== null);

        const avgPainLevel = validPain.length
          ? validPain.reduce((sum, c) => sum + (c.pain_level || 0), 0) / validPain.length
          : 0;
        const avgEnergyLevel = validEnergy.length
          ? validEnergy.reduce((sum, c) => sum + (c.energy_level || 0), 0) / validEnergy.length
          : 0;
        const avgSleepQuality = validSleep.length
          ? validSleep.reduce((sum, c) => sum + (c.sleep_quality || 0), 0) / validSleep.length
          : 0;
        const avgMoodLevel = validMood.length
          ? validMood.reduce((sum, c) => sum + (c.mood_level || 0), 0) / validMood.length
          : 0;

        // Group check-ins by date (last 30 days)
        const dateGroups: Record<string, number> = {};
        checkIns.slice(0, 500).forEach((c) => {
          const date = c.check_in_date;
          dateGroups[date] = (dateGroups[date] || 0) + 1;
        });

        const checkInsByDate = Object.entries(dateGroups)
          .map(([date, count]) => ({ date, count }))
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(-30);

        if (isMountedRef.current) {
          setData({
            totalCheckIns: checkIns.length,
            avgPainLevel,
            avgEnergyLevel,
            avgSleepQuality,
            avgMoodLevel,
            checkInsByDate,
          });
        }
      } catch (err) {
        safeError("Error fetching aggregate health data", err);
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    }

    fetchData();
  }, [isAdmin, isMountedRef, user]);

  return { data, loading };
}

/**
 * Hook to fetch summary of all members for admin dashboard.
 * Includes membership status, check-in counts, and registration counts.
 *
 * @returns Object containing list of member summaries and loading state.
 */
export function useMembersSummary() {
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const isMountedRef = useIsMountedRef();

  useEffect(() => {
    async function fetchMembers() {
      if (!isAdmin) {
        if (isMountedRef.current) {
          setLoading(false);
        }
        return;
      }

      try {
        const { data, error } = await aisha.rpc("get_members_summary_admin");
        if (error) throw new Error(error.message);

        const validatedData = parseRpcArray(membersSummaryAdminRowSchema, data, "get_members_summary_admin");

        if (isMountedRef.current) {
          setMembers(
            validatedData.map((row) => ({
              id: row.id,
              user_id: row.user_id,
              display_name: row.display_name ?? null,
              email: row.email ?? null,
              membership_tier: row.membership_tier ?? null,
              membership_status: row.membership_status ?? null,
              total_check_ins: row.total_check_ins ?? 0,
              last_check_in: row.last_check_in ?? null,
              registrations_count: row.registrations_count ?? 0,
            }))
          );
        }
      } catch (err) {
        safeError("Error fetching members summary", err);
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    }

    fetchMembers();
  }, [isAdmin, isMountedRef]);

  return { members, loading };
}
