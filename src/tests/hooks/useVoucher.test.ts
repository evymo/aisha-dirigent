import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import {
  useUserWallet,
  useTokenTransactions,
  useMyVouchers,
  usePurchaseVoucher,
  useValidateVoucher,
  useRedeemVoucher,
} from "@/hooks/useVoucher";

// --- Mocks ---

const mockUser = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

vi.mock("@/hooks/useSession", () => ({
  useSession: vi.fn(() => ({ user: mockUser })),
}));

const mockRpc = vi.fn();

vi.mock("@/integrations/db/client", () => ({
  aisha: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

// --- Helpers ---

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

const MOCK_WALLET = {
  user_id: mockUser.id,
  governance_tokens: 100,
  impact_tokens: 50,
  data_tokens: 25,
  updated_at: "2026-01-01T00:00:00Z",
};

const MOCK_TRANSACTION = {
  id: "11111111-1111-1111-1111-111111111111",
  amount: 10,
  token_type: "governance",
  transaction_type: "earned",
  description: "Test reward",
  reference_id: null,
  reference_type: null,
  balance_after: 100,
  created_at: "2026-01-01T00:00:00Z",
};

const MOCK_VOUCHER = {
  id: "22222222-2222-2222-2222-222222222222",
  code: "ABC12345",
  product_id: "33333333-3333-3333-3333-333333333333",
  status: "active",
  points_cost: 50,
  expires_at: "2027-01-01T00:00:00Z",
  used_at: null,
  created_at: "2026-01-01T00:00:00Z",
};

// --- Tests ---

describe("useUserWallet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches wallet via get_my_wallet_balance RPC", async () => {
    mockRpc.mockResolvedValue({ data: [MOCK_WALLET], error: null });

    const { result } = renderHook(() => useUserWallet(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_my_wallet_balance");
    expect(result.current.data).toEqual(MOCK_WALLET);
  });

  it("returns null when wallet does not exist", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useUserWallet(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("propagates error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "Access denied" },
    });

    const { result } = renderHook(() => useUserWallet(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useTokenTransactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches transactions via get_my_token_transactions RPC", async () => {
    mockRpc.mockResolvedValue({ data: [MOCK_TRANSACTION], error: null });

    const { result } = renderHook(() => useTokenTransactions(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_my_token_transactions", {
      p_limit: 50,
    });
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]).toMatchObject({
      token_type: "governance",
      amount: 10,
    });
  });

  it("returns empty array when no transactions exist", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useTokenTransactions(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe("useMyVouchers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches vouchers via get_my_vouchers RPC", async () => {
    mockRpc.mockResolvedValue({ data: [MOCK_VOUCHER], error: null });

    const { result } = renderHook(() => useMyVouchers(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_my_vouchers");
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]).toMatchObject({ code: "ABC12345" });
  });
});

describe("usePurchaseVoucher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls purchase_product_voucher RPC with correct params", async () => {
    const voucherId = "55555555-5555-5555-5555-555555555555";
    mockRpc.mockResolvedValue({ data: voucherId, error: null });

    const { result } = renderHook(() => usePurchaseVoucher(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      const returned = await result.current.mutateAsync({
        productId: "33333333-3333-3333-3333-333333333333",
        cost: 50,
        tokenType: "governance",
      });
      expect(returned).toBe(voucherId);
    });

    expect(mockRpc).toHaveBeenCalledWith("purchase_product_voucher", {
      p_point_cost: 50,
      p_product_id: "33333333-3333-3333-3333-333333333333",
      p_token_type: "governance",
    });
  });

  it("propagates RPC errors", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "Insufficient tokens" },
    });

    const { result } = renderHook(() => usePurchaseVoucher(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          productId: "33333333-3333-3333-3333-333333333333",
          cost: 999,
          tokenType: "data",
        }),
      ).rejects.toThrow();
    });
  });
});

describe("useValidateVoucher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls validate_voucher_code RPC", async () => {
    mockRpc.mockResolvedValue({ data: [MOCK_VOUCHER], error: null });

    const { result } = renderHook(() => useValidateVoucher(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      const voucher = await result.current.mutateAsync("ABC12345");
      expect(voucher).toMatchObject({ code: "ABC12345" });
    });

    expect(mockRpc).toHaveBeenCalledWith("validate_voucher_code", {
      p_code: "ABC12345",
    });
  });

  it("throws when voucher not found", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useValidateVoucher(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync("INVALID"),
      ).rejects.toThrow("Invalid or inactive voucher code");
    });
  });
});

describe("useRedeemVoucher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls redeem_product_voucher RPC with correct params", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });

    const { result } = renderHook(() => useRedeemVoucher(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      const success = await result.current.mutateAsync({
        code: "ABC12345",
        orderId: "44444444-4444-4444-4444-444444444444",
      });
      expect(success).toBe(true);
    });

    expect(mockRpc).toHaveBeenCalledWith("redeem_product_voucher", {
      p_code: "ABC12345",
      p_order_id: "44444444-4444-4444-4444-444444444444",
    });
  });

  it("propagates RPC errors on invalid code", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "Invalid voucher code" },
    });

    const { result } = renderHook(() => useRedeemVoucher(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          code: "BADCODE",
          orderId: "44444444-4444-4444-4444-444444444444",
        }),
      ).rejects.toThrow();
    });
  });
});
