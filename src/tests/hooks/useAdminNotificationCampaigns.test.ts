import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type NotificationCampaignInput,
  type NotificationCampaignScheduleInput,
  useAdminNotificationCampaigns,
  useDeleteNotificationCampaignSchedule,
  useNotificationCampaignDeliveriesAdmin,
  useNotificationCampaignRunsAdmin,
  useNotificationCampaignSchedulesAdmin,
  useUpsertNotificationCampaignSchedule,
} from "@/hooks/useAdminNotificationCampaigns";
import { createTestQueryClient, renderHookWithProviders } from "@/tests/utils/test-utils";

const rpcMock = vi.hoisted(() => vi.fn());
const safeErrorMock = vi.hoisted(() => vi.fn());
const guardAdminReadMock = vi.hoisted(() => vi.fn((_permission: string, fn: () => unknown) => fn));
const guardAdminMutationMock = vi.hoisted(() => vi.fn((_permission: string, fn: (input: unknown) => unknown) => fn));

vi.mock("@/integrations/db/client", () => ({
  aisha: {
    rpc: rpcMock,
  },
}));

vi.mock("@/lib/security/safeLogger", () => ({
  safeError: safeErrorMock,
}));

vi.mock("@/hooks/useAdminGuard", () => ({
  useAdminGuard: () => ({
    guardAdminRead: guardAdminReadMock,
    guardAdminMutation: guardAdminMutationMock,
  }),
}));

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const SCHEDULE_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const DELIVERY_ID = "55555555-5555-4555-8555-555555555555";

const campaignRow = {
  id: CAMPAIGN_ID,
  name: "Monthly nudge",
  description: null,
  title_key: "notifications.monthly.title",
  body_key: "notifications.monthly.body",
  base_locale: "en",
  link: "/member",
  data: { source: "test" },
  audience_type: "members",
  audience_filter: { tier: "basic" },
  send_push: true,
  send_inapp: true,
  is_active: true,
  created_at: "2026-04-01T00:00:00.000Z",
  updated_at: "2026-04-02T00:00:00.000Z",
  schedule_count: 1,
};

const scheduleRow = {
  id: SCHEDULE_ID,
  campaign_id: CAMPAIGN_ID,
  run_at: "2026-04-30T08:00:00.000Z",
  next_run_at: "2026-05-30T08:00:00.000Z",
  repeat_interval_minutes: 43_200,
  status: "scheduled",
  last_run_at: null,
  created_at: "2026-04-01T00:00:00.000Z",
  updated_at: "2026-04-02T00:00:00.000Z",
};

const runRow = {
  id: RUN_ID,
  campaign_id: CAMPAIGN_ID,
  schedule_id: SCHEDULE_ID,
  run_at: "2026-04-30T08:00:00.000Z",
  status: "completed",
  recipients_count: 10,
  push_sent: 8,
  inapp_sent: 10,
  errors: null,
};

const deliveryRow = {
  id: DELIVERY_ID,
  user_id: USER_ID,
  profile_display_name: "Aisha Member",
  profile_email: "member@example.test",
  title: "Monthly nudge",
  message: "Check your dashboard",
  type: "campaign",
  link: "/member",
  schedule_id: SCHEDULE_ID,
  is_read: false,
  created_at: "2026-04-30T08:00:00.000Z",
};

describe("useAdminNotificationCampaigns", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    safeErrorMock.mockReset();
    guardAdminReadMock.mockClear();
    guardAdminMutationMock.mockClear();
  });

  it("fetches campaign rows for admin UI", async () => {
    rpcMock.mockResolvedValueOnce({ data: [campaignRow], error: null });

    const { result } = renderHookWithProviders(() => useAdminNotificationCampaigns());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.campaigns).toEqual([campaignRow]);
    expect(rpcMock).toHaveBeenCalledWith("get_notification_campaigns_admin");
  });

  it("upserts, deletes and enqueues campaign sends", async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    rpcMock.mockImplementation(async (functionName: string) => {
      if (functionName === "get_notification_campaigns_admin") {
        return { data: [], error: null };
      }
      if (functionName === "upsert_notification_campaign_admin") {
        return { data: [campaignRow], error: null };
      }
      return { data: null, error: null };
    });

    const { result } = renderHookWithProviders(() => useAdminNotificationCampaigns(), { queryClient });

    const input: NotificationCampaignInput = {
      id: CAMPAIGN_ID,
      name: "Monthly nudge",
      description: null,
      title_key: "notifications.monthly.title",
      body_key: "notifications.monthly.body",
      base_locale: "en",
      link: "/member",
      data: { source: "test" },
      audience_type: "members",
      audience_filter: { tier: "basic" },
      send_push: true,
      send_inapp: false,
      is_active: true,
    };

    await act(async () => {
      await result.current.upsertCampaign.mutateAsync(input);
      await result.current.deleteCampaign.mutateAsync(CAMPAIGN_ID);
      await result.current.enqueueSend.mutateAsync(CAMPAIGN_ID);
    });

    expect(rpcMock).toHaveBeenCalledWith("upsert_notification_campaign_admin", {
      p_audience_filter: { tier: "basic" },
      p_audience_type: "members",
      p_base_locale: "en",
      p_body_key: "notifications.monthly.body",
      p_data: { source: "test" },
      p_description: undefined,
      p_id: CAMPAIGN_ID,
      p_is_active: true,
      p_link: "/member",
      p_name: "Monthly nudge",
      p_send_inapp: false,
      p_send_push: true,
      p_title_key: "notifications.monthly.title",
    });
    expect(rpcMock).toHaveBeenCalledWith("delete_notification_campaign_admin", {
      p_id: CAMPAIGN_ID,
    });
    expect(rpcMock).toHaveBeenCalledWith("enqueue_notification_campaign_send_admin", {
      p_campaign_id: CAMPAIGN_ID,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["admin-notification-campaigns"] });
  });

  it("fetches schedules, runs and deliveries", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: [scheduleRow], error: null })
      .mockResolvedValueOnce({ data: [runRow], error: null })
      .mockResolvedValueOnce({ data: { rows: [deliveryRow] }, error: null });

    const schedulesHook = renderHookWithProviders(() => useNotificationCampaignSchedulesAdmin(CAMPAIGN_ID));
    await waitFor(() => expect(schedulesHook.result.current.isSuccess).toBe(true));
    expect(schedulesHook.result.current.data).toEqual([scheduleRow]);

    const runsHook = renderHookWithProviders(() => useNotificationCampaignRunsAdmin(CAMPAIGN_ID, 5));
    await waitFor(() => expect(runsHook.result.current.isSuccess).toBe(true));
    expect(runsHook.result.current.data).toEqual([runRow]);

    const deliveriesHook = renderHookWithProviders(() => useNotificationCampaignDeliveriesAdmin(CAMPAIGN_ID, 10));
    await waitFor(() => expect(deliveriesHook.result.current.isSuccess).toBe(true));
    expect(deliveriesHook.result.current.data).toEqual([deliveryRow]);

    expect(rpcMock).toHaveBeenNthCalledWith(1, "get_notification_campaign_schedules_admin", {
      p_campaign_id: CAMPAIGN_ID,
    });
    expect(rpcMock).toHaveBeenNthCalledWith(2, "get_notification_campaign_runs_admin", {
      p_campaign_id: CAMPAIGN_ID,
      p_limit: 5,
    });
    expect(rpcMock).toHaveBeenNthCalledWith(3, "edge_mobile_notifications", {
      p_action: "get_campaign_notification_deliveries_admin",
      p_payload: {
        campaign_id: CAMPAIGN_ID,
        limit: 10,
      },
    });
  });

  it("keeps dependent queries disabled without a campaign id", () => {
    const schedulesHook = renderHookWithProviders(() => useNotificationCampaignSchedulesAdmin(null));
    const runsHook = renderHookWithProviders(() => useNotificationCampaignRunsAdmin(undefined));
    const deliveriesHook = renderHookWithProviders(() => useNotificationCampaignDeliveriesAdmin(null));

    expect(schedulesHook.result.current.fetchStatus).toBe("idle");
    expect(runsHook.result.current.fetchStatus).toBe("idle");
    expect(deliveriesHook.result.current.fetchStatus).toBe("idle");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("upserts and deletes campaign schedules", async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    rpcMock
      .mockResolvedValueOnce({ data: [scheduleRow], error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    const upsertHook = renderHookWithProviders(() => useUpsertNotificationCampaignSchedule(), { queryClient });
    const input: NotificationCampaignScheduleInput = {
      id: SCHEDULE_ID,
      campaign_id: CAMPAIGN_ID,
      run_at: "2026-04-30T08:00:00.000Z",
      repeat_interval_minutes: null,
      status: null,
    };

    await act(async () => {
      await upsertHook.result.current.mutateAsync(input);
    });

    expect(rpcMock).toHaveBeenNthCalledWith(1, "upsert_notification_campaign_schedule_admin", {
      p_campaign_id: CAMPAIGN_ID,
      p_id: SCHEDULE_ID,
      p_repeat_interval_minutes: undefined,
      p_run_at: "2026-04-30T08:00:00.000Z",
      p_status: "scheduled",
    });

    const deleteHook = renderHookWithProviders(() => useDeleteNotificationCampaignSchedule(), { queryClient });
    await act(async () => {
      await deleteHook.result.current.mutateAsync({ id: SCHEDULE_ID, campaignId: CAMPAIGN_ID });
    });

    expect(rpcMock).toHaveBeenNthCalledWith(2, "delete_notification_campaign_schedule_admin", {
      p_id: SCHEDULE_ID,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["admin-notification-campaign-schedules", CAMPAIGN_ID],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["admin-notification-campaigns"] });
  });

  it("logs and surfaces fetch errors", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "RPC failed" },
    });

    const { result } = renderHookWithProviders(() => useAdminNotificationCampaigns());

    await waitFor(() => expect(result.current.error).toMatchObject({ message: "RPC failed" }));
    expect(safeErrorMock).toHaveBeenCalledWith(
      "adminNotifications.fetch.failed",
      { message: "RPC failed" },
    );
  });

  it("throws when mutation RPC returns an empty response", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    const { result } = renderHookWithProviders(() => useAdminNotificationCampaigns());

    await expect(
      result.current.upsertCampaign.mutateAsync({
        name: "Missing response",
      }),
    ).rejects.toThrow("Missing campaign response");
    expect(safeErrorMock).toHaveBeenCalledWith(
      "adminNotifications.upsert.failed",
      expect.any(Error),
    );
  });
});
