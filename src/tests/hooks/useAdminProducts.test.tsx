/**
 * Tests for src/hooks/useAdminProducts.ts (e-commerce products)
 *
 * Coverage:
 *   - useProductsAdmin   (query — get_products_admin, supports `enabled`)
 *   - useCreateProduct   (mutation — create_product_admin, big param set)
 *   - useUpdateProduct   (mutation — update_product_admin)
 *   - useDeleteProduct   (mutation — delete_product_admin)
 *
 * The create/update params are very wide (30+ params each) — we don't
 * snapshot the entire object. Instead we verify:
 *   - The RPC name
 *   - The id/slug threading through to the right param
 *   - The null-vs-undefined mapping pattern (null → undefined so the
 *     RPC's COALESCE pattern can keep the existing column value)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useProductsAdmin,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
} from "@/hooks/useAdminProducts";

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

const UUID_PRODUCT = "80000000-0000-4000-a000-000000000001";

const mockProductRow = {
  archive_document_id: null,
  id: UUID_PRODUCT,
  name: "Test Supplement",
  slug: "test-supplement",
  price: 1200,
  description: "Test description",
  short_description: "Short desc",
  category: "vitamin",
  use_case: null,
  in_stock: true,
  stock_quantity: 100,
  image_url: "https://example.test/img.jpg",
  images: [],
  compare_at_price: null,
  doses_per_package: 60,
  target_audience: null,
  name_key: null,
  description_key: null,
  short_description_key: null,
  tagline_key: null,
  badge_key: null,
  image_alt_key: null,
  benefits_title_key: null,
  composition_title_key: null,
  usage_title_key: null,
  base_locale: "cs",
  benefits_content: null,
  origin_content: null,
  substances_content: null,
  usage_content: null,
  default_protocol_id: null,
  created_at: "2026-03-01T00:00:00Z",
  updated_at: "2026-03-01T01:00:00Z",
};

// ── useProductsAdmin ───────────────────────────────────────────

describe("useProductsAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls get_products_admin and returns parsed array", async () => {
    mockRpc.mockResolvedValue({ data: [mockProductRow], error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useProductsAdmin(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith("get_products_admin");
    expect(result.current.data?.[0].id).toBe(UUID_PRODUCT);
  });

  it("respects the `enabled` parameter (e.g. opt-out from admin layouts)", async () => {
    mockRpc.mockResolvedValue({ data: [mockProductRow], error: null });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useProductsAdmin(false), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("does not call RPC when caller lacks view_admin_dashboard", async () => {
    mockHasPermission.mockReturnValue(false);
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useProductsAdmin(), {
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
    const { result } = renderHook(() => useProductsAdmin(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("permission denied for function");
  });
});

// ── useCreateProduct ───────────────────────────────────────────

describe("useCreateProduct", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls create_product_admin with mandatory fields filled in defaults", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateProduct(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        name: "New Supplement",
        slug: "new-supplement",
        price: 999,
        description: "Hello",
      });
    });

    const [rpcName, args] = mockRpc.mock.calls[0];
    expect(rpcName).toBe("create_product_admin");
    expect(args.p_name).toBe("New Supplement");
    expect(args.p_slug).toBe("new-supplement");
    expect(args.p_price).toBe(999);
    expect(args.p_description).toBe("Hello");
    expect(args.p_in_stock).toBe(true); // default
    expect(args.p_stock_quantity).toBe(0); // default
  });

  it("invalidates both admin-products and public-products caches on success", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { Wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateProduct(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ name: "X", slug: "x", price: 1 });
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin-products"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["public-products"] });
  });

  it("propagates RPC error (e.g. slug uniqueness violation)", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "duplicate key value violates unique constraint products_slug_key" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateProduct(), { wrapper: Wrapper });
    await expect(
      act(async () => {
        await result.current.mutateAsync({
          name: "Dupe",
          slug: "existing-slug",
          price: 100,
        });
      }),
    ).rejects.toThrow("duplicate key value");
  });
});

// ── useUpdateProduct ───────────────────────────────────────────

describe("useUpdateProduct", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls update_product_admin with p_id threaded through and only-set fields", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateProduct(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        id: UUID_PRODUCT,
        data: { price: 1500, in_stock: false },
      });
    });

    const [rpcName, args] = mockRpc.mock.calls[0];
    expect(rpcName).toBe("update_product_admin");
    expect(args.p_id).toBe(UUID_PRODUCT);
    expect(args.p_price).toBe(1500);
    expect(args.p_in_stock).toBe(false);
  });

  it("maps explicit null inputs to undefined (skip-update via COALESCE)", async () => {
    // The hook's pattern: `x !== null ? x : undefined`. So passing null
    // means "don't touch this column"; only undefined-source fields stay
    // out, but the test of importance is that *null* never crosses the
    // RPC boundary — that would NULL the column in DB.
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateProduct(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        id: UUID_PRODUCT,
        data: {
          name: "Renamed",
          description: null,
          short_description: null,
          category: null,
        },
      });
    });

    const args = mockRpc.mock.calls[0][1];
    expect(args.p_name).toBe("Renamed");
    expect(args.p_description).toBeUndefined();
    expect(args.p_short_description).toBeUndefined();
    expect(args.p_category).toBeUndefined();
  });

  it("invalidates admin-products + public-products on success", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { Wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateProduct(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: UUID_PRODUCT, data: { price: 1 } });
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin-products"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["public-products"] });
  });

  it("propagates RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "product not found" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateProduct(), { wrapper: Wrapper });
    await expect(
      act(async () => {
        await result.current.mutateAsync({ id: UUID_PRODUCT, data: { price: 1 } });
      }),
    ).rejects.toThrow("product not found");
  });
});

// ── useDeleteProduct ───────────────────────────────────────────

describe("useDeleteProduct", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls delete_product_admin with p_id", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteProduct(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync(UUID_PRODUCT);
    });

    expect(mockRpc).toHaveBeenCalledWith("delete_product_admin", {
      p_id: UUID_PRODUCT,
    });
  });

  it("invalidates admin-products only (public-products refresh on next list-fetch)", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { Wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useDeleteProduct(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync(UUID_PRODUCT);
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin-products"] });
    // Delete does NOT touch public-products — public reads use a different
    // RPC that filters soft-deleted rows automatically.
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ["public-products"] });
  });

  it("propagates RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "FK violation: product referenced by 4 orders" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteProduct(), { wrapper: Wrapper });
    await expect(
      act(async () => {
        await result.current.mutateAsync(UUID_PRODUCT);
      }),
    ).rejects.toThrow("FK violation");
  });
});
