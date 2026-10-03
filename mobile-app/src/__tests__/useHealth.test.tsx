import { renderHook, waitFor, act } from "@testing-library/react-native";
import { useTrackingCheckIns, useCreateTrackingCheckIn } from "@/hooks/useTrackingCheckIns";
import { createQueryWrapper } from "@/__tests__/testUtils";

const mockRpc = jest.fn();

jest.mock("@/config/api", () => ({
  api: { rpc: (...args: unknown[]) => mockRpc(...args) },
  realtime: { channel: jest.fn(), removeChannel: jest.fn() },
}));

jest.mock("@/lib/security/safeLogger", () => ({ safeError: jest.fn() }));

describe("useTrackingCheckIns", () => {
  beforeEach(() => mockRpc.mockReset());

  it("fetches + parses check-ins with limit", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          user_id: "99999999-9999-4999-8999-999999999999",
          check_in_type: "morning",
          pain_level: 3,
          energy_level: 7,
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useTrackingCheckIns("99999999-9999-4999-8999-999999999999", 14), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_my_health_check_ins_audited", { p_limit: 14 });
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].energy_level).toBe(7);
  });
});

describe("useCreateTrackingCheckIn", () => {
  beforeEach(() => mockRpc.mockReset());

  it("maps form fields to create_health_check_in p_* params", async () => {
    mockRpc.mockResolvedValue({ data: { id: "22222222-2222-4222-8222-222222222222" }, error: null });

    const { result } = renderHook(() => useCreateTrackingCheckIn(), { wrapper: createQueryWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ pain_level: 4, energy_level: 6, mood_level: 5, sleep_quality: 8, notes: "ok" });
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "create_health_check_in",
      expect.objectContaining({
        p_check_in_type: "morning",
        p_pain_level: 4,
        p_energy_level: 6,
        p_mood_level: 5,
        p_sleep_quality: 8,
        p_general_notes: "ok",
      }),
    );
  });
});
