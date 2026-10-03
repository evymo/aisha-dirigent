/**
 * useWorkflowStatuses Hook Tests
 *
 * Covers the kanban lifecycle status lookup hook (list_workflow_statuses RPC).
 *
 * @see src/hooks/useWorkflowStatuses.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  useWorkflowStatuses,
  useWorkflowStatusMap,
} from "@/hooks/useWorkflowStatuses";

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
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const MOCK_ROWS = [
  {
    status: "inbox",
    label_i18n_key: "storyloop.statuses.inbox",
    sort_order: 1,
    swimlane_color: "slate",
    is_terminal: false,
    is_active: true,
  },
  {
    status: "in_progress",
    label_i18n_key: "storyloop.statuses.inProgress",
    sort_order: 2,
    swimlane_color: "blue",
    is_terminal: false,
    is_active: true,
  },
  {
    status: "archived",
    label_i18n_key: "storyloop.statuses.archived",
    sort_order: 5,
    swimlane_color: "zinc",
    is_terminal: true,
    is_active: true,
  },
];

describe("useWorkflowStatuses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns parsed rows on success", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: MOCK_ROWS, error: null });

    const { result } = renderHook(() => useWorkflowStatuses(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(3);
    expect(result.current.data?.[0].status).toBe("inbox");
    expect(result.current.data?.[2].is_terminal).toBe(true);
  });

  it("calls RPC with p_include_inactive=false by default", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

    renderHook(() => useWorkflowStatuses(), { wrapper: createWrapper() });

    await waitFor(() => expect(hoisted.rpcMock).toHaveBeenCalled());
    expect(hoisted.rpcMock).toHaveBeenCalledWith("list_workflow_statuses", {
      p_include_inactive: false,
    });
  });

  it("calls RPC with p_include_inactive=true when option enabled", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

    renderHook(() => useWorkflowStatuses({ includeInactive: true }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(hoisted.rpcMock).toHaveBeenCalled());
    expect(hoisted.rpcMock).toHaveBeenCalledWith("list_workflow_statuses", {
      p_include_inactive: true,
    });
  });

  it("surfaces RPC errors and logs via safeError", async () => {
    const rpcError = { message: "RPC failed", code: "P0001" };
    hoisted.rpcMock.mockResolvedValue({ data: null, error: rpcError });

    const { result } = renderHook(() => useWorkflowStatuses(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(hoisted.safeErrorMock).toHaveBeenCalledWith(
      "useWorkflowStatuses",
      rpcError,
    );
  });

  it("rejects malformed RPC response via Zod", async () => {
    const malformed = [{ status: "inbox" /* missing required fields */ }];
    hoisted.rpcMock.mockResolvedValue({ data: malformed, error: null });

    const { result } = renderHook(() => useWorkflowStatuses(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("does not call RPC when disabled", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

    renderHook(() => useWorkflowStatuses({ enabled: false }), {
      wrapper: createWrapper(),
    });

    // Give the query time to fire if it were going to.
    await new Promise((r) => setTimeout(r, 20));
    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });
});

describe("useWorkflowStatusMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a Map keyed by status code", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: MOCK_ROWS, error: null });

    const { result } = renderHook(() => useWorkflowStatusMap(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.statusMap.size).toBe(3);
    expect(result.current.statusMap.get("inbox")?.sort_order).toBe(1);
    expect(result.current.statusMap.get("archived")?.is_terminal).toBe(true);
    expect(result.current.statusMap.has("unknown")).toBe(false);
  });
});
