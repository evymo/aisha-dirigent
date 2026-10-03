import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { parseRpcArray, combinedStudyConsentSchema } from "@/lib/validation/rpcSchemas";
import { aisha } from "@/integrations/db/client";
import { getConsentLocale } from "@/lib/i18n/locale";

/**
 * Schema for validating consent data from RPC
 */
export type StudyConsent = {
  id: string;
  consent_key: string;
  title: string | null;
  description: string | null;
  checkbox_label: string | null;
  is_required: boolean;
  display_order: number;
  document_url: string | null;
  study_code: string | null;
  is_umbrella: boolean;
};

/**
 * Validated consent with normalized fields
 */
export interface ValidatedStudyConsent {
  id: string;
  consentKey: string;
  title: string;
  description: string | null;
  checkboxLabel: string;
  isRequired: boolean;
  displayOrder: number;
  documentUrl: string | null;
  studyCode: string | null;
  isUmbrella: boolean;
}

/**
 * Hook to fetch combined consents for a study (umbrella + child).
 * Uses the `get_combined_study_consents` RPC to retrieve consents localized to the current language.
 *
 * @param studyId - The UUID of the study.
 * @param options - Configuration options.
 * @param options.enabled - Whether the query should run.
 * @returns Query object containing list of validated study consents.
 */
export function useCombinedStudyConsents(
  studyId: string | undefined,
  options?: { enabled?: boolean }
) {
  const { i18n } = useTranslation();
  const locale = getConsentLocale(i18n.language);

  return useQuery({
    queryKey: ["combined-study-consents", studyId, locale],
    queryFn: async (): Promise<ValidatedStudyConsent[]> => {
      if (!studyId) return [];

      const { data, error } = await aisha.rpc("get_combined_study_consents", {
        p_locale: locale,
        p_study_id: studyId,
      });

      if (error) throw new Error(error.message);

      const validated = parseRpcArray(
        combinedStudyConsentSchema,
        data,
        "get_combined_study_consents"
      );

      return validated
        .map((consent): ValidatedStudyConsent => ({
          id: consent.id,
          consentKey: consent.consent_key,
          title: consent.title || consent.consent_key,
          description: consent.description,
          checkboxLabel: consent.checkbox_label || consent.title || consent.consent_key,
          isRequired: consent.is_required,
          displayOrder: consent.display_order,
          documentUrl: consent.document_url,
          studyCode: consent.study_code,
          isUmbrella: consent.is_umbrella,
        }))
        .sort((a, b) => a.displayOrder - b.displayOrder);
    },
    enabled: options?.enabled !== false && Boolean(studyId),
    staleTime: 5 * 60 * 1000, // 5 minutes cache
  });
}

/**
 * Helper to check if all required consents have been accepted.
 *
 * @param consents - List of available consents.
 * @param acceptedConsents - Map of consent keys to boolean acceptance status.
 * @returns True if all required consents are accepted, false otherwise.
 */
export function validateRequiredConsents(
  consents: ValidatedStudyConsent[],
  acceptedConsents: Record<string, boolean>
): boolean {
  return consents
    .filter((c) => c.isRequired)
    .every((c) => acceptedConsents[c.consentKey] === true);
}

/**
 * Get list of accepted consent keys for submission
 */
export function getAcceptedConsentKeys(
  acceptedConsents: Record<string, boolean>
): string[] {
  return Object.entries(acceptedConsents)
    .filter(([_, accepted]) => accepted)
    .map(([key]) => key);
}
