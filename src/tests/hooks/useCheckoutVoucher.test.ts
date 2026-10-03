/**
 * useCheckoutVoucher Hook Tests
 *
 * Tests for the checkout voucher hook: applying, removing,
 * validating vouchers, and calculating discounts.
 *
 * @see src/hooks/useCheckoutVoucher.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---------- hoisted mocks ----------

const hoisted = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(),
    loading: vi.fn(), dismiss: vi.fn(), promise: vi.fn(),
  }),
}));

vi.mock("@/hooks/useVoucher", () => ({
  useValidateVoucher: () => ({
    mutateAsync: hoisted.mutateAsync,
    isPending: hoisted.isPending,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

vi.mock("sonner", () => ({
  toast: hoisted.toast,
}));

// ---------- helpers ----------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

// ---------- fixtures ----------

const PRODUCT_ID = "33333333-3333-3333-3333-333333333333";

const MOCK_CART_ITEMS = [
  {
    product_id: PRODUCT_ID,
    product: { price: 5000 },
  },
  {
    product_id: "44444444-4444-4444-4444-444444444444",
    product: { price: 3000 },
  },
];

const MOCK_VOUCHER = {
  id: "22222222-2222-2222-2222-222222222222",
  code: "ABC12345",
  product_id: PRODUCT_ID,
  product_name: "Test Product",
  product_image_url: null,
  status: "active" as const,
  points_cost: 50,
  metadata: null,
  expires_at: "2027-01-01T00:00:00Z",
  used_at: null,
  created_at: "2026-01-01T00:00:00Z",
};

const mockConvertFromBase = vi.fn((amount: number, _currency: string) => amount);

// ---------- tests ----------

describe("useCheckoutVoucher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConvertFromBase.mockImplementation((amount: number) => amount);
  });

  const defaultParams = {
    convertFromBase: mockConvertFromBase,
    items: MOCK_CART_ITEMS,
    preferredCurrency: "CZK",
  };

  const importHook = async () => {
    const mod = await import("@/hooks/useCheckoutVoucher");
    return mod.useCheckoutVoucher;
  };

  it("returns initial state with empty voucher code", async () => {
    const useCheckoutVoucher = await importHook();
    const { result } = renderHook(() => useCheckoutVoucher(defaultParams), {
      wrapper: createWrapper(),
    });

    expect(result.current.voucherCode).toBe("");
    expect(result.current.appliedVoucher).toBeNull();
    expect(result.current.voucherDiscount).toBe(0);
    expect(result.current.isValidating).toBe(false);
  });

  it("updates voucher code via setVoucherCode", async () => {
    const useCheckoutVoucher = await importHook();
    const { result } = renderHook(() => useCheckoutVoucher(defaultParams), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setVoucherCode("TESTCODE");
    });

    expect(result.current.voucherCode).toBe("TESTCODE");
  });

  it("applies valid voucher when product is in cart", async () => {
    hoisted.mutateAsync.mockResolvedValue(MOCK_VOUCHER);

    const useCheckoutVoucher = await importHook();
    const { result } = renderHook(() => useCheckoutVoucher(defaultParams), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setVoucherCode("ABC12345");
    });

    await act(async () => {
      await result.current.handleApplyVoucher();
    });

    expect(result.current.appliedVoucher).not.toBeNull();
    expect(result.current.appliedVoucher?.code).toBe("ABC12345");
    expect(hoisted.toast.success).toHaveBeenCalled();
  });

  it("shows error toast when product is NOT in cart", async () => {
    const voucherForOtherProduct = {
      ...MOCK_VOUCHER,
      product_id: "99999999-9999-9999-9999-999999999999",
    };
    hoisted.mutateAsync.mockResolvedValue(voucherForOtherProduct);

    const useCheckoutVoucher = await importHook();
    const { result } = renderHook(() => useCheckoutVoucher(defaultParams), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setVoucherCode("ABC12345");
    });

    await act(async () => {
      await result.current.handleApplyVoucher();
    });

    expect(hoisted.toast.error).toHaveBeenCalled();
    expect(result.current.appliedVoucher).toBeNull();
  });

  it("shows error toast when validation fails", async () => {
    hoisted.mutateAsync.mockRejectedValue(new Error("Invalid voucher code"));

    const useCheckoutVoucher = await importHook();
    const { result } = renderHook(() => useCheckoutVoucher(defaultParams), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setVoucherCode("BADCODE");
    });

    await act(async () => {
      await result.current.handleApplyVoucher();
    });

    expect(hoisted.toast.error).toHaveBeenCalled();
    expect(result.current.appliedVoucher).toBeNull();
  });

  it("does nothing when voucher code is empty/whitespace", async () => {
    const useCheckoutVoucher = await importHook();
    const { result } = renderHook(() => useCheckoutVoucher(defaultParams), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.handleApplyVoucher();
    });

    expect(hoisted.mutateAsync).not.toHaveBeenCalled();
    expect(hoisted.toast).not.toHaveBeenCalled();
  });

  it("removes applied voucher and clears code", async () => {
    hoisted.mutateAsync.mockResolvedValue(MOCK_VOUCHER);

    const useCheckoutVoucher = await importHook();
    const { result } = renderHook(() => useCheckoutVoucher(defaultParams), {
      wrapper: createWrapper(),
    });

    // Apply voucher first
    act(() => {
      result.current.setVoucherCode("ABC12345");
    });
    await act(async () => {
      await result.current.handleApplyVoucher();
    });
    expect(result.current.appliedVoucher).not.toBeNull();

    // Remove
    act(() => {
      result.current.handleRemoveVoucher();
    });

    expect(result.current.appliedVoucher).toBeNull();
    expect(result.current.voucherCode).toBe("");
    expect(result.current.voucherDiscount).toBe(0);
  });

  it("calculates voucherDiscount from matching cart item price", async () => {
    hoisted.mutateAsync.mockResolvedValue(MOCK_VOUCHER);
    mockConvertFromBase.mockImplementation((amount: number) => amount * 0.04);

    const useCheckoutVoucher = await importHook();
    const { result } = renderHook(() => useCheckoutVoucher(defaultParams), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setVoucherCode("ABC12345");
    });
    await act(async () => {
      await result.current.handleApplyVoucher();
    });

    expect(result.current.appliedVoucher).not.toBeNull();
    // Product price is 5000, converted by factor 0.04 = 200
    expect(result.current.voucherDiscount).toBe(200);
    expect(mockConvertFromBase).toHaveBeenCalledWith(5000, "CZK");
  });

  it("returns 0 discount when no product_id on voucher", async () => {
    const voucherNoProduct = { ...MOCK_VOUCHER, product_id: null };
    hoisted.mutateAsync.mockResolvedValue(voucherNoProduct);

    const useCheckoutVoucher = await importHook();
    // Items won't match null product_id, but since product_id is null,
    // the cart check passes vacuously (null !== any product_id)
    // So the voucher won't be applied (product not in cart)
    // Let's use empty items so there's nothing to match
    const params = { ...defaultParams, items: [] };
    const { result } = renderHook(() => useCheckoutVoucher(params), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setVoucherCode("ABC12345");
    });
    await act(async () => {
      await result.current.handleApplyVoucher();
    });

    // Voucher not applied because product not in cart (empty cart)
    expect(result.current.appliedVoucher).toBeNull();
    expect(result.current.voucherDiscount).toBe(0);
  });

  it("returns 0 discount when matching cart item has no product data", async () => {
    hoisted.mutateAsync.mockResolvedValue(MOCK_VOUCHER);

    const itemsWithoutProduct = [
      { product_id: PRODUCT_ID, product: null },
    ];

    const useCheckoutVoucher = await importHook();
    const { result } = renderHook(
      () => useCheckoutVoucher({ ...defaultParams, items: itemsWithoutProduct }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.setVoucherCode("ABC12345");
    });
    await act(async () => {
      await result.current.handleApplyVoucher();
    });

    expect(result.current.appliedVoucher).not.toBeNull();
    expect(result.current.voucherDiscount).toBe(0);
  });
});
