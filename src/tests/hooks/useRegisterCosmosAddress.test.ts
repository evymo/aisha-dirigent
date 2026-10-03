import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useRegisterCosmosAddress } from "@/hooks/useRegisterCosmosAddress";

const hoisted = vi.hoisted(() => ({
  mockRpc: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: { rpc: hoisted.mockRpc },
}));

beforeEach(() => {
  hoisted.mockRpc.mockReset();
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useRegisterCosmosAddress", () => {
  it("calls update_my_cosmos_address RPC with valid address", async () => {
    hoisted.mockRpc.mockResolvedValue({ data: null, error: null });
    const validAddress = "cosmos1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu";

    const { result } = renderHook(() => useRegisterCosmosAddress(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ cosmosAddress: validAddress });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(hoisted.mockRpc).toHaveBeenCalledWith("update_my_cosmos_address", {
      p_cosmos_address: validAddress,
    });
  });

  it("allows null address to clear registration", async () => {
    hoisted.mockRpc.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useRegisterCosmosAddress(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ cosmosAddress: null });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(hoisted.mockRpc).toHaveBeenCalledWith("update_my_cosmos_address", {
      p_cosmos_address: null,
    });
  });

  it("rejects address with wrong prefix", async () => {
    const { result } = renderHook(() => useRegisterCosmosAddress(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      // Full-length but wrong prefix: the old aisha1… prefix must now be rejected
      // (the deployed chain is cosmos1…). Length is valid so only the prefix fails.
      result.current.mutate({ cosmosAddress: "aisha1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(hoisted.mockRpc).not.toHaveBeenCalled();
  });

  it("rejects address that is too short", async () => {
    const { result } = renderHook(() => useRegisterCosmosAddress(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ cosmosAddress: "cosmos1short" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(hoisted.mockRpc).not.toHaveBeenCalled();
  });

  it("rejects address with uppercase characters", async () => {
    const { result } = renderHook(() => useRegisterCosmosAddress(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ cosmosAddress: "cosmos1QYPQXPQ9QCRSSZG2PVXQ6RS0ZQG3YYC5LZV7XU" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(hoisted.mockRpc).not.toHaveBeenCalled();
  });

  it("handles RPC error gracefully", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Invalid Cosmos address format" },
    });

    const validAddress = "cosmos1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu";
    const { result } = renderHook(() => useRegisterCosmosAddress(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ cosmosAddress: validAddress });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
