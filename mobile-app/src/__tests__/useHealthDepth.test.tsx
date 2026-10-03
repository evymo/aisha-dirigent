import { renderHook, waitFor } from "@testing-library/react-native";
import {
  useHealthTrends,
  useMyDosingLogs,
  useMyLabResults,
  useMyOngoingSymptoms,
} from "@/hooks/useHealthDepth";
import { createQueryWrapper } from "@/__tests__/testUtils";

const mockRpc = jest.fn();

jest.mock("@/config/api", () => ({
  api: { rpc: (...args: unknown[]) => mockRpc(...args) },
  realtime: { channel: jest.fn(), removeChannel: jest.fn() },
}));

jest.mock("@/lib/security/safeLogger", () => ({ safeError: jest.fn() }));

describe("useHealthDepth", () => {
  beforeEach(() => mockRpc.mockReset());

  it("fetches health trends with metric, period, and ISO range", async () => {
    mockRpc.mockResolvedValue({
      data: { trends: [{ period_start: "2026-07-01", period_end: "2026-07-01", avg_value: 4200, count: 1 }] },
      error: null,
    });

    const { result } = renderHook(() => useHealthTrends("user-1", "steps", "daily", 7), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_health_trends", expect.objectContaining({
      p_metric: "steps",
      p_period: "daily",
    }));
    expect(result.current.data?.trends[0].avg_value).toBe(4200);
  });

  it("fetches lab results via audited RPC", async () => {
    mockRpc.mockResolvedValue({
      data: [{ id: "11111111-1111-4111-8111-111111111111", lab_name: "Lab", crp: 1.2 }],
      error: null,
    });

    const { result } = renderHook(() => useMyLabResults("user-1", 5), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_my_lab_results_audited", { p_limit: 5 });
    expect(result.current.data?.[0].crp).toBe(1.2);
  });

  it("fetches dosing logs via audited RPC", async () => {
    mockRpc.mockResolvedValue({
      data: [{ id: "22222222-2222-4222-8222-222222222222", logged_at: "2026-07-01T08:00:00Z", dose_amount: "1" }],
      error: null,
    });

    const { result } = renderHook(() => useMyDosingLogs("user-1", 3), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_my_dosing_logs_audited", { p_limit: 3 });
    expect(result.current.data?.[0].dose_amount).toBe("1");
  });

  it("fetches ongoing symptoms via audited RPC", async () => {
    mockRpc.mockResolvedValue({
      data: [{ id: "33333333-3333-4333-8333-333333333333", state_name: "Pain", severity: 4, duration_hours: 12 }],
      error: null,
    });

    const { result } = renderHook(() => useMyOngoingSymptoms("user-1", 4), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_my_ongoing_symptoms_audited", { p_limit: 4 });
    expect(result.current.data?.[0].severity).toBe(4);
  });
});
