/**
 * Tests for src/hooks/useAdminPartners.ts
 *
 * Covers all 4 exported hooks for partner-profile administration:
 *   - usePartnerProfilesAdmin       (query — list every partner)
 *   - useTogglePartnerVisibility    (mutation — flip is_visible)
 *   - useRevokePartnerCertification (mutation — strip cert)
 *   - useDeletePartnerProfile       (mutation — hard delete)
 *
 * The query uses `safeParse` and returns `[]` on schema mismatch — those
 * branches are exercised below alongside happy-path and RPC error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  usePartnerProfilesAdmin,
  useTogglePartnerVisibility,
  useRevokePartnerCertification,
  useDeletePartnerProfile,
} from "@/hooks/useAdminPartners";

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

const UUID_PARTNER = "20000000-0000-4000-a000-000000000001";
const UUID_USER = "20000000-0000-4000-a000-000000000002";

const mockPartnerRow = {
  id: UUID_PARTNER,
  user_id: UUID_USER,
  display_name: "Dr. Partner Test",
  business_name: "Test Clinic",
  city: "Prague",
  country: "CZ",
  email: "partner@example.test",
  phone: "+420123456789",
  is_production_provider: true,
  is_visible: true,
  certification_level: "advanced",
  certification_score: 95,
  certification_passed_at: "2026-01-15T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  services: ["consultation", "diagnostic"],
};

// ── usePartnerProfilesAdmin ─────────────────────────────────

describe("usePartnerProfilesAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls get_partner_profiles_admin and returns parsed list", async () => {
    mockRpc.mockResolvedValue({ data: [mockPartnerRow], error: null });

    const { result } = renderHook(() => usePartnerProfilesAdmin(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_partner_profiles_admin");
    expect(result.current.data).toEqual([mockPartnerRow]);
  });

  it("returns [] on schema mismatch (safeParse soft-fails)", async () => {
    // Missing required `display_name` — safeParse rejects → hook returns []
    mockRpc.mockResolvedValue({
      data: [{ ...mockPartnerRow, display_name: undefined }],
      error: null,
    });

    const { result } = renderHook(() => usePartnerProfilesAdmin(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("does not call RPC when caller lacks view_admin_dashboard", async () => {
    mockHasPermission.mockReturnValue(false);
    const { result } = renderHook(() => usePartnerProfilesAdmin(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("throws on RPC error so the UI can surface it", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied for function" },
    });
    const { result } = renderHook(() => usePartnerProfilesAdmin(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("permission denied for function");
  });
});

// ── useTogglePartnerVisibility ──────────────────────────────

describe("useTogglePartnerVisibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls set_partner_profile_visibility_admin with id + flag", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useTogglePartnerVisibility(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.mutateAsync({ partnerId: UUID_PARTNER, isVisible: false });
    });
    expect(mockRpc).toHaveBeenCalledWith("set_partner_profile_visibility_admin", {
      p_is_visible: false,
      p_partner_profile_id: UUID_PARTNER,
    });
  });

  it("returns the params back so the caller can optimistic-update", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useTogglePartnerVisibility(), {
      wrapper: createWrapper(),
    });
    let out: { partnerId: string; isVisible: boolean } | undefined;
    await act(async () => {
      out = await result.current.mutateAsync({
        partnerId: UUID_PARTNER,
        isVisible: true,
      });
    });
    expect(out).toEqual({ partnerId: UUID_PARTNER, isVisible: true });
  });

  it("propagates RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "partner_profile not found" },
    });
    const { result } = renderHook(() => useTogglePartnerVisibility(), {
      wrapper: createWrapper(),
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync({ partnerId: "x", isVisible: false });
      }),
    ).rejects.toThrow("partner_profile not found");
  });
});

// ── useRevokePartnerCertification ───────────────────────────

describe("useRevokePartnerCertification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls revoke_partner_certification_admin with the partner id", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useRevokePartnerCertification(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.mutateAsync(UUID_PARTNER);
    });
    expect(mockRpc).toHaveBeenCalledWith("revoke_partner_certification_admin", {
      p_partner_profile_id: UUID_PARTNER,
    });
  });

  it("propagates RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "partner has active appointments" },
    });
    const { result } = renderHook(() => useRevokePartnerCertification(), {
      wrapper: createWrapper(),
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync(UUID_PARTNER);
      }),
    ).rejects.toThrow("partner has active appointments");
  });
});

// ── useDeletePartnerProfile ─────────────────────────────────

describe("useDeletePartnerProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls delete_partner_profile_admin with the partner id", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useDeletePartnerProfile(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.mutateAsync(UUID_PARTNER);
    });
    expect(mockRpc).toHaveBeenCalledWith("delete_partner_profile_admin", {
      p_partner_profile_id: UUID_PARTNER,
    });
  });

  it("propagates RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "FK violation: partner_appointments still reference partner" },
    });
    const { result } = renderHook(() => useDeletePartnerProfile(), {
      wrapper: createWrapper(),
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync(UUID_PARTNER);
      }),
    ).rejects.toThrow("FK violation");
  });
});
