import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useNewsDelivery } from "@/hooks/useNewsDelivery";

// Hoisted mocks
const hoisted = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockUseSession: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: hoisted.mockRpc,
  },
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => hoisted.mockUseSession(),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe("useNewsDelivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    hoisted.mockUseSession.mockReturnValue({
      session: { user: { id: "user-123" }, access_token: "token" },
    });

    hoisted.mockRpc.mockResolvedValue({ data: 0, error: null });
  });

  it("should call deliver_pending_news_to_chat on deliverNews()", async () => {
    hoisted.mockRpc.mockResolvedValue({ data: 2, error: null });

    const { result } = renderHook(() => useNewsDelivery(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.deliverNews();
    });

    await waitFor(() => {
      expect(result.current.isDelivering).toBe(false);
    });

    expect(hoisted.mockRpc).toHaveBeenCalledWith("deliver_pending_news_to_chat");
    expect(result.current.deliveredCount).toBe(2);
  });

  it("should not call RPC when user is not authenticated", () => {
    hoisted.mockUseSession.mockReturnValue({
      session: null,
    });

    const { result } = renderHook(() => useNewsDelivery(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.deliverNews();
    });

    expect(hoisted.mockRpc).not.toHaveBeenCalled();
  });

  it("should only deliver once (idempotent via ref)", async () => {
    hoisted.mockRpc.mockResolvedValue({ data: 1, error: null });

    const { result } = renderHook(() => useNewsDelivery(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.deliverNews();
    });

    await waitFor(() => {
      expect(result.current.isDelivering).toBe(false);
    });

    // Second call should be no-op
    act(() => {
      result.current.deliverNews();
    });

    // Should have been called only once
    expect(hoisted.mockRpc).toHaveBeenCalledTimes(1);
  });

  it("should handle RPC error gracefully", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: null,
      error: { message: "DB error" },
    });

    const { result } = renderHook(() => useNewsDelivery(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.deliverNews();
    });

    await waitFor(() => {
      expect(result.current.isDelivering).toBe(false);
    });

    // Should not crash, error handled internally
    expect(result.current.deliveredCount).toBe(0);
  });

  it("should return 0 delivered when no pending articles", async () => {
    hoisted.mockRpc.mockResolvedValue({ data: 0, error: null });

    const { result } = renderHook(() => useNewsDelivery(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.deliverNews();
    });

    await waitFor(() => {
      expect(result.current.isDelivering).toBe(false);
    });

    expect(result.current.deliveredCount).toBe(0);
  });
});
