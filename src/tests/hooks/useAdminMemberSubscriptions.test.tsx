/**
 * Tests for src/hooks/useAdminMemberSubscriptions.ts
 *
 * Coverage:
 *   - useMemberSubscriptionsAdmin       (query — 2 RPCs, client-side join)
 *   - useUpdateMemberSubscriptionStatus (mutation — returns {id, status})
 *
 * The query fans out:
 *   1) get_member_subscriptions_admin       → subscription rows
 *   2) get_profiles_admin_by_user_ids       → profile rows for distinct user_ids
 *      then client-side joins them on user_id (left join — missing profile = null)
 *
 * We exercise the join behaviour explicitly because it's a hand-rolled
 * pattern that's easy to break when adding new fields to either side.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useMemberSubscriptionsAdmin,
  useUpdateMemberSubscriptionStatus,
} from "@/hooks/useAdminMemberSubscriptions";

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

function createWrapper(qc?: QueryClient) {
  const queryClient =
    qc ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { Wrapper, queryClient };
}

const UUID_SUB = "90000000-0000-4000-a000-000000000001";
const UUID_SUB_2 = "90000000-0000-4000-a000-000000000002";
const UUID_USER = "90000000-0000-4000-a000-000000000011";
const UUID_USER_2 = "90000000-0000-4000-a000-000000000012";
const UUID_PACKAGE = "90000000-0000-4000-a000-000000000021";
const UUID_MEMBERSHIP = "90000000-0000-4000-a000-000000000031";

function subRow(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID_SUB,
    user_id: UUID_USER,
    package_id: UUID_PACKAGE,
    membership_id: UUID_MEMBERSHIP,
    amount_paid: 9900,
    currency: "CZK",
    status: "active",
    period_start: "2026-01-01T00:00:00Z",
    period_end: "2026-12-31T23:59:59Z",
    created_at: "2026-01-01T00:00:00Z",
    package_name: "Premium",
    package_tier: "premium",
    package_period: "yearly",
    ...overrides,
  };
}

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: UUID_USER,
    display_name: "Test User",
    email: "user@example.test",
    phone: "+420123456789",
    ...overrides,
  };
}

// ── useMemberSubscriptionsAdmin ────────────────────────────────

describe("useMemberSubscriptionsAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("fans out 2 RPCs (subs + profiles) and joins them by user_id", async () => {
    mockRpc
      .mockResolvedValueOnce({ data: [subRow()], error: null }) // subscriptions
      .mockResolvedValueOnce({ data: [profileRow()], error: null }); // profiles

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useMemberSubscriptionsAdmin(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // First call: subscriptions
    expect(mockRpc).toHaveBeenNthCalledWith(1, "get_member_subscriptions_admin");
    // Second call: profiles, with the distinct user_ids
    expect(mockRpc).toHaveBeenNthCalledWith(2, "get_profiles_admin_by_user_ids", {
      p_user_ids: [UUID_USER],
    });

    expect(result.current.data).toEqual([
      {
        id: UUID_SUB,
        user_id: UUID_USER,
        package_id: UUID_PACKAGE,
        membership_id: UUID_MEMBERSHIP,
        amount_paid: 9900,
        currency: "CZK",
        status: "active",
        period_start: "2026-01-01T00:00:00Z",
        period_end: "2026-12-31T23:59:59Z",
        created_at: "2026-01-01T00:00:00Z",
        package: { name: "Premium", tier: "premium", period: "yearly" },
        profile: {
          display_name: "Test User",
          email: "user@example.test",
          phone: "+420123456789",
        },
      },
    ]);
  });

  it("dedupes user_ids before fetching profiles (avoid N+1 explosion)", async () => {
    // 3 subscriptions but only 2 distinct user_ids
    mockRpc
      .mockResolvedValueOnce({
        data: [
          subRow({ id: UUID_SUB, user_id: UUID_USER }),
          subRow({ id: UUID_SUB_2, user_id: UUID_USER_2 }),
          subRow({ id: "90000000-0000-4000-a000-000000000003", user_id: UUID_USER }),
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [profileRow({ user_id: UUID_USER }), profileRow({ user_id: UUID_USER_2 })],
        error: null,
      });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useMemberSubscriptionsAdmin(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const profilesCall = mockRpc.mock.calls.find(
      (c) => c[0] === "get_profiles_admin_by_user_ids",
    );
    expect(profilesCall?.[1]?.p_user_ids).toHaveLength(2);
    expect(profilesCall?.[1]?.p_user_ids).toEqual(
      expect.arrayContaining([UUID_USER, UUID_USER_2]),
    );
  });

  it("attaches profile=null when no matching profile row (deleted user)", async () => {
    mockRpc
      .mockResolvedValueOnce({ data: [subRow()], error: null })
      .mockResolvedValueOnce({ data: [], error: null }); // empty profiles

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useMemberSubscriptionsAdmin(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].profile).toBeNull();
  });

  it("skips the profiles RPC when there are zero subscriptions", async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useMemberSubscriptionsAdmin(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual([]);
  });

  it("defaults currency to CZK when the RPC omits it", async () => {
    mockRpc
      .mockResolvedValueOnce({
        data: [subRow({ currency: undefined })],
        error: null,
      })
      .mockResolvedValueOnce({ data: [profileRow()], error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useMemberSubscriptionsAdmin(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].currency).toBe("CZK");
  });

  it("does not call RPC when caller lacks view_admin_dashboard", async () => {
    mockHasPermission.mockReturnValue(false);
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useMemberSubscriptionsAdmin(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("throws when the subscriptions RPC errors (raw error, before profiles fan-out)", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "permission denied for function" },
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useMemberSubscriptionsAdmin(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    // Profiles RPC must NOT have been called
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it("throws when the profiles RPC errors (after subs succeeded)", async () => {
    mockRpc
      .mockResolvedValueOnce({ data: [subRow()], error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "profile lookup failed" },
      });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useMemberSubscriptionsAdmin(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ── useUpdateMemberSubscriptionStatus ──────────────────────────

describe("useUpdateMemberSubscriptionStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls update_member_subscription_status_admin with the params", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateMemberSubscriptionStatus(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({
        subscriptionId: UUID_SUB,
        status: "cancelled",
      });
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "update_member_subscription_status_admin",
      {
        p_status: "cancelled",
        p_subscription_id: UUID_SUB,
      },
    );
  });

  it("returns the params back for optimistic update consumers", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateMemberSubscriptionStatus(), {
      wrapper: Wrapper,
    });

    let out: { subscriptionId: string; status: string } | undefined;
    await act(async () => {
      out = await result.current.mutateAsync({
        subscriptionId: UUID_SUB,
        status: "active",
      });
    });
    expect(out).toEqual({ subscriptionId: UUID_SUB, status: "active" });
  });

  it("invalidates admin-member-subscriptions cache on success", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { Wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateMemberSubscriptionStatus(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({
        subscriptionId: UUID_SUB,
        status: "active",
      });
    });
    expect(spy).toHaveBeenCalledWith({
      queryKey: ["admin-member-subscriptions"],
    });
  });

  it("propagates RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "invalid status transition: active → terminated" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateMemberSubscriptionStatus(), {
      wrapper: Wrapper,
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync({
          subscriptionId: UUID_SUB,
          status: "terminated",
        });
      }),
    ).rejects.toThrow("invalid status transition");
  });
});
