import { act, renderHook } from "@testing-library/react-native";
import { useValidator } from "@/hooks/useValidator";

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

jest.mock("@/hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("useValidator", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockSafeError.mockReset();
  });

  it("runs compliance and effort RPCs from the hook", async () => {
    mockRpc
      .mockResolvedValueOnce({
        data: {
          issues: ["lint_clean"],
          passed: false,
          score: 75,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          complexity: "medium",
          confidence: 0.8,
          hours_max: 8,
          hours_min: 4,
          notes: "Review the RPC layer.",
        },
        error: null,
      });

    const { result } = renderHook(() => useValidator("story-1"));

    await act(async () => {
      await result.current.runValidation();
    });

    expect(mockRpc).toHaveBeenNthCalledWith(1, "validate_compliance_mobile", {
      p_story_id: "story-1",
    });
    expect(mockRpc).toHaveBeenNthCalledWith(2, "estimate_effort_mobile", {
      p_story_id: "story-1",
    });
    expect(result.current.compliance?.score).toBe(75);
    expect(result.current.effort?.hours_max).toBe(8);
    expect(
      result.current.checklist.find((item) => item.key === "lint_clean")?.status,
    ).toBe("fail");
    expect(result.current.isRunning).toBe(false);
  });
});
