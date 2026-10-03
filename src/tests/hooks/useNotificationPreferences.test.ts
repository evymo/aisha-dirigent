import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import type { UserNotificationPreferences } from "@/hooks/useNotificationPreferences";

// --- hoisted mocks ---

const hoisted = vi.hoisted(() => ({
  rpc: vi.fn(),
  sessionUser: null as { id: string } | null,
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({ user: hoisted.sessionUser }),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpc(...args),
  },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/safeLogger")>();
  return { ...actual, safeError: vi.fn() };
});

// --- helpers ---

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

const MOCK_PREFS: UserNotificationPreferences = {
  push_enabled: true,
  push_reminders: true,
  push_health_insights: false,
  push_leaderboard: false,
  push_study_updates: true,
  push_achievements: false,
  quiet_hours_enabled: false,
  quiet_hours_start: "22:00",
  quiet_hours_end: "07:00",
  morning_start: "06:00",
  afternoon_start: "12:00",
  evening_start: "18:00",
  questionnaire_reminder_period: "morning",
  user_timezone: "Europe/Prague",
  email_weekly_summary: true,
  email_monthly_report: true,
  email_study_invitations: true,
  max_daily_push_notifications: 10,
  min_notification_interval_minutes: 30,
};

// --- tests ---

describe("useNotificationPreferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.sessionUser = { id: "user-1" };
    hoisted.rpc.mockResolvedValue({ data: MOCK_PREFS, error: null });
  });

  it("should fetch preferences when user is authenticated", async () => {
    const { useNotificationPreferences } = await import(
      "@/hooks/useNotificationPreferences"
    );

    const { result } = renderHook(() => useNotificationPreferences(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(hoisted.rpc).toHaveBeenCalledWith("get_my_notification_preferences");
    expect(result.current.notificationPreferences.push_enabled).toBe(true);
    expect(result.current.isError).toBe(false);
  });

  it("should NOT fetch when user is null (unauthenticated)", async () => {
    hoisted.sessionUser = null;

    const { useNotificationPreferences } = await import(
      "@/hooks/useNotificationPreferences"
    );

    const { result } = renderHook(() => useNotificationPreferences(), {
      wrapper: createWrapper(),
    });

    // Query stays disabled — rpc must never be called
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(hoisted.rpc).not.toHaveBeenCalled();
  });

  it("should NOT fetch when explicitly disabled via options", async () => {
    const { useNotificationPreferences } = await import(
      "@/hooks/useNotificationPreferences"
    );

    const { result } = renderHook(
      () => useNotificationPreferences({ enabled: false }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(hoisted.rpc).not.toHaveBeenCalled();
  });

  it("should handle RPC error safely", async () => {
    hoisted.rpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied for function get_my_notification_preferences" },
    });

    const { useNotificationPreferences } = await import(
      "@/hooks/useNotificationPreferences"
    );

    const { result } = renderHook(() => useNotificationPreferences(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeTruthy();
  });

  it("should return default preferences while loading", async () => {
    hoisted.sessionUser = null;

    const { useNotificationPreferences, DEFAULT_NOTIFICATION_PREFERENCES } =
      await import("@/hooks/useNotificationPreferences");

    const { result } = renderHook(() => useNotificationPreferences(), {
      wrapper: createWrapper(),
    });

    expect(result.current.notificationPreferences).toEqual(
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
  });
});
