import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode } from "react";

const mockToast = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(),
    loading: vi.fn(), dismiss: vi.fn(), promise: vi.fn(),
  })
);

vi.mock("sonner", () => ({
  toast: mockToast,
}));

vi.mock("@/i18n", () => ({
  default: {
    t: (key: string) => key,
  },
}));

// Hoisted mock for aisha.rpc
const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

// Import after mocks
import {
  useTokenConfigs,
  useUpdateTokenConfig,
  useTokenRewardRules,
  useUpdateRewardRule,
  useCreateRewardRule,
  useTokenLocks,
  useCreateTokenLock,
  useUpdateTokenLock,
  useTokenBurns,
  useCreateTokenBurn,
  useTokenAllocations,
  useCreateTokenAllocation,
  useUpdateTokenAllocation,
  useTokenomicsStats,
} from "@/hooks/useTokenomics";
import { mockAdminPermissions } from '@/tests/utils/permissions';

const createWrapper = (queryClient: QueryClient) => {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

// Valid mock data that passes Zod schemas
const validTokenConfig = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  token_type: "aisha",
  name: "Platform Token",
  symbol: "CHR",
  description: "Main token",
  total_supply: 1000000,
  circulating_supply: 500000,
  locked_supply: 200000,
  burned_supply: 50000,
  emission_rate_daily: 100,
  is_active: true,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

const validRewardRule = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  action_type: "health_checkin",
  action_name_key: "tokenomics.health_checkin",
  description_key: "tokenomics.health_checkin.desc",
  token_type: "aisha",
  base_amount: 10,
  multiplier: 1,
  min_amount: null,
  max_amount: null,
  daily_limit: 1,
  weekly_limit: null,
  monthly_limit: null,
  cooldown_hours: 24,
  requires_membership: true,
  membership_tier_required: null,
  is_active: true,
  sort_order: 1,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

const validTokenLock = {
  id: "550e8400-e29b-41d4-a716-446655440002",
  user_id: "550e8400-e29b-41d4-a716-446655440003",
  token_type: "aisha",
  amount: 1000,
  lock_reason: "Vesting",
  lock_start: "2024-01-01",
  lock_end: "2025-01-01",
  unlock_schedule: "linear",
  unlocked_amount: 0,
  is_active: true,
  notes: null,
  created_at: "2024-01-01T00:00:00Z",
  profile_display_name: "Test User",
  profile_email: "test@example.com",
};

const validTokenBurn = {
  id: "550e8400-e29b-41d4-a716-446655440004",
  token_type: "aisha",
  amount: 1000,
  burn_reason: "quarterly_burn",
  source_user_id: null,
  description: "Q1 2024 burn",
  burned_by: "550e8400-e29b-41d4-a716-446655440005",
  created_at: "2024-01-01T00:00:00Z",
};

const validTokenAllocation = {
  id: "550e8400-e29b-41d4-a716-446655440006",
  allocation_name: "Team",
  allocation_type: "team",
  token_type: "aisha",
  total_amount: 100000,
  distributed_amount: 25000,
  vesting_start: "2024-01-01T00:00:00Z",
  vesting_end: "2026-01-01T00:00:00Z",
  vesting_schedule: "linear",
  cliff_months: 6,
  is_active: true,
  notes: null,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

describe("useTokenomics hooks", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminPermissions();
    hoisted.rpcMock.mockReset();
    mockToast.mockReset();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  describe("useTokenConfigs", () => {
    it("fetches token configs successfully", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [validTokenConfig],
        error: null,
      });

      const { result } = renderHook(() => useTokenConfigs(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].token_type).toBe("aisha");
      expect(hoisted.rpcMock).toHaveBeenCalledWith("get_token_configs_admin");
    });

    it("handles fetch error", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: "Database error" },
      });

      const { result } = renderHook(() => useTokenConfigs(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
  });

  describe("useUpdateTokenConfig", () => {
    it("updates token config and invalidates queries", async () => {
      // Mock returns single object (not array) for parseRpcResponse
      hoisted.rpcMock.mockResolvedValue({
        data: validTokenConfig,
        error: null,
      });

      const { result } = renderHook(() => useUpdateTokenConfig(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          id: validTokenConfig.id,
          updates: { token_type: "aisha", emission_rate_daily: 150 },
        });
      });

      // Implementation uses p_token_type as identifier, not p_config_id
      expect(hoisted.rpcMock).toHaveBeenCalledWith("update_token_config_admin", {
        p_token_type: "aisha",
        p_name: undefined,
        p_symbol: undefined,
        p_description: undefined,
        p_total_supply: undefined,
        p_emission_rate_daily: 150,
        p_is_active: undefined,
      });
    });

    it("shows error toast on failure", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: "Update failed" },
      });

      const { result } = renderHook(() => useUpdateTokenConfig(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await expect(
          result.current.mutateAsync({
            id: "test-id",
            updates: { emission_rate_daily: 150 },
          })
        ).rejects.toBeTruthy();
      });

      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  describe("useTokenRewardRules", () => {
    it("fetches reward rules successfully", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [validRewardRule],
        error: null,
      });

      const { result } = renderHook(() => useTokenRewardRules(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].action_type).toBe("health_checkin");
    });
  });

  describe("useTokenLocks", () => {
    it("fetches token locks with profile info", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [validTokenLock],
        error: null,
      });

      const { result } = renderHook(() => useTokenLocks(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].profile?.display_name).toBe("Test User");
    });
  });

  describe("useCreateTokenLock", () => {
    it("creates token lock successfully", async () => {
      // Mock returns single object for mutation response
      hoisted.rpcMock.mockResolvedValue({
        data: validTokenLock,
        error: null,
      });

      const { result } = renderHook(() => useCreateTokenLock(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          user_id: validTokenLock.user_id,
          token_type: "aisha",
          amount: 100,
          lock_end: "2026-01-01T00:00:00Z",
          lock_reason: "manual",
          lock_start: "2025-01-01T00:00:00Z",
          unlock_schedule: "cliff",
        });
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith("create_token_lock_admin", {
        p_user_id: validTokenLock.user_id,
        p_token_type: "aisha",
        p_amount: 100,
        p_lock_end: "2026-01-01T00:00:00Z",
        p_lock_reason: "manual",
        p_lock_start: "2025-01-01T00:00:00Z",
        p_unlock_schedule: "cliff",
        p_notes: undefined,
      });
    });

    it("throws error when required fields are missing", async () => {
      const { result } = renderHook(() => useCreateTokenLock(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await expect(
          result.current.mutateAsync({})
        ).rejects.toThrow("Missing required fields");
      });
    });
  });

  describe("useUpdateTokenLock", () => {
    it("updates token lock successfully", async () => {
      // Mock returns single object for mutation response
      hoisted.rpcMock.mockResolvedValue({
        data: validTokenLock,
        error: null,
      });

      const { result } = renderHook(() => useUpdateTokenLock(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          id: validTokenLock.id,
          updates: {
            amount: 150,
            lock_end: "2026-06-01T00:00:00Z",
          },
        });
      });

      // Implementation uses p_lock_id as identifier
      expect(hoisted.rpcMock).toHaveBeenCalledWith("update_token_lock_admin", {
        p_lock_id: validTokenLock.id,
        p_amount: 150,
        p_lock_end: "2026-06-01T00:00:00Z",
        p_unlock_schedule: undefined,
        p_unlocked_amount: undefined,
        p_is_active: undefined,
        p_lock_reason: undefined,
        p_notes: undefined,
      });
    });
  });

  describe("useTokenBurns", () => {
    it("fetches token burns successfully", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [validTokenBurn],
        error: null,
      });

      const { result } = renderHook(() => useTokenBurns(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].burn_reason).toBe("quarterly_burn");
    });
  });

  describe("useCreateTokenBurn", () => {
    it("creates token burn and invalidates queries", async () => {
      // Mock returns single object for mutation response
      hoisted.rpcMock.mockResolvedValue({
        data: validTokenBurn,
        error: null,
      });

      const { result } = renderHook(() => useCreateTokenBurn(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          token_type: "aisha",
          amount: 1000,
          burn_reason: "quarterly_burn",
          description: "Test burn",
        });
      });

      // Implementation uses p_reason, not p_burn_reason
      expect(hoisted.rpcMock).toHaveBeenCalledWith("create_token_burn_admin", {
        p_token_type: "aisha",
        p_amount: 1000,
        p_reason: "quarterly_burn",
        p_description: "Test burn",
        p_source_user_id: undefined,
      });
    });
  });

  describe("useTokenAllocations", () => {
    it("fetches token allocations successfully", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [validTokenAllocation],
        error: null,
      });

      const { result } = renderHook(() => useTokenAllocations(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].allocation_name).toBe("Team");
    });
  });

  describe("useCreateTokenAllocation", () => {
    it("creates token allocation successfully", async () => {
      // Mock returns single object for parseRpcResponse
      hoisted.rpcMock.mockResolvedValue({
        data: validTokenAllocation,
        error: null,
      });

      const { result } = renderHook(() => useCreateTokenAllocation(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          allocation_name: "Team",
          allocation_type: "team",
          token_type: "aisha",
          total_amount: 100000,
        });
      });

      // Implementation uses p_name, p_purpose, p_allocation_amount
      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "create_token_allocation_admin",
        expect.objectContaining({
          p_name: "Team",
          p_purpose: "team",
          p_token_type: "aisha",
          p_allocation_amount: 100000,
        })
      );
    });
  });

  describe("useUpdateTokenAllocation", () => {
    it("updates token allocation successfully", async () => {
      // Mock returns single object for parseRpcResponse
      hoisted.rpcMock.mockResolvedValue({
        data: validTokenAllocation,
        error: null,
      });

      const { result } = renderHook(() => useUpdateTokenAllocation(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          id: validTokenAllocation.id,
          updates: {
            total_amount: 30000,
          },
        });
      });

      // Implementation uses p_id and p_allocation_amount
      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "update_token_allocation_admin",
        expect.objectContaining({
          p_id: validTokenAllocation.id,
          p_allocation_amount: 30000,
        })
      );
    });
  });

  describe("useTokenomicsStats", () => {
    it("calculates aggregated stats correctly", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: {
          token_configs: [validTokenConfig],
          transaction_summary: [{ token_type: "aisha", transaction_type: "reward", amount: 5000 }],
          active_locks: [{ token_type: "aisha", amount: 10000 }],
          burn_summary: [{ token_type: "aisha", amount: 1000 }],
        },
        error: null,
      });

      const { result } = renderHook(() => useTokenomicsStats(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toBeDefined();
    });

    it("returns empty array when no data", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: null,
      });

      const { result } = renderHook(() => useTokenomicsStats(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual([]);
    });
  });
});
