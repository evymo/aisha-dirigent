import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useRetryBlockchainSync } from "@/hooks/useRetryBlockchainSync";

const hoisted = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockHasPermission: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: { rpc: hoisted.mockRpc },
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPermission: hoisted.mockHasPermission,
  }),
}));

beforeEach(() => {
  hoisted.mockRpc.mockReset();
  hoisted.mockHasPermission.mockReset();
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useRetryBlockchainSync", () => {
  it("exposes isAdmin flag based on permissions", () => {
    hoisted.mockHasPermission.mockReturnValue(true);

    const { result } = renderHook(() => useRetryBlockchainSync(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isAdmin).toBe(true);
  });

  it("returns isAdmin=false for non-admin users", () => {
    hoisted.mockHasPermission.mockReturnValue(false);

    const { result } = renderHook(() => useRetryBlockchainSync(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isAdmin).toBe(false);
  });

  it("calls reset_stale_processing with default timeout", async () => {
    hoisted.mockHasPermission.mockReturnValue(true);
    hoisted.mockRpc.mockResolvedValue({ data: 3, error: null });

    const { result } = renderHook(() => useRetryBlockchainSync(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.resetStale.mutate({});
    });

    await waitFor(() => expect(result.current.resetStale.isSuccess).toBe(true));
    expect(result.current.resetStale.data).toBe(3);
    expect(hoisted.mockRpc).toHaveBeenCalledWith("reset_stale_processing", {
      p_timeout_minutes: 5,
    });
  });

  it("calls reset_stale_processing with custom timeout", async () => {
    hoisted.mockHasPermission.mockReturnValue(true);
    hoisted.mockRpc.mockResolvedValue({ data: 0, error: null });

    const { result } = renderHook(() => useRetryBlockchainSync(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.resetStale.mutate({ timeoutMinutes: 10 });
    });

    await waitFor(() => expect(result.current.resetStale.isSuccess).toBe(true));
    expect(hoisted.mockRpc).toHaveBeenCalledWith("reset_stale_processing", {
      p_timeout_minutes: 10,
    });
  });

  it("rejects timeout above 60", async () => {
    hoisted.mockHasPermission.mockReturnValue(true);

    const { result } = renderHook(() => useRetryBlockchainSync(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.resetStale.mutate({ timeoutMinutes: 120 });
    });

    await waitFor(() => expect(result.current.resetStale.isError).toBe(true));
    expect(hoisted.mockRpc).not.toHaveBeenCalled();
  });

  it("handles RPC error gracefully", async () => {
    hoisted.mockHasPermission.mockReturnValue(true);
    hoisted.mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Insufficient privilege" },
    });

    const { result } = renderHook(() => useRetryBlockchainSync(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.resetStale.mutate({});
    });

    await waitFor(() => expect(result.current.resetStale.isError).toBe(true));
  });
});
