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
  useMcpRegistry,
  useUpdateMcpStatus,
  MCP_STATUSES,
} from "@/hooks/useMcpRegistry";

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

const sampleMcp = {
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  slug: "aisha-knowledge",
  display_name: "AISHA Knowledge",
  description: "Internal knowledge base + retrieval MCP.",
  transport: "http",
  endpoint_url: "https://mcp.aisha.guru/aisha-knowledge",
  stdio_command: null,
  auth_kind: "bearer",
  auth_env_var: "AISHA_KNOWLEDGE_TOKEN",
  capability_tags: ["retrieval", "knowledge", "llm_chat"],
  exposes_llm: false,
  status: "in_use",
  last_tested_at: "2026-05-18T12:00:00Z",
  last_test_result: { ok: true, latency_ms: 87, supported_methods: ["tools/list", "tools/call"] },
  test_failure_count: 0,
  source: "manual",
  registered_by: null,
  metadata: {},
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-05-18T12:00:00Z",
};

/* ── Tests ─────────────────────────────────────────────────────── */

describe("useMcpRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("fetches and Zod-parses MCP registry data", async () => {
    mockRpc.mockResolvedValue({ data: [sampleMcp], error: null });

    const { result } = renderHook(() => useMcpRegistry(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith("get_mcp_registry_admin", {
      p_active_only: false,
      p_status: undefined,
      p_transport: undefined,
    });

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].slug).toBe("aisha-knowledge");
    expect(result.current.data?.[0].status).toBe("in_use");
    expect(result.current.data?.[0].capability_tags).toContain("retrieval");
  });

  it("passes filters (transport + status + activeOnly) to RPC", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(
      () =>
        useMcpRegistry({
          transport: "http",
          status: "enabled",
          activeOnly: true,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith("get_mcp_registry_admin", {
      p_active_only: true,
      p_status: "enabled",
      p_transport: "http",
    });
  });

  it("returns empty (no fetch) when user lacks admin permission", async () => {
    mockHasPermission.mockReturnValue(false);

    const { result } = renderHook(() => useMcpRegistry(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects Zod-invalid rows with parse error", async () => {
    mockRpc.mockResolvedValue({
      data: [{ id: "not-uuid", slug: 123 }],
      error: null,
    });

    const { result } = renderHook(() => useMcpRegistry(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("MCP_STATUSES export contains all 7 lifecycle states", () => {
    expect(MCP_STATUSES).toEqual([
      "discovered",
      "tested_ok",
      "tested_failed",
      "enabled",
      "in_use",
      "deprecated",
      "rejected",
    ]);
  });
});

describe("useUpdateMcpStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("transitions status via update_mcp_status_admin RPC", async () => {
    mockRpc.mockResolvedValue({
      data: {
        success: true,
        slug: "aisha-knowledge",
        old_status: "tested_ok",
        new_status: "enabled",
        transition: "tested_ok → enabled",
      },
      error: null,
    });

    const { result } = renderHook(() => useUpdateMcpStatus(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        mcpId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        newStatus: "enabled",
      });
    });

    expect(mockRpc).toHaveBeenCalledWith("update_mcp_status_admin", {
      p_mcp_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      p_new_status: "enabled",
      p_note: undefined,
    });
  });

  it("propagates server-side transition validation errors", async () => {
    // Server enforces state machine — invalid transition surfaces clear error
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message: "Invalid transition: discovered → in_use (run aisha_test_mcp_server to probe first)",
      },
    });

    const { result } = renderHook(() => useUpdateMcpStatus(), {
      wrapper: createWrapper(),
    });

    let caught: Error | null = null;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          mcpId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          newStatus: "in_use",
        });
      } catch (err) {
        caught = err as Error;
      }
    });

    expect(caught).not.toBeNull();
    expect(caught!.message).toContain("Invalid transition");
    expect(caught!.message).toContain("discovered → in_use");
  });

  it("passes optional note to RPC", async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, transition: "in_use → deprecated" },
      error: null,
    });

    const { result } = renderHook(() => useUpdateMcpStatus(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        mcpId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        newStatus: "deprecated",
        note: "Provider announced 2026-06 EOL, sunsetting now.",
      });
    });

    expect(mockRpc).toHaveBeenCalledWith("update_mcp_status_admin", {
      p_mcp_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      p_new_status: "deprecated",
      p_note: expect.stringContaining("EOL"),
    });
  });
});
