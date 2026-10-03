import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HeroSlider } from "@/components/landing/HeroSlider";
import { BrowserRouter } from "react-router-dom";
import type { HeroSlide } from "@/hooks/useHeroSlides";

// Mock data
const mockSlides: HeroSlide[] = [
  {
    id: "slide-1",
    title: "Welcome to Health",
    subtitle: "Your journey starts here",
    badge: "New",
    targetAudience: "all",
    backgroundImageUrl: "",
    backgroundGradient: "from-primary/10 to-background",
    ctaText: "Shop Now",
    ctaUrl: "/shop",
    linkedProductId: null,
    linkedProductName: "",
    linkedProductPrice: 0,
    linkedProductSlug: "",
    sortOrder: 0,
    circleIcon: "Heart",
    circleText: "For Everyone",
  },
  {
    id: "slide-2",
    title: "Premium Products",
    subtitle: "Quality you can trust",
    badge: "Featured",
    targetAudience: "athletes",
    backgroundImageUrl: "",
    backgroundGradient: "from-secondary/10 to-background",
    ctaText: "Learn More",
    ctaUrl: "/about",
    linkedProductId: "product-1",
    linkedProductName: "Super Product",
    linkedProductPrice: 999,
    linkedProductSlug: "super-product",
    sortOrder: 1,
    circleIcon: "Zap",
    circleText: "For Athletes",
  },
];

// Hoisted mock state - allows changing mock return values per test
const hoisted = vi.hoisted(() => ({
  mockSlidesData: [] as HeroSlide[],
  mockIsLoading: false,
}));

vi.mock("@/hooks/useHeroSlides", () => ({
  useHeroSlides: () => ({
    data: hoisted.mockSlidesData,
    isLoading: hoisted.mockIsLoading,
  }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    addToCart: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    user: { id: "test-user" },
    session: { user: { id: "test-user" } },
  }),
}));

vi.mock("@/hooks/useCurrency", () => ({
  useCurrency: () => ({
    formatPrice: (amount: number) => `€${(amount / 100).toFixed(2)}`,
    formatCurrency: (amount: number) => `€${(amount / 100).toFixed(2)}`,
    convertAmount: (amount: number) => amount,
    convertFromBase: (amount: number) => amount,
    preferredCurrency: "EUR",
    baseCurrency: "EUR",
    availableCurrencies: ["EUR", "CZK", "USD"],
    rates: {},
    isLoading: false,
    storedCurrency: null,
    getRateToCzk: () => 1,
    setPreferredCurrency: vi.fn(),
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "landing.hero.fallbackTitle": "Platform",
        "landing.hero.fallbackSubtitle": "Your health journey",
        "landing.hero.featuredProduct": "Featured Product",
        "landing.hero.addToCart": "Add to Cart",
        "landing.hero.addedToCart": "Added!",
        "landing.hero.forEveryone": "For Everyone",
        "common.previous": "Previous",
        "common.next": "Next",
      };
      return translations[key] || key;
    },
    i18n: { language: "cs" },
  }),
}));

const renderHeroSlider = () => {
  return render(
    <BrowserRouter>
      <HeroSlider />
    </BrowserRouter>
  );
};

describe("HeroSlider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default mock data
    hoisted.mockSlidesData = [...mockSlides];
    hoisted.mockIsLoading = false;
  });

  it("should render first slide content", async () => {
    renderHeroSlider();

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    });

    expect(screen.getByText("Your journey starts here")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("should render navigation controls when multiple slides exist", async () => {
    renderHeroSlider();

    await waitFor(() => {
      expect(screen.getByLabelText("Previous")).toBeInTheDocument();
      expect(screen.getByLabelText("Next")).toBeInTheDocument();
    });

    // Check slide indicators (2 slides = 2 buttons)
    const slideButtons = screen.getAllByRole("button", { name: /Go to slide/i });
    expect(slideButtons).toHaveLength(2);
  });

  it("should change slide when clicking next button", async () => {
    renderHeroSlider();

    await waitFor(() => {
      expect(screen.getByText("Your journey starts here")).toBeInTheDocument();
    });

    const nextButton = screen.getByLabelText("Next");
    fireEvent.click(nextButton);

    await waitFor(() => {
      expect(screen.getByText("Quality you can trust")).toBeInTheDocument();
    });
  });

  it("should change slide when clicking slide indicator", async () => {
    renderHeroSlider();

    await waitFor(() => {
      expect(screen.getByText("Your journey starts here")).toBeInTheDocument();
    });

    const slideButtons = screen.getAllByRole("button", { name: /Go to slide/i });
    fireEvent.click(slideButtons[1]); // Click second slide indicator

    await waitFor(() => {
      expect(screen.getByText("Quality you can trust")).toBeInTheDocument();
    });
  });

  it("should display linked product info when available", async () => {
    hoisted.mockSlidesData = [mockSlides[1]]; // Use slide with linked product

    renderHeroSlider();

    await waitFor(() => {
      expect(screen.getByText("Featured Product")).toBeInTheDocument();
      expect(screen.getByText("Super Product")).toBeInTheDocument();
    });
  });

  it("should render CTA button with correct link", async () => {
    renderHeroSlider();

    await waitFor(() => {
      const ctaLink = screen.getByRole("link", { name: /Shop Now/i });
      expect(ctaLink).toHaveAttribute("href", "/shop");
    });
  });

  it("should show loading state when data is loading", async () => {
    hoisted.mockSlidesData = [];
    hoisted.mockIsLoading = true;

    renderHeroSlider();

    // Should show fallback content — title split across styled spans
    await waitFor(() => {
      const heading = screen.getByRole("heading", { level: 1 });
      expect(heading).toBeInTheDocument();
      expect(heading.textContent).toContain("Platform");
    });
  });

  it("should not render navigation when only one slide", async () => {
    hoisted.mockSlidesData = [mockSlides[0]];

    renderHeroSlider();

    await waitFor(() => {
      expect(screen.getByText("Your journey starts here")).toBeInTheDocument();
    });

    // Navigation should not be present
    expect(screen.queryByLabelText("Previous")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Next")).not.toBeInTheDocument();
  });

  it("should render badge when provided", async () => {
    renderHeroSlider();

    await waitFor(() => {
      expect(screen.getByText("New")).toBeInTheDocument();
    });
  });
});
