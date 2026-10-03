import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { useAdminGuard } from "@/hooks/useAdminGuard";
import {
  notificationCampaignArraySchema,
  notificationCampaignDeliveryArraySchema,
  notificationCampaignScheduleArraySchema,
  notificationCampaignRunArraySchema,
  parseArrayResponse,
  type NotificationCampaignRow,
  type NotificationCampaignDeliveryRow,
  type NotificationCampaignScheduleRow,
  type NotificationCampaignRunRow,
} from "@/lib/schemas/adminSchemas";

/**
 * Input payload for creating or updating a notification campaign.
 */
export interface NotificationCampaignInput {
  id?: string | null;
  name: string;
  description?: string | null;
  title_key?: string | null;
  body_key?: string | null;
  base_locale?: string | null;
  link?: string | null;
  data?: Record<string, unknown> | null;
  audience_type?: string | null;
  audience_filter?: Record<string, unknown> | null;
  send_push?: boolean;
  send_inapp?: boolean;
  is_active?: boolean;
}

/**
 * Input payload for creating or updating a campaign schedule.
 */
export interface NotificationCampaignScheduleInput {
  id?: string | null;
  campaign_id: string;
  run_at: string;
  repeat_interval_minutes?: number | null;
  status?: string | null;
}

/**
 * Fetch notification campaigns for admin UI.
 *
 * @returns Query state with campaigns and mutation helpers.
 */
export function useAdminNotificationCampaigns() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  const query = useQuery({
    queryKey: ["admin-notification-campaigns"],
    queryFn: async (): Promise<NotificationCampaignRow[]> => {
      const { data, error } = await aisha.rpc("get_notification_campaigns_admin");
      if (error) {
        safeError("adminNotifications.fetch.failed", error);
        throw new Error(error.message);
      }
      return parseArrayResponse(notificationCampaignArraySchema, data, "notificationCampaigns");
    },
    staleTime: 60_000,
  });

  const upsertCampaign = useMutation({
    mutationFn: guardAdminMutation(
      "upsert_notification_campaign_admin",
      async (input: NotificationCampaignInput): Promise<NotificationCampaignRow> => {
        const { data, error } = await aisha.rpc("upsert_notification_campaign_admin", {
          p_audience_filter: input.audience_filter !== null && input.audience_filter !== undefined ? JSON.parse(JSON.stringify(input.audience_filter)) : undefined,
          p_audience_type: input.audience_type !== null ? input.audience_type : undefined,
          p_base_locale: input.base_locale !== null ? input.base_locale : undefined,
          p_body_key: input.body_key !== null ? input.body_key : undefined,
          p_data: input.data !== null && input.data !== undefined ? JSON.parse(JSON.stringify(input.data)) : undefined,
          p_description: input.description !== null ? input.description : undefined,
          p_id: input.id ?? undefined,
          p_is_active: input.is_active ?? true,
          p_link: input.link ?? undefined,
          p_name: input.name,
          p_send_inapp: input.send_inapp ?? true,
          p_send_push: input.send_push ?? true,
          p_title_key: input.title_key ?? undefined,
        });
        if (error) throw new Error(error.message);
        const rows = parseArrayResponse(notificationCampaignArraySchema, data, "upsert_notification_campaign_admin");
        if (!rows[0]) {
          throw new Error("Missing campaign response");
        }
        return rows[0];
      }
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-notification-campaigns"] });
    },
    onError: (error) => {
      safeError("adminNotifications.upsert.failed", error);
    },
  });

  const deleteCampaign = useMutation({
    mutationFn: guardAdminMutation("delete_notification_campaign_admin", async (id: string) => {
      const { error } = await aisha.rpc("delete_notification_campaign_admin", {
        p_id: id,
      });
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-notification-campaigns"] });
    },
    onError: (error) => {
      safeError("adminNotifications.delete.failed", error);
    },
  });

  const enqueueSend = useMutation({
    mutationFn: guardAdminMutation("enqueue_notification_campaign_send_admin", async (campaignId: string) => {
      const { error } = await aisha.rpc("enqueue_notification_campaign_send_admin", {
        p_campaign_id: campaignId,
      });
      if (error) throw new Error(error.message);
    }),
    onError: (error) => {
      safeError("adminNotifications.enqueue.failed", error);
    },
  });

  return {
    campaigns: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    upsertCampaign,
    deleteCampaign,
    enqueueSend,
  };
}

/**
 * Fetch schedules for a given campaign.
 *
 * @param campaignId - Campaign identifier.
 * @returns Query state with schedules.
 */
export function useNotificationCampaignSchedulesAdmin(campaignId?: string | null) {
  const { guardAdminRead } = useAdminGuard();

  const fetchSchedules = guardAdminRead(
    "get_notification_campaign_schedules_admin",
    async (): Promise<NotificationCampaignScheduleRow[]> => {
      if (!campaignId) return [];
      const { data, error } = await aisha.rpc("get_notification_campaign_schedules_admin", {
        p_campaign_id: campaignId,
      });
      if (error) {
        safeError("adminNotifications.schedules.fetch.failed", error);
        throw new Error(error.message);
      }
      return parseArrayResponse(notificationCampaignScheduleArraySchema, data, "notificationCampaignSchedules");
    }
  );

  return useQuery({
    queryKey: ["admin-notification-campaign-schedules", campaignId],
    queryFn: fetchSchedules,
    enabled: !!campaignId,
    staleTime: 30_000,
  });
}

/**
 * Create or update a campaign schedule.
 *
 * @returns Mutation for schedule upserts.
 */
export function useUpsertNotificationCampaignSchedule() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation<NotificationCampaignScheduleRow, Error, NotificationCampaignScheduleInput>({
    mutationFn: guardAdminMutation(
      "upsert_notification_campaign_schedule_admin",
      async (input: NotificationCampaignScheduleInput): Promise<NotificationCampaignScheduleRow> => {
        const { data, error } = await aisha.rpc("upsert_notification_campaign_schedule_admin", {
          p_campaign_id: input.campaign_id,
          p_id: input.id ?? undefined,
          p_repeat_interval_minutes: input.repeat_interval_minutes ?? undefined,
          p_run_at: input.run_at,
          p_status: input.status ?? "scheduled",
        });
        if (error) throw new Error(error.message);
        const rows = parseArrayResponse(notificationCampaignScheduleArraySchema, data, "upsert_notification_campaign_schedule_admin");
        if (!rows[0]) {
          throw new Error("Missing schedule response");
        }
        return rows[0];
      }
    ),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin-notification-campaign-schedules", variables.campaign_id] });
      queryClient.invalidateQueries({ queryKey: ["admin-notification-campaigns"] });
    },
    onError: (error) => {
      safeError("adminNotifications.schedules.upsert.failed", error);
    },
  });
}

/**
 * Delete a campaign schedule.
 *
 * @returns Mutation for schedule deletion.
 */
export function useDeleteNotificationCampaignSchedule() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation<void, Error, { id: string; campaignId: string }>({
    mutationFn: guardAdminMutation("delete_notification_campaign_schedule_admin", async (input: { id: string; campaignId: string }) => {
      const { error } = await aisha.rpc("delete_notification_campaign_schedule_admin", {
        p_id: input.id,
      });
      if (error) throw new Error(error.message);
    }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin-notification-campaign-schedules", variables.campaignId] });
      queryClient.invalidateQueries({ queryKey: ["admin-notification-campaigns"] });
    },
    onError: (error) => {
      safeError("adminNotifications.schedules.delete.failed", error);
    },
  });
}

/**
 * Fetch recent runs for a given campaign.
 *
 * @param campaignId - Campaign identifier.
 * @param limit - Max number of runs to return.
 * @returns Query state with recent runs.
 */
export function useNotificationCampaignRunsAdmin(campaignId?: string | null, limit = 20) {
  const { guardAdminRead } = useAdminGuard();

  const fetchRuns = guardAdminRead(
    "get_notification_campaign_runs_admin",
    async (): Promise<NotificationCampaignRunRow[]> => {
      if (!campaignId) return [];
      const { data, error } = await aisha.rpc("get_notification_campaign_runs_admin", {
        p_campaign_id: campaignId,
        p_limit: limit,
      });
      if (error) {
        safeError("adminNotifications.runs.fetch.failed", error);
        throw new Error(error.message);
      }
      return parseArrayResponse(notificationCampaignRunArraySchema, data, "notificationCampaignRuns");
    }
  );

  return useQuery({
    queryKey: ["admin-notification-campaign-runs", campaignId, limit],
    queryFn: fetchRuns,
    enabled: !!campaignId,
    staleTime: 30_000,
  });
}

/**
 * Fetch recent in-app delivery rows for a given campaign.
 *
 * @param campaignId - Campaign identifier.
 * @param limit - Max number of deliveries to return.
 * @returns Query state with per-user deliveries.
 */
export function useNotificationCampaignDeliveriesAdmin(campaignId?: string | null, limit = 200) {
  const { guardAdminRead } = useAdminGuard();

  const fetchDeliveries = guardAdminRead(
    "edge_mobile_notifications",
    async (): Promise<NotificationCampaignDeliveryRow[]> => {
      if (!campaignId) return [];
      const { data, error } = await aisha.rpc("edge_mobile_notifications", {
        p_action: "get_campaign_notification_deliveries_admin",
        p_payload: {
          campaign_id: campaignId,
          limit,
        },
      });
      if (error) {
        safeError("adminNotifications.deliveries.fetch.failed", error);
        throw new Error(error.message);
      }
      const rows =
        (data as { rows?: unknown[] } | null)?.rows ?? [];
      return parseArrayResponse(
        notificationCampaignDeliveryArraySchema,
        rows,
        "notificationCampaignDeliveries"
      );
    }
  );

  return useQuery({
    queryKey: ["admin-notification-campaign-deliveries", campaignId, limit],
    queryFn: fetchDeliveries,
    enabled: !!campaignId,
    staleTime: 30_000,
  });
}
