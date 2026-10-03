import { useState, useEffect, useCallback } from "react";
import { useSession } from "./useSession";
import { safeError } from "@/lib/security/safeLogger";
import { getUserFacingDataErrorMessage } from "@/lib/security/userFacingErrors";
import { useSecureMode } from "./useSecureMode";
import { useIsMountedRef } from "./useIsMountedRef";

/**
 * Represents a daily health check-in record.
 * Contains subjective health metrics like pain, sleep, and mood.
 */
export interface TrackingCheckIn {
  id: string;
  user_id: string;
  study_registration_id: string | null;
  check_in_type: "morning" | "evening" | "weekly" | "monthly";
  check_in_date: string;
  pain_level: number | null;
  pain_location: string | null;
  pain_notes: string | null;
  sleep_quality: number | null;
  sleep_hours: number | null;
  energy_level: number | null;
  mood_level: number | null;
  steps_count: number | null;
  activity_minutes: number | null;
  exercise_type: string | null;
  womac_pain: number | null;
  womac_stiffness: number | null;
  womac_function: number | null;
  took_medication: boolean | null;
  medication_notes: string | null;
  side_effects: string | null;
  general_notes: string | null;
  created_at: string;
}

export interface LabResult {
  id: string;
  user_id: string;
  study_registration_id: string | null;
  test_date: string;
  lab_name: string | null;
  status: "pending" | "completed" | "reviewed";
  crp: number | null;
  esr: number | null;
  wbc: number | null;
  rbc: number | null;
  hemoglobin: number | null;
  platelets: number | null;
  glucose: number | null;
  hba1c: number | null;
  insulin: number | null;
  cholesterol_total: number | null;
  ldl: number | null;
  hdl: number | null;
  triglycerides: number | null;
  alt: number | null;
  ast: number | null;
  creatinine: number | null;
  vitamin_d: number | null;
  vitamin_b12: number | null;
  nk_cells: number | null;
  cd4_count: number | null;
  cd8_count: number | null;
  il_4: number | null;
  il_6: number | null;
  tnf_alpha: number | null;
  nad_nadh_ratio: number | null;
  omega3_index: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DosingLog {
  id: string;
  user_id: string;
  product_id: string | null;
  study_registration_id: string | null;
  logged_at: string;
  dose_amount: string | null;
  dose_unit: string;
  dose_count: number;
  taken_with_food: boolean | null;
  notes: string | null;
  created_at: string;
}

/**
 * Hook to fetch the user's health check-ins.
 *
 * This hook is sensitive data-protected and requires secure mode to be enabled.
 * It uses the `secureClient` to fetch data via the `get_my_health_check_ins_audited` RPC.
 *
 * @param limit - The maximum number of records to fetch (default: 30).
 * @param options - Configuration options.
 * @returns An object containing the check-ins, loading state, and any error.
 */
export function useTrackingCheckIns(limit = 30, options?: { enabled?: boolean }) {
  const { user } = useSession();
  const { isEnabled: isPhiEnabled, secureClient } = useSecureMode();
  const [checkIns, setCheckIns] = useState<TrackingCheckIn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useIsMountedRef();

  const enabled = (options?.enabled ?? true) && isPhiEnabled;

  const fetchCheckIns = useCallback(async () => {
    if (!enabled || !user || !secureClient) {
      if (isMountedRef.current) {
        setCheckIns([]);
        setLoading(false);
      }
      return;
    }

    try {
      const { data, error } = await secureClient.rpc("get_my_health_check_ins_audited", {
        p_limit: limit,
      });

      if (error) throw new Error(error.message);
      if (isMountedRef.current) {
        setCheckIns(data || []);
      }
    } catch (err) {
      safeError("useTrackingCheckIns.fetchCheckIns", err);
      if (isMountedRef.current) {
        setError(getUserFacingDataErrorMessage(err));
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [enabled, user, secureClient, limit, isMountedRef]);

  useEffect(() => {
    fetchCheckIns();
  }, [fetchCheckIns]);

  const createCheckIn = async (checkIn: Partial<TrackingCheckIn>) => {
    if (!enabled || !user || !secureClient) return { error: "Not authenticated" };

    try {
      // Try RPC first for audit logging
      const { data: rpcData, error: rpcError } = await secureClient.rpc("create_health_check_in", {
        p_activity_minutes: checkIn.activity_minutes ?? undefined,
        p_check_in_date: checkIn.check_in_date || new Date().toISOString().split("T")[0],
        p_check_in_type: checkIn.check_in_type || "morning",
        p_energy_level: checkIn.energy_level ?? undefined,
        p_exercise_type: checkIn.exercise_type ?? undefined,
        p_general_notes: checkIn.general_notes ?? undefined
,
        p_medication_notes: checkIn.medication_notes ?? undefined,
        p_mood_level: checkIn.mood_level ?? undefined,
        p_pain_level: checkIn.pain_level ?? undefined,
        p_pain_location: checkIn.pain_location ?? undefined,
        p_pain_notes: checkIn.pain_notes ?? undefined,
        p_side_effects: checkIn.side_effects ?? undefined,
        p_sleep_hours: checkIn.sleep_hours ?? undefined,
        p_sleep_quality: checkIn.sleep_quality ?? undefined,
        p_steps_count: checkIn.steps_count ?? undefined,
        p_study_registration_id: checkIn.study_registration_id || undefined,
        p_took_medication: checkIn.took_medication ?? undefined,
        p_womac_function: checkIn.womac_function ?? undefined,
        p_womac_pain: checkIn.womac_pain ?? undefined,
        p_womac_stiffness: checkIn.womac_stiffness ?? undefined
    });

      if (rpcError) {
        throw rpcError;
      }

      await fetchCheckIns();
      if (rpcData === null || typeof rpcData !== "object" || Array.isArray(rpcData)) {
        throw new Error("Unexpected response shape from create_health_check_in");
      }
      return { data: rpcData as unknown as TrackingCheckIn, error: null };
    } catch (err) {
      safeError("useTrackingCheckIns.createCheckIn", err);
      return { data: null, error: getUserFacingDataErrorMessage(err) };
    }
  };

  const todayCheckIn = checkIns.find(
    (c) => c.check_in_date === new Date().toISOString().split("T")[0]
  );

  return {
    checkIns,
    loading,
    error,
    todayCheckIn,
    createCheckIn,
    refetch: fetchCheckIns,
  };
}

/**
 * Hook to fetch the user's lab results.
 *
 * This hook is sensitive data-protected and requires secure mode to be enabled.
 * It uses the `secureClient` to fetch data via the `get_my_lab_results_audited` RPC.
 *
 * @param options - Configuration options.
 * @returns An object containing the lab results, loading state, and any error.
 */
export function useLabResults(options?: { enabled?: boolean }) {
  const { user } = useSession();
  const { isEnabled: isPhiEnabled, secureClient } = useSecureMode();
  const [labResults, setLabResults] = useState<LabResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useIsMountedRef();

  const enabled = (options?.enabled ?? true) && isPhiEnabled;

  const fetchLabResults = useCallback(async () => {
    if (!enabled || !user || !secureClient) {
      if (isMountedRef.current) {
        setLabResults([]);
        setLoading(false);
      }
      return;
    }

    try {
      const { data, error } = await secureClient.rpc("get_my_lab_results_audited", {
        p_limit: 200,
      });

      if (error) throw new Error(error.message);
      if (isMountedRef.current) {
        setLabResults(data || []);
      }
    } catch (err) {
      safeError("useLabResults.fetchLabResults", err);
      if (isMountedRef.current) {
        setError(getUserFacingDataErrorMessage(err));
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [enabled, user, secureClient, isMountedRef]);

  useEffect(() => {
    fetchLabResults();
  }, [fetchLabResults]);

  return {
    labResults,
    loading,
    error,
    refetch: fetchLabResults,
  };
}

/**
 * Hook to fetch the user's dosing logs.
 *
 * This hook is sensitive data-protected and requires secure mode to be enabled.
 * It uses the `secureClient` to fetch data via the `get_my_dosing_logs_audited` RPC.
 *
 * @param limit - The maximum number of records to fetch (default: 30).
 * @param options - Configuration options.
 * @returns An object containing the dosing logs, loading state, and logDose function.
 */
export function useDosingLogs(limit = 30, options?: { enabled?: boolean }) {
  const { user } = useSession();
  const { isEnabled: isPhiEnabled, secureClient } = useSecureMode();
  const [dosingLogs, setDosingLogs] = useState<DosingLog[]>([]);
  const [loading, setLoading] = useState(true);
  const isMountedRef = useIsMountedRef();

  const enabled = (options?.enabled ?? true) && isPhiEnabled;

  const fetchDosingLogs = useCallback(async () => {
    if (!enabled || !user || !secureClient) {
      if (isMountedRef.current) {
        setDosingLogs([]);
        setLoading(false);
      }
      return;
    }

    try {
      const { data, error } = await secureClient.rpc("get_my_dosing_logs_audited", {
        p_limit: limit,
      });

      if (error) throw new Error(error.message);
      if (isMountedRef.current) {
        setDosingLogs(data || []);
      }
    } catch (err) {
      safeError("useDosingLogs.fetchDosingLogs", err);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [enabled, user, secureClient, limit, isMountedRef]);

  useEffect(() => {
    fetchDosingLogs();
  }, [fetchDosingLogs]);

  const logDose = async (params: {
    distributionProtocolId?: string | null;
    productId?: string | null;
    studyRegistrationId?: string | null;
    doseAmount?: string | null;
    doseUnit?: string;
    doseCount?: number;
    doseTiming?: string[];
    isCustomDistribution?: boolean;
    reportType?: string;
    reportPeriodStart?: string | null;
    reportPeriodEnd?: string | null;
    takenWithFood?: boolean | null;
    notes?: string | null;
  }) => {
    if (!enabled || !user || !secureClient) return { error: "Not authenticated" };

    try {
      const { data: rpcData, error: rpcError } = await secureClient.rpc("create_dosing_log_audited", {
        p_distribution_protocol_id: params.distributionProtocolId ?? undefined,
        p_dose_amount: params.doseAmount ?? undefined,
        p_dose_count: params.doseCount ?? 1,
        p_dose_timing: params.doseTiming ?? undefined,
        p_dose_unit: params.doseUnit ?? 'drops',
        p_is_custom_distribution: params.isCustomDistribution ?? false,
        p_notes: params.notes ?? undefined
,
        p_product_id: params.productId ?? undefined,
        p_report_period_end: params.reportPeriodEnd ?? undefined,
        p_report_period_start: params.reportPeriodStart ?? undefined,
        p_report_type: params.reportType ?? 'daily',
        p_study_registration_id: params.studyRegistrationId ?? undefined,
        p_taken_with_food: params.takenWithFood ?? undefined
    });

      if (rpcError) {
        throw rpcError;
      }

      await fetchDosingLogs();
      return { data: rpcData, error: null };
    } catch (err) {
      safeError("useDosingLogs.logDose", err);
      return { data: null, error: getUserFacingDataErrorMessage(err) };
    }
  };

  return {
    dosingLogs,
    loading,
    logDose,
    refetch: fetchDosingLogs,
  };
}
