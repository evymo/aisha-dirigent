import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useCosmosLedgerStatus } from "@/hooks/useCosmosLedgerStatus";

// Hoisted mocks
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

const mockStatus = {
  confirmed: 42,
  failed: 3,
  last_sync: "2026-04-18T10:00:00Z",
  pending: 5,
  total: 50,
};

describe("useCosmosLedgerStatus", () => {
  it("fetches and parses ledger stats for admin users", async () => {
    hoisted.mockHasPermission.mockReturnValue(true);
    hoisted.mockRpc.mockResolvedValue({ data: mockStatus, error: null });

    const { result } = renderHook(() => useCosmosLedgerStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockStatus);
    expect(hoisted.mockRpc).toHaveBeenCalledWith(
      "get_cosmos_ledger_status_admin",
    );
  });

  it("does not fetch for non-admin users", () => {
    hoisted.mockHasPermission.mockReturnValue(false);

    const { result } = renderHook(() => useCosmosLedgerStatus(), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(hoisted.mockRpc).not.toHaveBeenCalled();
  });

  it("handles RPC error gracefully", async () => {
    hoisted.mockHasPermission.mockReturnValue(true);
    hoisted.mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Forbidden" },
    });

    const { result } = renderHook(() => useCosmosLedgerStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("handles null last_sync (no confirmed records)", async () => {
    hoisted.mockHasPermission.mockReturnValue(true);
    hoisted.mockRpc.mockResolvedValue({
      data: { ...mockStatus, last_sync: null },
      error: null,
    });

    const { result } = renderHook(() => useCosmosLedgerStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.last_sync).toBeNull();
  });
});
