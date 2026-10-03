import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useAdminNewsArticles } from "@/hooks/useAdminNewsArticles";

// Hoisted mocks
const hoisted = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockUseSession: vi.fn(),
  mockHasPermission: vi.fn(),
  mockGuardAdminMutation: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: hoisted.mockRpc,
  },
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => hoisted.mockUseSession(),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPermission: hoisted.mockHasPermission,
  }),
}));

vi.mock("@/hooks/useAdminGuard", () => ({
  useAdminGuard: () => ({
    guardAdminMutation: hoisted.mockGuardAdminMutation,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
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

const mockAdminArticles = [
  {
    id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    slug: "mobile-app-beta-testing",
    title_key: "news.mobile-app-beta.title",
    content_key: "news.mobile-app-beta.content",
    excerpt_key: "news.mobile-app-beta.excerpt",
    image_url: null,
    is_published: true,
    published_at: "2026-02-17T15:00:00Z",
    sort_order: 0,
    created_by: "f0e1d2c3-b4a5-4697-8899-aabbccddeeff",
    created_at: "2026-02-17T14:00:00Z",
    updated_at: "2026-02-17T15:00:00Z",
    title: "Mobile app beta",
    excerpt: null,
    tags: ["home"],
    has_draft: false,
    edit_stamp: "2026-02-17T15:00:00Z",
    image_focus_x: 0.5,
    image_focus_y: 0.5,
    image_zoom: 1,
  },
];

describe("useAdminNewsArticles", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    hoisted.mockUseSession.mockReturnValue({
      user: { id: "f0e1d2c3-b4a5-4697-8899-aabbccddeeff" },
      session: { access_token: "token" },
      isLoading: false,
    });
    hoisted.mockHasPermission.mockReturnValue(true);

    // guardAdminMutation passes through the callback
    hoisted.mockGuardAdminMutation.mockImplementation(
      (_name: string, fn: (...args: unknown[]) => unknown) => fn
    );

    hoisted.mockRpc.mockResolvedValue({
      data: mockAdminArticles,
      error: null,
    });
  });

  it("should fetch admin news articles via RPC", async () => {
    const { result } = renderHook(() => useAdminNewsArticles(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Titulek v jazyce rozhraní — locale se posílá vždy.
    expect(hoisted.mockRpc).toHaveBeenCalledWith("get_news_articles_admin", { p_locale: "en" });
    expect(result.current.articles).toHaveLength(1);
    expect(result.current.articles?.[0].title).toBe("Mobile app beta");
    expect(result.current.articles?.[0].slug).toBe("mobile-app-beta-testing");
    expect(result.current.articles?.[0].is_published).toBe(true);
  });

  it("should not fetch when user has no admin permission", async () => {
    hoisted.mockHasPermission.mockReturnValue(false);

    const { result } = renderHook(() => useAdminNewsArticles(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // RPC should not have been called with the admin function
    const adminCalls = hoisted.mockRpc.mock.calls.filter(
      (call: unknown[]) => call[0] === "get_news_articles_admin"
    );
    expect(adminCalls).toHaveLength(0);
  });

  it("should not fetch when session is loading", async () => {
    hoisted.mockUseSession.mockReturnValue({
      user: null,
      session: null,
      isLoading: true,
    });

    const { result } = renderHook(() => useAdminNewsArticles(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
  });

  it("should handle RPC error on fetch", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Access denied" },
    });

    const { result } = renderHook(() => useAdminNewsArticles(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it("should call create RPC with correct parameters", async () => {
    hoisted.mockRpc
      .mockResolvedValueOnce({ data: mockAdminArticles, error: null }) // fetch
      .mockResolvedValueOnce({ data: "new-id-123", error: null }); // create

    const { result } = renderHook(() => useAdminNewsArticles(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      result.current.createArticle({
        content_key: "news.test.content",
        title_key: "news.test.title",
        slug: "test-article",
        is_published: false,
        sort_order: 1,
      });
    });

    expect(hoisted.mockRpc).toHaveBeenCalledWith(
      "create_news_article_admin",
      expect.objectContaining({
        p_content_key: "news.test.content",
        p_title_key: "news.test.title",
        p_slug: "test-article",
        p_is_published: false,
        p_sort_order: 1,
      })
    );
  });

  it("should call update RPC with correct parameters", async () => {
    hoisted.mockRpc
      .mockResolvedValueOnce({ data: mockAdminArticles, error: null }) // fetch
      .mockResolvedValueOnce({ data: null, error: null }); // update

    const { result } = renderHook(() => useAdminNewsArticles(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      result.current.updateArticle({
        id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
        data: { is_published: true, slug: "updated-slug" },
      });
    });

    expect(hoisted.mockRpc).toHaveBeenCalledWith(
      "update_news_article_admin",
      expect.objectContaining({
        p_id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
        p_is_published: true,
        p_slug: "updated-slug",
      })
    );
  });

  it("saveDraftAsync sends content to save_news_article_draft_admin with the stamp and returns the new one", async () => {
    hoisted.mockRpc
      .mockResolvedValueOnce({ data: mockAdminArticles, error: null }) // fetch
      .mockResolvedValueOnce({ data: "2026-09-24T10:00:00Z", error: null }); // draft

    const { result } = renderHook(() => useAdminNewsArticles(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let stamp = "";
    await act(async () => {
      stamp = await result.current.saveDraftAsync({
        id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
        expectedStamp: "2026-02-17T15:00:00Z",
        fields: { tags: ["a"], texts: { cs: { title: "Ahoj" } } },
      });
    });
    expect(stamp).toBe("2026-09-24T10:00:00Z");
    expect(hoisted.mockRpc).toHaveBeenCalledWith("save_news_article_draft_admin", {
      p_article_id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      p_canvas_css: undefined,
      p_canvas_data: undefined,
      p_canvas_html: undefined,
      p_expected_stamp: "2026-02-17T15:00:00Z",
      p_fields: { tags: ["a"], texts: { cs: { title: "Ahoj" } } },
    });
  });

  it("a 409 from the server surfaces as a conflict error, not a generic failure", async () => {
    hoisted.mockRpc
      .mockResolvedValueOnce({ data: mockAdminArticles, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "Article changed since it was loaded", code: "PT409", status: 409 } });

    const { result } = renderHook(() => useAdminNewsArticles(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let chyba: unknown;
    await act(async () => {
      try {
        await result.current.publishAsync({ id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", expectedStamp: "x" });
      } catch (e) {
        chyba = e;
      }
    });
    expect((chyba as { status?: number }).status).toBe(409);
    expect((chyba as { code?: string }).code).toBe("PT409");
  });

  it("should call delete RPC with article id", async () => {
    hoisted.mockRpc
      .mockResolvedValueOnce({ data: mockAdminArticles, error: null }) // fetch
      .mockResolvedValueOnce({ data: null, error: null }); // delete

    const { result } = renderHook(() => useAdminNewsArticles(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      result.current.deleteArticle("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d");
    });

    expect(hoisted.mockRpc).toHaveBeenCalledWith("delete_news_article_admin", {
      p_id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    });
  });
});
