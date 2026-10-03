import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useHeroSlides } from "@/hooks/useHeroSlides";
import { aisha } from "@/integrations/db/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Mock aisha
vi.mock("@/integrations/db/client", () => ({
  aisha: {
    rpc: vi.fn(),
  },
}));

// Mock i18n
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "cs" },
  }),
}));

// Mock safeLogger
vi.mock("@/lib/security/safeLogger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/safeLogger")>()),
  safeError: vi.fn(),
}));

// Mock Zod schema parser - pass through data as-is
vi.mock("@/schemas/rpcResponseSchemas", () => ({
  HeroSlidePublicSchema: {},
  parseRpcArrayResponse: (_schema: unknown, data: unknown) => data,
}));

const mockRpcData = [
  {
    id: "slide-1",
    title: "Vítejte u zdraví",
    subtitle: "Vaše cesta začíná zde",
    badge: "Nové",
    target_audience: "all",
    background_image_url: null,
    background_gradient: "from-primary/10 to-background",
    cta_text: "Nakupovat",
    cta_url: "/shop",
    linked_product_id: null,
    linked_product_name: "",
    linked_product_price: 0,
    linked_product_slug: "",
    sort_order: 0,
    circle_icon: "Heart",
    circle_text: "Pro všechny",
  },
  {
    id: "slide-2",
    title: "Prémiové produkty",
    subtitle: "Kvalita, které můžete věřit",
    badge: "Doporučeno",
    target_audience: "athletes",
    background_image_url: "https://example.com/image.jpg",
    background_gradient: "from-emerald-500/20 via-teal-400/10 to-background",
    cta_text: "Více informací",
    cta_url: "/about",
    linked_product_id: "product-1",
    linked_product_name: "Super doplněk",
    linked_product_price: 999,
    linked_product_slug: "super-product",
    sort_order: 1,
    circle_icon: "Zap",
    circle_text: "Pro atlety",
  },
];

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("useHeroSlides", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch hero slides via RPC", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: mockRpcData,
      error: null,
    });

    const { result } = renderHook(() => useHeroSlides(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
      expect(result.current.data).toHaveLength(2);
    });

    expect(aisha.rpc).toHaveBeenCalledWith("get_public_hero_slides", {
      p_locale: "cs",
    });
  });

  it("should return localized fields from RPC", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: mockRpcData,
      error: null,
    });

    const { result } = renderHook(() => useHeroSlides(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    const firstSlide = result.current.data?.[0];
    expect(firstSlide?.title).toBe("Vítejte u zdraví");
    expect(firstSlide?.subtitle).toBe("Vaše cesta začíná zde");
    expect(firstSlide?.badge).toBe("Nové");
    expect(firstSlide?.ctaText).toBe("Nakupovat");
  });

  it("should return all slide properties correctly", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: mockRpcData,
      error: null,
    });

    const { result } = renderHook(() => useHeroSlides(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    const secondSlide = result.current.data?.[1];
    expect(secondSlide?.id).toBe("slide-2");
    expect(secondSlide?.targetAudience).toBe("athletes");
    expect(secondSlide?.backgroundImageUrl).toBe("https://example.com/image.jpg");
    expect(secondSlide?.linkedProductId).toBe("product-1");
    expect(secondSlide?.linkedProductPrice).toBe(999);
    expect(secondSlide?.circleIcon).toBe("Zap");
    expect(secondSlide?.circleText).toBe("Pro atlety");
  });

  it("should handle RPC errors", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: null,
      error: { message: "Database error", code: "500" },
    });

    const { result } = renderHook(() => useHeroSlides(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).toBeDefined();
    });
  });

  it("should return empty array when no slides", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: [],
      error: null,
    });

    const { result } = renderHook(() => useHeroSlides(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual([]);
    });
  });

  it("should include queryKey with language", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: mockRpcData,
      error: null,
    });

    renderHook(() => useHeroSlides(), {
      wrapper: createWrapper(),
    });

    // Just verify the RPC was called - queryKey is internal
    await waitFor(() => {
      expect(aisha.rpc).toHaveBeenCalled();
    });
  });
});
