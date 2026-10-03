import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";

/**
 * Schema for the consent detail returned from the RPC.
 */
const consentDetailSchema = z.object({
  consent_type: z.string(),
  created_at: z.string().nullable(),
  document_url: z.string().nullable(),
  granted: z.boolean(),
  granted_at: z.string().nullable(),
  id: z.string(),
  revoked_at: z.string().nullable(),
  study_code: z.string().nullable(),
  study_id: z.string().nullable(),
  study_name: z.string().nullable(),
  study_name_key: z.string().nullable(),
  user_id: z.string(),
  version: z.string().nullable(),
});

export type ConsentDetail = z.infer<typeof consentDetailSchema>;

/**
 * Hook to fetch a single consent detail with audit logging.
 *
 * @param consentId - The UUID of the consent to fetch
 * @param options - Query options (enabled)
 */
export function useConsentDetail(
  consentId: string | null,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["consent-detail", consentId],
    queryFn: async (): Promise<ConsentDetail> => {
      if (!consentId) throw new Error("Consent ID is required");

      const { data, error } = await aisha.rpc(
        "get_consent_detail_audited",
        { p_consent_id: consentId },
      );

      if (error) {
        safeError("useConsentDetail.fetch", error);
        throw new Error(error.message);
      }

      if (!data || typeof data !== "object") {
        throw new Error("Empty consent data");
      }

      return consentDetailSchema.parse(data);
    },
    enabled: !!consentId && (options?.enabled !== false),
    staleTime: 2 * 60 * 1000,
  });
}
