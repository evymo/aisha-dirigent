import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

/* ── Hoisted mocks ──────────────────────────────────────────────── */

const mockRpc = vi.hoisted(() => vi.fn());
const mockHasPermission = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: { rpc: mockRpc },
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
  useProviderRegistry,
  useUpdateProvider,
} from "@/hooks/useProviderRegistry";

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

const sampleProvider = {
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  slug: "anthropic",
  display_name: "Anthropic (direct)",
  backend_kind: "direct_cloud",
  endpoint_url: "https://api.anthropic.com",
  health_url: null,
  auth_env_var: "ANTHROPIC_API_KEY",
  auth_kind: "bearer",
  supports_chat: true,
  supports_tool_use: true,
  supports_vision: true,
  supports_batch: true,
  supports_streaming: true,
  is_enabled: true,
  last_health_status: "healthy",
  last_health_checked_at: "2026-05-18T12:00:00Z",
  last_health_detail: "HTTP 200 in 234ms",
  consecutive_failure_count: 0,
  cost_class: "premium",
  notes: "Direct Anthropic API. AISHA uses for sync calls + Message Batches deferred (50% off).",
  created_at: "2026-05-15T12:00:00Z",
  updated_at: "2026-05-18T12:00:00Z",
};

/* ── Tests ─────────────────────────────────────────────────────── */

describe("useProviderRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("fetches and Zod-parses provider registry data", async () => {
    mockRpc.mockResolvedValue({ data: [sampleProvider], error: null });

    const { result } = renderHook(() => useProviderRegistry(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // RPC called with default params (no filters → undefined backendKind, false enabledOnly)
    expect(mockRpc).toHaveBeenCalledWith("get_provider_registry_admin", {
      p_backend_kind: undefined,
      p_enabled_only: false,
    });

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].slug).toBe("anthropic");
    expect(result.current.data?.[0].last_health_status).toBe("healthy");
    expect(result.current.data?.[0].supports_batch).toBe(true);
  });

  it("passes filters (backendKind + enabledOnly) to RPC call", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(
      () =>
        useProviderRegistry({
          backendKind: "llm_gateway",
          enabledOnly: true,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith("get_provider_registry_admin", {
      p_backend_kind: "llm_gateway",
      p_enabled_only: true,
    });
  });

  it("returns empty array (no fetch) when user lacks admin permission", async () => {
    mockHasPermission.mockReturnValue(false);

    const { result } = renderHook(() => useProviderRegistry(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("propagates Zod parse error for malformed rows", async () => {
    mockRpc.mockResolvedValue({
      data: [{ id: "not-a-uuid", slug: 123 }], // intentionally invalid
      error: null,
    });

    const { result } = renderHook(() => useProviderRegistry(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("propagates RPC error message", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Admin or staff role required" },
    });

    const { result } = renderHook(() => useProviderRegistry(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain("Admin or staff role required");
  });
});

describe("useUpdateProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("toggles is_enabled via update_provider_admin RPC", async () => {
    mockRpc.mockResolvedValue({
      data: {
        success: true,
        slug: "anthropic",
        is_enabled: false,
        enabled_changed: true,
      },
      error: null,
    });

    const { result } = renderHook(() => useUpdateProvider(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        providerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        isEnabled: false,
      });
    });

    expect(mockRpc).toHaveBeenCalledWith("update_provider_admin", {
      p_is_enabled: false,
      p_notes: undefined,
      p_provider_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      p_reset_failure_count: false,
    });
  });

  it("updates notes via update_provider_admin RPC", async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, slug: "openai", is_enabled: true, enabled_changed: false },
      error: null,
    });

    const { result } = renderHook(() => useUpdateProvider(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        providerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        notes: "Updated by operator on 2026-05-18 — temporarily disabled due to rate limit incident.",
      });
    });

    expect(mockRpc).toHaveBeenCalledWith("update_provider_admin", {
      p_is_enabled: undefined,
      p_notes: expect.stringContaining("rate limit incident"),
      p_provider_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      p_reset_failure_count: false,
    });
  });

  it("resets failure count via p_reset_failure_count=true (pulls provider out of backoff)", async () => {
    mockRpc.mockResolvedValue({
      data: {
        success: true,
        slug: "openai",
        is_enabled: true,
        enabled_changed: false,
        failure_count_reset: true,
      },
      error: null,
    });

    const { result } = renderHook(() => useUpdateProvider(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        providerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        resetFailureCount: true,
      });
    });

    expect(mockRpc).toHaveBeenCalledWith("update_provider_admin", {
      p_is_enabled: undefined,
      p_notes: undefined,
      p_provider_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      p_reset_failure_count: true,
    });
  });

  it("propagates RPC error (e.g. permission denied)", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Admin or staff role required" },
    });

    const { result } = renderHook(() => useUpdateProvider(), {
      wrapper: createWrapper(),
    });

    let caught: Error | null = null;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          providerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          isEnabled: false,
        });
      } catch (err) {
        caught = err as Error;
      }
    });

    expect(caught).not.toBeNull();
    expect(caught!.message).toContain("Admin or staff role required");
  });
});

describe("ProviderRegistryRow Zod schema", () => {
  it("Zod parses consecutive_failure_count as non-negative int", async () => {
    // Row with backoff counter populated → should parse without issue
    mockRpc.mockResolvedValue({
      data: [{ ...sampleProvider, consecutive_failure_count: 7, last_health_status: "down" }],
      error: null,
    });

    const { result } = renderHook(() => useProviderRegistry(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].consecutive_failure_count).toBe(7);
  });

  it("Zod rejects negative consecutive_failure_count", async () => {
    mockRpc.mockResolvedValue({
      data: [{ ...sampleProvider, consecutive_failure_count: -1 }],
      error: null,
    });

    const { result } = renderHook(() => useProviderRegistry(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
