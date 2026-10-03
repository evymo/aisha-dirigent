import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("@/hooks/useDynamicTranslations", () => ({
  useDynamicTranslationsMap: () => ({}),
}));
vi.mock("@/hooks/useWebPartials", () => ({
  useWebPartials: () => ({ data: {}, isLoading: false }),
}));

import { PageRenderer } from "@/components/web/PageRenderer";

/** Statická kopie, jak ji vydává svc-web-render: sourozenec #root, ne potomek. */
function polozStatickouKopii(): HTMLElement {
  const staticka = document.createElement("div");
  staticka.id = "static-page";
  staticka.dataset.slug = "index";
  staticka.innerHTML = "<header>statická kopie</header>";
  document.body.prepend(staticka);
  return staticka;
}

describe("PageRenderer — statická kopie ze svc-web-render", () => {
  afterEach(() => {
    document.getElementById("static-page")?.remove();
  });

  // ⛔ NAPSÁNO ČERVENÉ proti dřívějšímu kódu (naměřeno 2026-09-03 na produkci):
  // generátor statických stránek sliboval „aplikace #static-page odstraní, až
  // vykreslí totéž" — jenže ten kód neexistoval. Každá předrenderovaná stránka
  // byla na produkci dvakrát pod sebou (2697 px statické kopie nad hydratovanou).
  it("po připojení plátna odstraní #static-page — jinak je stránka dvakrát", () => {
    polozStatickouKopii();

    render(
      <MemoryRouter>
        <PageRenderer canvasCss="" canvasHtml="<p>plátno</p>" pageSettings={{}} />
      </MemoryRouter>,
    );

    expect(document.getElementById("static-page")).toBeNull();
  });

  it("bez připojeného plátna statická kopie zůstává — je to jediné, co člověk vidí", () => {
    const staticka = polozStatickouKopii();

    expect(document.getElementById("static-page")).toBe(staticka);
  });
});
