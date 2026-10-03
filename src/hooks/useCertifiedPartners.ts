import { useQuery, keepPreviousData, queryOptions } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import type { PartnerProfile } from "@/hooks/usePartners";
import { parseRpcArray, partnerAvailabilitySchema, certifiedPartnerRowSchema } from "@/lib/validation/rpcSchemas";
import type { PartnerAvailabilityValidated } from "@/lib/validation/rpcSchemas";
import { PUBLIC_QUERY_OPTIONS } from "@/lib/reactQuery/queryDefaults";

export interface CertifiedPartnerWithAvailability extends PartnerProfile {
  availability?: PartnerAvailabilityValidated[];
  hasAvailability: boolean;
}

/**
 * Options for fetching certified partners
 */
export interface CertifiedPartnersOptions {
  includeAvailability?: boolean;
  randomize?: boolean;
  limit?: number;
}

/**
 * Query options for certified partners - compatible with data router
 */
export function certifiedPartnersQueryOptions(options: CertifiedPartnersOptions = {}) {
  const includeAvailability = options.includeAvailability ?? false;
  const randomize = options.randomize ?? false;
  const limit = options.limit;

  return queryOptions({
    queryKey: ["certified-partners", includeAvailability, randomize, limit] as const,
    queryFn: async (): Promise<CertifiedPartnerWithAvailability[]> => {
      // Use RPC-only pattern - avoid undefined in RPC payloads (PostgREST treats missing keys as missing args)
      const { data, error } = await aisha.rpc("get_certified_partners", {
        p_include_availability: includeAvailability,
        p_limit: limit
,
        p_randomize: randomize
    });

      if (error) {
        safeError("CertifiedPartners.fetch", error);
        throw new Error(error.message);
      }

      if (!data) {
        return [];
      }

      const dataArr = parseRpcArray(certifiedPartnerRowSchema, data, "get_certified_partners");
      
      // Map PostgreSQL lowercase 'hasavailability' to camelCase 'hasAvailability'
      // Validate availability array with schema - Zod validated, explicit return type
      return dataArr.map((partner): CertifiedPartnerWithAvailability => {
        const rawAvail = partner.availability;
        const validatedAvail = rawAvail ? parseRpcArray(partnerAvailabilitySchema, rawAvail, "partner.availability") : undefined;
        return {
          ...partner,
          availability: validatedAvail,
          hasAvailability: partner.hasavailability ?? false,
        };
      });
    },
    ...PUBLIC_QUERY_OPTIONS,
    placeholderData: keepPreviousData,
  });
}

/**
 * Hook to fetch certified partners (those with `certification_passed_at` set).
 * Optionally includes their availability data.
 *
 * @param options - Configuration options for fetching partners.
 * @param options.includeAvailability - Whether to include availability data.
 * @param options.randomize - Whether to randomize the order of partners.
 * @param options.limit - Maximum number of partners to return.
 * @returns Query object containing list of certified partners.
 */
export function useCertifiedPartners(options?: CertifiedPartnersOptions) {
  return useQuery(certifiedPartnersQueryOptions(options ?? {}));
}

/**
 * Hook to get a random certified partner.
 * Useful for suggesting a default mentor or partner.
 *
 * @param options - Configuration options.
 * @param options.includeAvailability - Whether to include availability data.
 * @param options.preferWithAvailability - Whether to prefer partners with availability.
 * @returns Query object containing a single random certified partner or null.
 */
export function useRandomCertifiedPartner(options?: {
  includeAvailability?: boolean;
  preferWithAvailability?: boolean;
}) {
  const includeAvailability = options?.includeAvailability ?? true;
  const preferWithAvailability = options?.preferWithAvailability ?? true;

  return useQuery({
    queryKey: ["random-certified-partner", includeAvailability, preferWithAvailability],
    queryFn: async () => {
      // Use RPC-only pattern - get all certified partners with availability
      const { data, error } = await aisha.rpc("get_certified_partners", {
        p_include_availability: includeAvailability,
        p_limit: undefined
,
        p_randomize: true
    });

      if (error) {
        safeError("RandomCertifiedPartner.fetch", error);
        throw new Error(error.message);
      }

      if (!data) {
        return null;
      }

      const dataArr = parseRpcArray(certifiedPartnerRowSchema, data, "get_certified_partners_random");
      if (dataArr.length === 0) {
        return null;
      }

      // Map PostgreSQL lowercase 'hasavailability' to camelCase 'hasAvailability'
      // Validate availability array with schema - Zod validated, explicit return type
      const result = dataArr.map((partner): CertifiedPartnerWithAvailability => {
        const rawAvail = partner.availability;
        const validatedAvail = rawAvail ? parseRpcArray(partnerAvailabilitySchema, rawAvail, "partner.availability") : undefined;
        return {
          ...partner,
          availability: validatedAvail,
          hasAvailability: partner.hasavailability ?? false,
        };
      });

      // If preferring partners with availability, filter and pick from those
      if (preferWithAvailability) {
        const withAvailability = result.filter(p => p.hasAvailability);
        if (withAvailability.length > 0) {
          const randomIndex = Math.floor(Math.random() * withAvailability.length);
          return withAvailability[randomIndex];
        }
      }

      // Otherwise pick random from all
      const randomIndex = Math.floor(Math.random() * result.length);
      return result[randomIndex];
    },
    ...PUBLIC_QUERY_OPTIONS,
    placeholderData: keepPreviousData,
  });
}
