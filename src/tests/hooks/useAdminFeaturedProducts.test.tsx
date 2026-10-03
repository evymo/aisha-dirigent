import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAdminFeaturedProducts } from "@/hooks/useAdminFeaturedProducts";
import { aisha } from "@/integrations/db/client";
import type { ReactNode } from "react";

vi.mock("@/integrations/db/client", () => ({
  aisha: {
    rpc: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const mockAdminFeaturedProduct = {
  id: "test-id",
  product_id: "product-id",
  product_name: "Test Product",
  product_slug: "test-product",
  product_price: 1000,
  badge_key: "test.badge",
  title_key: "test.title",
  subtitle_key: null,
  feature_keys: ["test.feature1"],
  cta_text_key: "test.cta",
  cta_url: null,
  price_period_days: 60,
  show_price: true,
  image_url: null,
  background_gradient: "from-primary/5",
  display_location: "homepage",
  sort_order: 0,
  is_active: true,
  created_at: "2026-02-03T00:00:00Z",
  updated_at: "2026-02-03T00:00:00Z",
};

describe("useAdminFeaturedProducts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch featured products via admin RPC", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: [mockAdminFeaturedProduct],
      error: null,
    });

    const { result } = renderHook(() => useAdminFeaturedProducts(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.featuredProducts).toEqual([mockAdminFeaturedProduct]);
    expect(aisha.rpc).toHaveBeenCalledWith("get_featured_products_admin");
  });

  it("should return empty array when no data", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: null,
      error: null,
    });

    const { result } = renderHook(() => useAdminFeaturedProducts(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.featuredProducts).toEqual([]);
  });

  it("should create featured product", async () => {
    vi.mocked(aisha.rpc)
      .mockResolvedValueOnce({ data: [], error: null }) // initial fetch
      .mockResolvedValueOnce({ data: "new-id", error: null }); // create

    const { result } = renderHook(() => useAdminFeaturedProducts(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      result.current.create({
        product_id: "product-id",
        badge_key: "test.badge",
        title_key: "test.title",
      });
    });

    await waitFor(() => {
      expect(result.current.isCreating).toBe(false);
    });

    expect(aisha.rpc).toHaveBeenCalledWith(
      "upsert_featured_product_admin",
      expect.objectContaining({
        p_id: undefined,
        p_product_id: "product-id",
        p_badge_key: "test.badge",
        p_title_key: "test.title",
      })
    );
  });

  it("should update featured product", async () => {
    vi.mocked(aisha.rpc)
      .mockResolvedValueOnce({ data: [mockAdminFeaturedProduct], error: null })
      .mockResolvedValueOnce({ data: "test-id", error: null });

    const { result } = renderHook(() => useAdminFeaturedProducts(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      result.current.update({
        id: "test-id",
        badge_key: "updated.badge",
      });
    });

    await waitFor(() => {
      expect(result.current.isUpdating).toBe(false);
    });

    expect(aisha.rpc).toHaveBeenCalledWith(
      "upsert_featured_product_admin",
      expect.objectContaining({
        p_id: "test-id",
        p_badge_key: "updated.badge",
      })
    );
  });

  it("should delete featured product", async () => {
    vi.mocked(aisha.rpc)
      .mockResolvedValueOnce({ data: [mockAdminFeaturedProduct], error: null })
      .mockResolvedValueOnce({ data: true, error: null });

    const { result } = renderHook(() => useAdminFeaturedProducts(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      result.current.remove("test-id");
    });

    await waitFor(() => {
      expect(result.current.isDeleting).toBe(false);
    });

    expect(aisha.rpc).toHaveBeenCalledWith("delete_featured_product_admin", {
      p_id: "test-id",
    });
  });
});
