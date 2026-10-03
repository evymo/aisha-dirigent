import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useOrderInvoiceData } from "@/hooks/useOrderInvoiceData";
import type { ReactNode } from "react";

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  safeErrorMock: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/security/safeLogger")>();
  return { ...mod, safeError: hoisted.safeErrorMock };
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const VALID_ORDER_ID = "550e8400-e29b-41d4-a716-446655440500";

const VALID_INVOICE_DATA = {
  id: VALID_ORDER_ID,
  billing_address: { city: "Prague", country: "CZ" },
  created_at: "2026-02-19T10:00:00Z",
  currency: "CZK",
  invoice_generated_at: "2026-02-19T12:00:00Z",
  invoice_number: "FAK-2026-0001",
  order_items: [
    {
      id: "item-1",
      price_at_purchase: 490,
      product_id: "prod-1",
      product_name: "RTN Preparation",
      product_sku: "RTN-001",
      quantity: 2,
    },
  ],
  payment_method: "bank_transfer",
  shipping: 99,
  shipping_address: { city: "Prague", country: "CZ" },
  shipping_method: "dpd",
  status: "confirmed",
  subtotal: 980,
  tax: 0,
  total: 1079,
  user_email: "test@example.com",
  user_name: "Test User",
  variable_symbol: "20260001",
};

describe("useOrderInvoiceData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls get_order_invoice_data with correct params", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: VALID_INVOICE_DATA,
      error: null,
    });

    const { result } = renderHook(
      () => useOrderInvoiceData(VALID_ORDER_ID, true),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(hoisted.rpcMock).toHaveBeenCalledWith("get_order_invoice_data", {
      p_order_id: VALID_ORDER_ID,
    });
  });

  it("returns parsed invoice data on success", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: VALID_INVOICE_DATA,
      error: null,
    });

    const { result } = renderHook(
      () => useOrderInvoiceData(VALID_ORDER_ID, true),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(
      expect.objectContaining({
        id: VALID_ORDER_ID,
        invoice_number: "FAK-2026-0001",
        total: 1079,
        order_items: expect.arrayContaining([
          expect.objectContaining({
            id: "item-1",
            product_name: "RTN Preparation",
            quantity: 2,
          }),
        ]),
      })
    );
  });

  it("does not fetch when orderId is undefined", async () => {
    const { result } = renderHook(
      () => useOrderInvoiceData(undefined, true),
      { wrapper: createWrapper() }
    );

    // Should stay in idle state, not loading
    expect(result.current.isFetching).toBe(false);
    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });

  it("does not fetch when enabled is false", async () => {
    const { result } = renderHook(
      () => useOrderInvoiceData(VALID_ORDER_ID, false),
      { wrapper: createWrapper() }
    );

    expect(result.current.isFetching).toBe(false);
    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });

  it("returns null when data is null", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: null,
    });

    const { result } = renderHook(
      () => useOrderInvoiceData(VALID_ORDER_ID, true),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("throws on RPC error", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Not authorized" },
    });

    const { result } = renderHook(
      () => useOrderInvoiceData(VALID_ORDER_ID, true),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(hoisted.safeErrorMock).toHaveBeenCalledWith(
      "orderInvoiceData.fetchFailed",
      expect.objectContaining({ message: "Not authorized" })
    );
  });

  it("returns null on invalid data shape instead of crashing", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: { invalid: "shape" },
      error: null,
    });

    const { result } = renderHook(
      () => useOrderInvoiceData(VALID_ORDER_ID, true),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();

    expect(hoisted.safeErrorMock).toHaveBeenCalledWith(
      "orderInvoiceData.parseFailed",
      expect.any(Object)
    );
  });

  it("handles order with minimal fields (nullable optionals)", async () => {
    const minimalData = {
      id: VALID_ORDER_ID,
      created_at: "2026-02-19T10:00:00Z",
      total: 500,
      order_items: [],
    };

    hoisted.rpcMock.mockResolvedValue({
      data: minimalData,
      error: null,
    });

    const { result } = renderHook(
      () => useOrderInvoiceData(VALID_ORDER_ID, true),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(
      expect.objectContaining({
        id: VALID_ORDER_ID,
        total: 500,
        order_items: [],
      })
    );
  });

  it("does not leak sensitive data in error logs", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: { message: "forbidden" },
    });

    const { result } = renderHook(
      () => useOrderInvoiceData(VALID_ORDER_ID, true),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(hoisted.safeErrorMock).toHaveBeenCalled();
    const [tag] = hoisted.safeErrorMock.mock.calls[0];
    expect(tag).not.toContain("email");
    expect(tag).not.toContain("name");
  });
});
