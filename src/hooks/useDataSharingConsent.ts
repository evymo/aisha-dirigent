import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "./useSession";
import { safeWarn } from "@/lib/security/safeLogger";
import { parseRpcArray, dataSharingConsentSchema, availablePartnerForSharingSchema } from "@/lib/validation/rpcSchemas";
import type { DataSharingConsentValidated, AvailablePartnerForSharingValidated } from "@/lib/validation/rpcSchemas";

/**
 * Represents a data sharing consent record.
 * Re-exported from validation schemas for convenience.
 */
export type DataSharingConsent = DataSharingConsentValidated;

/**
 * Represents a partner available for data sharing.
 * Re-exported from validation schemas for convenience.
 */
export type AvailablePartner = AvailablePartnerForSharingValidated;

function notNullish<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

// Helper function kept for potential future use
// function isNonEmptyString(value: string | null | undefined): value is string {
//   return typeof value === "string" && value.length > 0;
// }

/**
 * Hook for members to manage their data sharing consents.
 * Fetches list of active and revoked consents.
 *
 * @returns Query object containing list of data sharing consents.
 */
export function useDataSharingConsents() {
  const { user } = useSession();

  return useQuery({
    queryKey: ["data-sharing-consents", user?.id],
    queryFn: async (): Promise<DataSharingConsent[]> => {
      if (!user) return [];

      // RPC-only pattern
      const { data, error } = await aisha.rpc("get_my_data_sharing_consents");

      if (error) throw new Error(error.message);
      
      return parseRpcArray(dataSharingConsentSchema, data, "get_my_data_sharing_consents");
    },
    enabled: !!user,
  });
}

/**
 * Hook to get available partners the member can share data with.
 * Returns partners who are certified and available for data sharing.
 *
 * @returns Query object containing list of available partners.
 */
export function useAvailablePartnersForSharing() {
  const { user } = useSession();

  return useQuery({
    queryKey: ["available-partners-for-sharing", user?.id],
    queryFn: async (): Promise<AvailablePartner[]> => {
      if (!user) return [];

      // RPC-only pattern
      const { data, error } = await aisha.rpc("get_available_partners_for_sharing");

      if (error) throw new Error(error.message);

      return parseRpcArray(availablePartnerForSharingSchema, data, "get_available_partners_for_sharing");
    },
    enabled: !!user,
  });
}

/**
 * Hook to grant data sharing consent to a specific partner.
 *
 * @returns Mutation object for granting consent.
 */
export function useGrantDataSharing() {
  const queryClient = useQueryClient();
  const { user } = useSession();

  return useMutation({
    mutationFn: async (partnerId: string) => {
      if (!user) throw new Error("Not authenticated");

      // Use RPC-only pattern
      const { error } = await aisha.rpc("grant_data_sharing_consent", {
        p_partner_id: partnerId,
      });

      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["data-sharing-consents"] });
      queryClient.invalidateQueries({ queryKey: ["available-partners-for-sharing"] });
    },
  });
}

/**
 * Hook to revoke data sharing consent.
 */
export function useRevokeDataSharing() {
  const queryClient = useQueryClient();
  const { user } = useSession();

  return useMutation({
    mutationFn: async (consentId: string) => {
      if (!user) throw new Error("Not authenticated");

      // Use RPC-only pattern
      const { error } = await aisha.rpc("revoke_data_sharing_consent", {
        p_consent_id: consentId,
      });

      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["data-sharing-consents"] });
      queryClient.invalidateQueries({ queryKey: ["available-partners-for-sharing"] });
    },
  });
}

// Hook for partners to get cohort statistics (anonymized aggregate data)
export function useStudyCohortStatistics(studyIds: string[]) {
  return useQuery({
    queryKey: ["study-cohort-statistics", studyIds],
    queryFn: async () => {
      if (studyIds.length === 0) return [];

      const results = await Promise.all(
        studyIds.map(async (studyId) => {
          const { data, error } = await aisha.rpc("get_study_cohort_statistics", {
            p_study_id: studyId,
          });
          if (error) {
            safeWarn("useStudyCohortStatistics.rpcFailed", error);
            return null;
          }
          return data;
        })
      );

      return results.filter(notNullish).flat();
    },
    enabled: studyIds.length > 0,
  });
}

// Hook for partners to get cohort health trends (time-series data)
export function useStudyCohortTrends(studyIds: string[]) {
  return useQuery({
    queryKey: ["study-cohort-trends", studyIds],
    queryFn: async () => {
      if (studyIds.length === 0) return [];

      const results = await Promise.all(
        studyIds.map(async (studyId) => {
          const { data, error } = await aisha.rpc("get_study_cohort_trends", {
            p_study_id: studyId,
          });
          if (error) {
            safeWarn("useStudyCohortTrends.rpcFailed", error);
            return null;
          }
          return data;
        })
      );

      return results.filter(notNullish).flat();
    },
    enabled: studyIds.length > 0,
  });
}

// Hook for partners to get cohort lab trends (time-series data)
export function useStudyCohortLabTrends(studyIds: string[]) {
  const { user } = useSession();
  
  return useQuery({
    queryKey: ["study-cohort-lab-trends", user?.id, studyIds],
    queryFn: async () => {
      if (!user?.id) return [];
      if (studyIds.length === 0) return [];

      const results = await Promise.all(
        studyIds.map(async (studyId) => {
          const { data, error } = await aisha.rpc("get_study_cohort_lab_trends", {
            p_study_id: studyId,
          });
          if (error) {
            safeWarn("useStudyCohortLabTrends.rpcFailed", error);
            return null;
          }
          return data;
        })
      );

      return results.filter(notNullish).flat();
    },
    enabled: !!user?.id && studyIds.length > 0,
  });
}

/**
 * Hook for partners to check which users have granted consent.
 */
export function useConsentedUsers() {
  const { user } = useSession();

  return useQuery({
    queryKey: ["consented-users", user?.id],
    queryFn: async (): Promise<string[]> => {
      if (!user) return [];

      // RPC-only pattern
      const { data, error } = await aisha.rpc("get_consented_users");

      if (error) throw new Error(error.message);
      return (data as string[]) ?? [];
    },
    enabled: !!user,
  });
}
