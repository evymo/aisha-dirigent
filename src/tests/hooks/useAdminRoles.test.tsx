/**
 * Tests for src/hooks/useAdminRoles.ts
 *
 * Covers all 3 exported hooks for RBAC management — these are security-
 * critical because they grant/revoke `app_role` rows that drive every
 * permission check:
 *   - useUserRolesAdmin   (query — list every (user, role) tuple)
 *   - useGrantUserRole    (mutation — assign role by email)
 *   - useRevokeUserRole   (mutation — delete role by id)
 *
 * Same mock pattern as useAdminConsultants:
 *   - aisha.rpc mocked at the client level
 *   - usePermissions / useSession mocked to drive the in-hook gate
 *   - useAdminGuard.guardAdminMutation transparent so the real mutationFn
 *     body runs (so we exercise the email-trim/lower + ERROR_CODE
 *     parsing for USER_NOT_FOUND / ROLE_EXISTS).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useUserRolesAdmin,
  useGrantUserRole,
  useRevokeUserRole,
} from "@/hooks/useAdminRoles";

const { mockRpc, mockHasPermission, mockUser, mockGuardAdminMutation } =
  vi.hoisted(() => ({
    mockRpc: vi.fn(),
    mockHasPermission: vi.fn(),
    mockUser: { id: "admin-id" },
    mockGuardAdminMutation: (_rpc: string, fn: (args: unknown) => unknown) => fn,
  }));

vi.mock("@/integrations/db/client", () => ({
  aisha: { rpc: mockRpc },
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: mockHasPermission }),
}));
vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({ user: mockUser }),
}));
vi.mock("@/hooks/useAdminGuard", () => ({
  useAdminGuard: () => ({ guardAdminMutation: mockGuardAdminMutation }),
}));

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
}

const UUID_ROLE = "10000000-0000-4000-a000-000000000001";
const UUID_USER = "10000000-0000-4000-a000-000000000002";
const UUID_GRANTOR = "10000000-0000-4000-a000-000000000003";

const mockRoleRow = {
  id: UUID_ROLE,
  user_id: UUID_USER,
  role: "member",
  granted_at: "2026-02-01T00:00:00Z",
  granted_by: UUID_GRANTOR,
  profile_email: "user@example.test",
  profile_display_name: "Test User",
};

// ── useUserRolesAdmin ───────────────────────────────────────

describe("useUserRolesAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls get_user_roles_admin and maps profile fields", async () => {
    mockRpc.mockResolvedValue({ data: [mockRoleRow], error: null });

    const { result } = renderHook(() => useUserRolesAdmin(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_user_roles_admin");
    expect(result.current.data).toEqual([
      {
        id: UUID_ROLE,
        user_id: UUID_USER,
        role: "member",
        granted_at: "2026-02-01T00:00:00Z",
        granted_by: UUID_GRANTOR,
        profile: {
          email: "user@example.test",
          display_name: "Test User",
        },
      },
    ]);
  });

  it("does not call RPC when caller lacks view_admin_dashboard", async () => {
    mockHasPermission.mockReturnValue(false);

    const { result } = renderHook(() => useUserRolesAdmin(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("normalises missing profile fields to null (FE renders dashes)", async () => {
    mockRpc.mockResolvedValue({
      data: [{ ...mockRoleRow, profile_email: null, profile_display_name: null }],
      error: null,
    });

    const { result } = renderHook(() => useUserRolesAdmin(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].profile).toEqual({
      email: null,
      display_name: null,
    });
  });
});

// ── useGrantUserRole ────────────────────────────────────────

describe("useGrantUserRole", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("trims + lowercases email before sending to RPC", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useGrantUserRole(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.mutateAsync({
        email: "  User@Example.Test  ",
        role: "practitioner",
      });
    });
    expect(mockRpc).toHaveBeenCalledWith("grant_user_role_admin", {
      p_email: "user@example.test",
      p_role: "practitioner",
    });
  });

  it("maps USER_NOT_FOUND error to the typed string", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "USER_NOT_FOUND: no auth.user with that email" },
    });

    const { result } = renderHook(() => useGrantUserRole(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          email: "ghost@example.test",
          role: "member",
        });
      }),
    ).rejects.toThrow("USER_NOT_FOUND");
  });

  it("maps ROLE_EXISTS error to the typed string", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "ROLE_EXISTS: user already has role" },
    });
    const { result } = renderHook(() => useGrantUserRole(), {
      wrapper: createWrapper(),
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync({
          email: "user@example.test",
          role: "member",
        });
      }),
    ).rejects.toThrow("ROLE_EXISTS");
  });

  it("passes through unrecognised errors verbatim", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied for function grant_user_role_admin" },
    });
    const { result } = renderHook(() => useGrantUserRole(), {
      wrapper: createWrapper(),
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync({
          email: "user@example.test",
          role: "admin",
        });
      }),
    ).rejects.toThrow("permission denied for function grant_user_role_admin");
  });
});

// ── useRevokeUserRole ───────────────────────────────────────

describe("useRevokeUserRole", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls revoke_user_role_admin with the role id", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useRevokeUserRole(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.mutateAsync(UUID_ROLE);
    });
    expect(mockRpc).toHaveBeenCalledWith("revoke_user_role_admin", {
      p_role_id: UUID_ROLE,
    });
  });

  it("propagates RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Cannot revoke last admin" },
    });
    const { result } = renderHook(() => useRevokeUserRole(), {
      wrapper: createWrapper(),
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync(UUID_ROLE);
      }),
    ).rejects.toThrow("Cannot revoke last admin");
  });
});
