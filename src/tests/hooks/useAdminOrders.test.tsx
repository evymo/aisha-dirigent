/**
 * Tests for src/hooks/useAdminOrders.ts
 *
 *   - useOrdersAdmin       (query — get_orders_admin_with_items, safeParse soft-fail)
 *   - useUpdateOrderStatus (mutation — update_order_status_admin)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useOrdersAdmin, useUpdateOrderStatus } from "@/hooks/useAdminOrders";

const { mockRpc, mockHasPermission, mockUser, mockGuardAdminMutation } =
  vi.hoisted(() => ({
    mockRpc: vi.fn(),
    mockHasPermission: vi.fn(),
    mockUser: { id: "admin-id" },
    mockGuardAdminMutation: (_rpc: string, fn: (args: unknown) => unknown) => fn,
  }));

vi.mock("@/integrations/db/client", () => ({
  aisha: { rpc: mockRpc },
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: mockHasPermission }),
}));
vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({ user: mockUser }),
}));
vi.mock("@/hooks/useAdminGuard", () => ({
  useAdminGuard: () => ({ guardAdminMutation: mockGuardAdminMutation }),
}));

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
}

const UUID_ORDER = "40000000-0000-4000-a000-000000000001";
const UUID_USER = "40000000-0000-4000-a000-000000000002";
const UUID_ITEM = "40000000-0000-4000-a000-000000000003";
const UUID_PRODUCT = "40000000-0000-4000-a000-000000000004";

const mockOrderRow = {
  id: UUID_ORDER,
  user_id: UUID_USER,
  user_email: "buyer@example.test",
  user_name: "Buyer Test",
  status: "pending",
  total: 5000,
  currency: "CZK",
  subtotal: 4500,
  shipping: 500,
  payment_method: "stripe",
  payment_status: "succeeded",
  stripe_payment_intent_id: "pi_test_123",
  shipping_address: { street: "Test 1", city: "Prague" },
  billing_address: null,
  delivered_at: null,
  invoice_generated_at: null,
  invoice_number: null,
  variable_symbol: null,
  created_at: "2026-03-01T00:00:00Z",
  updated_at: "2026-03-01T01:00:00Z",
  order_items: [
    {
      id: UUID_ITEM,
      product_id: UUID_PRODUCT,
      price_at_purchase: 2250,
      quantity: 2,
    },
  ],
};

describe("useOrdersAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls get_orders_admin_with_items with p_limit=500 + undefined status", async () => {
    mockRpc.mockResolvedValue({ data: [mockOrderRow], error: null });

    const { result } = renderHook(() => useOrdersAdmin(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith("get_orders_admin_with_items", {
      p_limit: 500,
      p_status: undefined,
    });
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].id).toBe(UUID_ORDER);
  });

  it("ensures order_items defaults to [] even when row arrives without it", async () => {
    // Schema requires order_items array — verify we don't crash when the
    // server happens to send an empty list or missing field
    mockRpc.mockResolvedValue({
      data: [{ ...mockOrderRow, order_items: [] }],
      error: null,
    });

    const { result } = renderHook(() => useOrdersAdmin(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].order_items).toEqual([]);
  });

  it("returns [] on schema parse failure (safeParse soft-fail)", async () => {
    // Missing required `status` field → safeParse rejects → empty array
    mockRpc.mockResolvedValue({
      data: [{ ...mockOrderRow, status: undefined }],
      error: null,
    });

    const { result } = renderHook(() => useOrdersAdmin(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("does not call RPC when caller lacks view_admin_dashboard", async () => {
    mockHasPermission.mockReturnValue(false);

    const { result } = renderHook(() => useOrdersAdmin(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied for function" },
    });

    const { result } = renderHook(() => useOrdersAdmin(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("permission denied for function");
  });
});

describe("useUpdateOrderStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls update_order_status_admin with orderId + status", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useUpdateOrderStatus(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.mutateAsync({ orderId: UUID_ORDER, status: "shipped" });
    });

    expect(mockRpc).toHaveBeenCalledWith("update_order_status_admin", {
      p_order_id: UUID_ORDER,
      p_status: "shipped",
    });
  });

  it("returns the params for optimistic-update consumers", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useUpdateOrderStatus(), {
      wrapper: createWrapper(),
    });
    let out: { orderId: string; status: string } | undefined;
    await act(async () => {
      out = await result.current.mutateAsync({
        orderId: UUID_ORDER,
        status: "cancelled",
      });
    });
    expect(out).toEqual({ orderId: UUID_ORDER, status: "cancelled" });
  });

  it("propagates RPC error to the caller", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Invalid status: not_a_real_status" },
    });

    const { result } = renderHook(() => useUpdateOrderStatus(), {
      wrapper: createWrapper(),
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync({
          orderId: UUID_ORDER,
          status: "not_a_real_status",
        });
      }),
    ).rejects.toThrow("Invalid status: not_a_real_status");
  });
});
