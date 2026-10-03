import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFeaturedProducts, usePrimaryFeaturedProduct } from "@/hooks/useFeaturedProducts";
import { aisha } from "@/integrations/db/client";
import type { ReactNode } from "react";

vi.mock("@/integrations/db/client", () => ({
  aisha: {
    rpc: vi.fn(),
  },
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const mockFeaturedProduct = {
  id: "test-id",
  product_id: "product-id",
  product_name: "Test Product",
  product_slug: "test-product",
  product_price: 1000,
  product_currency: "CZK",
  badge_key: "test.badge",
  title_key: "test.title",
  subtitle_key: null,
  feature_keys: ["test.feature1", "test.feature2"],
  cta_text_key: "test.cta",
  cta_url: "/shop/test-product",
  price_period_days: 60,
  show_price: true,
  image_url: null,
  background_gradient: "from-primary/5",
  sort_order: 0,
};

describe("useFeaturedProducts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch featured products via RPC", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: [mockFeaturedProduct],
      error: null,
    });

    const { result } = renderHook(() => useFeaturedProducts("homepage"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual([mockFeaturedProduct]);
    expect(aisha.rpc).toHaveBeenCalledWith("get_featured_products", {
      p_location: "homepage",
    });
  });

  it("should return empty array on no data", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: null,
      error: null,
    });

    const { result } = renderHook(() => useFeaturedProducts("homepage"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual([]);
  });

  it("should handle errors", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: null,
      error: { message: "Database error", code: "500", details: "", hint: "" },
    });

    const { result } = renderHook(() => useFeaturedProducts("homepage"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeDefined();
  });
});

describe("usePrimaryFeaturedProduct", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return the first featured product", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: [mockFeaturedProduct, { ...mockFeaturedProduct, id: "second" }],
      error: null,
    });

    const { result } = renderHook(() => usePrimaryFeaturedProduct(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockFeaturedProduct);
  });

  it("should return null when no featured products", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: [],
      error: null,
    });

    const { result } = renderHook(() => usePrimaryFeaturedProduct(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toBeNull();
  });
});
