/**
 * Editor webové stránky a koncept (2026-10-02, naměřeno na instanci).
 *
 * Zveřejněná stránka: editor hydratuje z KONCEPTU, ukáže „Zveřejnit změny“
 * a „Zahodit koncept“; uložení nese razítko; když autor koncept zahodí,
 * odcházející plátno (dopsání rozběhnutého autosave) se NESMÍ uložit —
 * jinak by zahazovaný obsah koncept hned založil znovu.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasSavePayload } from "@/components/admin/page-builder/CanvasEditor";

const mockUpdate = vi.fn();
const mockDiscard = vi.fn();
let mockPage: Record<string, unknown> | null = null;
let posledniProps: { onSave: (p: CanvasSavePayload) => Promise<void>; canvasHtml?: string | null; toolbarExtras?: ReactNode; belowToolbar?: ReactNode } | null = null;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useAdminWebPages", () => ({
  useAdminWebPage: () => ({ data: mockPage, isLoading: false }),
  useUpdateWebPageCanvas: () => ({ mutateAsync: mockUpdate, isPending: false }),
  useDiscardWebPageDraft: () => ({ mutateAsync: mockDiscard, isPending: false }),
}));
vi.mock("@/hooks/usePageAssetUpload", () => ({ usePageAssetUpload: () => ({ uploadAsset: vi.fn() }) }));
vi.mock("@/hooks/usePageVersions", () => ({
  usePageVersions: () => ({ data: [] }),
  useRestorePageVersion: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/usePageTemplates", () => ({
  usePageTemplates: () => ({ data: [] }),
  useSavePageAsTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useApplyPageTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/components/admin/page-builder/CanvasEditor", () => ({
  CanvasEditor: (props: NonNullable<typeof posledniProps>) => {
    posledniProps = props;
    return (
      <div data-testid="editor" data-html={props.canvasHtml ?? ""}>
        {props.toolbarExtras}
        {props.belowToolbar}
      </div>
    );
  },
}));

import AdminPageEditor from "@/pages/admin/AdminPageEditor";

const STRANKA = "11111111-1111-4111-8111-111111111111";

function vykresli() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/admin/pages/${STRANKA}/edit`]}>
        <Routes>
          <Route path="/admin/pages/:id/edit" element={<AdminPageEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ulozeni = (html: string, extra: Partial<CanvasSavePayload> = {}): CanvasSavePayload => ({
  canvasData: { pages: [] },
  canvasHtml: html,
  canvasCss: "",
  publish: false,
  ...extra,
});

describe("AdminPageEditor — koncept zveřejněné stránky", () => {
  beforeEach(() => {
    mockUpdate.mockReset().mockResolvedValue("2026-10-02T10:00:05Z");
    mockDiscard.mockReset().mockResolvedValue("2026-10-02T09:00:00Z");
    posledniProps = null;
    mockPage = {
      id: STRANKA, slug: "index", status: "published", page_settings: { chrome: "none" },
      canvas_data: { pages: [] }, canvas_html: "<p>zive</p>", canvas_css: "",
      updated_at: "2026-10-02T09:00:00Z", edit_stamp: "2026-10-02T10:00:00Z",
      draft: { canvas_data: { pages: [] }, canvas_html: "<p>koncept</p>", canvas_css: "", page_settings: { chrome: "none" }, updated_at: "2026-10-02T10:00:00Z" },
    };
  });

  it("hydratuje z konceptu a nabídne zveřejnění i zahození", () => {
    vykresli();
    expect(screen.getByTestId("editor")).toHaveAttribute("data-html", "<p>koncept</p>");
    expect(screen.getByText("builder.draft.publishChanges")).toBeInTheDocument();
    expect(screen.getByText("builder.draft.discard")).toBeInTheDocument();
    expect(screen.getByText("builder.draft.banner")).toBeInTheDocument();
  });

  it("uložení posílá razítko z načtení", async () => {
    vykresli();
    await posledniProps!.onSave(ulozeni("<p>dalsi</p>"));
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      id: STRANKA, canvas_html: "<p>dalsi</p>", publish: false, expected_stamp: "2026-10-02T10:00:00Z",
    }));
  });

  it("po zahození konceptu se odcházející plátno nedopíše", async () => {
    vykresli();
    fireEvent.click(screen.getByText("builder.draft.discard"));
    await waitFor(() => expect(mockDiscard).toHaveBeenCalledWith(STRANKA));
    await posledniProps!.onSave(ulozeni("<p>zahazovane</p>", { priOdchodu: true }));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("běžné dopsání při odchodu (bez nahrazení) se uloží", async () => {
    vykresli();
    await posledniProps!.onSave(ulozeni("<p>rozepsane</p>", { priOdchodu: true }));
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("nezveřejněná stránka koncept nemá — žádná tlačítka konceptu", () => {
    mockPage = { ...mockPage!, status: "draft", draft: null };
    vykresli();
    expect(screen.getByTestId("editor")).toHaveAttribute("data-html", "<p>zive</p>");
    expect(screen.queryByText("builder.draft.publishChanges")).toBeNull();
  });
});
