import { renderHook, waitFor } from "@testing-library/react-native";
import { useTrackedActions } from "@/hooks/useTrackedActions";
import { createQueryWrapper } from "@/__tests__/testUtils";

const mockRpc = jest.fn();

jest.mock("@/config/api", () => ({
  api: { rpc: (...args: unknown[]) => mockRpc(...args) },
  realtime: { channel: jest.fn(), removeChannel: jest.fn() },
}));

jest.mock("@/lib/security/safeLogger", () => ({ safeError: jest.fn() }));

// Domain-neutral fixtures: assert the universal action_type/occurred_at/source/
// payload contract, not any specific theme.
describe("useTrackedActions (mobile)", () => {
  beforeEach(() => mockRpc.mockReset());

  it("fetches tracked actions via the universal RPC and validates the shape", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          action_type: "reminder",
          occurred_at: "2026-01-01T10:00:00.000Z",
          reminder_id: "22222222-2222-4222-9222-222222222222",
          source: "reminder_completion",
          source_id: "11111111-1111-4111-8111-111111111111",
          payload: { done: true },
        },
      ],
      error: null,
    });

    const { result } = renderHook(
      () => useTrackedActions("user-1", { actionType: "reminder", limit: 50 }),
      { wrapper: createQueryWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith("get_my_tracked_actions", {
      p_since: undefined,
      p_action_type: "reminder",
      p_limit: 50,
    });
    expect(result.current.data?.[0]).toMatchObject({
      action_type: "reminder",
      source: "reminder_completion",
    });
  });

  it("is disabled without a userId", () => {
    const { result } = renderHook(() => useTrackedActions(undefined), {
      wrapper: createQueryWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
