import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useNewsArticles, useNewsArticleBySlug } from "@/hooks/useNewsArticles";

// Hoisted mock for aisha.rpc
const { mockRpc } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: mockRpc,
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const mockArticles = [
  {
    id: "a0a0a0a0-b1b1-c2c2-d3d3-e4e4e4e4e4e4",
    slug: "mobile-app-beta-testing",
    title_key: "news.mobile-app-beta.title",
    content_key: "news.mobile-app-beta.content",
    excerpt_key: "news.mobile-app-beta.excerpt",
    image_url: null,
    canvas_html: null,
    canvas_css: null,
    published_at: "2026-02-17T15:00:00Z",
    sort_order: 0,
  },
  {
    id: "b1b1b1b1-c2c2-d3d3-e4e4-f5f5f5f5f5f5",
    slug: "another-article",
    title_key: "news.another.title",
    content_key: "news.another.content",
    excerpt_key: null,
    image_url: "https://example.com/img.jpg",
    published_at: "2026-02-16T10:00:00Z",
    sort_order: 1,
  },
];

describe("useNewsArticles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: mockArticles, error: null });
  });

  it("should fetch published news articles via RPC", async () => {
    const { result } = renderHook(() => useNewsArticles(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockRpc).toHaveBeenCalledWith("get_published_news_articles", {
      p_limit: 20,
      p_offset: 0,
    });
    expect(result.current.articles).toHaveLength(2);
    expect(result.current.articles?.[0].slug).toBe("mobile-app-beta-testing");
  });

  it("should pass custom limit and offset", async () => {
    const { result } = renderHook(() => useNewsArticles(5, 10), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockRpc).toHaveBeenCalledWith("get_published_news_articles", {
      p_limit: 5,
      p_offset: 10,
    });
  });

  it("should handle empty response", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useNewsArticles(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.articles).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("should handle RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Database error" },
    });

    const { result } = renderHook(() => useNewsArticles(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });

    expect(result.current.articles).toBeUndefined();
  });

  it("should validate response schema (reject invalid data)", async () => {
    mockRpc.mockResolvedValue({
      data: [{ invalid: "schema" }],
      error: null,
    });

    const { result } = renderHook(() => useNewsArticles(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // parseRpcArrayResponse throws on invalid data, causing query error
    expect(result.current.error).toBeTruthy();
    expect(result.current.articles).toBeUndefined();
  });
});

describe("useNewsArticleBySlug", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: [mockArticles[0]], error: null });
  });

  it("should fetch a single article by slug", async () => {
    const { result } = renderHook(
      () => useNewsArticleBySlug("mobile-app-beta-testing"),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockRpc).toHaveBeenCalledWith("get_news_article_by_slug", {
      p_slug: "mobile-app-beta-testing",
    });
    expect(result.current.article?.id).toBe("a0a0a0a0-b1b1-c2c2-d3d3-e4e4e4e4e4e4");
    expect(result.current.article?.slug).toBe("mobile-app-beta-testing");
  });

  it("should return null for non-existent slug", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(
      () => useNewsArticleBySlug("non-existent"),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.article).toBeNull();
  });

  it("should not fetch when slug is empty", async () => {
    const { result } = renderHook(
      () => useNewsArticleBySlug(""),
      { wrapper: createWrapper() }
    );

    // Should stay in loading/disabled state, not fire RPC
    expect(mockRpc).not.toHaveBeenCalled();
    expect(result.current.article).toBeUndefined();
  });

  it("should handle RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Not found" },
    });

    const { result } = renderHook(
      () => useNewsArticleBySlug("broken-slug"),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });
  });
});
