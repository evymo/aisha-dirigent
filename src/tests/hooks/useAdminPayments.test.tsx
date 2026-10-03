/**
 * Tests for src/hooks/useAdminPayments.ts
 *
 * Coverage:
 *   - useAdminPayments  (query — orders + payment metadata)
 *   - processRefund     (standalone async function — refund via edge fn)
 *   - useRefetchPayments (cache invalidator)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useAdminPayments,
  processRefund,
  useRefetchPayments,
} from "@/hooks/useAdminPayments";

const { mockRpc, mockInvoke, mockHasPermission, mockUser } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockInvoke: vi.fn(),
  mockHasPermission: vi.fn(),
  mockUser: { id: "admin-id" },
}));

vi.mock("@/integrations/db/client", () => ({
  aisha: { rpc: mockRpc, functions: { invoke: mockInvoke } },
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: mockHasPermission }),
}));
vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({ user: mockUser }),
}));

function createWrapper(qc?: QueryClient) {
  const queryClient = qc ??
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

const UUID_ORDER = "30000000-0000-4000-a000-000000000001";
const UUID_USER = "30000000-0000-4000-a000-000000000002";

const mockOrderRow = {
  id: UUID_ORDER,
  user_id: UUID_USER,
  user_email: "buyer@example.test",
  user_name: "Buyer Test",
  status: "paid",
  total: 12500,
  currency: "CZK",
  stripe_payment_intent_id: "pi_test_123",
  shipping_address: { street: "Test 1", city: "Prague" },
  created_at: "2026-03-01T00:00:00Z",
  updated_at: "2026-03-01T01:00:00Z",
};

// ── useAdminPayments ─────────────────────────────────────────

describe("useAdminPayments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls get_orders_admin with p_limit=500 and maps to Payment shape", async () => {
    mockRpc.mockResolvedValue({ data: [mockOrderRow], error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAdminPayments(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith("get_orders_admin", {
      p_limit: 500,
      p_status: undefined,
    });
    expect(result.current.data).toEqual([
      {
        id: UUID_ORDER,
        order_id: UUID_ORDER,
        stripe_payment_intent_id: "pi_test_123",
        stripe_session_id: null,
        amount: 12500,
        currency: "CZK",
        status: "paid",
        created_at: "2026-03-01T00:00:00Z",
        updated_at: "2026-03-01T01:00:00Z",
        order: {
          id: UUID_ORDER,
          status: "paid",
          user_id: UUID_USER,
          shipping_address: { street: "Test 1", city: "Prague" },
        },
        profile: { display_name: "Buyer Test", email: "buyer@example.test" },
      },
    ]);
  });

  it("defaults missing currency to CZK and missing profile fields to null", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          ...mockOrderRow,
          // omit user_email / user_name / currency to exercise nullable + default paths
          user_email: undefined,
          user_name: undefined,
          currency: undefined,
        },
      ],
      error: null,
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAdminPayments(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.[0].currency).toBe("CZK");
    expect(result.current.data?.[0].profile).toEqual({
      display_name: null,
      email: null,
    });
  });

  it("does not call RPC when caller lacks view_admin_dashboard", async () => {
    mockHasPermission.mockReturnValue(false);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAdminPayments(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "function get_orders_admin does not exist" },
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAdminPayments(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain("get_orders_admin");
  });
});

// ── processRefund ────────────────────────────────────────────

describe("processRefund", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invokes the stripe-refund edge fn with the payment intent", async () => {
    mockInvoke.mockResolvedValue({ data: null, error: null });
    await processRefund({ paymentIntentId: "pi_test_123", amount: 1000 });

    expect(mockInvoke).toHaveBeenCalledWith("stripe-refund", {
      body: { paymentIntentId: "pi_test_123", amount: 1000 },
    });
  });

  it("supports full refund (amount omitted)", async () => {
    mockInvoke.mockResolvedValue({ data: null, error: null });
    await processRefund({ paymentIntentId: "pi_full_refund" });

    expect(mockInvoke).toHaveBeenCalledWith("stripe-refund", {
      body: { paymentIntentId: "pi_full_refund", amount: undefined },
    });
  });

  it("throws a generic 'Refund failed' so callers can't leak provider details", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: {
        message:
          "Stripe internal: charge_already_refunded for ch_LEAK_THIS_SHOULDNT_PROPAGATE",
      },
    });

    await expect(
      processRefund({ paymentIntentId: "pi_test_123" }),
    ).rejects.toThrow("Refund failed");
    // Verify the leaky upstream message is NOT in the rejection
    try {
      await processRefund({ paymentIntentId: "pi_test_123" });
    } catch (e) {
      expect((e as Error).message).not.toContain("ch_LEAK_THIS_SHOULDNT_PROPAGATE");
    }
  });
});

// ── useRefetchPayments ──────────────────────────────────────

describe("useRefetchPayments", () => {
  it("invalidates the admin-payments query key", () => {
    const { Wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRefetchPayments(), { wrapper: Wrapper });
    result.current();

    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin-payments"] });
  });
});
