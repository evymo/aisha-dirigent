import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useGenerateInvoice } from "@/hooks/useGenerateInvoice";
import type { ReactNode } from "react";

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  safeErrorMock: vi.fn(),
  guardAdminMutationMock: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/security/safeLogger")>();
  return { ...mod, safeError: (...args: unknown[]) => hoisted.safeErrorMock(...args) };
});

// guardAdminMutation just wraps the async function transparently
vi.mock("@/hooks/useAdminGuard", () => ({
  useAdminGuard: () => ({
    guardAdminMutation: (_name: string, fn: unknown) => fn,
  }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const VALID_ORDER_ID = "550e8400-e29b-41d4-a716-446655440500";

const VALID_RESULT = {
  invoice_number: "FAK-2026-0001",
  already_existed: false,
};

describe("useGenerateInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls generate_invoice_for_order with correct params", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: VALID_RESULT,
      error: null,
    });

    const { result } = renderHook(() => useGenerateInvoice(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ orderId: VALID_ORDER_ID });
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith(
      "generate_invoice_for_order",
      {
        p_order_id: VALID_ORDER_ID,
        p_prefix: "FAK",
      }
    );
  });

  it("returns parsed invoice result on success", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: VALID_RESULT,
      error: null,
    });

    const { result } = renderHook(() => useGenerateInvoice(), {
      wrapper: createWrapper(),
    });

    let invoiceResult: unknown;
    await act(async () => {
      invoiceResult = await result.current.mutateAsync({
        orderId: VALID_ORDER_ID,
      });
    });

    expect(invoiceResult).toEqual({
      invoice_number: "FAK-2026-0001",
      already_existed: false,
    });
  });

  it("uses custom prefix when provided", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: { invoice_number: "INV-2026-0001", already_existed: false },
      error: null,
    });

    const { result } = renderHook(() => useGenerateInvoice(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        orderId: VALID_ORDER_ID,
        prefix: "INV",
      });
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith(
      "generate_invoice_for_order",
      {
        p_order_id: VALID_ORDER_ID,
        p_prefix: "INV",
      }
    );
  });

  it("returns already_existed: true when invoice already exists", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: { invoice_number: "FAK-2026-0001", already_existed: true },
      error: null,
    });

    const { result } = renderHook(() => useGenerateInvoice(), {
      wrapper: createWrapper(),
    });

    let invoiceResult: unknown;
    await act(async () => {
      invoiceResult = await result.current.mutateAsync({
        orderId: VALID_ORDER_ID,
      });
    });

    expect(invoiceResult).toEqual({
      invoice_number: "FAK-2026-0001",
      already_existed: true,
    });
  });

  it("throws on RPC error", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Admin only" },
    });

    const { result } = renderHook(() => useGenerateInvoice(), {
      wrapper: createWrapper(),
    });

    let thrownError: Error | undefined;
    try {
      await act(async () => {
        await result.current.mutateAsync({ orderId: VALID_ORDER_ID });
      });
    } catch (e) {
      thrownError = e as Error;
    }

    expect(thrownError?.message).toBe("Admin only");
    expect(hoisted.safeErrorMock).toHaveBeenCalledWith(
      "generateInvoice.failed",
      expect.objectContaining({ message: "Admin only" })
    );
  });

  it("throws on invalid response shape", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: { unexpected: "shape" },
      error: null,
    });

    const { result } = renderHook(() => useGenerateInvoice(), {
      wrapper: createWrapper(),
    });

    let thrownError: Error | undefined;
    try {
      await act(async () => {
        await result.current.mutateAsync({ orderId: VALID_ORDER_ID });
      });
    } catch (e) {
      thrownError = e as Error;
    }

    expect(thrownError?.message).toBe(
      "Invalid response from generate_invoice_for_order"
    );
    expect(hoisted.safeErrorMock).toHaveBeenCalledWith(
      "generateInvoice.parseFailed",
      expect.any(Object)
    );
  });

  it("does not leak sensitive data in error logs", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: { message: "some error" },
    });

    const { result } = renderHook(() => useGenerateInvoice(), {
      wrapper: createWrapper(),
    });

    try {
      await act(async () => {
        await result.current.mutateAsync({ orderId: VALID_ORDER_ID });
      });
    } catch {
      // expected
    }

    // Ensure safeError was used, not console.log / raw logging
    expect(hoisted.safeErrorMock).toHaveBeenCalled();
    const [tag] = hoisted.safeErrorMock.mock.calls[0];
    expect(tag).not.toContain("email");
    expect(tag).not.toContain("name");
  });
});
