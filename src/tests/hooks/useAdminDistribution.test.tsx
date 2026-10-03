/**
 * Tests for src/hooks/useAdminDistribution.ts
 *
 * Coverage (6 exports):
 *   - useShipmentSettings           (query — merges with DEFAULT_SETTINGS)
 *   - useDistributionSchedules      (query — month-windowed)
 *   - useUpdateShipmentSetting      (mutation — JSON-stringifies the value)
 *   - useSaveShipmentSettings       (mutation — sequential RPC per setting)
 *   - useCreateDistributionSchedule (mutation — dated + timed)
 *   - useProcessDistributionSchedule (mutation — returns { processed: number })
 *
 * Two interesting behaviours we lock in:
 *   1. `useShipmentSettings` shallow-merges the validated RPC payload over
 *      DEFAULT_SETTINGS, so missing keys are filled with the defaults.
 *   2. `useSaveShipmentSettings` calls the RPC *once per top-level key*
 *      sequentially — if mid-iteration fails, the rest don't run.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useShipmentSettings,
  useDistributionSchedules,
  useUpdateShipmentSetting,
  useSaveShipmentSettings,
  useCreateDistributionSchedule,
  useProcessDistributionSchedule,
  DEFAULT_SHIPMENT_SETTINGS,
} from "@/hooks/useAdminDistribution";

const { mockRpc, mockHasPermission, mockUser } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockHasPermission: vi.fn(),
  mockUser: { id: "admin-id" },
}));

vi.mock("@/integrations/db/client", () => ({
  aisha: { rpc: mockRpc },
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: mockHasPermission }),
}));
vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({ user: mockUser }),
}));

function createWrapper(qc?: QueryClient) {
  const queryClient =
    qc ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { Wrapper, queryClient };
}

const UUID_SCHEDULE = "a0000000-0000-4000-a000-000000000001";

const mockScheduleRow = {
  id: UUID_SCHEDULE,
  scheduled_date: "2026-03-15",
  scheduled_time: "14:00",
  status: "pending",
  orders_count: 12,
  processed_count: 0,
  failed_count: 0,
  notes: null,
  created_at: "2026-03-01T00:00:00Z",
  processed_at: null,
};

// ── useShipmentSettings ────────────────────────────────────────

describe("useShipmentSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls get_shipment_settings and merges with DEFAULT_SETTINGS", async () => {
    // Server returns only one setting overridden; the rest fall through
    // to DEFAULT_SHIPMENT_SETTINGS.
    mockRpc.mockResolvedValue({
      data: {
        auto_ship_time: { time: "10:00", timezone: "Europe/Berlin" },
      },
      error: null,
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useShipmentSettings(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith("get_shipment_settings");
    expect(result.current.data?.auto_ship_time).toEqual({
      time: "10:00",
      timezone: "Europe/Berlin",
    });
    // Default kept for an unrelated key
    expect(result.current.data?.packeta_defaults.default_weight).toBe(
      DEFAULT_SHIPMENT_SETTINGS.packeta_defaults.default_weight,
    );
  });

  it("falls back to DEFAULT_SETTINGS when the RPC returns null data", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useShipmentSettings(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(DEFAULT_SHIPMENT_SETTINGS);
  });

  it("does not call RPC when caller lacks view_admin_dashboard", async () => {
    mockHasPermission.mockReturnValue(false);
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useShipmentSettings(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied for function" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useShipmentSettings(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("permission denied for function");
  });
});

// ── useDistributionSchedules ───────────────────────────────────

describe("useDistributionSchedules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls get_distribution_calendar_admin with month start/end dates", async () => {
    mockRpc.mockResolvedValue({ data: [mockScheduleRow], error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useDistributionSchedules(new Date("2026-03-15T12:00:00Z")),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const call = mockRpc.mock.calls[0];
    expect(call[0]).toBe("get_distribution_calendar_admin");
    // Format is YYYY-MM-DD for both ends of the chosen month
    expect(call[1].p_from).toMatch(/^2026-03-0[12]$/); // first day of march in local tz
    expect(call[1].p_to).toMatch(/^2026-03-3[01]$/);  // last day of march in local tz
    expect(result.current.data).toHaveLength(1);
  });

  it("does not call RPC when caller lacks view_admin_dashboard", async () => {
    mockHasPermission.mockReturnValue(false);
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useDistributionSchedules(new Date()), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied for function" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useDistributionSchedules(new Date()), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ── useUpdateShipmentSetting ───────────────────────────────────

describe("useUpdateShipmentSetting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls update_shipment_setting with key + JSON-stringified value", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateShipmentSetting(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({
        key: "auto_ship_days",
        value: { enabled: true, days: ["tuesday"] },
      });
    });

    expect(mockRpc).toHaveBeenCalledWith("update_shipment_setting", {
      p_key: "auto_ship_days",
      p_value: JSON.stringify({ enabled: true, days: ["tuesday"] }),
    });
  });

  it("invalidates shipment-settings cache on success", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { Wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateShipmentSetting(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({ key: "x", value: 1 });
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["shipment-settings"] });
  });

  it("propagates RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "unknown setting key" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateShipmentSetting(), {
      wrapper: Wrapper,
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync({ key: "fake", value: 1 });
      }),
    ).rejects.toThrow("unknown setting key");
  });
});

// ── useSaveShipmentSettings ────────────────────────────────────

describe("useSaveShipmentSettings", () => {
  beforeEach(() => {
    // Reset (not just clear) — implementations carry over between tests
    // in this suite (vitest 3.x behaviour) and would otherwise mask
    // mockImplementation overrides set by individual tests.
    vi.resetAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls update_shipment_setting once per top-level key", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useSaveShipmentSettings(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync(DEFAULT_SHIPMENT_SETTINGS);
    });

    const expectedKeyCount = Object.keys(DEFAULT_SHIPMENT_SETTINGS).length;
    expect(mockRpc).toHaveBeenCalledTimes(expectedKeyCount);
    // All calls go to the same RPC
    for (const call of mockRpc.mock.calls) {
      expect(call[0]).toBe("update_shipment_setting");
      expect(typeof call[1].p_value).toBe("string"); // JSON-stringified
    }
  });

  it("stops iterating after first failure (no half-applied state in mock observer)", async () => {
    // NOTE: we use try/catch rather than `expect(act(...)).rejects.toThrow(...)`.
    // For react-query mutations whose mutationFn is itself a loop of awaits,
    // the rejects matcher resolves before all inner awaits complete in
    // this environment, leaving mockRpc.mock.calls observably empty
    // even though the rejection assertion passes.
    let nthCall = 0;
    let caught: Error | undefined;
    mockRpc.mockImplementation(async () => {
      nthCall += 1;
      if (nthCall === 1) return { data: null, error: null };
      if (nthCall === 2) return { data: null, error: { message: "validation: bad value" } };
      return { data: null, error: null };
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useSaveShipmentSettings(), {
      wrapper: Wrapper,
    });
    try {
      await act(async () => {
        await result.current.mutateAsync(DEFAULT_SHIPMENT_SETTINGS);
      });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught?.message).toContain("bad value");
    // Exactly 2 RPC calls (one ok, one failing); loop exited without
    // trying the remaining keys.
    expect(nthCall).toBe(2);
  });
});

// ── useCreateDistributionSchedule ──────────────────────────────

describe("useCreateDistributionSchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls create_distribution_schedule_admin with date + time", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateDistributionSchedule(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({
        scheduledDate: "2026-03-15",
        scheduledTime: "14:00",
      });
    });

    expect(mockRpc).toHaveBeenCalledWith("create_distribution_schedule_admin", {
      p_scheduled_date: "2026-03-15",
      p_scheduled_time: "14:00",
    });
  });

  it("invalidates distribution-calendar cache on success", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { Wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateDistributionSchedule(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({
        scheduledDate: "2026-03-15",
        scheduledTime: "14:00",
      });
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["distribution-calendar"] });
  });

  it("propagates RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "schedule conflicts with existing one" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateDistributionSchedule(), {
      wrapper: Wrapper,
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync({
          scheduledDate: "2026-03-15",
          scheduledTime: "14:00",
        });
      }),
    ).rejects.toThrow("schedule conflicts");
  });
});

// ── useProcessDistributionSchedule ─────────────────────────────

describe("useProcessDistributionSchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls process_distribution_schedule and returns { processed: number }", async () => {
    mockRpc.mockResolvedValue({ data: { processed: 12 }, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useProcessDistributionSchedule(), {
      wrapper: Wrapper,
    });

    let out: { processed: number } | undefined;
    await act(async () => {
      out = await result.current.mutateAsync(UUID_SCHEDULE);
    });

    expect(mockRpc).toHaveBeenCalledWith("process_distribution_schedule", {
      p_schedule_id: UUID_SCHEDULE,
    });
    expect(out).toEqual({ processed: 12 });
  });

  it("propagates RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "schedule already processed" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useProcessDistributionSchedule(), {
      wrapper: Wrapper,
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync(UUID_SCHEDULE);
      }),
    ).rejects.toThrow("already processed");
  });
});
