import { renderHook, waitFor } from "@testing-library/react-native";
import { useMyComplianceSummary, useMyConsents } from "@/hooks/usePrivacy";
import { createQueryWrapper } from "@/__tests__/testUtils";

const mockRpc = jest.fn();

jest.mock("@/config/api", () => ({
  api: { rpc: (...args: unknown[]) => mockRpc(...args) },
  realtime: { channel: jest.fn(), removeChannel: jest.fn() },
}));

jest.mock("@/lib/security/safeLogger", () => ({ safeError: jest.fn() }));

describe("useMyComplianceSummary", () => {
  beforeEach(() => mockRpc.mockReset());

  it("parses the single-row TABLE result", async () => {
    mockRpc.mockResolvedValue({
      data: [{ total_required: 10, total_completed: 7, compliance_score: 70, current_streak: 4, is_eligible_for_discount: true }],
      error: null,
    });

    const { result } = renderHook(() => useMyComplianceSummary("u-1"), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_my_compliance_summary");
    expect(result.current.data?.compliance_score).toBe(70);
    expect(result.current.data?.is_eligible_for_discount).toBe(true);
  });
});

describe("useMyConsents", () => {
  beforeEach(() => mockRpc.mockReset());

  it("parses consents (granted/revoked)", async () => {
    mockRpc.mockResolvedValue({
      data: [
        { id: "11111111-1111-4111-8111-111111111111", consent_type: "data_processing", granted: true, revoked_at: null, version: "2" },
      ],
      error: null,
    });

    const { result } = renderHook(() => useMyConsents("u-1"), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_my_consents");
    expect(result.current.data?.[0].consent_type).toBe("data_processing");
    expect(result.current.data?.[0].granted).toBe(true);
  });
});
