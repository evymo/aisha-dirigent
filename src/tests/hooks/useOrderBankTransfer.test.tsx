import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useOrderBankTransfer } from "@/hooks/useOrderBankTransfer";
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

const VALID_BANK_TRANSFER_DATA = {
  id: VALID_ORDER_ID,
  bank_transfer_amount: 1200,
  bank_transfer_bic: "FIOBCZPPXXX",
  bank_transfer_due_date: "2026-03-01",
  bank_transfer_iban: "CZ1234567890123456789012",
  currency: "CZK",
  payment_method: "bank_transfer",
  payment_status: "pending",
  status: "pending",
  total: 1200,
  variable_symbol: "20260001",
};

describe("useOrderBankTransfer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls edge_bank_transactions with correct params", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: VALID_BANK_TRANSFER_DATA,
      error: null,
    });

    const { result } = renderHook(() => useOrderBankTransfer(VALID_ORDER_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(hoisted.rpcMock).toHaveBeenCalledWith("edge_bank_transactions", {
      p_action: "get_order_bank_transfer",
      p_payload: { order_id: VALID_ORDER_ID },
    });
  });

  it("returns parsed bank transfer details on success", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: VALID_BANK_TRANSFER_DATA,
      error: null,
    });

    const { result } = renderHook(() => useOrderBankTransfer(VALID_ORDER_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(VALID_BANK_TRANSFER_DATA);
    expect(result.current.data?.variable_symbol).toBe("20260001");
    expect(result.current.data?.bank_transfer_iban).toBe("CZ1234567890123456789012");
  });

  it("handles JSON string response", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: JSON.stringify(VALID_BANK_TRANSFER_DATA),
      error: null,
    });

    const { result } = renderHook(() => useOrderBankTransfer(VALID_ORDER_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe(VALID_ORDER_ID);
  });

  it("does not fetch when orderId is undefined", () => {
    const { result } = renderHook(() => useOrderBankTransfer(undefined), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });

  it("throws on RPC error", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Not found", code: "PGRST116" },
    });

    const { result } = renderHook(() => useOrderBankTransfer(VALID_ORDER_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(hoisted.safeErrorMock).toHaveBeenCalledWith(
      "useOrderBankTransfer.fetchFailed",
      expect.objectContaining({ message: "Not found" })
    );
  });

  it("returns null for invalid schema and logs parse error", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: { id: VALID_ORDER_ID, missing_total: true },
      error: null,
    });

    const { result } = renderHook(() => useOrderBankTransfer(VALID_ORDER_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBeNull();
    expect(hoisted.safeErrorMock).toHaveBeenCalledWith(
      "useOrderBankTransfer.parseFailed",
      expect.objectContaining({ issues: expect.any(Array) })
    );
  });

  it("returns null when RPC returns null data", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: null,
    });

    const { result } = renderHook(() => useOrderBankTransfer(VALID_ORDER_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});
