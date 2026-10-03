/**
 * Tests for src/hooks/useAdminDistributionForecast.ts
 *
 * Coverage (4 exports):
 *   - useDistributionForecastsAdmin (query — forecasts + computed stats)
 *   - useStudiesForForecast         (query — soft-fail to [] on bad data)
 *   - useRecalculateForecast        (mutation — recompute month forecasts)
 *   - useUpdateForecastStatus       (mutation — set production status)
 *
 * Locked-in behaviours:
 *   - "all" studyId is converted to undefined (not the literal string)
 *   - studyId=undefined also goes through as undefined
 *   - Stats are summed from the forecast rows, treating missing fields as 0
 *   - Empty result set ⇒ all-zero stats
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useDistributionForecastsAdmin,
  useStudiesForForecast,
  useRecalculateForecast,
  useUpdateForecastStatus,
} from "@/hooks/useAdminDistributionForecast";

const { mockRpc, mockHasPermission, mockUser, mockGuardAdminMutation } =
  vi.hoisted(() => ({
    mockRpc: vi.fn(),
    mockHasPermission: vi.fn(),
    mockUser: { id: "admin-id" },
    mockGuardAdminMutation: (_rpc: string, fn: (args: unknown) => unknown) => fn,
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
vi.mock("@/hooks/useAdminGuard", () => ({
  useAdminGuard: () => ({ guardAdminMutation: mockGuardAdminMutation }),
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

const UUID_FORECAST = "b0000000-0000-4000-a000-000000000001";
const UUID_PRODUCT = "b0000000-0000-4000-a000-000000000002";
const UUID_STUDY = "b0000000-0000-4000-a000-000000000003";
const UUID_BATCH = "b0000000-0000-4000-a000-000000000004";

function forecastRow(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID_FORECAST,
    forecast_month: "2026-04-01",
    product_id: UUID_PRODUCT,
    study_id: UUID_STUDY,
    total_members: 80,
    vip_members: 20,
    required_packages: 100,
    compensated_value: 50000,
    production_status: "pending",
    reported_deviation_percent: 0,
    deviation_sample_size: 0,
    linked_batch_id: UUID_BATCH,
    product_name: "Vitamin D3",
    study_name: "Spring 2026",
    study_code: "SPRING_2026",
    ...overrides,
  };
}

// ── useDistributionForecastsAdmin ──────────────────────────────

describe("useDistributionForecastsAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls get_distribution_forecasts_admin with p_month=`<month>-01` + study filter", async () => {
    mockRpc.mockResolvedValue({ data: [forecastRow()], error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useDistributionForecastsAdmin("2026-04", UUID_STUDY),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith("get_distribution_forecasts_admin", {
      p_month: "2026-04-01",
      p_study_id: UUID_STUDY,
    });
    expect(result.current.data?.forecasts).toHaveLength(1);
  });

  it("computes monthly stats by summing forecast rows", async () => {
    mockRpc.mockResolvedValue({
      data: [
        forecastRow({ required_packages: 100, compensated_value: 50000, total_members: 80, vip_members: 20 }),
        forecastRow({
          id: "b0000000-0000-4000-a000-000000000099",
          required_packages: 60,
          compensated_value: 25000,
          total_members: 45,
          vip_members: 10,
        }),
      ],
      error: null,
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useDistributionForecastsAdmin("2026-04", "all"),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.stats).toEqual({
      total_packages: 160,
      total_value: 75000,
      total_members: 125,
      vip_members: 30,
    });
  });

  it("converts studyId='all' to undefined for the RPC", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { Wrapper } = createWrapper();
    renderHook(() => useDistributionForecastsAdmin("2026-04", "all"), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());

    expect(mockRpc).toHaveBeenCalledWith("get_distribution_forecasts_admin", {
      p_month: "2026-04-01",
      p_study_id: undefined,
    });
  });

  it("returns zeroed stats when no forecasts exist", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useDistributionForecastsAdmin("2026-04", "all"),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.stats).toEqual({
      total_packages: 0,
      total_value: 0,
      total_members: 0,
      vip_members: 0,
    });
  });

  it("returns zeroed empty result when caller lacks view_admin_dashboard", async () => {
    mockHasPermission.mockReturnValue(false);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useDistributionForecastsAdmin("2026-04", "all"),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied for function" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useDistributionForecastsAdmin("2026-04", "all"),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ── useStudiesForForecast ──────────────────────────────────────

describe("useStudiesForForecast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("returns active studies, projected down to {id, name, code}", async () => {
    mockRpc.mockResolvedValue({
      data: [
        { id: UUID_STUDY, name: "Spring 2026", code: "SPRING_2026", is_active: true, extra: "ignored" },
        {
          id: "b0000000-0000-4000-a000-000000000022",
          name: "Winter 2025",
          code: "WINTER_2025",
          is_active: false,
        },
      ],
      error: null,
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useStudiesForForecast(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([
      { id: UUID_STUDY, name: "Spring 2026", code: "SPRING_2026" },
    ]);
  });

  it("returns [] on schema mismatch (soft-fail)", async () => {
    mockRpc.mockResolvedValue({
      data: [{ id: "not-a-uuid" }], // missing name + code, bad uuid
      error: null,
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useStudiesForForecast(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied for function" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useStudiesForForecast(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ── useRecalculateForecast ─────────────────────────────────────

describe("useRecalculateForecast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls recalculate_distribution_forecasts_admin with month + study filter", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useRecalculateForecast(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({ month: "2026-04", studyId: UUID_STUDY });
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "recalculate_distribution_forecasts_admin",
      { p_month: "2026-04-01", p_study_id: UUID_STUDY },
    );
  });

  it("converts studyId='all' to undefined in the recalc call", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useRecalculateForecast(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({ month: "2026-04", studyId: "all" });
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "recalculate_distribution_forecasts_admin",
      { p_month: "2026-04-01", p_study_id: undefined },
    );
  });

  it("invalidates admin-distribution-forecasts on success", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { Wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRecalculateForecast(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({ month: "2026-04", studyId: "all" });
    });

    expect(spy).toHaveBeenCalledWith({
      queryKey: ["admin-distribution-forecasts"],
    });
  });

  it("propagates RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "recalc job already running for this month" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useRecalculateForecast(), {
      wrapper: Wrapper,
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync({ month: "2026-04", studyId: "all" });
      }),
    ).rejects.toThrow("recalc job already running");
  });
});

// ── useUpdateForecastStatus ────────────────────────────────────

describe("useUpdateForecastStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls update_distribution_forecast_status_admin with id + status", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateForecastStatus(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({
        forecastId: UUID_FORECAST,
        status: "in_production",
      });
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "update_distribution_forecast_status_admin",
      { p_id: UUID_FORECAST, p_production_status: "in_production" },
    );
  });

  it("propagates RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "invalid status transition: shipped → pending" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateForecastStatus(), {
      wrapper: Wrapper,
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync({
          forecastId: UUID_FORECAST,
          status: "pending",
        });
      }),
    ).rejects.toThrow("invalid status transition");
  });
});
