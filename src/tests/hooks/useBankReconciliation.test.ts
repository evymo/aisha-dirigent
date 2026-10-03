import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import {
  useUnmatchedBankTransactions,
  useAllBankTransactions,
  useAwaitingTransferOrders,
  useMatchTransactionToOrder,
  useDismissTransaction,
  useFioBankSync,
  useFioBankSyncStatus,
} from "@/hooks/useBankReconciliation";
import type {
  BankTransaction,
  AwaitingOrder,
  FioSyncResult,
} from "@/hooks/useBankReconciliation";

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

// ── Test wrapper ───────────────────────────────────────────────

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

// ── Fixtures ───────────────────────────────────────────────────

const validTransaction: BankTransaction = {
  amount: 1200.0,
  created_at: "2026-02-19T10:00:00Z",
  currency: "CZK",
  fio_transaction_id: "123456",
  id: "tx-001",
  match_notes: null,
  match_status: "unmatched",
  match_type: null,
  matched_order_id: null,
  message: "Objednávka 12345",
  sender_account: "1234567890/0100",
  sender_name: "Jan Novák",
  transaction_date: "2026-02-18",
  variable_symbol: "12345",
};

const validOrder: AwaitingOrder = {
  bank_transfer_amount: 1200.0,
  bank_transfer_due_date: "2026-02-25",
  created_at: "2026-02-15T12:00:00Z",
  currency: "CZK",
  id: "order-001",
  total: 1200.0,
  variable_symbol: "12345",
};

// ── useUnmatchedBankTransactions ───────────────────────────────

describe("useUnmatchedBankTransactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch and parse unmatched transactions", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: { rows: [validTransaction] },
      error: null,
    });

    const { result } = renderHook(() => useUnmatchedBankTransactions(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]).toEqual(validTransaction);

    expect(hoisted.rpcMock).toHaveBeenCalledWith("edge_bank_transactions", {
      p_action: "get_unmatched",
      p_payload: {},
    });
  });

  it("should handle RPC error", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Unauthorized" },
    });

    const { result } = renderHook(() => useUnmatchedBankTransactions(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("Unauthorized");
    expect(hoisted.safeErrorMock).toHaveBeenCalledWith(
      "bankReconciliation.fetchUnmatched",
      expect.objectContaining({ message: "Unauthorized" }),
    );
  });

  it("should return empty array for null data", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: null,
    });

    const { result } = renderHook(() => useUnmatchedBankTransactions(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("should filter out malformed rows via Zod safeParse", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: {
        rows: [
          validTransaction,
          { id: "bad", missing_fields: true },
          null,
        ],
      },
      error: null,
    });

    const { result } = renderHook(() => useUnmatchedBankTransactions(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].id).toBe("tx-001");
  });

  it("should handle response without rows property", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: { not_rows: [] },
      error: null,
    });

    const { result } = renderHook(() => useUnmatchedBankTransactions(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

// ── useAllBankTransactions ─────────────────────────────────────

describe("useAllBankTransactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch and parse all transactions", async () => {
    const matched = { ...validTransaction, id: "tx-002", match_status: "matched" };
    hoisted.rpcMock.mockResolvedValue({
      data: { rows: [validTransaction, matched] },
      error: null,
    });

    const { result } = renderHook(() => useAllBankTransactions(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);

    expect(hoisted.rpcMock).toHaveBeenCalledWith("edge_bank_transactions", {
      p_action: "get_all",
      p_payload: {},
    });
  });

  it("should handle RPC error", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Server error" },
    });

    const { result } = renderHook(() => useAllBankTransactions(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Server error");
  });
});

// ── useAwaitingTransferOrders ──────────────────────────────────

describe("useAwaitingTransferOrders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch and parse awaiting orders", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: { rows: [validOrder] },
      error: null,
    });

    const { result } = renderHook(() => useAwaitingTransferOrders(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]).toEqual(validOrder);

    expect(hoisted.rpcMock).toHaveBeenCalledWith("edge_bank_transactions", {
      p_action: "get_awaiting_orders",
      p_payload: {},
    });
  });

  it("should handle RPC error", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Forbidden" },
    });

    const { result } = renderHook(() => useAwaitingTransferOrders(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Forbidden");
  });

  it("should filter out malformed orders via Zod safeParse", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: {
        rows: [validOrder, { id: "bad-order" }],
      },
      error: null,
    });

    const { result } = renderHook(() => useAwaitingTransferOrders(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });
});

// ── useMatchTransactionToOrder ─────────────────────────────────

describe("useMatchTransactionToOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should match transaction to order via RPC", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: { ok: true },
      error: null,
    });

    const { result } = renderHook(() => useMatchTransactionToOrder(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        order_id: "order-001",
        transaction_id: "tx-001",
        notes: "Manual match by admin",
      });
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith("edge_bank_transactions", {
      p_action: "match_to_order",
      p_payload: {
        notes: "Manual match by admin",
        order_id: "order-001",
        transaction_id: "tx-001",
      },
    });
  });

  it("should throw on RPC error", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Match failed" },
    });

    const { result } = renderHook(() => useMatchTransactionToOrder(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          order_id: "order-001",
          transaction_id: "tx-001",
        });
      }),
    ).rejects.toThrow("Match failed");
  });

  it("should throw when response ok is false", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: { ok: false },
      error: null,
    });

    const { result } = renderHook(() => useMatchTransactionToOrder(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          order_id: "order-001",
          transaction_id: "tx-001",
        });
      }),
    ).rejects.toThrow("Match operation failed");
  });

  it("should throw when response is null", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: null,
    });

    const { result } = renderHook(() => useMatchTransactionToOrder(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          order_id: "order-001",
          transaction_id: "tx-001",
        });
      }),
    ).rejects.toThrow("Match operation failed");
  });
});

// ── useDismissTransaction ──────────────────────────────────────

describe("useDismissTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should dismiss transaction via RPC", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: { ok: true },
      error: null,
    });

    const { result } = renderHook(() => useDismissTransaction(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        transaction_id: "tx-001",
        notes: "Duplicate payment",
      });
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith("edge_bank_transactions", {
      p_action: "dismiss_transaction",
      p_payload: {
        notes: "Duplicate payment",
        transaction_id: "tx-001",
      },
    });
  });

  it("should throw on RPC error", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Dismiss failed" },
    });

    const { result } = renderHook(() => useDismissTransaction(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({ transaction_id: "tx-001" });
      }),
    ).rejects.toThrow("Dismiss failed");
  });

  it("should throw when ok is false", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: { ok: false },
      error: null,
    });

    const { result } = renderHook(() => useDismissTransaction(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({ transaction_id: "tx-001" });
      }),
    ).rejects.toThrow("Dismiss operation failed");
  });
});

// ── useFioBankSync ─────────────────────────────────────────────

describe("useFioBankSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should invoke fio-bank-sync edge function", async () => {
    const syncResult: FioSyncResult = {
      auto_matched: 2,
      duplicates: 1,
      inserted: 5,
      ok: true,
      total: 8,
    };

    hoisted.invokeMock.mockResolvedValue({
      data: syncResult,
      error: null,
    });

    const { result } = renderHook(() => useFioBankSync(), {
      wrapper: createWrapper(),
    });

    let syncData: FioSyncResult | undefined;
    await act(async () => {
      syncData = await result.current.mutateAsync({
        from_date: "2026-02-01",
        to_date: "2026-02-19",
      });
    });

    expect(syncData).toEqual(syncResult);
    expect(hoisted.invokeMock).toHaveBeenCalledWith("fio-bank-sync", {
      body: {
        action: "sync",
        from_date: "2026-02-01",
        to_date: "2026-02-19",
      },
    });
  });

  it("should invoke without date params", async () => {
    hoisted.invokeMock.mockResolvedValue({
      data: { ok: true, inserted: 0, total: 0 },
      error: null,
    });

    const { result } = renderHook(() => useFioBankSync(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync(undefined);
    });

    expect(hoisted.invokeMock).toHaveBeenCalledWith("fio-bank-sync", {
      body: {
        action: "sync",
        from_date: undefined,
        to_date: undefined,
      },
    });
  });

  it("should throw on invoke error", async () => {
    hoisted.invokeMock.mockResolvedValue({
      data: null,
      error: { message: "Edge function error" },
    });

    const { result } = renderHook(() => useFioBankSync(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync(undefined);
      }),
    ).rejects.toThrow("Edge function error");
  });

  it("should throw on invalid sync response", async () => {
    hoisted.invokeMock.mockResolvedValue({
      data: { invalid: "data" },
      error: null,
    });

    const { result } = renderHook(() => useFioBankSync(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync(undefined);
      }),
    ).rejects.toThrow("Invalid sync response");
  });
});

// ── useFioBankSyncStatus ───────────────────────────────────────

describe("useFioBankSyncStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch sync status", async () => {
    hoisted.invokeMock.mockResolvedValue({
      data: {
        check_interval_minutes: 15,
        configured: true,
        enabled: true,
      },
      error: null,
    });

    const { result } = renderHook(() => useFioBankSyncStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      check_interval_minutes: 15,
      configured: true,
      enabled: true,
    });

    expect(hoisted.invokeMock).toHaveBeenCalledWith("fio-bank-sync", {
      body: { action: "status" },
    });
  });

  it("should return defaults on error without throwing", async () => {
    hoisted.invokeMock.mockResolvedValue({
      data: null,
      error: { message: "Function not found" },
    });

    const { result } = renderHook(() => useFioBankSyncStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      check_interval_minutes: 30,
      configured: false,
      enabled: false,
    });
  });
});

// ── Zod schema edge cases ──────────────────────────────────────

describe("Zod schema validation edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should accept transaction with all nullable fields as null", async () => {
    const minimalTx: BankTransaction = {
      amount: 500,
      created_at: "2026-01-01T00:00:00Z",
      currency: "CZK",
      fio_transaction_id: null,
      id: "tx-minimal",
      match_notes: null,
      match_status: "unmatched",
      match_type: null,
      matched_order_id: null,
      message: null,
      sender_account: null,
      sender_name: null,
      transaction_date: null,
      variable_symbol: null,
    };

    hoisted.rpcMock.mockResolvedValue({
      data: { rows: [minimalTx] },
      error: null,
    });

    const { result } = renderHook(() => useUnmatchedBankTransactions(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].id).toBe("tx-minimal");
  });

  it("should reject transaction missing required amount field", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: {
        rows: [
          {
            id: "tx-no-amount",
            created_at: "2026-01-01T00:00:00Z",
            currency: "CZK",
            match_status: "unmatched",
            // missing amount
          },
        ],
      },
      error: null,
    });

    const { result } = renderHook(() => useUnmatchedBankTransactions(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(0);
  });

  it("should accept order with optional fields absent", async () => {
    const minimalOrder: AwaitingOrder = {
      bank_transfer_amount: null,
      bank_transfer_due_date: null,
      created_at: "2026-01-01T00:00:00Z",
      currency: "CZK",
      id: "order-minimal",
      total: 999,
      variable_symbol: null,
    };

    hoisted.rpcMock.mockResolvedValue({
      data: { rows: [minimalOrder] },
      error: null,
    });

    const { result } = renderHook(() => useAwaitingTransferOrders(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].total).toBe(999);
  });
});
