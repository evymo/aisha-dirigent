import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { getUser as getKcUser } from "@/integrations/auth/oidc-client";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";
import { parseRpcArray } from "@/lib/validation/rpcSchemas";

// Zod schema for consent request in member UI
const consentRequestSchema = z.object({
  id: z.string().uuid(),
  partner_id: z.string().uuid(),
  partner_name: z.string(),
  partner_email: z.string(),
  consent_requested_at: z.string(),
  granted_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  expires_at: z.string().nullable(),
});

export type ConsentRequest = z.infer<typeof consentRequestSchema>;

/**
 * Hook to fetch data sharing consents for member UI
 */
export function useMemberDataSharingConsents() {
  return useQuery({
    queryKey: ["member", "data-sharing-consents"],
    queryFn: async () => {
      const user = await getKcUser();
      if (!user) return [];

      const { data, error } = await aisha.rpc("get_my_data_sharing_consents");
      if (error) {
        safeError("member.consents.fetchFailed", error);
        throw new Error(error.message);
      }

      return parseRpcArray(consentRequestSchema, data, "get_my_data_sharing_consents");
    },
  });
}

/**
 * Hook to grant data sharing consent
 */
export function useGrantConsentById() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (consentId: string) => {
      const { error } = await aisha.rpc("grant_data_sharing_consent_by_id", {
        p_consent_id: consentId,
      });

      if (error) {
        safeError("member.consents.grantFailed", error);
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["member", "data-sharing-consents"] });
    },
  });
}

/**
 * Hook to revoke data sharing consent
 */
export function useRevokeConsentById() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (consentId: string) => {
      const { error } = await aisha.rpc("revoke_data_sharing_consent", {
        p_consent_id: consentId,
      });

      if (error) {
        safeError("member.consents.revokeFailed", error);
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["member", "data-sharing-consents"] });
    },
  });
}
