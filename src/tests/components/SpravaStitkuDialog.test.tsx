/**
 * Správa štítků novinek (2026-10-02, naměřeno na instanci): přejmenování normalizuje vstup
 * stejně jako pole štítků článku, sloučení do existujícího štítku se nejdřív
 * zeptá, názvy se ukládají jen změněné a do jmenného prostoru news-tags.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrejmenuj = vi.fn();
const mockUlozNazvy = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useAdminNewsTags", () => ({
  useNewsTagsAdmin: () => ({
    isLoading: false,
    data: [
      { tag: "team-news", article_count: 9, published_count: 9 },
      { tag: "people", article_count: 2, published_count: 1 },
    ],
  }),
  useNewsTagNames: () => ({ data: { "team-news": { en: "Team News", cs: "Týmové novinky" } } }),
  useRenameNewsTag: () => ({ mutateAsync: mockPrejmenuj, isPending: false }),
}));
vi.mock("@/hooks/useDynamicTranslations", () => ({
  useUpsertTranslations: () => ({ mutateAsync: mockUlozNazvy, isPending: false }),
}));
vi.mock("@/hooks/useSupportedLanguages", () => ({
  useSupportedLanguages: () => ({
    data: [
      { code: "en", name_native: "English" },
      { code: "cs", name_native: "Čeština" },
      { code: "global", name_native: "Global" },
    ],
  }),
}));

import { SpravaStitkuDialog } from "@/components/admin/news/SpravaStitkuDialog";

const radek = (stitek: string) => document.querySelector(`[data-stitek="${stitek}"]`) as HTMLElement;

describe("SpravaStitkuDialog", () => {
  beforeEach(() => {
    mockPrejmenuj.mockReset().mockResolvedValue(9);
    mockUlozNazvy.mockReset().mockResolvedValue([]);
  });

  it("ukáže zobrazovaný název i syrovou hodnotu štítku", () => {
    render(<SpravaStitkuDialog open onOpenChange={vi.fn()} />);
    expect(within(radek("team-news")).getByText("Team News")).toBeInTheDocument();
    expect(within(radek("people")).getByText("People")).toBeInTheDocument(); // bez překladu: čitelná podoba
  });

  it("přejmenování normalizuje vstup („Wisdom Quotes“ → wisdom-quotes)", async () => {
    render(<SpravaStitkuDialog open onOpenChange={vi.fn()} />);
    fireEvent.click(within(radek("team-news")).getByLabelText("admin.newsArticles.tags.rename"));
    fireEvent.change(screen.getByLabelText("admin.newsArticles.tags.newValue"), { target: { value: "Wisdom Quotes" } });
    fireEvent.click(screen.getByText("admin.newsArticles.tags.renameConfirm"));
    await waitFor(() => expect(mockPrejmenuj).toHaveBeenCalledWith({ z: "team-news", na: "wisdom-quotes" }));
  });

  it("přejmenování na existující štítek se nejdřív zeptá na sloučení", async () => {
    render(<SpravaStitkuDialog open onOpenChange={vi.fn()} />);
    fireEvent.click(within(radek("team-news")).getByLabelText("admin.newsArticles.tags.rename"));
    fireEvent.change(screen.getByLabelText("admin.newsArticles.tags.newValue"), { target: { value: "People" } });
    fireEvent.click(screen.getByText("admin.newsArticles.tags.renameConfirm"));
    expect(mockPrejmenuj).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("admin.newsArticles.tags.mergeConfirm"));
    await waitFor(() => expect(mockPrejmenuj).toHaveBeenCalledWith({ z: "team-news", na: "people" }));
  });

  it("názvy: uloží jen změněné, do news-tags; „global“ není jazyk", async () => {
    render(<SpravaStitkuDialog open onOpenChange={vi.fn()} />);
    fireEvent.click(within(radek("team-news")).getByLabelText("admin.newsArticles.tags.names"));
    const poleRadku = within(radek("team-news")).getAllByRole("textbox");
    expect(poleRadku).toHaveLength(2); // en, cs — bez global
    fireEvent.change(poleRadku[1], { target: { value: "Lidé" } });
    fireEvent.click(screen.getByText("admin.newsArticles.tags.saveNames"));
    await waitFor(() =>
      expect(mockUlozNazvy).toHaveBeenCalledWith([{ key: "team-news", locale: "cs", value: "Lidé", namespace: "news-tags" }]),
    );
  });
});
