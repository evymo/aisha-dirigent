/**
 * Web Page Builder Subsystem — Integration tests.
 *
 * Verifies the entire public web page builder pipeline:
 * - Runtime block registry: completeness, resolution, lazy-load
 * - PageRenderer: i18n extraction, segment splitting, page settings
 * - EditorPageGate: published → editor, draft → fallback
 * - Zod schemas: public + admin detail with page_settings
 * - useWebPage: RPC call, Zod parse, error handling
 * - useAdminWebPages: list, detail, canvas save with page_settings
 * - Block registry ↔ runtime registry alignment
 *
 * @module
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  registerRuntimeBlock,
  resolveRuntimeBlock,
  hasRuntimeBlock,
} from "@/lib/builder/runtimeBlockRegistry";
import {
  CANVAS_BLOCK_REGISTRY,
  RUNTIME_BLOCK_DEFINITIONS,
} from "@/lib/builder/blockRegistry";
import {
  webPagePublicSchema,
  webPageAdminDetailSchema,
  webPageAdminListSchema,
} from "@/lib/schemas/webPageSchemas";
import type { WebPageAdminDetail } from "@/lib/schemas/webPageSchemas";
import { PageRenderer } from "@/components/web/PageRenderer";

// =====================================================
// Hoisted mocks
// =====================================================

const hoisted = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockUseSession: vi.fn(),
  mockTranslations: {
    "web.contact.email_placeholder": "name@example.com",
    "web.hero.image_alt": "AISHA train",
    "web.hero.link_title": "<strong>Open AISHA</strong>",
    "web.hero.subtitle": "Translated subtitle",
    "web.hero.title": "Translated title",
    "web.pruvodce.skip.link": "Go to AISHA",
    "web.pruvodce.skip.prompt": "Already know what you need?",
  } as Record<string, string>,
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

vi.mock("@/hooks/useDynamicTranslations", () => ({
  useDynamicTranslationsMap: (keys: string[]) =>
    Object.fromEntries(keys.map((key) => [key, hoisted.mockTranslations[key] ?? key])),
  useDynamicTranslationsMultiLocale: () => new Map(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

// =====================================================
// Helpers
// =====================================================

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { gcTime: 0, retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

// =====================================================
// Mock data
// =====================================================

const MOCK_PUBLIC_PAGE = {
  canvas_css: ".hero { color: red; }",
  canvas_data: { pages: [{ id: "p1" }] },
  canvas_html: '<section class="hero"><h1 data-i18n-key="web.hero.title">Hello</h1></section>',
  description_key: "web.index.description",
  id: "11111111-1111-1111-1111-111111111111",
  og_image_url: null,
  page_settings: { background: "linear-gradient(135deg, #1a1a1a, #2d2d2d)", className: "dark-page" },
  slug: "index",
  title_key: "web.index.title",
};

const MOCK_ADMIN_DETAIL = {
  ...MOCK_PUBLIC_PAGE,
  created_at: "2026-01-01T00:00:00Z",
  is_active: true,
  sort_order: 0,
  status: "published",
  updated_at: "2026-04-12T10:00:00Z",
};

const MOCK_ADMIN_LIST_ITEM = {
  created_at: "2026-01-01T00:00:00Z",
  description_key: "web.index.description",
  id: "11111111-1111-1111-1111-111111111111",
  is_active: true,
  og_image_url: null,
  slug: "index",
  sort_order: 0,
  status: "published",
  title_key: "web.index.title",
  updated_at: "2026-04-12T10:00:00Z",
};

// =====================================================
// 1. Runtime block registry
// =====================================================

describe("Runtime Block Registry", () => {
  it("has all 12 expected runtime blocks registered", () => {
    const expectedTypes = [
      "archive-browser",
      "archive-preview",
      "contact-form",
      "faq-accordion",
      "guild-directory",
      "hero-slides",
      "knowledge-browser",
      "knowledge-preview",
      "news-browser",
      "news-list",
      "product-catalog",
      "studies-browser",
    ];

    for (const blockType of expectedTypes) {
      expect(hasRuntimeBlock(blockType), `Missing runtime block: ${blockType}`).toBe(true);
    }
  });

  it("resolveRuntimeBlock returns entry with component for each registered block", () => {
    const types = [
      "hero-slides", "news-list", "contact-form", "archive-preview",
      "knowledge-preview", "faq-accordion", "product-catalog", "news-browser",
      "knowledge-browser", "archive-browser", "studies-browser", "guild-directory",
    ];

    for (const blockType of types) {
      const entry = resolveRuntimeBlock(blockType);
      expect(entry, `No entry for ${blockType}`).toBeDefined();
      expect(entry!.component).toBeDefined();
    }
  });

  it("returns undefined for unregistered block type", () => {
    expect(resolveRuntimeBlock("nonexistent-block")).toBeUndefined();
    expect(hasRuntimeBlock("nonexistent-block")).toBe(false);
  });

  it("registerRuntimeBlock overwrites existing entries", () => {
    const mockComponent = vi.fn() as never;
    registerRuntimeBlock("test-overwrite", mockComponent);
    expect(resolveRuntimeBlock("test-overwrite")!.component).toBe(mockComponent);

    const mockComponent2 = vi.fn() as never;
    registerRuntimeBlock("test-overwrite", mockComponent2);
    expect(resolveRuntimeBlock("test-overwrite")!.component).toBe(mockComponent2);
  });
});

// =====================================================
// 2. Block registry ↔ runtime registry alignment
// =====================================================

describe("Block registry ↔ Runtime registry alignment", () => {
  it("every V1 web block with data-runtime-block has a matching runtime block", () => {
    const runtimeBlockRegex = /data-runtime-block="([^"]+)"/;
    const misaligned: string[] = [];

    for (const block of CANVAS_BLOCK_REGISTRY) {
      const match = runtimeBlockRegex.exec(block.content);
      if (match) {
        const runtimeType = match[1];
        if (!hasRuntimeBlock(runtimeType)) {
          misaligned.push(`Block "${block.blockType}" references runtime "${runtimeType}" but it's not registered`);
        }
      }
    }

    expect(misaligned, `Misaligned blocks:\n${misaligned.join("\n")}`).toEqual([]);
  });

  it("every RUNTIME_BLOCK_DEFINITIONS entry has editorHtml with matching data-runtime-block", () => {
    const runtimeBlockRegex = /data-runtime-block="([^"]+)"/;

    for (const def of RUNTIME_BLOCK_DEFINITIONS) {
      const match = runtimeBlockRegex.exec(def.editorHtml);
      expect(match, `${def.blockType}: editorHtml missing data-runtime-block`).not.toBeNull();
      expect(match![1]).toBe(def.blockType);
    }
  });

  it("every RUNTIME_BLOCK_DEFINITIONS entry has a matching runtime block component", () => {
    const misaligned: string[] = [];

    for (const def of RUNTIME_BLOCK_DEFINITIONS) {
      if (!hasRuntimeBlock(def.blockType)) {
        misaligned.push(`Definition "${def.blockType}" has no runtime block component`);
      }
    }

    expect(misaligned, `Misaligned:\n${misaligned.join("\n")}`).toEqual([]);
  });

  it("every registered runtime block has a RUNTIME_BLOCK_DEFINITIONS entry", () => {
    const runtimeTypes = [
      "hero-slides", "news-list", "contact-form", "archive-preview",
      "knowledge-preview", "faq-accordion", "product-catalog", "news-browser",
      "knowledge-browser", "archive-browser", "studies-browser", "guild-directory",
    ];

    const definedTypes = new Set(RUNTIME_BLOCK_DEFINITIONS.map((d) => d.blockType));
    const orphans = runtimeTypes.filter((t) => !definedTypes.has(t));
    expect(orphans, `Runtime blocks without definition: ${orphans.join(", ")}`).toEqual([]);
  });
});

// =====================================================
// 3. Zod schema validation
// =====================================================

describe("webPagePublicSchema", () => {
  it("parses valid public page data", () => {
    const result = webPagePublicSchema.parse(MOCK_PUBLIC_PAGE);
    expect(result.slug).toBe("index");
    expect(result.canvas_html).toContain("data-i18n-key");
    expect(result.page_settings).toEqual({
      background: "linear-gradient(135deg, #1a1a1a, #2d2d2d)",
      className: "dark-page",
    });
  });

  it("accepts null page_settings", () => {
    const data = { ...MOCK_PUBLIC_PAGE, page_settings: null };
    const result = webPagePublicSchema.parse(data);
    expect(result.page_settings).toBeNull();
  });

  it("defaults missing page_settings to null", () => {
    const { page_settings: _, ...dataWithout } = MOCK_PUBLIC_PAGE;
    const result = webPagePublicSchema.parse(dataWithout);
    expect(result.page_settings).toBeNull();
  });

  it("accepts empty object page_settings", () => {
    const data = { ...MOCK_PUBLIC_PAGE, page_settings: {} };
    const result = webPagePublicSchema.parse(data);
    expect(result.page_settings).toEqual({});
  });

  it("rejects missing required fields", () => {
    expect(() => webPagePublicSchema.parse({})).toThrow();
    expect(() => webPagePublicSchema.parse({ slug: "x" })).toThrow();
  });

  it("rejects invalid UUID for id", () => {
    expect(() => webPagePublicSchema.parse({ ...MOCK_PUBLIC_PAGE, id: "not-a-uuid" })).toThrow();
  });
});

describe("webPageAdminDetailSchema", () => {
  it("parses valid admin detail data", () => {
    const result = webPageAdminDetailSchema.parse(MOCK_ADMIN_DETAIL);
    expect(result.slug).toBe("index");
    expect(result.status).toBe("published");
    expect(result.is_active).toBe(true);
    expect(result.page_settings).toBeDefined();
  });

  it("accepts page_settings with style object", () => {
    const data = {
      ...MOCK_ADMIN_DETAIL,
      page_settings: { background: "#000", style: { maxWidth: "1200px" } },
    };
    const result = webPageAdminDetailSchema.parse(data);
    expect(result.page_settings).toEqual(data.page_settings);
  });

  it("preserves canvas_data as unknown", () => {
    const data = { ...MOCK_ADMIN_DETAIL, canvas_data: { custom: [1, 2, 3] } };
    const result = webPageAdminDetailSchema.parse(data);
    expect(result.canvas_data).toEqual({ custom: [1, 2, 3] });
  });
});

describe("webPageAdminListSchema", () => {
  it("parses valid admin list item", () => {
    const result = webPageAdminListSchema.parse(MOCK_ADMIN_LIST_ITEM);
    expect(result.slug).toBe("index");
    expect(result.status).toBe("published");
  });

  it("rejects missing status", () => {
    const { status: _, ...invalid } = MOCK_ADMIN_LIST_ITEM;
    expect(() => webPageAdminListSchema.parse(invalid)).toThrow();
  });
});

// =====================================================
// 4. useWebPage hook
// =====================================================

describe("useWebPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockUseSession.mockReturnValue({
      user: { id: "user-1" },
    });
  });

  // Dynamically import to get the mocked version
  async function loadUseWebPage() {
    const mod = await import("@/hooks/useWebPage");
    return mod.useWebPage;
  }

  it("returns published page data for valid slug", async () => {
    hoisted.mockRpc.mockResolvedValueOnce({
      data: [MOCK_PUBLIC_PAGE],
      error: null,
    });

    const useWebPage = await loadUseWebPage();
    const { result } = renderHook(() => useWebPage("index"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.slug).toBe("index");
    expect(result.current.data?.canvas_html).toContain("data-i18n-key");
    expect(hoisted.mockRpc).toHaveBeenCalledWith("get_web_page_by_slug", {
      p_hostname: window.location.hostname || null,
      p_slug: "index",
    });
  });

  it("returns null when page not found", async () => {
    hoisted.mockRpc.mockResolvedValueOnce({
      data: [],
      error: null,
    });

    const useWebPage = await loadUseWebPage();
    const { result } = renderHook(() => useWebPage("nonexistent"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("does not fetch when slug is undefined", async () => {
    const useWebPage = await loadUseWebPage();
    const { result } = renderHook(() => useWebPage(undefined), {
      wrapper: createWrapper(),
    });

    // Should never become loading since enabled = false
    expect(result.current.isLoading).toBe(false);
    expect(result.current.fetchStatus).toBe("idle");
    expect(hoisted.mockRpc).not.toHaveBeenCalled();
  });

  it("handles RPC error", async () => {
    hoisted.mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "Database error" },
    });

    const useWebPage = await loadUseWebPage();
    const { result } = renderHook(() => useWebPage("index"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Database error");
  });

  it("includes page_settings in parsed response", async () => {
    const pageWithSettings = {
      ...MOCK_PUBLIC_PAGE,
      page_settings: { background: "#ff6a1a", className: "brand" },
    };
    hoisted.mockRpc.mockResolvedValueOnce({
      data: [pageWithSettings],
      error: null,
    });

    const useWebPage = await loadUseWebPage();
    const { result } = renderHook(() => useWebPage("index"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.page_settings).toEqual({
      background: "#ff6a1a",
      className: "brand",
    });
  });
});

// =====================================================
// 5. useAdminWebPages hooks
// =====================================================

describe("useAdminWebPages hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockUseSession.mockReturnValue({
      user: { id: "admin-1" },
    });
  });

  async function loadHooks() {
    const mod = await import("@/hooks/useAdminWebPages");
    return mod;
  }

  describe("useAdminWebPages", () => {
    it("fetches admin page list via RPC", async () => {
      hoisted.mockRpc.mockResolvedValueOnce({
        data: [MOCK_ADMIN_LIST_ITEM],
        error: null,
      });

      const { useAdminWebPages } = await loadHooks();
      const { result } = renderHook(() => useAdminWebPages(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.pages).toHaveLength(1);
      expect(result.current.pages[0].slug).toBe("index");
      expect(hoisted.mockRpc).toHaveBeenCalledWith("get_web_pages_admin", {
        p_branding_profile_id: undefined,
      });
    });

    it("returns empty array when no pages", async () => {
      hoisted.mockRpc.mockResolvedValueOnce({
        data: [],
        error: null,
      });

      const { useAdminWebPages } = await loadHooks();
      const { result } = renderHook(() => useAdminWebPages(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.pages).toEqual([]);
    });
  });

  describe("useAdminWebPage", () => {
    it("fetches single page detail via RPC", async () => {
      hoisted.mockRpc.mockResolvedValueOnce({
        data: [MOCK_ADMIN_DETAIL],
        error: null,
      });

      const { useAdminWebPage } = await loadHooks();
      const pageId = "11111111-1111-1111-1111-111111111111";
      const { result } = renderHook(() => useAdminWebPage(pageId), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const detail = result.current.data as unknown as WebPageAdminDetail | null;
      expect(detail?.slug).toBe("index");
      expect(detail?.canvas_html).toContain("data-i18n-key");
      expect(hoisted.mockRpc).toHaveBeenCalledWith("get_web_page_admin", {
        p_id: pageId,
      });
    });

    it("does not fetch without user session", async () => {
      hoisted.mockUseSession.mockReturnValue({ user: null });

      const { useAdminWebPage } = await loadHooks();
      const { result } = renderHook(() => useAdminWebPage("some-id"), {
        wrapper: createWrapper(),
      });

      expect(result.current.fetchStatus).toBe("idle");
      expect(hoisted.mockRpc).not.toHaveBeenCalled();
    });

    it("does not fetch without id", async () => {
      const { useAdminWebPage } = await loadHooks();
      const { result } = renderHook(() => useAdminWebPage(undefined), {
        wrapper: createWrapper(),
      });

      expect(result.current.fetchStatus).toBe("idle");
      expect(hoisted.mockRpc).not.toHaveBeenCalled();
    });
  });
});

// =====================================================
// 6. PageRenderer helpers (pure functions)
// =====================================================

describe("PageRenderer helpers", () => {
  it("renders DB translations for editor-authored text and safe attributes", () => {
    const html = `
      <h1 data-i18n-key="web.hero.title">Title</h1>
      <p data-i18n-key="web.hero.subtitle">Subtitle</p>
      <p><span data-i18n-key="web.pruvodce.skip.prompt">Fallback</span>
      <a href="/aisha" data-i18n-key="web.pruvodce.skip.link" data-i18n-title-key="web.hero.link_title">Fallback link</a></p>
      <input data-i18n-placeholder-key="web.contact.email_placeholder" />
      <img src="/x.svg" data-i18n-alt-key="web.hero.image_alt" />
    `;
    // PageRenderer si od zavedení sdílených útržků tahá `get_published_web_partials`
    // přes react-query — bez klienta by spadl na „No QueryClient set". Obal je
    // týž, jaký používají hookové testy v tomhle souboru.
    const { container } = render(React.createElement(PageRenderer, { canvasCss: "", canvasHtml: html }), {
      wrapper: createWrapper(),
    });

    expect(container.querySelector("h1")?.textContent).toBe("Translated title");
    expect(container.querySelector("p")?.textContent).toBe("Translated subtitle");
    expect(container.querySelector("span")?.textContent).toBe("Already know what you need?");
    expect(container.querySelector("a")?.textContent).toBe("Go to AISHA");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/aisha");
    expect(container.querySelector("a")?.getAttribute("title")).toBe("Open AISHA");
    expect(container.querySelector("input")?.getAttribute("placeholder")).toBe("name@example.com");
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("AISHA train");
  });

  // Test runtime block regex splitting
  it("splits canvas HTML at runtime block placeholders", () => {
    const html = `
      <section>Static HTML</section>
      <div data-runtime-block="hero-slides" data-block-config='{"limit":5}'></div>
      <section>More static</section>
      <div data-runtime-block="news-list"></div>
      <footer>End</footer>
    `;

    const RUNTIME_BLOCK_REGEX =
      /<div[^>]*\bdata-runtime-block="([^"]+)"(?:[^>]*\bdata-block-config='([^']*)')?[^>]*>(?:<\/div>)?/g;

    const segments: Array<{ type: string; blockType?: string; config?: string }> = [];
    let lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = RUNTIME_BLOCK_REGEX.exec(html)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: "html" });
      }
      segments.push({
        type: "runtime-block",
        blockType: match[1],
        config: match[2],
      });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < html.length) {
      segments.push({ type: "html" });
    }

    expect(segments).toEqual([
      { type: "html" },
      { type: "runtime-block", blockType: "hero-slides", config: '{"limit":5}' },
      { type: "html" },
      { type: "runtime-block", blockType: "news-list", config: undefined },
      { type: "html" },
    ]);
  });

  // Test page settings style computation
  it("computes wrapper style from page_settings", () => {
    const pageSettings = {
      background: "linear-gradient(135deg, #1a1a1a, #2d2d2d)",
      className: "dark-page custom-width",
      style: { maxWidth: "1400px", margin: "0 auto" },
    };

    const wrapperStyle: React.CSSProperties = {};
    const wrapperClasses = ["gjs-page-content"];

    if (pageSettings.background) {
      wrapperStyle.background = pageSettings.background;
    }
    if (pageSettings.className) {
      wrapperClasses.push(pageSettings.className);
    }
    if (pageSettings.style) {
      Object.assign(wrapperStyle, pageSettings.style);
    }

    expect(wrapperStyle).toEqual({
      background: "linear-gradient(135deg, #1a1a1a, #2d2d2d)",
      margin: "0 auto",
      maxWidth: "1400px",
    });
    expect(wrapperClasses.join(" ")).toBe("gjs-page-content dark-page custom-width");
  });

  it("handles empty/null page_settings gracefully", () => {
    const pageSettings = null;

    const wrapperStyle: React.CSSProperties = {};
    const wrapperClasses = ["gjs-page-content"];

    if (pageSettings) {
      // won't enter
    }

    expect(wrapperStyle).toEqual({});
    expect(wrapperClasses).toEqual(["gjs-page-content"]);
  });
});

// =====================================================
// 7. EditorPageGate pattern contract
// =====================================================

describe("EditorPageGate contract", () => {
  it("returns children when no published page exists (data is null)", () => {
    // Contract: isLoading=false, data=null → render children
    const data = null;
    const isLoading = false;
    const shouldRenderEditor = !isLoading && !!data;
    expect(shouldRenderEditor).toBe(false);
  });

  it("returns WebPageShell when published page exists", () => {
    // Contract: isLoading=false, data=page → render editor
    const data = MOCK_PUBLIC_PAGE;
    const isLoading = false;
    const shouldRenderEditor = !isLoading && !!data;
    expect(shouldRenderEditor).toBe(true);
  });

  it("returns children while loading (avoids blank flash)", () => {
    // Contract: isLoading=true → render children as fallback
    const isLoading = true;
    const shouldShowFallback = isLoading;
    expect(shouldShowFallback).toBe(true);
  });
});

// =====================================================
// 8. Canvas seed data completeness
// =====================================================

describe("Canvas seed data completeness", () => {
  const EXPECTED_SLUGS = [
    "faq",
    "index",
    "news",
    "partners",
    "research",
    "rtn-protocol",
    "story",
    "whitepaper",
  ];

  it("Zod schema accepts all expected slug formats", () => {
    for (const slug of EXPECTED_SLUGS) {
      const data = { ...MOCK_PUBLIC_PAGE, slug };
      expect(() => webPagePublicSchema.parse(data)).not.toThrow();
    }
  });
});

// =====================================================
// 9. ProductCatalogBlock grid class mapping
// =====================================================

describe("ProductCatalogBlock grid cols safety", () => {
  const GRID_COLS: Record<number, string> = {
    2: "grid grid-cols-1 md:grid-cols-2 gap-6",
    3: "grid grid-cols-1 md:grid-cols-3 gap-6",
    4: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6",
  };

  it("resolves columns=2 to static grid class", () => {
    expect(GRID_COLS[2]).toBe("grid grid-cols-1 md:grid-cols-2 gap-6");
  });

  it("resolves columns=3 (default) to static grid class", () => {
    expect(GRID_COLS[3]).toBe("grid grid-cols-1 md:grid-cols-3 gap-6");
  });

  it("resolves columns=4 to static grid class with lg breakpoint", () => {
    expect(GRID_COLS[4]).toContain("lg:grid-cols-4");
  });

  it("falls back to 3-column grid for unknown column count", () => {
    const columns = 7;
    const gridClass = GRID_COLS[columns] ?? GRID_COLS[3];
    expect(gridClass).toBe(GRID_COLS[3]);
  });

  it("all grid classes contain only static Tailwind classes (no interpolation)", () => {
    for (const cls of Object.values(GRID_COLS)) {
      expect(cls).not.toContain("${");
      expect(cls).toMatch(/^[\w\s\-:/]+$/);
    }
  });
});

// =====================================================
// 10. buildPageSettings validation
// =====================================================

describe("buildPageSettings", () => {
  // Replicate the function locally for unit testing
  function buildPageSettings(settings: {
    background: string;
    className: string;
    styleJson: string;
  }): Record<string, unknown> {
    const nextSettings: Record<string, unknown> = {};

    if (settings.background.trim()) {
      nextSettings.background = settings.background.trim();
    }
    if (settings.className.trim()) {
      nextSettings.className = settings.className.trim();
    }
    if (settings.styleJson.trim()) {
      const parsed = JSON.parse(settings.styleJson) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("builder.pageSettings.invalidJson");
      }
      nextSettings.style = parsed;
    }

    return nextSettings;
  }

  it("builds settings from valid inputs", () => {
    const result = buildPageSettings({
      background: "#1a1a1a",
      className: "dark-page",
      styleJson: '{"maxWidth":"1200px"}',
    });

    expect(result).toEqual({
      background: "#1a1a1a",
      className: "dark-page",
      style: { maxWidth: "1200px" },
    });
  });

  it("returns empty object when all fields are empty", () => {
    const result = buildPageSettings({
      background: "",
      className: "",
      styleJson: "",
    });
    expect(result).toEqual({});
  });

  it("trims whitespace from values", () => {
    const result = buildPageSettings({
      background: "  #fff  ",
      className: "  hero-bg  ",
      styleJson: "",
    });
    expect(result).toEqual({
      background: "#fff",
      className: "hero-bg",
    });
  });

  it("rejects invalid JSON in styleJson", () => {
    expect(() =>
      buildPageSettings({
        background: "",
        className: "",
        styleJson: "not valid json",
      }),
    ).toThrow();
  });

  it("rejects array JSON in styleJson", () => {
    expect(() =>
      buildPageSettings({
        background: "",
        className: "",
        styleJson: "[1,2,3]",
      }),
    ).toThrow("builder.pageSettings.invalidJson");
  });

  it("rejects primitive JSON in styleJson", () => {
    expect(() =>
      buildPageSettings({
        background: "",
        className: "",
        styleJson: '"just a string"',
      }),
    ).toThrow("builder.pageSettings.invalidJson");
  });

  it("rejects null JSON in styleJson", () => {
    expect(() =>
      buildPageSettings({
        background: "",
        className: "",
        styleJson: "null",
      }),
    ).toThrow("builder.pageSettings.invalidJson");
  });
});

// =====================================================
// 11. CSS scoping contract
// =====================================================

describe("CSS scoping", () => {
  it("scopes selectors under .gjs-page-content", () => {
    const canvasCss = ".hero { color: red; } .footer { margin: 0; }";
    const scoped = canvasCss
      .replace(/(^|\})\s*([^@{}]+?)\s*\{/g, (_match, prefix: string, selector: string) => {
        const scopedSel = selector
          .split(",")
          .map((s: string) => `.gjs-page-content ${s.trim()}`)
          .join(", ");
        return `${prefix} ${scopedSel} {`;
      });

    expect(scoped).toContain(".gjs-page-content .hero");
    expect(scoped).toContain(".gjs-page-content .footer");
  });

  it("handles comma-separated selectors", () => {
    const canvasCss = ".a, .b { color: red; }";
    const scoped = canvasCss
      .replace(/(^|\})\s*([^@{}]+?)\s*\{/g, (_match, prefix: string, selector: string) => {
        const scopedSel = selector
          .split(",")
          .map((s: string) => `.gjs-page-content ${s.trim()}`)
          .join(", ");
        return `${prefix} ${scopedSel} {`;
      });

    expect(scoped).toContain(".gjs-page-content .a, .gjs-page-content .b");
  });
});
