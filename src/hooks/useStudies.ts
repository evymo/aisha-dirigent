import { useState, useEffect, useCallback } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useTranslation } from "react-i18next";
import { safeError } from "@/lib/security/safeLogger";
import { getUserFacingDataErrorMessage } from "@/lib/security/userFacingErrors";
import { PUBLIC_QUERY_OPTIONS } from "@/lib/reactQuery/queryDefaults";
import { useSession } from "./useSession";
import { useIsMountedRef } from "./useIsMountedRef";
import type { Json } from "@/integrations/db/types";



/**
 * Represents a research study in the system.
 */
export interface Study {
  id: string;
  code: string;
  name: string;
  description: string | null;
  study_type: "observational" | "operational_trial" | "community";
  target_condition: string | null;
  products: string[] | null;
  duration_weeks: number | null;
  target_registration: number | null;
  current_registration: number | null;
  is_blinded: boolean | null;
  is_active: boolean | null;
  starts_at: string | null;
  ends_at: string | null;
  protocol_url: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Represents a user's registration in a study.
 */
export interface StudyRegistration {
  id: string;
  study_id: string;
  study_code: string;
  study_name: string;
  status: string;
  group_assignment: string | null;
  enrolled_at: string | null;
  completed_at: string | null;
  consultant_id: string | null;
  created_at: string;
}

/**
 * Represents a user's consent record for a study or data processing.
 */
export interface Consent {
  id: string;
  user_id: string;
  consent_type:
  | "data_processing"
  | "informed_consent"
  | "observation"
  | "operational_trial"
  | "wearables"
  | "marketing";
  study_id: string | null;
  version: string;
  granted: boolean;
  granted_at: string | null;
  revoked_at: string | null;
  document_url: string | null;
}

/**
 * Hook to fetch active research studies.
 *
 * This hook retrieves a list of studies that are currently active and available for registration.
 * It uses the `get_active_studies` RPC function to ensure secure access and proper filtering.
 *
 * @returns An object containing:
 * - `studies`: Array of active `Study` objects.
 * - `loading`: Boolean indicating if data is being fetched.
 * - `error`: Error message if the fetch failed.
 *
 * @example
 * ```tsx
 * const { studies, loading } = useStudies();
 *
 * if (loading) return <Spinner />;
 * return <StudyList studies={studies} />;
 * ```
 */
export function useStudies() {
  const { i18n } = useTranslation();
  const locale = i18n.language || "en";

  const query = useQuery({
    queryKey: ["active-studies", locale],
    queryFn: async (): Promise<Study[]> => {
      // Use RPC for secure access with audit logging
      const { data, error } = await aisha.rpc("get_active_studies" as never, {
        p_locale: locale,
      } as never) as { data: Study[] | null; error: Error | null };

      if (error) {
        safeError("Error fetching studies", error);
        throw new Error(error.message);
      }

      // Cast study_type from string to the expected union type
      return (data ?? []).map(s => ({
        ...s,
        study_type: s.study_type as Study["study_type"],
      }));
    },
    ...PUBLIC_QUERY_OPTIONS,
    placeholderData: keepPreviousData,
  });

  return {
    studies: query.data ?? [],
    loading: query.isLoading,
    error: query.error ? getUserFacingDataErrorMessage(query.error) : null,
  };
}

/**
 * Hook to fetch the current user's study registrations and perform registration.
 *
 * @returns Registration state, loading flag, error message, and registration helpers.
 */
export function useMyRegistrations() {
  const { user } = useSession();
  const [registrations, setRegistrations] = useState<StudyRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useIsMountedRef();

  const fetchRegistrations = useCallback(async () => {
    if (!user) {
      if (isMountedRef.current) {
        setRegistrations([]);
        setLoading(false);
      }
      return;
    }

    try {
      // Use RPC for secure access with audit logging
      const { data, error } = await aisha.rpc("get_my_study_registrations");

      if (error) throw new Error(error.message);

      if (isMountedRef.current) {
        setRegistrations(data ?? []);
      }
    } catch (err) {
      safeError("Error fetching registrations", err);
      if (isMountedRef.current) {
        setError(getUserFacingDataErrorMessage(err));
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [user, isMountedRef]);

  useEffect(() => {
    fetchRegistrations();
  }, [fetchRegistrations]);

  const enrollInStudy = async (studyId: string, baselineData?: Json) => {
    if (!user) return { error: "Not authenticated" };

    try {
      // Use RPC for secure registration with audit logging
      const { data, error } = await aisha.rpc("enroll_in_study", {
        p_baseline_data: baselineData ?? undefined
        ,
        p_study_id: studyId
      });

      if (error) throw new Error(error.message);

      await fetchRegistrations();
      return { data, error: null };
    } catch (err) {
      safeError("Error enrolling in study", err);
      return { data: null, error: getUserFacingDataErrorMessage(err) };
    }
  };

  return {
    registrations,
    loading,
    error,
    enrollInStudy,
    refetch: fetchRegistrations,
  };
}

/**
 * Hook to fetch and manage the current user's consent records.
 *
 * @returns Consent list, loading flag, and helper methods for grant/lookup.
 */
export function useConsents() {
  const { user } = useSession();
  const [consents, setConsents] = useState<Consent[]>([]);
  const [loading, setLoading] = useState(true);
  const isMountedRef = useIsMountedRef();

  const fetchConsents = useCallback(async () => {
    if (!user) {
      if (isMountedRef.current) {
        setConsents([]);
        setLoading(false);
      }
      return;
    }

    try {
      // Use RPC for secure access with audit logging
      const { data, error } = await aisha.rpc("get_my_consents");

      if (error) throw new Error(error.message);

      if (isMountedRef.current) {
        setConsents(data ?? []);
      }
    } catch (err) {
      safeError("Error fetching consents", err);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [user, isMountedRef]);

  useEffect(() => {
    fetchConsents();
  }, [fetchConsents]);

  const grantConsent = async (
    consentType: Consent["consent_type"],
    studyId?: string
  ) => {
    if (!user) return { error: "Not authenticated" };

    try {
      // Use RPC for secure consent granting with audit logging
      const { data, error } = await aisha.rpc("grant_consent", {
        p_consent_type: consentType,
        p_study_id: studyId ?? undefined,
      });

      if (error) throw new Error(error.message);

      await fetchConsents();
      return { data, error: null };
    } catch (err) {
      safeError("Error granting consent", err);
      return { data: null, error: getUserFacingDataErrorMessage(err) };
    }
  };

  const hasConsent = (consentType: Consent["consent_type"], studyId?: string) => {
    return consents.some(
      (c) =>
        c.consent_type === consentType &&
        c.granted &&
        !c.revoked_at &&
        (studyId ? c.study_id === studyId : true)
    );
  };

  return {
    consents,
    loading,
    grantConsent,
    hasConsent,
    refetch: fetchConsents,
  };
}
