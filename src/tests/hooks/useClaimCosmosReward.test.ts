import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useClaimCosmosReward } from "@/hooks/useClaimCosmosReward";

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

const MOCK_CLAIM_ID = "d290f1ee-6c54-4b01-90e6-d701748f0851";

describe("useClaimCosmosReward", () => {
  it("calls claim_cosmos_reward RPC with amount and default denom", async () => {
    hoisted.mockRpc.mockResolvedValue({ data: MOCK_CLAIM_ID, error: null });

    const { result } = renderHook(() => useClaimCosmosReward(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ amount: 100 });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(MOCK_CLAIM_ID);
    expect(hoisted.mockRpc).toHaveBeenCalledWith("claim_cosmos_reward", {
      p_amount: 100,
      p_denom: "uash",
    });
  });

  it("supports ugov denomination", async () => {
    hoisted.mockRpc.mockResolvedValue({ data: MOCK_CLAIM_ID, error: null });

    const { result } = renderHook(() => useClaimCosmosReward(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ amount: 50, denom: "ugov" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(hoisted.mockRpc).toHaveBeenCalledWith("claim_cosmos_reward", {
      p_amount: 50,
      p_denom: "ugov",
    });
  });

  it("rejects zero amount", async () => {
    const { result } = renderHook(() => useClaimCosmosReward(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ amount: 0 });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(hoisted.mockRpc).not.toHaveBeenCalled();
  });

  it("rejects negative amount", async () => {
    const { result } = renderHook(() => useClaimCosmosReward(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ amount: -10 });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(hoisted.mockRpc).not.toHaveBeenCalled();
  });

  it("rejects non-integer amount", async () => {
    const { result } = renderHook(() => useClaimCosmosReward(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ amount: 10.5 });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(hoisted.mockRpc).not.toHaveBeenCalled();
  });

  it("handles RPC error (insufficient balance)", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Insufficient balance" },
    });

    const { result } = renderHook(() => useClaimCosmosReward(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ amount: 999999 });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("handles RPC error (no cosmos address)", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Cosmos address not set" },
    });

    const { result } = renderHook(() => useClaimCosmosReward(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ amount: 10 });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
