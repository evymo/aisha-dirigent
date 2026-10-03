import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useAdminPendingCounts,
  useAdminActivityFeed,
} from "@/hooks/useAdminActivityFeed";
import type { AdminPendingCounts, ActivityFeedItem } from "@/hooks/useAdminActivityFeed";

/* ── Hoisted mocks ────────────────────────────────────────────── */

const mockRpc = vi.hoisted(() => vi.fn());
const mockHasPermission = vi.hoisted(() => vi.fn(() => true));

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
  safeError: vi.fn(),
}));

/* ── Helpers ──────────────────────────────────────────────────── */

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const MOCK_COUNTS: AdminPendingCounts = {
  pending_consultants: 2,
  pending_contributions: 1,
  pending_deletions: 3,
  pending_registrations: 0,
  pending_escalations: 5,
  pending_moderation: 1,
  pending_orders: 4,
  pending_subscriptions: 7,
};

const MOCK_FEED_ITEMS: ActivityFeedItem[] = [
  {
    action_required: true,
    created_at: "2026-01-18T10:00:00Z",
    display_name: "Jan Novák",
    item_id: "subscription_pending:abc-123",
    item_type: "subscription_pending",
    membership_tier: "premium",
    metadata: {
      subscription_id: "abc-123",
      package_name: "Premium Monthly",
      amount_paid: 990,
      currency: "CZK",
    },
    user_id: "user-001",
  },
  {
    action_required: true,
    created_at: "2026-01-17T12:00:00Z",
    display_name: "Petr Svoboda",
    item_id: "deletion_pending:def-456",
    item_type: "deletion_pending",
    membership_tier: "basic",
    metadata: {
      deletion_id: "def-456",
      days_remaining: 14,
    },
    user_id: "user-002",
  },
];

/* ── useAdminPendingCounts ────────────────────────────────────── */

describe("useAdminPendingCounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("should return pending counts from RPC", async () => {
    mockRpc.mockResolvedValue({ data: [MOCK_COUNTS], error: null });

    const { result } = renderHook(() => useAdminPendingCounts(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(MOCK_COUNTS);
    expect(mockRpc).toHaveBeenCalledWith("get_admin_pending_counts");
  });

  it("should return single object (non-array) from RPC", async () => {
    mockRpc.mockResolvedValue({ data: MOCK_COUNTS, error: null });

    const { result } = renderHook(() => useAdminPendingCounts(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(MOCK_COUNTS);
  });

  it("should return empty counts on validation failure", async () => {
    mockRpc.mockResolvedValue({ data: [{ bad_field: "invalid" }], error: null });

    const { result } = renderHook(() => useAdminPendingCounts(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual({
      pending_consultants: 0,
      pending_contributions: 0,
      pending_deletions: 0,
      pending_registrations: 0,
      pending_escalations: 0,
      pending_moderation: 0,
      pending_orders: 0,
      pending_subscriptions: 0,
    });
  });

  it("should throw on RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied" },
    });

    const { result } = renderHook(() => useAdminPendingCounts(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeDefined();
  });

  it("should not fetch when user lacks permissions", async () => {
    mockHasPermission.mockReturnValue(false);

    const { result } = renderHook(() => useAdminPendingCounts(), {
      wrapper: createWrapper(),
    });

    // Query should remain in idle/pending state - never fetching
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

/* ── useAdminActivityFeed ─────────────────────────────────────── */

describe("useAdminActivityFeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("should return feed items from RPC", async () => {
    mockRpc.mockResolvedValue({ data: MOCK_FEED_ITEMS, error: null });

    const { result } = renderHook(() => useAdminActivityFeed(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].item_type).toBe("subscription_pending");
    expect(result.current.data?.[1].item_type).toBe("deletion_pending");
  });

  it("should pass default params to RPC", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    renderHook(() => useAdminActivityFeed(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalled();
    });

    expect(mockRpc).toHaveBeenCalledWith("get_admin_activity_feed", {
      p_action_type: undefined,
      p_limit: 50,
      p_offset: 0,
      p_search: undefined,
    });
  });

  it("should pass filtering params to RPC", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    renderHook(
      () =>
        useAdminActivityFeed({
          actionType: "subscription_pending",
          limit: 10,
          offset: 20,
          search: "Jan",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalled();
    });

    expect(mockRpc).toHaveBeenCalledWith("get_admin_activity_feed", {
      p_action_type: "subscription_pending",
      p_limit: 10,
      p_offset: 20,
      p_search: "Jan",
    });
  });

  it("should return empty array when no data", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useAdminActivityFeed(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([]);
  });

  it("should return empty array on validation failure", async () => {
    mockRpc.mockResolvedValue({
      data: [{ invalid_field: true }],
      error: null,
    });

    const { result } = renderHook(() => useAdminActivityFeed(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([]);
  });

  it("should throw on RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "fetch failed" },
    });

    const { result } = renderHook(() => useAdminActivityFeed(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeDefined();
  });

  it("should not fetch when user lacks permissions", async () => {
    mockHasPermission.mockReturnValue(false);

    const { result } = renderHook(() => useAdminActivityFeed(), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("should use separate query keys for different filter params", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const wrapper = createWrapper();

    const { result: result1 } = renderHook(
      () => useAdminActivityFeed({ actionType: "subscription_pending" }),
      { wrapper },
    );

    const { result: result2 } = renderHook(
      () => useAdminActivityFeed({ actionType: "deletion_pending" }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result1.current.isSuccess).toBe(true);
      expect(result2.current.isSuccess).toBe(true);
    });

    // Both should have been called with different params
    expect(mockRpc).toHaveBeenCalledWith("get_admin_activity_feed", expect.objectContaining({
      p_action_type: "subscription_pending",
    }));
    expect(mockRpc).toHaveBeenCalledWith("get_admin_activity_feed", expect.objectContaining({
      p_action_type: "deletion_pending",
    }));
  });

  it("should validate feed item schema correctly", async () => {
    const validItem: ActivityFeedItem = {
      action_required: true,
      created_at: "2026-01-18T10:00:00Z",
      display_name: null,
      item_id: "test-id",
      item_type: "order_pending",
      membership_tier: null,
      metadata: { total: 100 },
      user_id: null,
    };

    mockRpc.mockResolvedValue({ data: [validItem], error: null });

    const { result } = renderHook(() => useAdminActivityFeed(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].display_name).toBeNull();
    expect(result.current.data?.[0].user_id).toBeNull();
  });
});
