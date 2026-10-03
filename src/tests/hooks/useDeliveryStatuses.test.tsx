/**
 * useDeliveryStatuses Hook Tests
 *
 * Covers the delivery pipeline metadata lookup (list_delivery_statuses RPC).
 * Critical for governance: the requires_approval / restricts_actions flags
 * also feed the chat-side governance layer; the hook is the UI-side mirror.
 *
 * @see src/hooks/useDeliveryStatuses.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  useDeliveryStatuses,
  useDeliveryStatusMap,
} from "@/hooks/useDeliveryStatuses";

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
  return {
    ...mod,
    safeError: (...args: unknown[]) => hoisted.safeErrorMock(...args),
  };
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const MOCK_ROWS = [
  {
    status: "draft",
    label_i18n_key: "storyloop.deliveryStatuses.draft",
    sort_order: 1,
    swimlane_color: "slate",
    requires_approval: false,
    restricts_actions: false,
    is_terminal: false,
    is_active: true,
  },
  {
    status: "delivering",
    label_i18n_key: "storyloop.deliveryStatuses.delivering",
    sort_order: 5,
    swimlane_color: "orange",
    requires_approval: true,
    restricts_actions: true,
    is_terminal: false,
    is_active: true,
  },
  {
    status: "delivered",
    label_i18n_key: "storyloop.deliveryStatuses.delivered",
    sort_order: 6,
    swimlane_color: "emerald",
    requires_approval: true,
    restricts_actions: true,
    is_terminal: true,
    is_active: true,
  },
];

describe("useDeliveryStatuses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns parsed rows with governance flags", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: MOCK_ROWS, error: null });

    const { result } = renderHook(() => useDeliveryStatuses(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(3);
    const delivering = result.current.data?.find((s) => s.status === "delivering");
    expect(delivering?.requires_approval).toBe(true);
    expect(delivering?.restricts_actions).toBe(true);
  });

  it("calls RPC with p_include_inactive=false by default", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

    renderHook(() => useDeliveryStatuses(), { wrapper: createWrapper() });

    await waitFor(() => expect(hoisted.rpcMock).toHaveBeenCalled());
    expect(hoisted.rpcMock).toHaveBeenCalledWith("list_delivery_statuses", {
      p_include_inactive: false,
    });
  });

  it("calls RPC with p_include_inactive=true when option enabled", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

    renderHook(() => useDeliveryStatuses({ includeInactive: true }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(hoisted.rpcMock).toHaveBeenCalled());
    expect(hoisted.rpcMock).toHaveBeenCalledWith("list_delivery_statuses", {
      p_include_inactive: true,
    });
  });

  it("surfaces RPC errors and logs via safeError", async () => {
    const rpcError = { message: "RPC failed", code: "P0001" };
    hoisted.rpcMock.mockResolvedValue({ data: null, error: rpcError });

    const { result } = renderHook(() => useDeliveryStatuses(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(hoisted.safeErrorMock).toHaveBeenCalledWith(
      "useDeliveryStatuses",
      rpcError,
    );
  });

  it("rejects malformed RPC response via Zod", async () => {
    const malformed = [{ status: "draft" /* missing required fields */ }];
    hoisted.rpcMock.mockResolvedValue({ data: malformed, error: null });

    const { result } = renderHook(() => useDeliveryStatuses(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useDeliveryStatusMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a Map keyed by status code with governance flags", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: MOCK_ROWS, error: null });

    const { result } = renderHook(() => useDeliveryStatusMap(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.statusMap.size).toBe(3);
    expect(result.current.statusMap.get("delivering")?.requires_approval).toBe(
      true,
    );
    expect(result.current.statusMap.get("draft")?.requires_approval).toBe(false);
  });
});
