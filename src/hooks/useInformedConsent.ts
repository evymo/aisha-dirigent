import { useConsents } from "./useStudies";
import { useRIIMembership } from "./useRIIMembership";

/**
 * Informed consent is per study (defaults to umbrella study when no studyId is provided).
 */
export function useHasInformedConsent(studyId?: string) {
  const { consents, loading, hasConsent, grantConsent, refetch } = useConsents();
  const { umbrellaStudyId, isLoading: riiLoading } = useRIIMembership();

  const effectiveStudyId = studyId ?? umbrellaStudyId ?? undefined;

  // Data processing consent may be stored per-study (existing schema); treat any granted as sufficient.
  const hasDataProcessingConsent = hasConsent("data_processing");

  // Study participation informed consent is per-study. Also accept 'observation' rows.
  const hasStudyConsent = effectiveStudyId
    ? (hasConsent("informed_consent", effectiveStudyId) ||
      hasConsent("observation", effectiveStudyId))
    : consents.some(
      (c) =>
        (c.consent_type === "informed_consent" ||
          c.consent_type === "observation") &&
        c.granted &&
        !c.revoked_at &&
        c.study_id !== null
    );

  return {
    hasInformedConsent: hasStudyConsent,
    hasDataProcessingConsent,
    hasStudyConsent,
    loading: loading || riiLoading,
    consents,
    grantConsent,
    refetch,
  };
}
