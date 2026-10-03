/**
 * Tests for usePermissions hook integration
 *
 * Core logic tests are in src/tests/lib/permissionHelpers.test.ts
 * This file tests hook integration only.
 *
 * @module
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHookWithProviders, createTestQueryClient } from "../utils/test-utils";

// Mock state
const mockSessionState = vi.hoisted(() => ({
  user: { id: "test-user-id" } as { id: string } | null,
  roles: ["member"] as string[],
  isAdmin: false,
  isLoading: false,
}));

const mockRpcFn = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    user: mockSessionState.user,
    roles: mockSessionState.roles,
    isAdmin: mockSessionState.isAdmin,
    isLoading: mockSessionState.isLoading,
    roleRecords: mockSessionState.roles.map((r: string) => ({ role: r })),
    session: mockSessionState.user ? { user: mockSessionState.user } : null,
    hasRole: (role: string) => mockSessionState.roles.includes(role),
    signOut: vi.fn(),
    refetchRoles: vi.fn().mockResolvedValue(undefined),
  }),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => mockRpcFn(...args),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/safeLogger")>()),
  safeWarn: vi.fn(),
  safeError: vi.fn(),
}));

import { usePermissions, useAllPermissions } from "@/hooks/usePermissions";

describe("usePermissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionState.user = { id: "test-user-id" };
    mockSessionState.roles = ["member"];
    mockSessionState.isAdmin = false;
    mockSessionState.isLoading = false;

    mockRpcFn.mockImplementation((fnName: string) => {
      if (fnName === "get_user_permissions") {
        return Promise.resolve({
          data: [{ permission_code: "view_studies" }],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: { code: "42883" } });
    });
  });

  describe("return type", () => {
    it("returns correct interface shape", () => {
      const queryClient = createTestQueryClient();
      const { result } = renderHookWithProviders(() => usePermissions(), { queryClient });

      expect(result.current).toHaveProperty("permissions");
      expect(result.current).toHaveProperty("hasPermission");
      expect(result.current).toHaveProperty("hasAllPermissions");
      expect(result.current).toHaveProperty("hasAnyPermission");
      expect(result.current).toHaveProperty("isLoading");
      expect(result.current).toHaveProperty("error");
    });

    it("hasPermission is a function", () => {
      const queryClient = createTestQueryClient();
      const { result } = renderHookWithProviders(() => usePermissions(), { queryClient });
      expect(typeof result.current.hasPermission).toBe("function");
    });

    it("hasAllPermissions is a function", () => {
      const queryClient = createTestQueryClient();
      const { result } = renderHookWithProviders(() => usePermissions(), { queryClient });
      expect(typeof result.current.hasAllPermissions).toBe("function");
    });

    it("hasAnyPermission is a function", () => {
      const queryClient = createTestQueryClient();
      const { result } = renderHookWithProviders(() => usePermissions(), { queryClient });
      expect(typeof result.current.hasAnyPermission).toBe("function");
    });
  });

  describe("unauthenticated user", () => {
    beforeEach(() => {
      mockSessionState.user = null;
      mockSessionState.roles = [];
    });

    it("returns empty permissions array", () => {
      const queryClient = createTestQueryClient();
      const { result } = renderHookWithProviders(() => usePermissions(), { queryClient });
      expect(result.current.permissions).toEqual([]);
    });

    it("hasPermission returns false", () => {
      const queryClient = createTestQueryClient();
      const { result } = renderHookWithProviders(() => usePermissions(), { queryClient });
      expect(result.current.hasPermission("view_studies")).toBe(false);
    });
  });
});

describe("useAllPermissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpcFn.mockImplementation((fnName: string) => {
      if (fnName === "get_permissions_catalog_admin") {
        return Promise.resolve({
          data: [
            { id: "1", code: "view_studies", name: "View Studies", description: null, category: "member", is_system: true },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
  });

  it("returns correct interface shape", () => {
    const queryClient = createTestQueryClient();
    const { result } = renderHookWithProviders(() => useAllPermissions(), { queryClient });

    expect(result.current).toHaveProperty("data");
    expect(result.current).toHaveProperty("isLoading");
    expect(result.current).toHaveProperty("error");
  });
});
