/**
 * Studies hooks — discovery → enroll → scheduled questionnaires → consent (display).
 *
 * Studies are the platform's "clusters / areas of interest": each bundles
 * scheduled questionnaires + real health data into cohort metrics. All RPCs are
 * member-facing and audited; visibility is enforced server-side.
 *
 * Backed by: get_active_studies, get_study_detail, get_my_study_registrations,
 * enroll_in_study, get_study_questionnaires_mobile,
 * get_combined_study_consents, get_combined_consent_requirements_localized,
 * submit_study_consent_acceptance.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/config/api";
import {
  studySummarySchema,
  studyDetailSchema,
  studyRegistrationSchema,
  studyConsentItemSchema,
  studyConsentRequirementSchema,
  studyQuestionnairesResultSchema,
} from "@/types/schemas";
import { safeError } from "@/lib/security/safeLogger";
import type {
  StudySummary,
  StudyDetail,
  StudyRegistration,
  StudyConsentItem,
  StudyConsentRequirement,
  StudyQuestionnairesResult,
} from "@/types/schemas";

function parseArray<T>(data: unknown, schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }): T[] {
  if (!Array.isArray(data)) return [];
  return data.reduce<T[]>((acc, item) => {
    const r = schema.safeParse(item);
    if (r.success && r.data !== undefined) acc.push(r.data);
    return acc;
  }, []);
}

/** Active studies a member can discover / enrol in. */
export function useActiveStudies(locale = "en") {
  return useQuery<StudySummary[]>({
    queryKey: ["active-studies", locale],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_active_studies", { p_locale: locale });
      if (error) {
        safeError("useActiveStudies.fetch", error);
        throw error;
      }
      return parseArray<StudySummary>(data, studySummarySchema);
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Single study overview + funding progress. */
export function useStudyDetail(studyId: string | undefined, locale = "en") {
  return useQuery<StudyDetail | null>({
    queryKey: ["study-detail", studyId, locale],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_study_detail", {
        p_locale: locale,
        p_study_id: studyId!,
      });
      if (error) {
        safeError("useStudyDetail.fetch", error);
        throw error;
      }
      // get_study_detail RETURNS TABLE → PostgREST yields an array of one row.
      const row = Array.isArray(data) ? data[0] : data;
      const result = studyDetailSchema.safeParse(row);
      return result.success ? result.data : null;
    },
    enabled: !!studyId,
    staleTime: 5 * 60 * 1000,
  });
}

/** The member's own study enrolments + status. */
export function useMyStudyRegistrations(userId: string | undefined) {
  return useQuery<StudyRegistration[]>({
    queryKey: ["study-registrations", userId],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_my_study_registrations");
      if (error) {
        safeError("useMyStudyRegistrations.fetch", error);
        throw error;
      }
      return parseArray<StudyRegistration>(data, studyRegistrationSchema);
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

/** Enrol the current member in a study (creates a screening-status registration). */
export function useEnrollInStudy() {
  const queryClient = useQueryClient();
  return useMutation<{ registration_id?: string }, Error, { studyId: string }>({
    mutationFn: async ({ studyId }) => {
      const { data, error } = await api.rpc("enroll_in_study", { p_study_id: studyId });
      if (error) throw new Error(error.message);
      const result = (data ?? {}) as { success?: boolean; error?: string; registration_id?: string };
      if (result.success === false) throw new Error(result.error ?? "Enrolment failed");
      return { registration_id: result.registration_id };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["study-registrations"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => safeError("useEnrollInStudy.enroll", err),
  });
}

/** Scheduled questionnaires (due dates, rewards, pending/completed) for the member. */
export function useStudyQuestionnairesMobile(
  registrationId: string | undefined,
  locale = "en",
  enabled = true,
) {
  return useQuery<StudyQuestionnairesResult>({
    queryKey: ["study-questionnaires", registrationId ?? "all", locale],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_study_questionnaires_mobile", {
        p_locale: locale,
        p_study_registration_id: registrationId ?? undefined,
      });
      if (error) {
        safeError("useStudyQuestionnairesMobile.fetch", error);
        throw error;
      }
      const result = studyQuestionnairesResultSchema.safeParse(data);
      return result.success
        ? result.data
        : { questionnaires: [], total_pending: 0, total_completed: 0, notice: null };
    },
    enabled,
    staleTime: 60 * 1000,
  });
}

/** Combined umbrella + child study consent items (display / review). */
export function useStudyConsents(studyId: string | undefined, locale = "en") {
  return useQuery<StudyConsentItem[]>({
    queryKey: ["study-consents", studyId, locale],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_combined_study_consents", {
        p_locale: locale,
        p_study_id: studyId!,
      });
      if (error) {
        safeError("useStudyConsents.fetch", error);
        throw error;
      }
      return parseArray<StudyConsentItem>(data, studyConsentItemSchema);
    },
    enabled: !!studyId,
    staleTime: 5 * 60 * 1000,
  });
}

/** Combined umbrella + child consent requirements carrying consent_template_id for submit. */
export function useCombinedConsentRequirements(studyId: string | undefined, locale = "en") {
  return useQuery<StudyConsentRequirement[]>({
    queryKey: ["combined-consent-requirements", studyId, locale],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_combined_consent_requirements_localized", {
        p_locale: locale,
        p_study_id: studyId!,
      });
      if (error) {
        safeError("useCombinedConsentRequirements.fetch", error);
        throw error;
      }
      return parseArray<StudyConsentRequirement>(data, studyConsentRequirementSchema);
    },
    enabled: !!studyId,
    staleTime: 5 * 60 * 1000,
  });
}

/** Submit one accepted study consent template for the current member. */
export function useSubmitStudyConsentAcceptance() {
  const queryClient = useQueryClient();
  return useMutation<
    { id?: string; version?: string },
    Error,
    { studyId: string; consentTemplateId: string; granted?: boolean; signatureData?: string }
  >({
    mutationFn: async ({ studyId, consentTemplateId, granted = true, signatureData }) => {
      const { data, error } = await api.rpc("submit_study_consent_acceptance", {
        p_consent_template_id: consentTemplateId,
        p_granted: granted,
        p_signature_data: signatureData,
        p_study_id: studyId,
      });
      if (error) throw new Error(error.message);
      const result = (data ?? {}) as { success?: boolean; error?: string; id?: string; version?: string };
      if (result.success === false) throw new Error(result.error ?? "Consent submission failed");
      return { id: result.id, version: result.version };
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["study-consents", variables.studyId] });
      queryClient.invalidateQueries({ queryKey: ["my-consents"] });
      queryClient.invalidateQueries({ queryKey: ["my-compliance"] });
    },
    onError: (err) => safeError("useSubmitStudyConsentAcceptance.submit", err),
  });
}
