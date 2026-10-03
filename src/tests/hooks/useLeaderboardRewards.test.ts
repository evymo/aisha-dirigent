import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useLeaderboardRewardConfigs,
  useUpsertLeaderboardRewardConfig,
  useAwardLeaderboardRewards,
  type UpsertLeaderboardRewardConfigInput,
} from "@/hooks/useLeaderboardRewards";

// Hoisted mocks
const hoisted = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockHasPermission: vi.fn<(permission: string) => boolean>(),
  mockGuardAdminMutation: vi.fn(),
  mockGuardAdminRead: vi.fn(),
  mockToast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(),
    loading: vi.fn(), dismiss: vi.fn(), promise: vi.fn(),
  }),
  toastSuccess: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: { rpc: hoisted.mockRpc },
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: hoisted.mockHasPermission }),
}));

vi.mock("@/hooks/useAdminGuard", () => ({
  useAdminGuard: () => ({
    guardAdminMutation: hoisted.mockGuardAdminMutation,
    guardAdminRead: hoisted.mockGuardAdminRead,
  }),
}));

vi.mock("sonner", () => ({
  toast: hoisted.mockToast,
}));

vi.mock("@/i18n", () => ({
  default: { t: (key: string) => key },
}));

const mockConfigs = [
  {
    bonus_token_type: "aisha",
    bonus_tokens: 500,
    created_at: "2026-02-19T10:00:00Z",
    id: "cfg-uuid-1",
    is_active: true,
    period_type: "monthly",
    product_name: null,
    rank_from: 1,
    rank_to: 3,
    updated_at: "2026-02-19T10:00:00Z",
    voucher_product_id: null,
  },
  {
    bonus_token_type: "aisha",
    bonus_tokens: 200,
    created_at: "2026-02-19T10:00:00Z",
    id: "cfg-uuid-2",
    is_active: true,
    period_type: "monthly",
    product_name: "Vitamin Pack",
    rank_from: 4,
    rank_to: 10,
    updated_at: "2026-02-19T10:00:00Z",
    voucher_product_id: "prod-uuid",
  },
];

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
}

describe("useLeaderboardRewardConfigs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockHasPermission.mockReturnValue(true);
    hoisted.mockGuardAdminRead.mockImplementation(
      (_name: string, fn: () => unknown) => fn
    );
    hoisted.mockRpc.mockResolvedValue({ data: mockConfigs, error: null });
  });

  it("returns config list for admin", async () => {
    const { result } = renderHook(() => useLeaderboardRewardConfigs(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data![0].id).toBe("cfg-uuid-1");
    expect(result.current.data![0].rank_from).toBe(1);
    expect(vi.mocked(hoisted.mockRpc)).toHaveBeenCalledWith(
      "get_leaderboard_reward_configs_admin"
    );
  });

  it("does not fetch when user has no admin permission", async () => {
    hoisted.mockHasPermission.mockReturnValue(false);
    const { result } = renderHook(() => useLeaderboardRewardConfigs(), {
      wrapper: createWrapper(),
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(hoisted.mockRpc)).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it("handles RPC error", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: null,
      error: { message: "DB failure" },
    });
    const { result } = renderHook(() => useLeaderboardRewardConfigs(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("silently discards invalid config items", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: [{ id: "ok" }],
      error: null,
    });
    const { result } = renderHook(() => useLeaderboardRewardConfigs(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe("useUpsertLeaderboardRewardConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockGuardAdminMutation.mockImplementation(
      (_name: string, fn: (input: unknown) => unknown) => fn
    );
    hoisted.mockRpc.mockResolvedValue({ data: "cfg-uuid-1", error: null });
  });

  it("calls RPC with correct params and shows success toast", async () => {
    const { result } = renderHook(() => useUpsertLeaderboardRewardConfig(), {
      wrapper: createWrapper(),
    });

    const input: UpsertLeaderboardRewardConfigInput = {
      p_bonus_token_type: "aisha",
      p_bonus_tokens: 500,
      p_is_active: true,
      p_period_type: "monthly",
      p_rank_from: 1,
      p_rank_to: 3,
    };

    await act(async () => {
      result.current.mutate(input);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(vi.mocked(hoisted.mockRpc)).toHaveBeenCalledWith(
      "upsert_leaderboard_reward_config_admin",
      expect.objectContaining({
        p_bonus_tokens: 500,
        p_period_type: "monthly",
        p_rank_from: 1,
        p_rank_to: 3,
      })
    );
    expect(hoisted.mockToast.success).toHaveBeenCalled();
  });

  it("shows destructive toast on save failure", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Constraint violation" },
    });

    const { result } = renderHook(() => useUpsertLeaderboardRewardConfig(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(hoisted.mockToast.error).toHaveBeenCalled();
  });
});

describe("useAwardLeaderboardRewards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockGuardAdminMutation.mockImplementation(
      (_name: string, fn: (input: unknown) => unknown) => fn
    );
    hoisted.mockRpc.mockResolvedValue({ data: null, error: null });
  });

  it("calls RPC with period ID and shows awarded toast", async () => {
    const { result } = renderHook(() => useAwardLeaderboardRewards(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ periodId: "period-uuid" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(vi.mocked(hoisted.mockRpc)).toHaveBeenCalledWith(
      "award_leaderboard_rewards",
      { p_period_id: "period-uuid" }
    );
    expect(hoisted.mockToast.success).toHaveBeenCalled();
  });

  it("shows destructive toast when award distribution fails", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Period not found" },
    });

    const { result } = renderHook(() => useAwardLeaderboardRewards(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ periodId: "bad-period" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(hoisted.mockToast.error).toHaveBeenCalled();
  });
});
