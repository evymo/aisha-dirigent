/**
 * Privacy & compliance hooks — the member's consents, data-sharing grants,
 * compliance summary, and active mobile sessions. All read-only + audited.
 *
 * Backed by: get_my_consents, get_my_data_sharing_consents,
 * get_my_compliance_summary, get_my_mobile_sessions.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/config/api";
import {
  consentSchema,
  dataSharingConsentSchema,
  complianceSummarySchema,
  mobileSessionSchema,
} from "@/types/schemas";
import { safeError } from "@/lib/security/safeLogger";
import type { Consent, DataSharingConsent, ComplianceSummary, MobileSession } from "@/types/schemas";

function parseArray<T>(
  data: unknown,
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
): T[] {
  if (!Array.isArray(data)) return [];
  return data.reduce<T[]>((acc, item) => {
    const r = schema.safeParse(item);
    if (r.success && r.data !== undefined) acc.push(r.data);
    return acc;
  }, []);
}

/** The member's study/platform consents. */
export function useMyConsents(userId: string | undefined) {
  return useQuery<Consent[]>({
    queryKey: ["my-consents", userId],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_my_consents");
      if (error) {
        safeError("useMyConsents.fetch", error);
        throw error;
      }
      return parseArray<Consent>(data, consentSchema);
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}

/** Partners the member shares data with. */
export function useMyDataSharingConsents(userId: string | undefined) {
  return useQuery<DataSharingConsent[]>({
    queryKey: ["my-data-sharing", userId],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_my_data_sharing_consents");
      if (error) {
        safeError("useMyDataSharingConsents.fetch", error);
        throw error;
      }
      return parseArray<DataSharingConsent>(data, dataSharingConsentSchema);
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}

/** The member's compliance summary (score, streak, discount eligibility). */
export function useMyComplianceSummary(userId: string | undefined) {
  return useQuery<ComplianceSummary | null>({
    queryKey: ["my-compliance", userId],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_my_compliance_summary");
      if (error) {
        safeError("useMyComplianceSummary.fetch", error);
        throw error;
      }
      const row = Array.isArray(data) ? data[0] : data;
      const result = complianceSummarySchema.safeParse(row);
      return result.success ? result.data : null;
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}

/** The member's registered mobile sessions/devices. */
export function useMyMobileSessions(userId: string | undefined) {
  return useQuery<MobileSession[]>({
    queryKey: ["my-mobile-sessions", userId],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_my_mobile_sessions");
      if (error) {
        safeError("useMyMobileSessions.fetch", error);
        throw error;
      }
      return parseArray<MobileSession>(data, mobileSessionSchema);
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}
