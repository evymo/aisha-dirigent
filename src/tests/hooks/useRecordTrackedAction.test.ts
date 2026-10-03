import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useRecordTrackedAction } from "@/hooks/useRecordTrackedAction";

const mockRpc = vi.fn();
vi.mock("@/integrations/db/client", () => ({
  aisha: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useRecordTrackedAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records a neutral action via record_tracked_action", async () => {
    mockRpc.mockResolvedValue({ data: "33333333-3333-3333-3333-333333333333", error: null });
    const { result } = renderHook(() => useRecordTrackedAction(), { wrapper: createWrapper() });

    let id = "";
    await act(async () => {
      id = await result.current.mutateAsync({ actionType: "task", payload: { done: true } });
    });

    expect(id).toBe("33333333-3333-3333-3333-333333333333");
    expect(mockRpc).toHaveBeenCalledWith("record_tracked_action", {
      p_action_type: "task",
      p_payload: { done: true },
      p_reminder_id: undefined,
      p_occurred_at: undefined,
    });
  });
});
