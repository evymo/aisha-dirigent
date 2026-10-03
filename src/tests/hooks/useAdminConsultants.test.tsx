/**
 * Tests for src/hooks/useAdminConsultants.ts
 *
 * Covers all 3 exported hooks:
 *   - useStudyConsultantsAdmin     (query — list all consultants)
 *   - useStudiesDropdownAdmin      (query — filtered active studies)
 *   - useUpdateStudyConsultantStatus (mutation — admin-only status flip)
 *
 * The hooks gate themselves on `hasPermission("view_admin_dashboard")` +
 * a logged-in session, so the test wrapper mocks those two upstream hooks
 * directly. RPC is mocked at the `aisha` client level (Hook-Only Data
 * Access — see CLAUDE.md). The mutation also passes through
 * `useAdminGuard.guardAdminMutation`, mocked to a transparent wrapper so
 * the test exercises the real mutationFn body.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useStudyConsultantsAdmin,
  useStudiesDropdownAdmin,
  useUpdateStudyConsultantStatus,
} from "@/hooks/useAdminConsultants";

// ── Hoisted mocks ──────────────────────────────────────────────

const { mockRpc, mockHasPermission, mockUser, mockGuardAdminMutation } =
  vi.hoisted(() => ({
    mockRpc: vi.fn(),
    mockHasPermission: vi.fn(),
    mockUser: { id: "admin-user-id", email: "admin@example.test" },
    mockGuardAdminMutation: (_rpcName: string, fn: (args: unknown) => unknown) =>
      // Transparent wrapper — exercises the real mutationFn body
      fn,
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

// ── Test wrapper ──────────────────────────────────────────────

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

// ── Fixtures ──────────────────────────────────────────────────

// Schema requires UUIDs — use deterministic v4-shaped strings.
const UUID_CONSULTANT = "00000000-0000-4000-a000-000000000001";
const UUID_STUDY = "00000000-0000-4000-a000-000000000002";
const UUID_STUDY_OTHER = "00000000-0000-4000-a000-000000000003";
const UUID_PARTNER = "00000000-0000-4000-a000-000000000004";

const mockConsultantRow = {
  id: UUID_CONSULTANT,
  study_id: UUID_STUDY,
  partner_id: UUID_PARTNER,
  status: "approved",
  role: "consultant",
  max_participants: 50,
  created_at: "2026-01-01T00:00:00Z",
  approved_at: "2026-01-01T00:00:00Z",
  study: {
    id: UUID_STUDY,
    name: "Test Study",
    code: "TST-001",
  },
  partner: {
    id: UUID_PARTNER,
    display_name: "Dr. Test Consultant",
    business_name: null,
    city: "Prague",
    is_production_provider: false,
    email: "dr.test@example.test",
  },
};

const mockStudyDropdownRow = {
  id: UUID_STUDY,
  name: "Test Study",
  code: "TST-001",
  status: "active",
};

// ── useStudyConsultantsAdmin ─────────────────────────────────

describe("useStudyConsultantsAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls get_study_consultants_admin and returns parsed array", async () => {
    mockRpc.mockResolvedValue({ data: [mockConsultantRow], error: null });

    const { result } = renderHook(() => useStudyConsultantsAdmin(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_study_consultants_admin");
    expect(result.current.data).toEqual([mockConsultantRow]);
  });

  it("returns empty array when caller lacks view_admin_dashboard permission", async () => {
    mockHasPermission.mockReturnValue(false);

    const { result } = renderHook(() => useStudyConsultantsAdmin(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("throws on RPC error so the UI can surface it", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Unauthorized: admin role required" },
    });

    const { result } = renderHook(() => useStudyConsultantsAdmin(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe(
      "Unauthorized: admin role required",
    );
  });
});

// ── useStudiesDropdownAdmin ──────────────────────────────────

describe("useStudiesDropdownAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls get_studies_admin and filters to active studies only", async () => {
    mockRpc.mockResolvedValue({
      data: [
        mockStudyDropdownRow,
        { ...mockStudyDropdownRow, id: UUID_STUDY_OTHER, status: "closed" },
      ],
      error: null,
    });

    const { result } = renderHook(() => useStudiesDropdownAdmin(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { id: UUID_STUDY, name: "Test Study", code: "TST-001" },
    ]);
  });

  it("drops rows missing required fields (id / name / code)", async () => {
    mockRpc.mockResolvedValue({
      data: [
        mockStudyDropdownRow,
        { id: UUID_STUDY_OTHER, status: "active" }, // missing name + code
        null,
      ],
      error: null,
    });

    const { result } = renderHook(() => useStudiesDropdownAdmin(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].id).toBe(UUID_STUDY);
  });

  it("does not call RPC when admin permission is absent", async () => {
    mockHasPermission.mockReturnValue(false);

    const { result } = renderHook(() => useStudiesDropdownAdmin(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

// ── useUpdateStudyConsultantStatus ───────────────────────────

describe("useUpdateStudyConsultantStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls update_study_consultant_status_admin with id + status", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useUpdateStudyConsultantStatus(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ id: UUID_CONSULTANT, status: "rejected" });
    });

    expect(mockRpc).toHaveBeenCalledWith("update_study_consultant_status_admin", {
      p_id: UUID_CONSULTANT,
      p_status: "rejected",
    });
  });

  it("propagates RPC error to the caller", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Invalid status: not_a_status" },
    });

    const { result } = renderHook(() => useUpdateStudyConsultantStatus(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({ id: UUID_CONSULTANT, status: "not_a_status" });
      }),
    ).rejects.toThrow("Invalid status: not_a_status");
  });
});
