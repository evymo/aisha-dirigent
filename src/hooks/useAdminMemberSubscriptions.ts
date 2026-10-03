import { BASE_CURRENCY_FALLBACK } from "@/lib/currency/constants";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { parseArrayResponse, adminProfileRowSchema, type AdminProfileRow } from "@/lib/schemas/adminSchemas";
import { z } from "zod";
import { usePermissions } from "./usePermissions";
import { useSession } from "./useSession";
import { useAdminGuard } from "@/hooks/useAdminGuard";

// Schema for RPC response row - matches get_member_subscriptions_admin return type (alphabetical order)
const memberSubscriptionRpcRowSchema = z.object({
  amount_paid: z.number(),
  created_at: z.string(),
  currency: z.string().optional().default(BASE_CURRENCY_FALLBACK),
  id: z.string(),
  membership_id: z.string().nullable(),
  package_id: z.string().nullable(),
  package_name: z.string(),
  package_period: z.string(),
  package_tier: z.string(),
  period_end: z.string(),
  period_start: z.string(),
  status: z.string(),
  user_id: z.string(),
});

export type MemberSubscriptionRpcRow = z.infer<typeof memberSubscriptionRpcRowSchema>;

export interface MemberSubscription {
  id: string;
  user_id: string;
  package_id: string | null;
  membership_id: string | null;
  amount_paid: number;
  currency?: string;
  status: string;
  period_start: string;
  period_end: string;
  created_at: string;
  package: {
    name: string;
    tier: string;
    period: string;
  };
  profile: {
    display_name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
}

/**
 * Hook for fetching member subscriptions with admin privileges
 */
export function useMemberSubscriptionsAdmin() {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["admin-member-subscriptions"],
    queryFn: async (): Promise<MemberSubscription[]> => {
      if (!isAdmin || !user) return [];
      // Fetch subscriptions
      const { data: subsData, error: subsError } = await aisha.rpc(
        "get_member_subscriptions_admin"
      );

      if (subsError) {
        safeError("admin.subscriptions.fetchFailed", subsError);
        throw subsError;
      }

      const validatedSubsData = parseArrayResponse(
        z.array(memberSubscriptionRpcRowSchema),
        subsData,
        "subscriptions"
      );

      // Fetch profiles
      const userIds = [...new Set(validatedSubsData.map((s) => s.user_id))];
      let profilesMap: Record<string, MemberSubscription["profile"]> = {};

      if (userIds.length > 0) {
        const { data: profilesData, error: profilesError } = await aisha.rpc(
          "get_profiles_admin_by_user_ids",
          { p_user_ids: userIds }
        );

        if (profilesError) {
          safeError("admin.subscriptions.profilesFailed", profilesError);
          throw profilesError;
        }

        const profileRows = parseArrayResponse(
          z.array(adminProfileRowSchema),
          profilesData,
          "subscriptionProfiles"
        );

        profilesMap = profileRows.reduce<Record<string, MemberSubscription["profile"]>>(
          (acc, row: AdminProfileRow) => {
            acc[row.user_id] = {
              display_name: row.display_name,
              email: row.email,
              phone: row.phone,
            };
            return acc;
          },
          {}
        );
      }

      // Transform to component format
      return validatedSubsData.map((row) => ({
        id: row.id,
        user_id: row.user_id,
        package_id: row.package_id,
        membership_id: row.membership_id,
        amount_paid: row.amount_paid,
        currency: row.currency ?? BASE_CURRENCY_FALLBACK,
        status: row.status,
        period_start: row.period_start,
        period_end: row.period_end,
        created_at: row.created_at,
        package: {
          name: row.package_name,
          tier: row.package_tier,
          period: row.package_period,
        },
        profile: profilesMap[row.user_id] ?? null,
      }));
    },
    enabled: isAdmin && !!user,
  });
}

/**
 * Hook for updating member subscription status
 */
export function useUpdateMemberSubscriptionStatus() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("update_member_subscription_status_admin", async ({ subscriptionId, status }: { subscriptionId: string; status: string }) => {
      const { error } = await aisha.rpc("update_member_subscription_status_admin", {
        p_status: status
,
        p_subscription_id: subscriptionId
    });

      if (error) throw new Error(error.message);
      return { subscriptionId, status };
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-member-subscriptions"] });
    },
    onError: (error) => {
      safeError("admin.subscriptions.updateFailed", error);
    },
  });
}
