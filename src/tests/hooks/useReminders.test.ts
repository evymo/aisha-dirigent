import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useReminders } from "@/hooks/useReminders";

const mockRpc = vi.fn();
vi.mock("@/integrations/db/client", () => ({
  aisha: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

// Domain-neutral fixtures: a generic "task" reminder, no health/dosing theme.
describe("useReminders", () => {
  beforeEach(() => vi.clearAllMocks());

  it("create maps neutral input to create_user_reminder args", async () => {
    mockRpc.mockResolvedValue({ data: "11111111-1111-1111-1111-111111111111", error: null });
    const { result } = renderHook(() => useReminders(), { wrapper: createWrapper() });

    let id = "";
    await act(async () => {
      id = await result.current.create.mutateAsync({
        title: "Reminder",
        reminderType: "task",
        frequency: "daily",
        timeOfDay: "08:00",
      });
    });

    expect(id).toBe("11111111-1111-1111-1111-111111111111");
    expect(mockRpc).toHaveBeenCalledWith(
      "create_user_reminder",
      expect.objectContaining({
        p_title: "Reminder",
        p_reminder_type: "task",
        p_frequency: "daily",
        p_time_of_day: "08:00",
      }),
    );
  });

  it("update and deactivate call their RPCs", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    const { result } = renderHook(() => useReminders(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.update.mutateAsync({
        reminderId: "22222222-2222-2222-2222-222222222222",
        title: "Renamed",
      });
    });
    expect(mockRpc).toHaveBeenCalledWith(
      "update_user_reminder",
      expect.objectContaining({
        p_reminder_id: "22222222-2222-2222-2222-222222222222",
        p_title: "Renamed",
      }),
    );

    await act(async () => {
      await result.current.deactivate.mutateAsync("22222222-2222-2222-2222-222222222222");
    });
    expect(mockRpc).toHaveBeenCalledWith("deactivate_user_reminder", {
      p_reminder_id: "22222222-2222-2222-2222-222222222222",
    });
  });
});
