import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import AdminNewsArticles from "@/pages/admin/AdminNewsArticles";

const mockFetchTranslationsForKeys = vi.fn();
const mockSafeError = vi.fn();
const mockSaveDraft = vi.fn();
const mockUpdate = vi.fn();
const mockPublish = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && typeof opts === "object" && "shown" in opts ? `${key}:${opts.shown}/${opts.total}` : key,
    i18n: { language: "en" },
  }),
}));

const clanek = (p: Partial<Record<string, unknown>>) => ({
  id: "news-1",
  slug: "new-release",
  title_key: "news.new-release.title",
  content_key: "news.new-release.content",
  excerpt_key: "news.new-release.excerpt",
  image_url: null,
  is_published: true,
  sort_order: 1,
  published_at: "2026-02-17T12:00:00Z",
  created_at: "2026-02-17T12:00:00Z",
  updated_at: "2026-02-17T12:00:00Z",
  title: "New release",
  excerpt: null,
  tags: ["home"],
  has_draft: false,
  edit_stamp: "2026-02-17T12:00:00Z",
  image_focus_x: 0.5,
  image_focus_y: 0.5,
  image_zoom: 1,
  ...p,
});

// Tři články: nejstarší zveřejněný (2019), nejnovější zveřejněný (2026) a koncept.
const ARTICLES = [
  clanek({ id: "news-old", slug: "z-roku-2019", title: "Retreat 2019", published_at: "2019-12-03T00:00:00Z", sort_order: 1, tags: ["events"] }),
  clanek({ id: "news-1", slug: "new-release", title: "New release", published_at: "2026-02-17T12:00:00Z", sort_order: 2 }),
  clanek({ id: "news-draft", slug: "rozepsany", title: "Rozepsany", is_published: false, published_at: null, updated_at: "2020-01-01T00:00:00Z", sort_order: 3, tags: [] }),
];

vi.mock("@/hooks/useAdminNewsArticles", () => ({
  useAdminNewsArticles: () => ({
    articles: ARTICLES,
    isLoading: false,
    createArticle: vi.fn(),
    createArticleAsync: vi.fn(),
    updateArticle: vi.fn(),
    updateArticleAsync: mockUpdate,
    saveDraftAsync: mockSaveDraft,
    publishAsync: mockPublish,
    discardDraftAsync: vi.fn(),
    deleteArticle: vi.fn(),
    isCreating: false,
    isUpdating: false,
    isSavingDraft: false,
    isPublishing: false,
    isDeleting: false,
  }),
}));

vi.mock("@/hooks/useSupportedLanguages", () => ({
  useSupportedLanguages: () => ({
    data: [
      { code: "en", is_active: true },
      { code: "cs", is_active: true },
    ],
  }),
}));

vi.mock("@/hooks/useDynamicTranslations", () => ({
  useFetchTranslationsForKeys: () => ({
    mutateAsync: mockFetchTranslationsForKeys,
  }),
  useUpsertTranslations: () => ({
    mutateAsync: vi.fn().mockResolvedValue([]),
    isPending: false,
  }),
  SUPPORTED_LOCALES: ["en", "cs", "de", "fr", "ru", "th"],
  LOCALE_LABELS: {
    en: "English",
    cs: "Čeština",
    de: "Deutsch",
    fr: "Français",
    ru: "Русский",
    th: "ไทย",
  },
}));

vi.mock("@/hooks/usePageAssetUpload", () => ({
  ALLOWED_ASSET_TYPES: new Set(["image/jpeg", "image/png"]),
  MAX_ASSET_BYTES: 1024,
  usePageAssetUpload: () => ({ uploadAsset: vi.fn(), deleteAsset: vi.fn() }),
}));

vi.mock("@/components/admin/media/GalerieMedii", () => ({
  GalerieMedii: () => <div data-testid="galerie" />,
}));

vi.mock("@/components/admin/LocalizedFieldEditor", () => ({
  LocalizedFieldEditor: () => <div data-testid="localized-field-editor" />,
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: { rpc: vi.fn().mockResolvedValue({ data: [], error: null }) },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/safeLogger")>()),
  safeError: (...args: unknown[]) => mockSafeError(...args),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <AdminNewsArticles />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

const slugyVPoradi = () =>
  screen.getAllByRole("row").slice(1).map((r) => r.getAttribute("data-testid")?.replace("news-row-", ""));

describe("AdminNewsArticles page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockFetchTranslationsForKeys.mockResolvedValue([
      { key: "news.new-release.title", locale: "en", value: "New release" },
      { key: "news.new-release.content", locale: "en", value: "Content" },
      { key: "news.new-release.excerpt", locale: "en", value: "Excerpt" },
    ]);
    mockSaveDraft.mockResolvedValue("2026-09-24T00:00:00Z");
    mockUpdate.mockResolvedValue("2026-09-24T00:00:00Z");
    mockPublish.mockResolvedValue("2026-09-24T00:00:00Z");
  });

  it("loads translations through mutateAsync when editing an article", async () => {
    const user = userEvent.setup();
    renderPage();

    const row = screen.getByTestId("news-row-new-release");
    await user.click(within(row).getByRole("button", { name: "admin.newsArticles.editArticle" }));

    await waitFor(() => {
      expect(mockFetchTranslationsForKeys).toHaveBeenCalledWith({
        keys: [
          "news.new-release.title",
          "news.new-release.content",
          "news.new-release.excerpt",
        ],
        namespace: "news",
      });
    });

    expect(mockSafeError).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  /**
   * ⛔ Naměřeno testerem 2026-09-24: seznam začínal rokem 2019, protože se řadil
   * podle sort_order, které import naplnil chronologií. Výchozí pořadí je
   * NEJNOVĚJŠÍ NAHOŘE a rozdělaná práce (koncepty) úplně nahoře.
   */
  it("default order: drafts first, then newest published", () => {
    renderPage();
    expect(slugyVPoradi()).toEqual(["rozepsany", "new-release", "z-roku-2019"]);
  });

  it("search filters by title, slug and tags; tag filter narrows the list", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByRole("textbox", { name: "admin.newsArticles.list.search" }), "retreat");
    expect(slugyVPoradi()).toEqual(["z-roku-2019"]);

    await user.clear(screen.getByRole("textbox", { name: "admin.newsArticles.list.search" }));
    await user.click(screen.getByRole("button", { name: "home", pressed: false }));
    expect(slugyVPoradi()).toEqual(["new-release"]);
  });

  it("sort by title uses the translated title, not the key", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(screen.getByRole("combobox", { name: "admin.newsArticles.list.sort" }), "title");
    expect(slugyVPoradi()).toEqual(["new-release", "z-roku-2019", "rozepsany"]);
  });

  /**
   * ⛔ Naměřeno testerem 2026-09-24: kliknutí vedle okna zahodilo rozepsaný článek.
   * Klik mimo okno ho NEZAVŘE; Esc s rozepsanými změnami se zeptá.
   */
  it("outside click does not close the dialog; Escape with changes asks first", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /admin.newsArticles.addArticle/ }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("admin.newsArticles.form.slug"), "novy-clanek");

    // Radix drží `pointer-events: none` na body, dokud je dialog otevřený — klik
    // „vedle okna" je proto pointerdown mimo obsah (přesně to, co DismissableLayer
    // poslouchá), ne user-event klik, který by pointer-events zastavily.
    fireEvent.pointerDown(document.body);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(await screen.findByText("admin.newsArticles.unsaved.title")).toBeInTheDocument();
    await user.click(screen.getByText("admin.newsArticles.unsaved.keepEditing"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByLabelText("admin.newsArticles.form.slug")).toHaveValue("novy-clanek");
  });

  it("keeps the typed text in the browser and offers to restore it on reopen", async () => {
    const user = userEvent.setup();
    const { unmount } = renderPage();
    await user.click(screen.getByRole("button", { name: /admin.newsArticles.addArticle/ }));
    await user.type(within(screen.getByRole("dialog")).getByLabelText("admin.newsArticles.form.slug"), "prezije");
    await waitFor(() => expect(window.localStorage.getItem("novinky.rozepsane.novy")).toContain("prezije"));
    unmount();

    renderPage();
    await user.click(screen.getByRole("button", { name: /admin.newsArticles.addArticle/ }));
    expect(await screen.findByText("admin.newsArticles.restore.title")).toBeInTheDocument();
    await user.click(screen.getByText("admin.newsArticles.restore.restore"));
    await waitFor(() =>
      expect(within(screen.getByRole("dialog")).getByLabelText("admin.newsArticles.form.slug")).toHaveValue("prezije"),
    );
  });

  it("saving a published article goes through the draft RPC with the edit stamp", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(within(screen.getByTestId("news-row-new-release")).getByRole("button", { name: "admin.newsArticles.editArticle" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "admin.newsArticles.form.saveDraft" }));
    await waitFor(() => expect(mockSaveDraft).toHaveBeenCalled());
    const vstup = mockSaveDraft.mock.calls[0][0];
    expect(vstup.id).toBe("news-1");
    expect(vstup.expectedStamp).toBe("2026-02-17T12:00:00Z");
    expect(vstup.fields.tags).toEqual(["home"]);
    expect(mockPublish).not.toHaveBeenCalled();
  });
});
