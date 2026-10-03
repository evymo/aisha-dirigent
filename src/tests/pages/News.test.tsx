import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import News from "@/pages/News";
import NewsArticleDetail from "@/pages/NewsArticleDetail";

const mockUseNewsArticlesBrowser = vi.fn();
const mockUseNewsTags = vi.fn();
const mockUseNewsArticleBySlug = vi.fn();
const mockUseDynamicTranslationsMap = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

vi.mock("@/components/layout/Header", () => ({
  Header: () => <div data-testid="header" />,
}));

vi.mock("@/components/layout/Footer", () => ({
  Footer: () => <div data-testid="footer" />,
}));

/**
 * ⛔ `/news` VYKRESLUJE KNIHOVNU S HLEDÁNÍM (2026-09-21).
 *
 * Stránka měla vlastní mřížku karet nad `useNewsArticles()` — prostý výpis bez
 * hledání, štítků a řazení. Parametrizovaný listing i ovládání k němu existovaly,
 * ale jen jako blok do stavitele stránek, takže na `/news` se hledat nedalo.
 * Test proto mockuje ten listing (`useNewsArticlesBrowser`) a katalog štítků.
 */
vi.mock("@/hooks/useNewsArticles", () => ({
  useNewsArticlesBrowser: () => mockUseNewsArticlesBrowser(),
  useNewsTags: () => mockUseNewsTags(),
  useNewsArticleBySlug: () => mockUseNewsArticleBySlug(),
}));

vi.mock("@/hooks/useDynamicTranslations", () => ({
  useDynamicTranslationsMap: (...args: unknown[]) => mockUseDynamicTranslationsMap(...args),
}));

describe("News pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseNewsTags.mockReturnValue({ tags: [], isLoading: false });

    mockUseNewsArticlesBrowser.mockReturnValue({
      articles: [
        {
          id: "article-1",
          slug: "new-release",
          title_key: "news.new-release.title",
          excerpt_key: "news.new-release.excerpt",
          content_key: "news.new-release.content",
          image_url: null,
          published_at: "2026-02-17T12:00:00Z",
          created_at: "2026-02-17T12:00:00Z",
          sort_order: null,
          created_by: null,
          author_display_name: null,
          tags: [],
        },
      ],
      isLoading: false,
      error: null,
    });

    mockUseNewsArticleBySlug.mockReturnValue({
      article: {
        id: "article-1",
        slug: "new-release",
        title_key: "news.new-release.title",
        excerpt_key: "news.new-release.excerpt",
        content_key: "news.new-release.content",
        image_url: null,
        published_at: "2026-02-17T12:00:00Z",
      },
      isLoading: false,
      error: null,
    });

    mockUseDynamicTranslationsMap.mockImplementation((keys: string[]) =>
      Object.fromEntries(keys.map((key) => [key, `translated:${key}`]))
    );
  });

  it("renders translated title and excerpt on /news", () => {
    render(
      <MemoryRouter>
        <News />
      </MemoryRouter>
    );

    expect(screen.getByText("translated:news.new-release.title")).toBeInTheDocument();
    expect(screen.getByText("translated:news.new-release.excerpt")).toBeInTheDocument();
  });

  it("knihovna na /news nabízí hledání — ne jen výpis", () => {
    render(
      <MemoryRouter>
        <News />
      </MemoryRouter>
    );

    // Pole hledání je to, co na stránce do 2026-09-21 chybělo.
    expect(screen.getByPlaceholderText("news.searchPlaceholder")).toBeInTheDocument();
  });

  it("renders translated article content on /news/:slug", () => {
    render(
      <MemoryRouter initialEntries={["/news/new-release"]}>
        <Routes>
          <Route path="/news/:slug" element={<NewsArticleDetail />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("translated:news.new-release.title")).toBeInTheDocument();
    expect(screen.getByText("translated:news.new-release.content")).toBeInTheDocument();
  });
});
