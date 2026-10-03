/**
 * useAgentCatalog Hook Tests
 *
 * Tests for agent catalog admin operations: list and update.
 *
 * @see src/hooks/useAgentCatalog.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAgentCatalog, useUpdateAgentCatalog } from "@/hooks/useAgentCatalog";
import type { ReactNode } from "react";

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  safeErrorMock: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/security/safeLogger")>();
  return { ...mod, safeError: (...args: unknown[]) => hoisted.safeErrorMock(...args) };
});

vi.mock("@/hooks/useAdminGuard", () => ({
  useAdminGuard: () => ({
    guardAdminMutation: (_name: string, fn: unknown) => fn,
  }),
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({ user: { id: "test-user-id" }, isLoading: false }),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPermission: (p: string) => p === "view_admin_dashboard",
    hasAnyPermission: () => true,
    isLoading: false,
  }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const MOCK_AGENT = {
  id: "a1b2c3d4-0000-0000-0000-000000000001",
  slug: "orchestrator",
  display_name: "Orchestrator Agent",
  purpose: "Routing and orchestration",
  default_model: "gpt-4o",
  default_context_profile: "standard",
  safety_level: "medium",
  max_loops: 5,
  allowed_tools: [],
  denied_tools: [],
  model_overrides: {},
  is_active: true,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("useAgentCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("useAgentCatalog - list", () => {
    it("fetches agent catalog via RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: [MOCK_AGENT], error: null });

      const { result } = renderHook(() => useAgentCatalog(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith("get_agent_catalog_admin");
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].slug).toBe("orchestrator");
    });

    it("handles RPC error gracefully", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: "permission denied", code: "42501" },
      });

      const { result } = renderHook(() => useAgentCatalog(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(hoisted.safeErrorMock).toHaveBeenCalled();
    });

    it("returns empty array when no data", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

      const { result } = renderHook(() => useAgentCatalog(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([]);
    });
  });

  describe("useUpdateAgentCatalog - mutation", () => {
    it("calls update RPC with correct params", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: MOCK_AGENT.id, error: null });

      const { result } = renderHook(() => useUpdateAgentCatalog(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({
          id: MOCK_AGENT.id,
          updates: { display_name: "Updated Agent", is_active: false },
        });
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith("update_agent_catalog_admin", {
        p_id: MOCK_AGENT.id,
        p_updates: { display_name: "Updated Agent", is_active: false },
      });
    });

    it("throws on RPC error", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: "update failed", code: "P0001" },
      });

      const { result } = renderHook(() => useUpdateAgentCatalog(), {
        wrapper: createWrapper(),
      });

      await expect(
        act(async () => {
          await result.current.mutateAsync({
            id: MOCK_AGENT.id,
            updates: { is_active: false },
          });
        }),
      ).rejects.toThrow("update failed");
    });
  });
});
