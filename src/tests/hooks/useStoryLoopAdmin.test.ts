/**
 * useStoryLoopAdmin Hook Tests
 *
 * Tests for the admin/staff StoryLoop overview aggregation hook.
 * Uses `get_storyloop_admin_overview` RPC, permission-gated.
 *
 * @see src/hooks/useStoryLoopAdmin.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useAdminStoryLoopOverview } from "@/hooks/useStoryLoopAdmin";

/* ── Hoisted mocks ────────────────────────────────────────────── */

const mockRpc = vi.hoisted(() => vi.fn());
const mockHasPermission = vi.hoisted(() => vi.fn(() => true));
const mockSafeError = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    permissions: ["view_admin_dashboard"],
    isLoading: false,
    hasPermission: mockHasPermission,
    hasAllPermissions: vi.fn(() => true),
    hasAnyPermission: vi.fn(() => true),
  }),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: mockRpc,
  },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/safeLogger")>()),
  safeError: mockSafeError,
}));

/* ── Test data ────────────────────────────────────────────────── */

const VALID_OVERVIEW = {
  total_stories: 42,
  active_stories: 30,
  stories_active_7d: 12,
  stories_active_30d: 25,
  inbox_count: 5,
  in_progress_count: 10,
  scheduled_count: 3,
  archived_count: 2,
  trash_count: 1,
  starred_count: 7,
  unread_total: 15,
  total_entries: 200,
  entries_7d: 35,
  entries_30d: 120,
  reminders_upcoming_7d: 4,
  reminders_overdue: 2,
  partners_active: 8,
  members_covered: 36,
};

const EMPTY_OVERVIEW = {
  total_stories: 0,
  active_stories: 0,
  stories_active_7d: 0,
  stories_active_30d: 0,
  inbox_count: 0,
  in_progress_count: 0,
  scheduled_count: 0,
  archived_count: 0,
  trash_count: 0,
  starred_count: 0,
  unread_total: 0,
  total_entries: 0,
  entries_7d: 0,
  entries_30d: 0,
  reminders_upcoming_7d: 0,
  reminders_overdue: 0,
  partners_active: 0,
  members_covered: 0,
};

/* ── Helpers ──────────────────────────────────────────────────── */

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

/* ── Tests ────────────────────────────────────────────────────── */

describe("useAdminStoryLoopOverview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("fetches overview data via RPC when admin permission", async () => {
    mockRpc.mockResolvedValue({ data: VALID_OVERVIEW, error: null });

    const { result } = renderHook(() => useAdminStoryLoopOverview(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith("get_storyloop_admin_overview");
    expect(result.current.data).toEqual(VALID_OVERVIEW);
  });

  it("handles RPC returning array with single row", async () => {
    mockRpc.mockResolvedValue({ data: [VALID_OVERVIEW], error: null });

    const { result } = renderHook(() => useAdminStoryLoopOverview(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(VALID_OVERVIEW);
  });

  it("is disabled when user lacks admin/staff permission", async () => {
    mockHasPermission.mockReturnValue(false);

    const { result } = renderHook(() => useAdminStoryLoopOverview(), {
      wrapper: createWrapper(),
    });

    // Query should not fire — remains idle
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("returns empty fallback on Zod validation failure", async () => {
    // Return data that won't validate (missing required fields)
    mockRpc.mockResolvedValue({ data: { invalid: true }, error: null });

    const { result } = renderHook(() => useAdminStoryLoopOverview(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(EMPTY_OVERVIEW);
    expect(mockSafeError).toHaveBeenCalledWith(
      "storyloop.admin.overview.validation",
      expect.anything(),
    );
  });

  it("throws on RPC error and logs safely", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied", code: "42501" },
    });

    const { result } = renderHook(() => useAdminStoryLoopOverview(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(mockSafeError).toHaveBeenCalledWith(
      "storyloop.admin.overview",
      expect.objectContaining({ message: "permission denied" }),
    );
  });

  it("handles coerce for string-number values from RPC", async () => {
    // RPC may return stringified numbers — z.coerce.number() handles this
    const stringifiedOverview = Object.fromEntries(
      Object.entries(VALID_OVERVIEW).map(([key, value]) => [key, String(value)]),
    );
    mockRpc.mockResolvedValue({ data: stringifiedOverview, error: null });

    const { result } = renderHook(() => useAdminStoryLoopOverview(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(VALID_OVERVIEW);
  });

  it("does not log sensitive data data in error scenarios", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "internal error", code: "XX000" },
    });

    const { result } = renderHook(() => useAdminStoryLoopOverview(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // Verify safeError was called without sensitive data
    const safeErrorCalls = mockSafeError.mock.calls;
    for (const call of safeErrorCalls) {
      const stringified = JSON.stringify(call);
      expect(stringified).not.toContain("email");
      expect(stringified).not.toContain("name");
      expect(stringified).not.toContain("@");
    }
  });
});
