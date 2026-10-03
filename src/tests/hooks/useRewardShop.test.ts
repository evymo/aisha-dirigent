import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useRewardShopProducts,
  useWalletBalance,
} from "@/hooks/useRewardShop";

// Hoisted mocks
const hoisted = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockUserId: vi.fn<() => string | undefined>(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: { rpc: hoisted.mockRpc },
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    user: { id: hoisted.mockUserId() },
    isLoading: false,
  }),
}));

const mockProducts = [
  {
    category: "wellness",
    description: "Great product",
    id: "prod-uuid",
    image_url: "https://example.com/img.png",
    name: "Vitamin D",
    price: 25.0,
    sku: "VITD-001",
    token_price: 50,
    token_price_type: "aisha",
  },
];

const mockWalletBalance = {
  aisha_tokens: 1000,
  data_tokens: 0,
  governance_tokens: 0,
  impact_tokens: 0,
  updated_at: "2026-02-19T10:00:00Z",
  user_id: "user-uuid",
};

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
}

describe("useRewardShopProducts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockUserId.mockReturnValue("user-uuid");
    hoisted.mockRpc.mockResolvedValue({ data: mockProducts, error: null });
  });

  it("returns products when user is authenticated", async () => {
    const { result } = renderHook(() => useRewardShopProducts(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].name).toBe("Vitamin D");
    expect(result.current.data![0].token_price).toBe(50);
    expect(vi.mocked(hoisted.mockRpc)).toHaveBeenCalledWith(
      "get_reward_shop_products"
    );
  });

  it("does not fetch when user is not authenticated", async () => {
    hoisted.mockUserId.mockReturnValue(undefined);
    const { result } = renderHook(() => useRewardShopProducts(), {
      wrapper: createWrapper(),
    });
    // Should stay in loading/idle - not fetch
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(hoisted.mockRpc)).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it("handles RPC error gracefully", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: null,
      error: { message: "RPC failure" },
    });
    const { result } = renderHook(() => useRewardShopProducts(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("discards invalid product items silently", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: [{ invalid: "missing fields" }],
      error: null,
    });
    const { result } = renderHook(() => useRewardShopProducts(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe("useWalletBalance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockUserId.mockReturnValue("user-uuid");
    hoisted.mockRpc.mockResolvedValue({ data: [mockWalletBalance], error: null });
  });

  it("returns wallet balance when user is authenticated", async () => {
    const { result } = renderHook(() => useWalletBalance(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.aisha_tokens).toBe(1000);
    expect(vi.mocked(hoisted.mockRpc)).toHaveBeenCalledWith(
      "get_my_wallet_balance"
    );
  });

  it("returns undefined when no wallet row", async () => {
    hoisted.mockRpc.mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(() => useWalletBalance(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("does not fetch when user is not authenticated", async () => {
    hoisted.mockUserId.mockReturnValue(undefined);
    const { result } = renderHook(() => useWalletBalance(), {
      wrapper: createWrapper(),
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(hoisted.mockRpc)).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });
});
