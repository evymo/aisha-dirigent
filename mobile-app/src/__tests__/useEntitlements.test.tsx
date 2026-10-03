import { renderHook, waitFor } from "@testing-library/react-native";
import {
  useLlmQuotaStatus,
  useMyProductAccess,
  useMySubscriptions,
  useSubscriptionPackages,
  useTokenRewardRules,
  useWalletBalance,
} from "@/hooks/useEntitlements";
import { createQueryWrapper } from "@/__tests__/testUtils";

const mockRpc = jest.fn();

jest.mock("@/config/api", () => ({
  api: { rpc: (...args: unknown[]) => mockRpc(...args) },
  realtime: { channel: jest.fn(), removeChannel: jest.fn() },
}));

jest.mock("@/lib/security/safeLogger", () => ({ safeError: jest.fn() }));

describe("useMySubscriptions", () => {
  beforeEach(() => mockRpc.mockReset());

  it("fetches + parses subscriptions", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          package_name: "Premium",
          package_tier: "premium",
          status: "active",
          next_billing_date: "2026-07-01T00:00:00Z",
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useMySubscriptions("u-1"), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_my_subscriptions");
    expect(result.current.data?.[0].package_name).toBe("Premium");
    expect(result.current.data?.[0].status).toBe("active");
  });
});

describe("useMyProductAccess", () => {
  beforeEach(() => mockRpc.mockReset());

  it("fetches + parses product access grants", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          product_id: "33333333-3333-4333-8333-333333333333",
          access_type: "member_access",
          expires_at: null,
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useMyProductAccess("u-1"), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_my_product_access");
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].access_type).toBe("member_access");
  });
});

describe("service consumption hooks", () => {
  beforeEach(() => mockRpc.mockReset());

  it("fetches localized subscription packages", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          slug: "premium",
          name: "Premium",
          price: 990,
          tokens_governance: 10,
          tokens_impact: 20,
          tokens_data: 30,
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useSubscriptionPackages("cs"), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_subscription_packages", { p_locale: "cs" });
    expect(result.current.data?.[0].tokens_data).toBe(30);
  });

  it("fetches wallet balance from get_my_wallet_balance", async () => {
    mockRpc.mockResolvedValue({
      data: [{ user_id: "99999999-9999-4999-8999-999999999999", governance_tokens: 7, impact_tokens: 8, data_tokens: 9 }],
      error: null,
    });

    const { result } = renderHook(() => useWalletBalance("99999999-9999-4999-8999-999999999999"), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_my_wallet_balance");
    expect(result.current.data?.governance_tokens).toBe(7);
  });

  it("fetches localized reward rules", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          action_type: "check_in",
          token_type: "impact",
          action_name: "Check-in",
          base_amount: 5,
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useTokenRewardRules("en"), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_token_reward_rules_localized", { p_locale: "en" });
    expect(result.current.data?.[0].base_amount).toBe(5);
  });

  it("fetches current LLM quota status without consuming quota", async () => {
    mockRpc.mockResolvedValue({
      data: {
        user_id: "99999999-9999-4999-8999-999999999999",
        tier: "free",
        daily_token_limit: 1000,
        consumed_tokens_today: 250,
        remaining_tokens: 750,
      },
      error: null,
    });

    const { result } = renderHook(() => useLlmQuotaStatus("99999999-9999-4999-8999-999999999999"), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("fn_get_llm_quota_status", {});
    expect(result.current.data?.remaining_tokens).toBe(750);
  });
});
