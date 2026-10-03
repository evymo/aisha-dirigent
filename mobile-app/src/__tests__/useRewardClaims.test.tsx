import { renderHook, waitFor } from "@testing-library/react-native";
import { useRewardClaims } from "@/hooks/useRewardClaims";
import { createQueryWrapper } from "@/__tests__/testUtils";

const mockRpc = jest.fn();

jest.mock("@/config/api", () => ({
  api: { rpc: (...args: unknown[]) => mockRpc(...args) },
  realtime: { channel: jest.fn(), removeChannel: jest.fn() },
}));

jest.mock("@/lib/security/safeLogger", () => ({ safeError: jest.fn() }));

describe("useRewardClaims", () => {
  beforeEach(() => mockRpc.mockReset());

  it("fetches + parses the user's reward claims via get_my_reward_claims", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          amount: 100,
          denom: "uaisha",
          status: "pending",
          tx_hash: null,
          fulfilled_at: null,
          created_at: "2026-06-06T00:00:00.000Z",
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          amount: 50,
          denom: "uaisha",
          status: "fulfilled",
          tx_hash: "0xabc",
          fulfilled_at: "2026-06-06T01:00:00.000Z",
          created_at: "2026-06-06T00:30:00.000Z",
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useRewardClaims("user-1"), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_my_reward_claims", { p_limit: 20 });
    expect(result.current.data).toHaveLength(2);
    // The claim-reward screen filters this set to status === "pending".
    expect(result.current.data?.filter((c) => c.status === "pending")).toHaveLength(1);
    expect(result.current.data?.[0].denom).toBe("uaisha");
  });

  it("is disabled (never calls the RPC) when userId is undefined", () => {
    const { result } = renderHook(() => useRewardClaims(undefined), {
      wrapper: createQueryWrapper(),
    });

    expect(mockRpc).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("propagates the RPC error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error("forbidden") });

    const { result } = renderHook(() => useRewardClaims("user-1"), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});
