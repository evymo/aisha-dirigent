import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { z } from "zod";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { usePermissions } from "@/hooks/usePermissions";
import { useAdminGuard } from "@/hooks/useAdminGuard";

// ─── Pending Counts ──────────────────────────────────────────

const adminPendingCountsSchema = z.object({
  pending_consultants: z.number(),
  pending_contributions: z.number(),
  pending_deletions: z.number(),
  pending_registrations: z.number(),
  pending_escalations: z.number(),
  pending_moderation: z.number(),
  pending_orders: z.number(),
  pending_subscriptions: z.number(),
});

export type AdminPendingCounts = z.infer<typeof adminPendingCountsSchema>;

const EMPTY_PENDING_COUNTS: AdminPendingCounts = {
  pending_consultants: 0,
  pending_contributions: 0,
  pending_deletions: 0,
  pending_registrations: 0,
  pending_escalations: 0,
  pending_moderation: 0,
  pending_orders: 0,
  pending_subscriptions: 0,
};

/**
 * Fetch pending action counts for all admin-actionable categories.
 *
 * @returns Counts for subscriptions, deletions, registrations, contributions,
 *          consultants, escalations, moderation, and orders.
 */
export function useAdminPendingCounts() {
  const { hasPermission } = usePermissions();
  const canView =
    hasPermission("view_admin_dashboard") ||
    hasPermission("view_staff_dashboard");

  return useQuery({
    queryKey: ["admin", "pending-counts"],
    enabled: canView,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<AdminPendingCounts> => {
      const { data, error } = await aisha.rpc("get_admin_pending_counts");

      if (error) {
        safeError("admin.pendingCounts.fetchFailed", error);
        throw new Error(error.message);
      }

      const row = Array.isArray(data) ? data[0] : data;
      const validated = adminPendingCountsSchema.safeParse(row);
      if (!validated.success) {
        safeError("admin.pendingCounts.validation", validated.error);
        return EMPTY_PENDING_COUNTS;
      }

      return validated.data;
    },
  });
}

// ─── Activity Feed ───────────────────────────────────────────

const activityFeedItemSchema = z.object({
  action_required: z.boolean(),
  created_at: z.string(),
  display_name: z.string().nullable(),
  item_id: z.string(),
  item_type: z.string(),
  membership_tier: z.string().nullable(),
  metadata: z.record(z.unknown()),
  user_id: z.string().nullable(),
});

export type ActivityFeedItem = z.infer<typeof activityFeedItemSchema>;

export type ActivityFeedItemType =
  | "consultant_pending"
  | "contribution_pending"
  | "deletion_pending"
  | "registration_pending"
  | "escalation_pending"
  | "moderation_pending"
  | "order_pending"
  | "subscription_pending";

export interface UseAdminActivityFeedParams {
  actionType?: ActivityFeedItemType | null;
  limit?: number;
  offset?: number;
  search?: string | null;
}

/**
 * Fetch unified admin activity feed with pending actions from all categories.
 *
 * @param params - Filtering/pagination params (actionType, limit, offset, search)
 * @returns Array of feed items with member context and action metadata.
 *
 * @example
 * const { data } = useAdminActivityFeed({ search: "Jan", actionType: "subscription_pending" });
 */
export function useAdminActivityFeed(
  params: UseAdminActivityFeedParams = {},
) {
  const { hasPermission } = usePermissions();
  const canView =
    hasPermission("view_admin_dashboard") ||
    hasPermission("view_staff_dashboard");

  const { actionType = null, limit = 50, offset = 0, search = null } = params;

  return useQuery({
    queryKey: ["admin", "activity-feed", { actionType, limit, offset, search }],
    enabled: canView,
    staleTime: 30_000,
    queryFn: async (): Promise<ActivityFeedItem[]> => {
      const { data, error } = await aisha.rpc("get_admin_activity_feed", {
        p_action_type: actionType ?? undefined,
        p_limit: limit,
        p_offset: offset,
        p_search: search ?? undefined,
      });

      if (error) {
        safeError("admin.activityFeed.fetchFailed", error);
        throw new Error(error.message);
      }

      if (!data || !Array.isArray(data)) return [];

      const validated = z.array(activityFeedItemSchema).safeParse(data);
      if (!validated.success) {
        safeError("admin.activityFeed.validation", validated.error);
        return [];
      }

      return validated.data;
    },
  });
}

// ─── Activity Feed Actions ───────────────────────────────────

/**
 * Resolve the RPC function name and parameters for approving an activity item.
 */
function resolveApproveAction(
  itemType: string,
  metadata: Record<string, unknown>,
): { params: Record<string, unknown>; rpcName: string } | null {
  switch (itemType) {
    case "subscription_pending":
      return {
        rpcName: "update_member_subscription_status_admin",
        params: {
          p_status: "approved",
          p_subscription_id: metadata.subscription_id as string,
        },
      };
    case "registration_pending":
      return {
        rpcName: "update_study_registration_status_admin",
        params: {
          p_registration_id: metadata.registration_id as string,
          p_status: "enrolled",
        },
      };
    case "contribution_pending":
      return {
        rpcName: "update_study_contribution_status_admin",
        params: {
          p_id: metadata.contribution_id as string,
          p_status: "completed",
        },
      };
    case "consultant_pending":
      return {
        rpcName: "update_study_consultant_status_admin",
        params: {
          p_id: metadata.consultant_id as string,
          p_status: "approved",
        },
      };
    case "moderation_pending":
      return {
        rpcName: "review_moderation_item",
        params: {
          p_decision: "approved",
          p_notes: "",
          p_queue_id: metadata.queue_id as string,
        },
      };
    default:
      return null;
  }
}

/**
 * Resolve the RPC function name and parameters for rejecting an activity item.
 */
function resolveRejectAction(
  itemType: string,
  metadata: Record<string, unknown>,
): { params: Record<string, unknown>; rpcName: string } | null {
  switch (itemType) {
    case "subscription_pending":
      return {
        rpcName: "update_member_subscription_status_admin",
        params: {
          p_status: "cancelled",
          p_subscription_id: metadata.subscription_id as string,
        },
      };
    case "registration_pending":
      return {
        rpcName: "update_study_registration_status_admin",
        params: {
          p_registration_id: metadata.registration_id as string,
          p_status: "withdrawn",
        },
      };
    case "consultant_pending":
      return {
        rpcName: "update_study_consultant_status_admin",
        params: {
          p_id: metadata.consultant_id as string,
          p_status: "rejected",
        },
      };
    case "moderation_pending":
      return {
        rpcName: "review_moderation_item",
        params: {
          p_decision: "rejected",
          p_notes: "",
          p_queue_id: metadata.queue_id as string,
        },
      };
    default:
      return null;
  }
}

/**
 * Hook providing approve/reject actions for admin activity feed items.
 * Wraps each RPC call with admin guard and handles query invalidation.
 *
 * @returns `approveItem` and `rejectItem` async callbacks.
 *
 * @example
 * const { approveItem, rejectItem } = useAdminActivityActions();
 * await approveItem(feedItem);
 */
export function useAdminActivityActions() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  const invalidateFeed = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin", "activity-feed"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "pending-counts"] });
    queryClient.invalidateQueries({ queryKey: ["admin"] });
  }, [queryClient]);

  const executeAction = useCallback(
    async (
      item: ActivityFeedItem,
      resolver: typeof resolveApproveAction,
    ): Promise<{ error: string | null; success: boolean }> => {
      const action = resolver(item.item_type, item.metadata);
      if (!action) {
        return { success: false, error: "unsupported_action_type" };
      }

      try {
        await guardAdminMutation(action.rpcName, async () => {
          const { error } = await aisha.rpc(
            action.rpcName as "update_member_subscription_status_admin",
            action.params as never,
          );
          if (error) throw new Error(error.message);
        })(undefined);

        invalidateFeed();
        return { success: true, error: null };
      } catch (err) {
        safeError("admin.activityFeed.actionFailed", err);
        return {
          success: false,
          error: err instanceof Error ? err.message : "unknown_error",
        };
      }
    },
    [guardAdminMutation, invalidateFeed],
  );

  const approveItem = useCallback(
    (item: ActivityFeedItem) => executeAction(item, resolveApproveAction),
    [executeAction],
  );

  const rejectItem = useCallback(
    (item: ActivityFeedItem) => executeAction(item, resolveRejectAction),
    [executeAction],
  );

  return { approveItem, rejectItem };
}
