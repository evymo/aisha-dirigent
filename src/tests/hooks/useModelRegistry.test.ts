import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

/* ── Hoisted mocks ────────────────────────────────────────────── */

const mockRpc = vi.hoisted(() => vi.fn());
const mockInvoke = vi.hoisted(() => vi.fn());
const mockHasPermission = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: { rpc: mockRpc, functions: { invoke: mockInvoke } },
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    user: { id: "00000000-0000-0000-0000-000000000001" },
    session: { user: { id: "00000000-0000-0000-0000-000000000001" } },
    isLoading: false,
    hasRole: vi.fn(),
    roles: [],
    isAdmin: false,
    signOut: vi.fn(),
  }),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    permissions: ["view_admin_dashboard"],
    isLoading: false,
    hasPermission: mockHasPermission,
    hasAllPermissions: vi.fn(() => true),
    hasAnyPermission: vi.fn(() => true),
  }),
}));

vi.mock("@/lib/security/safeLogger", () => ({
  safeError: vi.fn(),
}));

import {
  useModelRegistry,
  useApproveModel,
  useRejectModel,
  useUpdateModelRegistry,
  useDiscoverModels,
} from "@/hooks/useModelRegistry";

/* ── Test wrapper ──────────────────────────────────────────────── */

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

/* ── Sample data ───────────────────────────────────────────────── */

const sampleModel = {
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  provider: "openai",
  model_id: "gpt-4o",
  display_name: "GPT-4o",
  model_family: "gpt-4",
  is_reasoning: false,
  is_vision: true,
  is_function_calling: true,
  context_window: 128000,
  input_price_per_m: 2.5,
  output_price_per_m: 10,
  cached_input_price_per_m: 1.25,
  is_available: true,
  is_deprecated: false,
  eval_status: "pending",
  latest_eval_score: null,
  latest_eval_at: null,
  first_seen_at: "2026-01-01T00:00:00Z",
  last_seen_at: "2026-03-30T00:00:00Z",
  best_task_type: null,
  best_task_score: null,
};

/* ── Tests ─────────────────────────────────────────────────────── */

describe("useModelRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("fetches and parses model registry data via Zod", async () => {
    mockRpc.mockResolvedValue({ data: [sampleModel], error: null });

    const { result } = renderHook(() => useModelRegistry(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith("get_model_registry_admin", {
      p_provider: undefined,
      p_eval_status: undefined,
      p_available_only: false,
    });

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].model_id).toBe("gpt-4o");
    expect(result.current.data?.[0].is_vision).toBe(true);
  });

  it("passes filters to RPC call", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(
      () =>
        useModelRegistry({
          provider: "anthropic",
          evalStatus: "approved",
          availableOnly: true,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith("get_model_registry_admin", {
      p_provider: "anthropic",
      p_eval_status: "approved",
      p_available_only: true,
    });
  });

  it("returns empty array when user lacks admin permission", async () => {
    mockHasPermission.mockReturnValue(false);

    const { result } = renderHook(() => useModelRegistry(), {
      wrapper: createWrapper(),
    });

    // Query should not fire (enabled: false)
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects Zod-invalid rows with parse error", async () => {
    mockRpc.mockResolvedValue({
      data: [{ id: "not-a-uuid", provider: 123 }],
      error: null,
    });

    const { result } = renderHook(() => useModelRegistry(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useApproveModel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls approve_model_admin RPC with correct params", async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, model_id: "gpt-4o", eval_status: "approved" },
      error: null,
    });

    const { result } = renderHook(() => useApproveModel(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    });

    expect(mockRpc).toHaveBeenCalledWith("approve_model_admin", {
      p_model_registry_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    });
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Admin or staff role required" },
    });

    const { result } = renderHook(() => useApproveModel(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
      }),
    ).rejects.toThrow("Admin or staff role required");
  });
});

describe("useRejectModel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls reject_model_admin with reason", async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, model_id: "gpt-4o", eval_status: "rejected" },
      error: null,
    });

    const { result } = renderHook(() => useRejectModel(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        modelRegistryId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        reason: "Poor performance on coding tasks",
      });
    });

    expect(mockRpc).toHaveBeenCalledWith("reject_model_admin", {
      p_model_registry_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      p_reason: "Poor performance on coding tasks",
    });
  });
});

describe("useUpdateModelRegistry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls update_model_registry_admin with partial params", async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, model_id: "gpt-4o" },
      error: null,
    });

    const { result } = renderHook(() => useUpdateModelRegistry(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        modelRegistryId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        isAvailable: false,
        isDeprecated: true,
      });
    });

    expect(mockRpc).toHaveBeenCalledWith("update_model_registry_admin", {
      p_model_registry_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      p_is_available: false,
      p_is_deprecated: true,
      p_display_name: undefined,
    });
  });
});

describe("useDiscoverModels", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invokes the gateway-routed discover-models function and returns the summary", async () => {
    mockInvoke.mockResolvedValue({ data: { discovered: 3, tested: 3, passed: 2, failed: 1 }, error: null });

    const { result } = renderHook(() => useDiscoverModels(), { wrapper: createWrapper() });

    let res: unknown;
    await act(async () => {
      res = await result.current.mutateAsync({});
    });

    expect(mockInvoke).toHaveBeenCalledWith("discover-models", { body: { provider: undefined } });
    expect(res).toMatchObject({ discovered: 3, tested: 3, passed: 2, failed: 1 });
  });

  it("passes a targeted provider through to the function body", async () => {
    mockInvoke.mockResolvedValue({ data: { discovered: 1, tested: 1, passed: 1, failed: 0 }, error: null });

    const { result } = renderHook(() => useDiscoverModels(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ provider: "openai" });
    });

    expect(mockInvoke).toHaveBeenCalledWith("discover-models", { body: { provider: "openai" } });
  });

  it("throws on an invoke error (e.g. 403 admin required)", async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: "Admin required" } });

    const { result } = renderHook(() => useDiscoverModels(), { wrapper: createWrapper() });
    await expect(
      act(async () => {
        await result.current.mutateAsync({});
      }),
    ).rejects.toThrow("Admin required");
  });

  it("threads a re-test mode through to the function body", async () => {
    mockInvoke.mockResolvedValue({ data: { discovered: 0, tested: 2, passed: 1, failed: 1 }, error: null });

    const { result } = renderHook(() => useDiscoverModels(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ mode: "rejected-only" });
    });

    expect(mockInvoke).toHaveBeenCalledWith("discover-models", { body: { provider: undefined, mode: "rejected-only" } });
  });
});
