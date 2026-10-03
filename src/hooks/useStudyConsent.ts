import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";

// Zod schema for special provisions response
const specialProvisionsResponseSchema = z.object({
  informed_consent_special_provisions: z.string().nullable(),
});

/**
 * Hook to fetch study informed consent special provisions
 */
export function useStudySpecialProvisions(studyId: string | undefined) {
  return useQuery({
    queryKey: ["study", "special-provisions", studyId],
    queryFn: async () => {
      if (!studyId) return null;

      const { data, error } = await aisha.rpc(
        "get_study_informed_consent_special_provisions",
        { p_study_id: studyId }
      );

      if (error) {
        safeError("consent.specialProvisions.fetchFailed", error);
        throw new Error(error.message);
      }

      const row = Array.isArray(data) ? data[0] : null;
      if (!row) return null;

      const parsed = specialProvisionsResponseSchema.safeParse(row);
      if (!parsed.success) {
        safeError("consent.specialProvisions.parseFailed", { issues: parsed.error.issues.length });
        return null;
      }

      return parsed.data.informed_consent_special_provisions;
    },
    enabled: !!studyId,
  });
}

type ConsentType = "informed_consent" | "data_processing" | "wearables";

interface SubmitConsentParams {
  studyId: string;
  consentType: ConsentType;
  signatureData?: string | null;
}

/**
 * Hook to submit study participant consent
 */
export function useSubmitStudyConsent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ studyId, consentType, signatureData }: SubmitConsentParams) => {
      const { data, error } = await aisha.rpc("submit_study_participant_consent", {
        p_consent_type: consentType,
        p_signature_data: signatureData ?? undefined
,
        p_study_id: studyId
    });

      if (error) {
        safeError("consent.submit.failed", error);
        throw new Error(error.message);
      }

      if (!data || (typeof data === "object" && "success" in data && data.success !== true)) {
        throw new Error("Consent submission failed");
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consents"] });
      queryClient.invalidateQueries({ queryKey: ["study", "registrations"] });
    },
  });
}
