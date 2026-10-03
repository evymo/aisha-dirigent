import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import {
  useShippingCosts,
  useCheckoutProfilePrefill,
  usePacketaPickupPoints,
  useCreateOrder,
  useCreateCheckoutSession,
} from "@/hooks/useCheckout";
import type { ShippingCosts, PacketaPickupPoint } from "@/hooks/useCheckout";

// ── Hoisted mocks ──────────────────────────────────────────────

const hoisted = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  rpcMock: vi.fn(),
  safeErrorMock: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    functions: {
      invoke: (...args: unknown[]) => hoisted.invokeMock(...args),
    },
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/security/safeLogger")>();
  return {
    ...actual,
    safeError: hoisted.safeErrorMock,
  };
});

// ── Wrapper ────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

// ── useShippingCosts ───────────────────────────────────────────

describe("useShippingCosts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch shipping costs for all methods", async () => {
    hoisted.rpcMock
      .mockResolvedValueOnce({ data: 79, error: null })   // carrier_home
      .mockResolvedValueOnce({ data: 89, error: null })   // carrier_pickup
      .mockResolvedValueOnce({ data: 99, error: null })   // packeta_home
      .mockResolvedValueOnce({ data: 69, error: null })   // packeta_pickup
      .mockResolvedValueOnce({ data: 59, error: null })   // packeta_zbox
      .mockResolvedValueOnce({ data: 0, error: null });   // personal_pickup

    const { result } = renderHook(() => useShippingCosts("CZ"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const costs = result.current.data as ShippingCosts;
    expect(costs.carrier_home).toBe(79);
    expect(costs.carrier_pickup).toBe(89);
    expect(costs.packeta_home).toBe(99);
    expect(costs.packeta_pickup).toBe(69);
    expect(costs.packeta_zbox).toBe(59);
    expect(costs.personal_pickup).toBe(0);

    expect(hoisted.rpcMock).toHaveBeenCalledTimes(6);

    expect(hoisted.rpcMock).toHaveBeenCalledWith("get_shipping_cost", {
      p_country: "CZ",
      p_currency: "CZK",
      p_shipping_method: "packeta_pickup",
    });
  });

  it("should not fetch when country is null", async () => {
    const { result } = renderHook(
      () => useShippingCosts(null),
      { wrapper: createWrapper() },
    );

    // Hook is disabled — should stay in idle state
    expect(result.current.isFetching).toBe(false);
    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });

  it("should default to 0 on individual method error", async () => {
    hoisted.rpcMock
      .mockResolvedValueOnce({ data: 79, error: null })
      .mockResolvedValueOnce({ data: 0, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "Error" } })
      .mockResolvedValueOnce({ data: 69, error: null })
      .mockResolvedValueOnce({ data: 59, error: null })
      .mockResolvedValueOnce({ data: 0, error: null });

    const { result } = renderHook(() => useShippingCosts("CZ"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const costs = result.current.data as ShippingCosts;
    expect(costs.carrier_home).toBe(79);
    expect(costs.carrier_pickup).toBe(0);
    expect(costs.packeta_home).toBe(0);
    expect(costs.packeta_pickup).toBe(69);
    expect(costs.packeta_zbox).toBe(59);
    expect(costs.personal_pickup).toBe(0);
  });

  it("should use provided currency", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: 5, error: null });

    const { result } = renderHook(
      () => useShippingCosts("DE", "EUR"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(hoisted.rpcMock).toHaveBeenCalledWith("get_shipping_cost",
      expect.objectContaining({
        p_country: "DE",
        p_currency: "EUR",
      }),
    );
  });
});

// ── useCheckoutProfilePrefill ──────────────────────────────────

describe("useCheckoutProfilePrefill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch profile prefill data", async () => {
    const profileData = {
      address: {
        street: "Vodičkova 1",
        city: "Praha",
        postalCode: "11000",
        country: "CZ",
      },
      display_name: "Test User",
      email: "test@example.com",
      phone: "+420123456789",
    };

    hoisted.rpcMock.mockResolvedValue({
      data: profileData,
      error: null,
    });

    const { result } = renderHook(
      () => useCheckoutProfilePrefill("user-123"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.email).toBe("test@example.com");
    expect(result.current.data?.address?.city).toBe("Praha");
  });

  it("should handle array response (first element)", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: [{ display_name: "First", email: "first@test.com" }],
      error: null,
    });

    const { result } = renderHook(
      () => useCheckoutProfilePrefill("user-123"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.display_name).toBe("First");
  });

  it("should not fetch without userId", () => {
    const { result } = renderHook(
      () => useCheckoutProfilePrefill(undefined),
      { wrapper: createWrapper() },
    );

    expect(result.current.isFetching).toBe(false);
  });

  it("should throw on RPC error", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Unauthorized" },
    });

    const { result } = renderHook(
      () => useCheckoutProfilePrefill("user-123"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Unauthorized");
  });

  it("should return null for empty response", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: null,
    });

    const { result } = renderHook(
      () => useCheckoutProfilePrefill("user-123"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});

// ── usePacketaPickupPoints ─────────────────────────────────────

describe("usePacketaPickupPoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch pickup points via edge function", async () => {
    const points: PacketaPickupPoint[] = [
      {
        id: 1001,
        name: "Zásilkovna Praha 1",
        city: "Praha",
        street: "Vodičkova 30",
        zip: "11000",
        country: "CZ",
      },
    ];

    hoisted.invokeMock.mockResolvedValue({
      data: { points },
      error: null,
    });

    const { result } = renderHook(() => usePacketaPickupPoints("CZ"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].name).toBe("Zásilkovna Praha 1");

    expect(hoisted.invokeMock).toHaveBeenCalledWith("packeta-api", {
      body: { action: "pickup-points", country: "CZ" },
    });
  });

  it("should handle pickupPoints field name variant", async () => {
    hoisted.invokeMock.mockResolvedValue({
      data: { pickupPoints: [{ id: 2002, name: "Test", city: "Brno", street: "S", zip: "600", country: "CZ" }] },
      error: null,
    });

    const { result } = renderHook(() => usePacketaPickupPoints("CZ"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it("should throw on invoke error", async () => {
    hoisted.invokeMock.mockResolvedValue({
      data: null,
      error: { message: "Packeta API error" },
    });

    const { result } = renderHook(() => usePacketaPickupPoints("CZ"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Packeta API error");
  });

  it("should not fetch when disabled", () => {
    const { result } = renderHook(
      () => usePacketaPickupPoints("CZ", false),
      { wrapper: createWrapper() },
    );

    expect(result.current.isFetching).toBe(false);
  });

  it("should uppercase country code", async () => {
    hoisted.invokeMock.mockResolvedValue({
      data: { points: [] },
      error: null,
    });

    const { result } = renderHook(() => usePacketaPickupPoints("cz"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(hoisted.invokeMock).toHaveBeenCalledWith("packeta-api", {
      body: { action: "pickup-points", country: "CZ" },
    });
  });
});

// ── useCreateOrder ─────────────────────────────────────────────

describe("useCreateOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create order via RPC and return order ID", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: "order-new-123",
      error: null,
    });

    const { result } = renderHook(() => useCreateOrder(), {
      wrapper: createWrapper(),
    });

    let orderId: string | undefined;
    await act(async () => {
      orderId = await result.current.mutateAsync({
        total: 1200,
        shippingAddress: { street: "Test", city: "Praha" },
        billingAddress: { street: "Test", city: "Praha" },
        shippingMethod: "packeta_pickup",
        packetaBranchId: 1001,
        items: [{ product_id: "prod-1", quantity: 2, price_at_purchase: 600 }],
        paymentMethod: "bank_transfer",
      });
    });

    expect(orderId).toBe("order-new-123");
    expect(hoisted.rpcMock).toHaveBeenCalledWith(
      "create_order_with_items_audited",
      expect.objectContaining({
        p_total: 1200,
        p_shipping_method: "packeta_pickup",
        p_payment_method: "bank_transfer",
        p_packeta_branch_id: 1001,
      }),
    );
  });

  it("should throw on RPC error", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Insufficient stock" },
    });

    const { result } = renderHook(() => useCreateOrder(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          total: 100,
          shippingAddress: {},
          billingAddress: {},
          items: [{ product_id: "p1", quantity: 1, price_at_purchase: 100 }],
        });
      }),
    ).rejects.toThrow("Insufficient stock");
  });

  it("should throw when order ID is not a string", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: null,
    });

    const { result } = renderHook(() => useCreateOrder(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          total: 100,
          shippingAddress: {},
          billingAddress: {},
          items: [{ product_id: "p1", quantity: 1, price_at_purchase: 100 }],
        });
      }),
    ).rejects.toThrow("Order creation failed");
  });
});

// ── useCreateCheckoutSession ───────────────────────────────────

describe("useCreateCheckoutSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create Stripe checkout session via edge function", async () => {
    hoisted.invokeMock.mockResolvedValue({
      data: { url: "https://checkout.stripe.com/session/abc" },
      error: null,
    });

    const { result } = renderHook(() => useCreateCheckoutSession(), {
      wrapper: createWrapper(),
    });

    let sessionData: { url: string } | undefined;
    await act(async () => {
      sessionData = await result.current.mutateAsync({
        orderId: "order-123",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      });
    });

    expect(sessionData?.url).toBe("https://checkout.stripe.com/session/abc");
    expect(hoisted.invokeMock).toHaveBeenCalledWith(
      "create-checkout-session",
      {
        body: {
          orderId: "order-123",
          successUrl: "https://example.com/success",
          cancelUrl: "https://example.com/cancel",
        },
      },
    );
  });

  it("should throw on invoke error", async () => {
    hoisted.invokeMock.mockResolvedValue({
      data: null,
      error: { message: "Stripe error" },
    });

    const { result } = renderHook(() => useCreateCheckoutSession(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          orderId: "x",
          successUrl: "a",
          cancelUrl: "b",
        });
      }),
    ).rejects.toThrow("Stripe error");
  });

  it("should throw when no URL returned", async () => {
    hoisted.invokeMock.mockResolvedValue({
      data: { someOtherField: true },
      error: null,
    });

    const { result } = renderHook(() => useCreateCheckoutSession(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          orderId: "x",
          successUrl: "a",
          cancelUrl: "b",
        });
      }),
    ).rejects.toThrow("No checkout URL returned");
  });
});
