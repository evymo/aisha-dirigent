import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useActionAdherence } from "@/hooks/useActionAdherence";

const mockUser = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
vi.mock("@/hooks/useSession", () => ({ useSession: vi.fn(() => ({ user: mockUser })) }));

const mockRpc = vi.fn();
vi.mock("@/integrations/db/client", () => ({
  aisha: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useActionAdherence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches and validates the adherence shape", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          reminder_id: "44444444-4444-4444-4444-444444444444",
          action_type: "task",
          title: "Reminder",
          expected: 30,
          actual: 5,
          adherence_ratio: 0.1667,
          window_start: "2026-01-01T00:00:00.000Z",
          window_end: "2026-01-31T00:00:00.000Z",
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useActionAdherence(30), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockRpc).toHaveBeenCalledWith("get_my_action_adherence", { p_window_days: 30 });
    expect(result.current.data?.[0]).toMatchObject({ action_type: "task", expected: 30, actual: 5 });
  });

  it("returns an empty list on a contract-breaking row", async () => {
    mockRpc.mockResolvedValue({ data: [{ reminder_id: "bad" }], error: null });
    const { result } = renderHook(() => useActionAdherence(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual([]);
  });
});
