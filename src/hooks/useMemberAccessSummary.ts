/**
 * Hook for fetching member access summary for StoryLoop
 * 
 * Combines consultant user data with data sharing consent status
 * to determine what level of access the partner has to each member.
 */

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { aisha } from "@/integrations/db/client";

import { useSession } from "./useSession";
import { safeError } from "@/lib/security/safeLogger";
import { 
  parseRpcArray, 
  consultantUserRegistrationSchema,
  dataSharingConsentRawSchema,
} from "@/lib/validation/rpcSchemas";
import type { MemberAccessSummary, MemberAccessLevel, ConsentStatus, DataCategory } from "@/schemas/memberAccessSchemas";

// Extended schema for consultant users with display_name from RPC
const consultantUserWithDisplayNameSchema = consultantUserRegistrationSchema.extend({
  display_name: z.string().nullable(),
});

type DataSharingConsentRaw = z.infer<typeof dataSharingConsentRawSchema>;

/**
 * Determine access level based on consent status
 */
function determineAccessLevel(consent: DataSharingConsentRaw | null): MemberAccessLevel {
  if (!consent) return 'anonymized'; // No consent record = anonymized only
  if (consent.revoked_at) return 'none'; // Revoked = no access
  if (consent.expires_at && new Date(consent.expires_at) < new Date()) return 'none'; // Expired
  return 'full'; // Active consent = full access
}

/**
 * Determine consent status for display
 */
function determineConsentStatus(consent: DataSharingConsentRaw | null): ConsentStatus {
  if (!consent) return 'never_asked';
  if (consent.revoked_at) return 'revoked';
  if (consent.expires_at && new Date(consent.expires_at) < new Date()) return 'expired';
  if (consent.consent_requested_at && !consent.granted_at) return 'pending';
  return 'granted';
}

/**
 * Get default permissions based on access level
 */
function getPermissions(accessLevel: MemberAccessLevel): MemberAccessSummary['permissions'] {
  const categories: DataCategory[] = [
    'health_checkins',
    'lab_results', 
    'documents',
    'assessments',
    'dosing_logs',
    'study_data',
  ];

  return categories.map(category => ({
    category,
    can_view: accessLevel === 'full' || accessLevel === 'limited',
    can_use_for_research: accessLevel === 'full',
    can_use_for_statistics: true, // Always true - anonymized data
  }));
}

const partnerUsersRecentActivityRowSchema = z
  .object({
    user_id: z.string(),
    last_check_in_at: z.union([z.string(), z.null()]).optional(),
    last_lab_at: z.union([z.string(), z.null()]).optional(),
    last_document_at: z.union([z.string(), z.null()]).optional(),
  })
  .passthrough();

function isWithinLastDays(timestamp: string | null | undefined, days: number): boolean {
  if (!timestamp) return false;

  const ms = Date.parse(timestamp);
  if (Number.isNaN(ms)) return false;

  const threshold = Date.now() - days * 24 * 60 * 60 * 1000;
  return ms >= threshold;
}

/**
 * Hook to fetch member access summaries for all users assigned to the consultant
 */
export function useMemberAccessSummaries() {
  const { user } = useSession();

  return useQuery({
    queryKey: ["member-access-summaries", user?.id],
    queryFn: async (): Promise<MemberAccessSummary[]> => {
      if (!user) return [];

      // Get consultant's users
      const { data: users, error: usersError } = await aisha.rpc("get_consultant_users");
      
      if (usersError) throw usersError;
      if (!users || users.length === 0) return [];

      // Zod validated users - no cast needed
      const typedUsers = parseRpcArray(consultantUserWithDisplayNameSchema, users, "get_consultant_users");

      // Get partner profile ID
      const { data: partnerProfileId, error: partnerError } = await aisha.rpc("get_current_partner_id");
      
      if (partnerError || !partnerProfileId) return [];

      // Get data sharing consents for this partner
      const { data: consents, error: consentsError } = await aisha.rpc("get_my_data_sharing_consents");
      
      if (consentsError) throw consentsError;

      // Create a map of user_id -> consent (Zod validated)
      const consentMap = new Map<string, DataSharingConsentRaw>();
      if (consents) {
        const validatedConsents = parseRpcArray(dataSharingConsentRawSchema, consents, "get_my_data_sharing_consents");
        validatedConsents.forEach(c => {
          consentMap.set(c.user_id, c);
        });
      }

      // Recent activity (audited RPC; fail-closed if unavailable)
      const recentActivityByUserId = new Map<
        string,
        {
          last_check_in_at?: string | null;
          last_lab_at?: string | null;
          last_document_at?: string | null;
        }
      >();

      {
        // Fail-closed: No fallbacks for sensitive data data access
        const { data: recentActivity, error: recentActivityError } = await aisha.rpc(
          "get_partner_users_recent_activity_audited"
        );

        if (recentActivityError) {
          // Log error but don't expose sensitive data through fallback mechanisms
          safeError(
            "[useMemberAccessSummary] Failed to fetch recent activity",
            recentActivityError
          );
          // Continue without activity data - fail-closed behavior
        } else {
          const parsed = z
            .array(partnerUsersRecentActivityRowSchema)
            .safeParse(recentActivity ?? []);

          if (parsed.success) {
            for (const row of parsed.data) {
              recentActivityByUserId.set(row.user_id, {
                last_check_in_at: row.last_check_in_at ?? null,
                last_lab_at: row.last_lab_at ?? null,
                last_document_at: row.last_document_at ?? null,
              });
            }
          }
        }
      }

      // Build access summaries with activity checks
      const summaries = await Promise.all(
        typedUsers.map(async (user): Promise<MemberAccessSummary> => {
          const consent = consentMap.get(user.user_id) || null;
          const accessLevel = determineAccessLevel(consent);
          const consentStatus = determineConsentStatus(consent);
          
          const activity = recentActivityByUserId.get(user.user_id);
          const hasRecentActivity =
            accessLevel === "full" || accessLevel === "limited"
              ? isWithinLastDays(activity?.last_check_in_at, 30) ||
                isWithinLastDays(activity?.last_lab_at, 30) ||
                isWithinLastDays(activity?.last_document_at, 30)
              : false;
          
          return {
            member_id: user.user_id,
            member_token: `M-${user.user_id.slice(0, 8).toUpperCase()}`,
            display_name: accessLevel !== 'anonymized' && accessLevel !== 'none' 
              ? (user.display_name || undefined) 
              : undefined,
            study_id: user.study_id,
            study_name: user.study_name,
            study_code: user.study_code,
            registration_id: user.registration_id,
            registration_status: user.status,
            access_level: accessLevel,
            consent_status: consentStatus,
            consent_granted_at: consent?.granted_at,
            consent_expires_at: consent?.expires_at || undefined,
            permissions: getPermissions(accessLevel),
            member_since: user.enrolled_at || undefined,
            has_recent_activity: hasRecentActivity,
          };
        })
      );

      return summaries;
    },
    enabled: !!user,
  });
}

/**
 * Hook to fetch a single member's access summary
 */
export function useMemberAccessSummary(memberId: string | null) {
  const { data: allSummaries, ...rest } = useMemberAccessSummaries();
  
  const summary = memberId 
    ? allSummaries?.find(s => s.member_id === memberId) 
    : undefined;

  return {
    ...rest,
    data: summary,
  };
}

/**
 * Hook to request data sharing consent from a member
 */
export function useRequestDataSharingConsent() {
  const { user } = useSession();

  return async (memberId: string, message?: string): Promise<boolean> => {
    if (!user) return false;

    const { error } = await aisha.rpc("request_data_sharing_consent", {
      p_message: message
,
      p_user_id: memberId
    });

    return !error;
  };
}
