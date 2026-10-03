import { renderHook, waitFor } from "@testing-library/react-native";
import { useDashboard } from "@/hooks/useDashboard";
import { createQueryWrapper } from "@/__tests__/testUtils";

const mockRpc = jest.fn();
const mockSafeError = jest.fn();

jest.mock("@/config/api", () => ({
  api: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
  realtime: {
    channel: jest.fn(),
    removeChannel: jest.fn(),
  },
}));

jest.mock("@/lib/security/safeLogger", () => ({
  safeError: (...args: unknown[]) => mockSafeError(...args),
}));

describe("useDashboard", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockSafeError.mockReset();
  });

  it("loads and validates dashboard data", async () => {
    mockRpc.mockResolvedValue({
      data: {
        user_stats: {
          total_points: 120,
          weekly_points: 30,
          current_streak: 5,
          best_streak: 10,
          weekly_rank: 3,
        },
        todays_reminders: [],
        recent_health_data: {
          avg_pain_7d: 2,
          avg_energy_7d: 7,
          avg_sleep_7d: 8,
          avg_mood_7d: 6,
        },
        active_studies: [
          { id: "s-1", title: "Study A", status: "active" },
        ],
      },
      error: null,
    });

    const { result } = renderHook(() => useDashboard("user-1"), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.user_stats.total_points).toBe(120);
    expect(result.current.data?.active_studies).toHaveLength(1);
    expect(mockRpc).toHaveBeenCalledWith("get_mobile_dashboard_data", {});
  });
});
