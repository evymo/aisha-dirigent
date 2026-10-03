/**
 * Tests for src/hooks/useAdminWebPages.ts
 *
 * Covers all 5 exports:
 *   - useAdminWebPages       (query — list)
 *   - useAdminWebPage        (query — single by id, returns first row)
 *   - useUpsertWebPage       (mutation — returns new/existing page id)
 *   - useUpdateWebPageCanvas (mutation — GrapeJS save; invalidates 3 keys)
 *   - useDeleteWebPage       (mutation — soft delete)
 *
 * Notes:
 *   - Validation uses `parseRpcArray` which is *per-item* soft-fail — bad
 *     rows are skipped (logged via safeWarn), valid rows pass through. We
 *     exercise that with a mixed-batch fixture.
 *   - The single-detail hook uses the same array parser and grabs the
 *     first row → covers the empty-array branch returning `null`.
 *   - Cache invalidation: we spy on `QueryClient.invalidateQueries` to
 *     verify the canvas-save touches all 3 keys the UI depends on.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useAdminWebPages,
  useAdminWebPage,
  useUpsertWebPage,
  useUpdateWebPageCanvas,
  useDeleteWebPage,
} from "@/hooks/useAdminWebPages";
import type { WebPageAdminDetail } from "@/lib/schemas/webPageSchemas";

const { mockRpc, mockUser } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockUser: { id: "admin-id" },
}));

vi.mock("@/integrations/db/client", () => ({
  aisha: { rpc: mockRpc },
}));
vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({ user: mockUser }),
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

const UUID_PAGE = "60000000-0000-4000-a000-000000000001";
const UUID_PAGE_2 = "60000000-0000-4000-a000-000000000002";

const mockListRow = {
  id: UUID_PAGE,
  slug: "/about",
  title_key: "pages.about.title",
  description_key: "pages.about.description",
  og_image_url: null,
  sort_order: 10,
  status: "published",
  is_active: true,
  created_at: "2026-03-01T00:00:00Z",
  updated_at: "2026-03-01T01:00:00Z",
};

const mockDetailRow = {
  ...mockListRow,
  canvas_html: "<section>hi</section>",
  canvas_css: ".x{color:red}",
  canvas_data: { components: [] },
  page_settings: { theme: "default" },
};

// ── useAdminWebPages ───────────────────────────────────────────

describe("useAdminWebPages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls get_web_pages_admin and exposes the list as .pages", async () => {
    mockRpc.mockResolvedValue({ data: [mockListRow], error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAdminWebPages(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith("get_web_pages_admin", { p_branding_profile_id: undefined });
    expect(result.current.pages).toHaveLength(1);
    expect(result.current.pages[0].id).toBe(UUID_PAGE);
  });

  it("per-item soft-fails — invalid rows are skipped, valid rows pass through", async () => {
    // Two rows, one with an id that isn't a UUID → that row is dropped,
    // the other is returned.
    mockRpc.mockResolvedValue({
      data: [
        { ...mockListRow, id: "not-a-uuid-at-all" },
        { ...mockListRow, id: UUID_PAGE_2 },
      ],
      error: null,
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAdminWebPages(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.pages).toHaveLength(1);
    expect(result.current.pages[0].id).toBe(UUID_PAGE_2);
  });

  it("returns empty .pages when the RPC returns no array (defensive default)", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAdminWebPages(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.pages).toEqual([]);
  });

  it("throws on RPC error so the UI can surface it", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied for function" },
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAdminWebPages(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("permission denied for function");
  });
});

// ── useAdminWebPage ────────────────────────────────────────────

describe("useAdminWebPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls get_web_page_admin with p_id and returns the first row", async () => {
    mockRpc.mockResolvedValue({ data: [mockDetailRow], error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAdminWebPage(UUID_PAGE), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith("get_web_page_admin", {
      p_id: UUID_PAGE,
    });
    const detail = result.current.data as unknown as WebPageAdminDetail | null;
    expect(detail?.id).toBe(UUID_PAGE);
    expect(detail?.canvas_html).toBe("<section>hi</section>");
  });

  it("returns null when no row matches (RPC returns [])", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAdminWebPage(UUID_PAGE), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("does not call RPC when id is undefined (disabled)", async () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAdminWebPage(undefined), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "function get_web_page_admin does not exist" },
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAdminWebPage(UUID_PAGE), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain("get_web_page_admin");
  });
});

// ── useUpsertWebPage ───────────────────────────────────────────

describe("useUpsertWebPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls upsert_web_page_admin with full param set + sane defaults", async () => {
    mockRpc.mockResolvedValue({ data: UUID_PAGE, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpsertWebPage(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        slug: "/contact",
        title_key: "pages.contact.title",
      });
    });

    expect(mockRpc).toHaveBeenCalledWith("upsert_web_page_admin", {
      p_branding_profile_id: undefined,
      p_description_key: undefined,
      p_id: undefined,
      p_og_image_url: undefined,
      p_slug: "/contact",
      p_sort_order: 0,
      p_status: "draft",
      p_title_key: "pages.contact.title",
    });
  });

  it("returns the page id as a string for the caller", async () => {
    mockRpc.mockResolvedValue({ data: UUID_PAGE, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpsertWebPage(), { wrapper: Wrapper });

    let id: string | undefined;
    await act(async () => {
      id = await result.current.mutateAsync({ slug: "/x", title_key: "x.t" });
    });
    expect(id).toBe(UUID_PAGE);
  });

  it("invalidates the admin-web-pages cache key on success", async () => {
    mockRpc.mockResolvedValue({ data: UUID_PAGE, error: null });
    const { Wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpsertWebPage(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ slug: "/a", title_key: "a.t" });
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin-web-pages"] });
  });

  it("propagates RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "duplicate slug" },
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpsertWebPage(), { wrapper: Wrapper });
    await expect(
      act(async () => {
        await result.current.mutateAsync({ slug: "/dupe", title_key: "x.t" });
      }),
    ).rejects.toThrow("duplicate slug");
  });
});

// ── useUpdateWebPageCanvas ─────────────────────────────────────

describe("useUpdateWebPageCanvas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls update_web_page_canvas_admin with p_publish=false by default", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateWebPageCanvas(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({
        id: UUID_PAGE,
        canvas_html: "<section/>",
        canvas_css: ".x{}",
        canvas_data: { components: [] },
      });
    });

    expect(mockRpc).toHaveBeenCalledWith("update_web_page_canvas_admin", {
      p_canvas_css: ".x{}",
      p_canvas_data: { components: [] },
      p_canvas_html: "<section/>",
      p_id: UUID_PAGE,
      p_page_settings: undefined,
      p_publish: false,
    });
  });

  it("invalidates all 3 cache keys on success (detail, list, public)", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { Wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateWebPageCanvas(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({ id: UUID_PAGE, publish: true });
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin-web-page", UUID_PAGE] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin-web-pages"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["web-page"] });
  });

  it("propagates RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "page locked by another editor" },
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateWebPageCanvas(), {
      wrapper: Wrapper,
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync({ id: UUID_PAGE });
      }),
    ).rejects.toThrow("page locked");
  });
});

// ── useDeleteWebPage ───────────────────────────────────────────

describe("useDeleteWebPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls delete_web_page_admin with p_id", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteWebPage(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync(UUID_PAGE);
    });

    expect(mockRpc).toHaveBeenCalledWith("delete_web_page_admin", {
      p_id: UUID_PAGE,
    });
  });

  it("invalidates the admin-web-pages cache on success", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { Wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useDeleteWebPage(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync(UUID_PAGE);
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin-web-pages"] });
  });

  it("propagates RPC error (e.g. FK violation from pages-with-references)", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "FK violation: page referenced by menu items" },
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteWebPage(), { wrapper: Wrapper });
    await expect(
      act(async () => {
        await result.current.mutateAsync(UUID_PAGE);
      }),
    ).rejects.toThrow("FK violation");
  });
});
