import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "./useSession";
import { STUDY_ENROLLMENT_QUESTIONNAIRE_ID } from "@/lib/studyRegistrationSchema";

/**
 * Hook for managing RII (ReInvented Immunology) membership status.
 *
 * This hook determines if the current user is a member of the RII umbrella study,
 * their registration status, and whether they have completed necessary questionnaires.
 *
 * @returns Object containing membership status flags and registration data.
 * @example
 * const { isRIIMember, isRIIActive } = useRIIMembership();
 * if (isRIIActive) {
 *   // Show RII-exclusive content
 * }
 */
export function useRIIMembership() {
  const { user } = useSession();

  // Find the umbrella study using the is_umbrella flag
  const umbrellaStudyQuery = useQuery({
    queryKey: ["rii-umbrella-study"],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_umbrella_study");

      if (error) throw new Error(error.message);
      const raw = data as unknown;
      const asArray = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : null;
      const studies = (asArray as { id: string; code: string; name: string; is_umbrella: boolean }[] | null) ?? null;
      return studies && studies.length > 0 ? studies[0] : null;
    },
  });

  const umbrellaStudy = umbrellaStudyQuery.data ?? null;

  const registrationQuery = useQuery({
    queryKey: ["rii-membership", user?.id, umbrellaStudy?.id],
    queryFn: async () => {
      if (!user || !umbrellaStudy) return null;

      const { data, error } = await aisha.rpc("get_my_umbrella_registration", {
        p_study_id: umbrellaStudy.id,
      });

      if (error) throw new Error(error.message);
      const registrations =
        (data as {
          id: string;
          user_id: string;
          study_id: string;
          status: string;
          group_assignment: string | null;
          enrolled_at: string | null;
          completed_at: string | null;
          withdrawn_at: string | null;
          withdrawal_reason: string | null;
          baseline_data: Record<string, unknown> | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        }[] | null) ?? null;
      return registrations && registrations.length > 0 ? registrations[0] : null;
    },
    enabled: !!user && !!umbrellaStudy,
  });

  const registration = registrationQuery.data ?? null;

  // Check if user has completed the study registration questionnaire
  const questionnaireQuery = useQuery({
    queryKey: ["rii-questionnaire-completed", user?.id],
    queryFn: async () => {
      if (!user) return false;

      const { data, error } = await aisha.rpc("get_my_questionnaire_completed", {
        p_questionnaire_id: STUDY_ENROLLMENT_QUESTIONNAIRE_ID,
      });

      if (error) throw new Error(error.message);
      return data as boolean;
    },
    enabled: !!user,
  });

  const hasCompletedQuestionnaire = questionnaireQuery.data ?? false;

  // User is RII member only if enrolled/active/completed (not screening)
  const isRIIMember = !!registration && ["enrolled", "active", "completed"].includes(registration.status);
  // User is pending if in screening status
  const isPendingRII = !!registration && registration.status === "screening";
  // User is fully active in RII only if active/completed
  const isRIIActive = !!registration && ["active", "completed"].includes(registration.status);
  // User is approved (can access questionnaire) if enrolled but may not have completed questionnaire
  const isRIIApproved = isRIIMember;
  // User can take qualification test only if RII is active AND questionnaire completed
  const canTakeQualificationTest = isRIIActive && hasCompletedQuestionnaire;

  const isLoading =
    umbrellaStudyQuery.isLoading ||
    registrationQuery.isLoading ||
    (Boolean(user) && questionnaireQuery.isLoading);

  return {
    umbrellaStudy,
    registration,
    isRIIMember,
    isPendingRII,
    isRIIActive,
    isRIIApproved,
    hasCompletedQuestionnaire,
    canTakeQualificationTest,
    isLoading,
    umbrellaStudyId: umbrellaStudy?.id,
  };
}

export function useIsUmbrellaStudy(studyId: string) {
  const { data } = useQuery({
    queryKey: ["is-umbrella-study", studyId],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("is_umbrella_study", {
        p_study_id: studyId,
      });

      if (error) throw new Error(error.message);
      return data as boolean;
    },
    enabled: !!studyId,
  });

  return data ?? false;
}
