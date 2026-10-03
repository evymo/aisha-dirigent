/**
 * useMcpTokens Hook Tests
 *
 * Tests for MCP token admin operations: list, create, toggle, revoke.
 *
 * @see src/hooks/useMcpTokens.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useMcpTokens,
  useCreateMcpToken,
  useToggleMcpToken,
  useRevokeMcpToken,
} from "@/hooks/useMcpTokens";
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

const MOCK_TOKEN = {
  id: "c0c0c0c0-0000-0000-0000-000000000001",
  scope: "full",
  allowed_tools: ["compose_context"],
  denied_tools: [],
  rate_limit_rpm: 60,
  rate_limit_daily: 10000,
  is_active: true,
  usage_count: 42,
  last_used_at: "2026-03-01T09:00:00.000Z",
  project_id: null,
  account_id: null,
  created_by: "a0a0a0a0-0000-0000-0000-000000000099",
  expires_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
};

describe("useMcpTokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("useMcpTokens - list", () => {
    it("fetches tokens via RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: [MOCK_TOKEN], error: null });

      const { result } = renderHook(() => useMcpTokens(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith("get_mcp_tokens_admin");
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].scope).toBe("full");
    });

    it("handles RPC error gracefully", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: "permission denied", code: "42501" },
      });

      const { result } = renderHook(() => useMcpTokens(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(hoisted.safeErrorMock).toHaveBeenCalled();
    });
  });

  describe("useCreateMcpToken - mutation", () => {
    it("creates token and returns hash", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: { token_hash: "mcp_abc123xyz" },
        error: null,
      });

      const { result } = renderHook(() => useCreateMcpToken(), {
        wrapper: createWrapper(),
      });

      let res: unknown;
      await act(async () => {
        res = await result.current.mutateAsync({ scope: "read_only" });
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith("create_mcp_token", expect.objectContaining({
        p_scope: "read_only",
      }));
      expect(res).toEqual({ token_hash: "mcp_abc123xyz" });
    });

    it("uses default values when no input provided", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: { token_hash: "mcp_default" },
        error: null,
      });

      const { result } = renderHook(() => useCreateMcpToken(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({});
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith("create_mcp_token", expect.objectContaining({
        p_scope: "read_only",
        p_rate_limit_rpm: 60,
        p_rate_limit_daily: 10000,
      }));
    });
  });

  describe("useToggleMcpToken - mutation", () => {
    it("toggles token active state", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: MOCK_TOKEN.id, error: null });

      const { result } = renderHook(() => useToggleMcpToken(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({ id: MOCK_TOKEN.id, isActive: false });
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith("toggle_mcp_token_admin", {
        p_id: MOCK_TOKEN.id,
        p_is_active: false,
      });
    });
  });

  describe("useRevokeMcpToken - mutation", () => {
    it("revokes token permanently", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: MOCK_TOKEN.id, error: null });

      const { result } = renderHook(() => useRevokeMcpToken(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync(MOCK_TOKEN.id);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith("revoke_mcp_token_admin", {
        p_id: MOCK_TOKEN.id,
      });
    });

    it("throws on RPC error", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: "not found", code: "P0001" },
      });

      const { result } = renderHook(() => useRevokeMcpToken(), {
        wrapper: createWrapper(),
      });

      await expect(
        act(async () => {
          await result.current.mutateAsync("non-existent-id");
        }),
      ).rejects.toThrow("not found");
    });
  });
});
