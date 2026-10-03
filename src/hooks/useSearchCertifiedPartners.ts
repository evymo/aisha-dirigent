/**
 * Hook for searching certified partners to invite as story participants.
 *
 * Uses search_certified_partners_audited RPC to find partners
 * eligible for story collaboration.
 *
 * @module hooks/useSearchCertifiedPartners
 */

import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";

const CertifiedPartnerSchema = z.object({
  user_id: z.string().uuid(),
  display_name: z.string().nullable(),
  business_name: z.string().nullable(),
  certification_level: z.string(),
  avatar_url: z.string().nullable(),
});

export type CertifiedPartner = z.infer<typeof CertifiedPartnerSchema>;

/**
 * Search for certified partners by name / business name.
 *
 * @param query - Search query (minimum 2 characters).
 * @param options - Query options.
 * @returns Query result with matching certified partners.
 */
export function useSearchCertifiedPartners(
  query: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: ["certified-partners", "search", query] as const,
    queryFn: async (): Promise<CertifiedPartner[]> => {
      const { data, error } = await aisha.rpc(
        "search_certified_partners_audited",
        {
          p_limit: 20,
          p_search: query,
        }
      );

      if (error) {
        safeError("storyloop.searchCertifiedPartners", error);
        throw new Error(error.message);
      }

      const validated = z.array(CertifiedPartnerSchema).safeParse(data);
      if (!validated.success) {
        safeError("storyloop.searchCertifiedPartners.validation", validated.error);
        return [];
      }

      return validated.data;
    },
    enabled: (options?.enabled ?? true) && query.length >= 2,
    staleTime: 30_000,
  });
}
