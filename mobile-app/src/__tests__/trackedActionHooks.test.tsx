import { renderHook, waitFor, act } from "@testing-library/react-native";
import { useReminders } from "@/hooks/useReminders";
import { useRecordTrackedAction } from "@/hooks/useRecordTrackedAction";
import { useActionAdherence } from "@/hooks/useActionAdherence";
import { createQueryWrapper } from "@/__tests__/testUtils";

const mockRpc = jest.fn();

jest.mock("@/config/api", () => ({
  api: { rpc: (...args: unknown[]) => mockRpc(...args) },
  realtime: { channel: jest.fn(), removeChannel: jest.fn() },
}));

jest.mock("@/lib/security/safeLogger", () => ({ safeError: jest.fn() }));

// Domain-neutral fixtures — exercise the universal reminder/record/adherence
// contract, not any specific theme.
describe("tracked-action mobile hooks (parity with web)", () => {
  beforeEach(() => mockRpc.mockReset());

  it("useReminders.create wraps create_user_reminder", async () => {
    mockRpc.mockResolvedValue({ data: "11111111-1111-4111-8111-111111111111", error: null });
    const { result } = renderHook(() => useReminders(), { wrapper: createQueryWrapper() });

    let id: string | undefined;
    await act(async () => {
      id = await result.current.create.mutateAsync({
        title: "T",
        reminderType: "generic",
        frequency: "daily",
        timeOfDay: "08:00",
      });
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "create_user_reminder",
      expect.objectContaining({
        p_title: "T",
        p_reminder_type: "generic",
        p_frequency: "daily",
        p_time_of_day: "08:00",
      }),
    );
    expect(id).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("useReminders.deactivate wraps deactivate_user_reminder", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    const { result } = renderHook(() => useReminders(), { wrapper: createQueryWrapper() });

    await act(async () => {
      await result.current.deactivate.mutateAsync("22222222-2222-4222-9222-222222222222");
    });

    expect(mockRpc).toHaveBeenCalledWith("deactivate_user_reminder", {
      p_reminder_id: "22222222-2222-4222-9222-222222222222",
    });
  });

  it("useRecordTrackedAction wraps record_tracked_action with a neutral payload", async () => {
    mockRpc.mockResolvedValue({ data: "33333333-3333-4333-8333-333333333333", error: null });
    const { result } = renderHook(() => useRecordTrackedAction(), { wrapper: createQueryWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ actionType: "generic_action", payload: { value: 1 } });
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "record_tracked_action",
      expect.objectContaining({ p_action_type: "generic_action", p_payload: { value: 1 } }),
    );
  });

  it("useActionAdherence fetches + validates the events-vs-schedule shape", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          reminder_id: "22222222-2222-4222-9222-222222222222",
          action_type: "generic",
          title: "T",
          expected: 30,
          actual: 5,
          adherence_ratio: 0.1667,
          window_start: "2026-01-01T00:00:00.000Z",
          window_end: "2026-01-31T00:00:00.000Z",
        },
      ],
      error: null,
    });
    const { result } = renderHook(() => useActionAdherence("user-1", 30), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith("get_my_action_adherence", { p_window_days: 30 });
    expect(result.current.data?.[0]).toMatchObject({ expected: 30, actual: 5 });
  });

  it("useActionAdherence is disabled without a userId", () => {
    const { result } = renderHook(() => useActionAdherence(undefined), {
      wrapper: createQueryWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});
