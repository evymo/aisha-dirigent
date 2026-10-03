/**
 * useContextProfiles Hook Tests
 *
 * Tests for context profiles admin operations: list and update.
 *
 * @see src/hooks/useContextProfiles.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useContextProfiles, useUpdateContextProfile } from "@/hooks/useContextProfiles";
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

const MOCK_PROFILE = {
  id: "b1b2c3d4-0000-0000-0000-000000000001",
  slug: "standard",
  display_name: "Standard Profile",
  description: "Default context profile",
  token_budget: 8000,
  layers: {
    project_context: { enabled: true },
    ruleset: { enabled: true },
    memory: { enabled: true },
  },
  priority_order: ["project_context", "ruleset", "memory"],
  is_active: true,
  created_at: "2026-01-01T00:00:00.000Z",
};

describe("useContextProfiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("useContextProfiles - list", () => {
    it("fetches context profiles via RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: [MOCK_PROFILE], error: null });

      const { result } = renderHook(() => useContextProfiles(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith("get_context_profiles_admin");
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].slug).toBe("standard");
    });

    it("handles RPC error gracefully", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: "permission denied", code: "42501" },
      });

      const { result } = renderHook(() => useContextProfiles(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(hoisted.safeErrorMock).toHaveBeenCalled();
    });

    it("returns empty array when no data", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

      const { result } = renderHook(() => useContextProfiles(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([]);
    });
  });

  describe("useUpdateContextProfile - mutation", () => {
    it("calls update RPC with correct params", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: MOCK_PROFILE.id, error: null });

      const { result } = renderHook(() => useUpdateContextProfile(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({
          id: MOCK_PROFILE.id,
          updates: { token_budget: 16000, is_active: false },
        });
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith("update_context_profile_admin", {
        p_id: MOCK_PROFILE.id,
        p_updates: { token_budget: 16000, is_active: false },
      });
    });

    it("throws on RPC error", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: "update failed", code: "P0001" },
      });

      const { result } = renderHook(() => useUpdateContextProfile(), {
        wrapper: createWrapper(),
      });

      await expect(
        act(async () => {
          await result.current.mutateAsync({
            id: MOCK_PROFILE.id,
            updates: { token_budget: 0 },
          });
        }),
      ).rejects.toThrow("update failed");
    });
  });
});
