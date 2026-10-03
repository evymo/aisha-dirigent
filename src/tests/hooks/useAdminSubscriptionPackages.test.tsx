/**
 * Tests for src/hooks/useAdminSubscriptionPackages.ts
 *
 * Coverage (4 exports):
 *   - useSubscriptionPackagesAdmin (query — fetch + sort by sort_order)
 *   - useCreateSubscriptionPackage (mutation — create_subscription_package_admin)
 *   - useUpdateSubscriptionPackage (mutation — update_subscription_package_admin)
 *   - useDeleteSubscriptionPackage (mutation — delete_subscription_package_admin)
 *
 * Locked-in behaviours:
 *   - rows arrive in arbitrary order from the RPC; hook sorts by sort_order
 *   - create RPC param names DIFFER from input keys (slug → p_code, price → p_price)
 *   - update sends only the provided fields; everything else maps to undefined
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useSubscriptionPackagesAdmin,
  useCreateSubscriptionPackage,
  useUpdateSubscriptionPackage,
  useDeleteSubscriptionPackage,
} from "@/hooks/useAdminSubscriptionPackages";

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

const UUID_PKG_A = "d0000000-0000-4000-a000-000000000001";
const UUID_PKG_B = "d0000000-0000-4000-a000-000000000002";
const UUID_PKG_C = "d0000000-0000-4000-a000-000000000003";

function packageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID_PKG_A,
    name: "Basic",
    slug: "basic",
    description: "Entry tier",
    period: "monthly",
    tier: "basic",
    governance_tokens: 100,
    impact_tokens: 10,
    is_active: true,
    is_recurring: true,
    sort_order: 1,
    stripe_price_id: "price_basic_123",
    currency: "CZK",
    name_key: "subscription.basic.name",
    description_key: "subscription.basic.description",
    base_locale: "cs",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T01:00:00Z",
    ...overrides,
  };
}

// ── useSubscriptionPackagesAdmin ───────────────────────────────

describe("useSubscriptionPackagesAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls get_subscription_packages_admin and projects to component shape", async () => {
    mockRpc.mockResolvedValue({ data: [packageRow()], error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useSubscriptionPackagesAdmin(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith("get_subscription_packages_admin");
    expect(result.current.data?.[0]).toMatchObject({
      id: UUID_PKG_A,
      name: "Basic",
      slug: "basic",
      tier: "basic",
      period: "monthly",
      stripe_price_id: "price_basic_123",
    });
  });

  it("sorts the result by sort_order (asc) regardless of RPC return order", async () => {
    mockRpc.mockResolvedValue({
      data: [
        packageRow({ id: UUID_PKG_B, name: "Premium", slug: "premium", sort_order: 3 }),
        packageRow({ id: UUID_PKG_A, name: "Basic", slug: "basic", sort_order: 1 }),
        packageRow({ id: UUID_PKG_C, name: "Standard", slug: "standard", sort_order: 2 }),
      ],
      error: null,
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useSubscriptionPackagesAdmin(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.map((p) => p.slug)).toEqual([
      "basic",
      "standard",
      "premium",
    ]);
  });

  it("maps nullable fields to null when the RPC sends empty string", async () => {
    mockRpc.mockResolvedValue({
      data: [packageRow({ description: "", stripe_price_id: "" })],
      error: null,
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useSubscriptionPackagesAdmin(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].description).toBeNull();
    expect(result.current.data?.[0].stripe_price_id).toBeNull();
  });

  it("does not call RPC when caller lacks view_admin_dashboard", async () => {
    mockHasPermission.mockReturnValue(false);
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useSubscriptionPackagesAdmin(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied for function" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useSubscriptionPackagesAdmin(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ── useCreateSubscriptionPackage ───────────────────────────────

describe("useCreateSubscriptionPackage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls create_subscription_package_admin with field name remap (slug→p_code, price→p_price)", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateSubscriptionPackage(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({
        name: "Premium",
        slug: "premium",
        description: "Top tier",
        tier: "upgraded",
        period: "annual",
        price: 9900,
        governance_tokens: 1000,
        impact_tokens: 100,
        is_active: true,
        is_recurring: true,
        sort_order: 99,
        stripe_price_id: "price_prem_42",
      });
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "create_subscription_package_admin",
      expect.objectContaining({
        p_code: "premium",
        p_currency: "CZK",
        p_description: "Top tier",
        p_display_order: 99,
        p_features: [],
        p_is_active: true,
        p_is_recurring: true,
        p_name: "Premium",
        p_period: "annual",
        p_price: 9900,
        p_stripe_price_id: "price_prem_42",
        p_tier: "upgraded",
        p_tokens_governance: 1000,
        p_tokens_impact: 100,
      }),
    );
  });

  it("uses sensible defaults (active=true, recurring=false, tokens=0)", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateSubscriptionPackage(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({
        name: "Minimal",
        slug: "minimal",
        tier: "basic",
        period: "monthly",
        price: 0,
      });
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "create_subscription_package_admin",
      expect.objectContaining({
        p_is_active: true,
        p_is_recurring: false,
        p_tokens_governance: 0,
        p_tokens_impact: 0,
        p_display_order: 0,
      }),
    );
  });

  it("invalidates admin-subscription-packages cache on success", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { Wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateSubscriptionPackage(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({
        name: "X",
        slug: "x",
        tier: "basic",
        period: "monthly",
        price: 0,
      });
    });
    expect(spy).toHaveBeenCalledWith({
      queryKey: ["admin-subscription-packages"],
    });
  });

  it("propagates RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "duplicate slug" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateSubscriptionPackage(), {
      wrapper: Wrapper,
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync({
          name: "Dupe",
          slug: "basic",
          tier: "basic",
          period: "monthly",
          price: 0,
        });
      }),
    ).rejects.toThrow("duplicate slug");
  });
});

// ── useUpdateSubscriptionPackage ───────────────────────────────

describe("useUpdateSubscriptionPackage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls update_subscription_package_admin with p_id + only-provided fields", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateSubscriptionPackage(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({
        id: UUID_PKG_A,
        is_active: false,
        price: 1500,
      });
    });

    // The hook also fetches the commerce base currency (useCommerceBaseCurrency),
    // which issues its own RPC — select the update call by name rather than index.
    const updateCall = mockRpc.mock.calls.find(
      (c) => c[0] === "update_subscription_package_admin",
    );
    const args = updateCall![1];
    expect(args.p_id).toBe(UUID_PKG_A);
    expect(args.p_price).toBe(1500);
    expect(args.p_is_active).toBe(false);
    // Fields not in input become undefined (skip-update semantics)
    expect(args.p_name).toBeUndefined();
    expect(args.p_tier).toBeUndefined();
    expect(args.p_tokens_governance).toBeUndefined();
  });

  it("invalidates admin-subscription-packages cache on success", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { Wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateSubscriptionPackage(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({ id: UUID_PKG_A, price: 1 });
    });
    expect(spy).toHaveBeenCalledWith({
      queryKey: ["admin-subscription-packages"],
    });
  });

  it("propagates RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "package has active subscribers — cannot change tier" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateSubscriptionPackage(), {
      wrapper: Wrapper,
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync({ id: UUID_PKG_A, tier: "upgraded" });
      }),
    ).rejects.toThrow("active subscribers");
  });
});

// ── useDeleteSubscriptionPackage ───────────────────────────────

describe("useDeleteSubscriptionPackage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls delete_subscription_package_admin with the id", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteSubscriptionPackage(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync(UUID_PKG_A);
    });

    expect(mockRpc).toHaveBeenCalledWith("delete_subscription_package_admin", {
      p_id: UUID_PKG_A,
    });
  });

  it("propagates RPC error (e.g. FK violation)", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "FK violation: package referenced by member_subscriptions" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteSubscriptionPackage(), {
      wrapper: Wrapper,
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync(UUID_PKG_A);
      }),
    ).rejects.toThrow("FK violation");
  });
});
