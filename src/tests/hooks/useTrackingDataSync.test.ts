import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import { useTrackingDataSync } from "@/hooks/useTrackingDataSync";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  safeError: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  t: vi.fn((...args: unknown[]) => String(args[0])),
  useSession: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  aisha: {
    rpc: (...args: unknown[]) => mocks.rpc(...args),
  },
}));

vi.mock("@/lib/security/safeLogger", () => ({
  safeError: (...args: unknown[]) => mocks.safeError(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mocks.toastSuccess(...args),
    error: (...args: unknown[]) => mocks.toastError(...args),
  },
}));

vi.mock("@/i18n", () => ({
  default: { t: (...args: unknown[]) => mocks.t(...args) },
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => mocks.useSession(),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe("useTrackingDataSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mocks.useSession).mockReturnValue({
      user: { id: "user-1" },
      isLoading: false,
    });
  });

  it("calls get_my_health_data and get_health_summary RPCs", async () => {
    vi.mocked(mocks.rpc).mockImplementation((fn: string) => {
      if (fn === "get_my_health_data") {
        return Promise.resolve({ data: [], error: null });
      }
      if (fn === "get_health_summary") {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    renderHook(() => useTrackingDataSync({ limit: 20, summaryDays: 14 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(vi.mocked(mocks.rpc)).toHaveBeenCalledWith(
        "get_my_health_data",
        expect.objectContaining({ p_limit: 20 })
      );
      expect(vi.mocked(mocks.rpc)).toHaveBeenCalledWith("get_health_summary", { p_days: 14 });
    });
  });

  it("rejects invalid sync payload and logs safeError", async () => {
    vi.mocked(mocks.rpc).mockImplementation((fn: string) => {
      if (fn === "get_my_health_data") return Promise.resolve({ data: [], error: null });
      if (fn === "get_health_summary") return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: null, error: null });
    });

    const { result } = renderHook(() => useTrackingDataSync(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(
        result.current.syncTrackingData([
          {
            data_type: "steps",
            value: Number.NaN,
            unit: "count",
            recorded_at: "2026-01-01T10:00:00Z",
            source: "healthkit",
          },
        ] as never)
      ).rejects.toThrow("TrackingData.invalidEntries");
    });

    expect(vi.mocked(mocks.safeError)).toHaveBeenCalledWith(
      "useTrackingDataSync.sync.validate",
      expect.anything()
    );
    expect(vi.mocked(mocks.toastError)).toHaveBeenCalledWith("tracking.syncError");
    expect(vi.mocked(mocks.rpc)).not.toHaveBeenCalledWith("sync_health_data", expect.anything());
  });

  it("calls sync_health_data RPC on valid entries", async () => {
    vi.mocked(mocks.rpc).mockImplementation((fn: string) => {
      if (fn === "get_my_health_data") return Promise.resolve({ data: [], error: null });
      if (fn === "get_health_summary") return Promise.resolve({ data: null, error: null });
      if (fn === "sync_health_data") {
        return Promise.resolve({ data: { synced_count: 1 }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const { result } = renderHook(() => useTrackingDataSync(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.syncTrackingData([
        {
          data_type: "steps",
          value: 1234,
          unit: "count",
          recorded_at: "2026-01-01T10:00:00Z",
          source: "healthkit",
        },
      ]);
    });

    expect(vi.mocked(mocks.rpc)).toHaveBeenCalledWith("sync_health_data", {
      p_health_entries: [
        {
          data_type: "steps",
          value: 1234,
          unit: "count",
          recorded_at: "2026-01-01T10:00:00Z",
          source: "healthkit",
        },
      ],
    });
    expect(vi.mocked(mocks.toastSuccess)).toHaveBeenCalled();
  });
});
