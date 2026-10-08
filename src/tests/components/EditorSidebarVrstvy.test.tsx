/**
 * Panel „Vrstvy“ v editoru stránek — proti SKUTEČNÉMU GrapesJS, ne proti mocku.
 *
 * ⛔ NAMĚŘENO 2026-10-01 (na instanci): klik na „Vrstvy“ shodil celou administraci.
 * Panel volal na komponentách GrapesJS metody, které Component nemá — a mock
 * editoru je ochotně „měl“, takže by to žádný test s mockem nechytil. Tady se
 * proto staví headless editor 0.22 a panel čte jeho veřejné API
 * (`editor.Layers.getLayerData / setVisible`, `editor.select`).
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import grapesjs, { type Component as GjsComponent, type Editor } from "grapesjs";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_k: string, vychozi?: string) => vychozi ?? _k, i18n: { language: "en" } }),
}));
// Panel vrstev databázi nepotřebuje; zbytek postranního panelu ano — odstínit.
vi.mock("@/hooks/useDynamicTranslations", () => ({ useUpsertTranslations: () => ({ mutateAsync: vi.fn() }) }));
vi.mock("@/lib/builder/useEditorI18nResolver", () => ({ useEditorI18nResolver: () => ({}) }));

import { PanelVrstev } from "@/components/admin/page-builder/EditorSidebar";

let editor: Editor | null = null;

function postavEditor(html: string): Editor {
  editor = grapesjs.init({
    headless: true,
    storageManager: false,
    components: html,
  });
  return editor;
}

/**
 * Komponenta podle id PŘES MODELY. `Component.find("#id")` hledá v DOM pohledu —
 * a headless editor pohledy nemá, takže by vrátil prázdno.
 */
function podleId(ed: Editor, id: string): GjsComponent {
  const hledej = (c: GjsComponent): GjsComponent | undefined =>
    c.getId() === id ? c : c.components().models.map(hledej).find(Boolean);
  const nalez = hledej(ed.getWrapper()!);
  if (!nalez) throw new Error(`komponenta #${id} v editoru není`);
  return nalez;
}

afterEach(() => {
  // nejdřív odmontovat panel, pak zničit editor (jako při odchodu z editoru)
  cleanup();
  editor?.destroy();
  editor = null;
});

describe("panel Vrstvy nad skutečným GrapesJS", () => {
  it("vykreslí strom stránky bez pádu", () => {
    const ed = postavEditor('<section id="uvod"><h1 id="nadpis">Nadpis</h1><p id="text">Ahoj</p></section>');
    render(<PanelVrstev editor={ed} root={ed.getWrapper()!} />);

    const prepinace = screen.getAllByRole("button", { name: /^Show or hide: / });
    // obal stránky + section + h1 + p
    expect(prepinace.length).toBeGreaterThanOrEqual(4);
  });

  it("klik na vrstvu vybere komponentu v editoru", () => {
    const ed = postavEditor('<section id="uvod"><p id="text">Ahoj</p></section>');
    render(<PanelVrstev editor={ed} root={ed.getWrapper()!} />);
    const p = podleId(ed, "text");

    fireEvent.click(screen.getByRole("button", { name: `Show or hide: ${p.getName()}` }).parentElement!);

    expect(ed.getSelected()).toBe(p);
  });

  it("přepínač skryje a znovu ukáže komponentu; panel se překreslí sám", () => {
    const ed = postavEditor('<section id="uvod"><p id="text">Ahoj</p></section>');
    render(<PanelVrstev editor={ed} root={ed.getWrapper()!} />);
    const p = podleId(ed, "text");
    const prepinac = () => screen.getByRole("button", { name: `Show or hide: ${p.getName()}` });

    expect(prepinac()).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(prepinac());
    expect(ed.Layers.isVisible(p)).toBe(false);
    expect(prepinac()).toHaveAttribute("aria-pressed", "false");
    // skrytí nesmí zároveň vybrat komponentu (klik nesmí probublat na řádek)
    expect(ed.getSelected()).toBeUndefined();

    fireEvent.click(prepinac());
    expect(ed.Layers.isVisible(p)).toBe(true);
  });

  it("zničený editor panel nekreslí a nespadne", () => {
    const ed = postavEditor('<section id="uvod"></section>');
    const { container } = render(<PanelVrstev editor={ed} root={ed.getWrapper()!} />);
    act(() => {
      ed.destroy();
    });
    editor = null;
    expect(container).toBeEmptyDOMElement();
  });

  it("komponenta přidaná v plátně se v panelu objeví", () => {
    const ed = postavEditor('<section id="uvod"></section>');
    render(<PanelVrstev editor={ed} root={ed.getWrapper()!} />);
    const pred = screen.getAllByRole("button").length;

    // změna přichází z editoru, ne z Reactu — proto act()
    act(() => {
      podleId(ed, "uvod").append('<p id="novy">Nový</p>');
    });

    expect(screen.getAllByRole("button").length).toBe(pred + 1);
  });
});
