/**
 * `zajistiI18nKlice` — razítko i18n klíčů na plátně.
 *
 * Testuje se CHOVÁNÍ nad falešným (ale věrným) stromem komponent GrapesJS:
 * co klíč dostane, co ne, a že se opakovaný běh už ničeho nedotkne. Brána
 * `novinka-je-prelozitelna-a-dohledatelna` hlídá zapojení; tady se měří logika.
 */
import { describe, it, expect } from "vitest";

import { zajistiI18nKlice } from "@/lib/builder/klicePlatna";

interface FalesnaKomponenta {
  atributy: Record<string, unknown>;
  get: (k: string) => unknown;
  getAttributes: () => Record<string, unknown>;
  addAttributes: (a: Record<string, unknown>) => void;
  components: () => { length: number; models: FalesnaKomponenta[]; forEach: (f: (c: FalesnaKomponenta) => void) => void };
}

function prvek(
  vlastnosti: { tagName?: string; type?: string; content?: string; atributy?: Record<string, unknown> },
  deti: FalesnaKomponenta[] = [],
): FalesnaKomponenta {
  const atributy = { ...(vlastnosti.atributy ?? {}) };
  return {
    atributy,
    get: (k: string) => (vlastnosti as Record<string, unknown>)[k],
    getAttributes: () => atributy,
    addAttributes: (a) => Object.assign(atributy, a),
    components: () => ({
      length: deti.length,
      models: deti,
      forEach: (f) => deti.forEach(f),
    }),
  };
}

/** Editor = jen `getWrapper()`; nic jiného razítko nepotřebuje. */
function editorSKorenem(deti: FalesnaKomponenta[]) {
  const wrapper = prvek({ tagName: "body" }, deti);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { getWrapper: () => wrapper } as any;
}

const text = (obsah: string) => prvek({ type: "textnode", content: obsah });

describe("zajistiI18nKlice", () => {
  it("dá klíč odstavci s textem a klíč nese namespace i oblast", () => {
    const p = prvek({ tagName: "p", type: "text" }, [text("Dzogchen je …")]);
    const vysledek = zajistiI18nKlice(editorSKorenem([p]), "news", "muj-clanek");

    expect(vysledek).toEqual({ vyrazeno: 1, meli: 0 });
    const klic = p.getAttributes()["data-i18n-key"] as string;
    expect(klic.startsWith("news.muj-clanek.")).toBe(true);
    expect(klic.split(".").length).toBe(3);
  });

  it("existující klíč nechá být — opakované uložení klíče nepřerazí", () => {
    const p = prvek({ tagName: "p", type: "text", atributy: { "data-i18n-key": "web.hero.title" } }, [
      text("Hero"),
    ]);
    const editor = editorSKorenem([p]);

    expect(zajistiI18nKlice(editor, "news", "a")).toEqual({ vyrazeno: 0, meli: 1 });
    expect(p.getAttributes()["data-i18n-key"]).toBe("web.hero.title");

    // Druhý běh nad TÍM SAMÝM plátnem nesmí nic změnit — klíč je v ProjectData,
    // takže stabilita napříč uloženími je vlastnost, ne náhoda.
    const p2 = prvek({ tagName: "p", type: "text" }, [text("Nový")]);
    const editor2 = editorSKorenem([p2]);
    zajistiI18nKlice(editor2, "news", "a");
    const prvniKlic = p2.getAttributes()["data-i18n-key"];
    zajistiI18nKlice(editor2, "news", "a");
    expect(p2.getAttributes()["data-i18n-key"]).toBe(prvniKlic);
  });

  it("nedá klíč prvku, který obsahuje další PRVKY — klíč patří listům", () => {
    const h3 = prvek({ tagName: "h3", type: "text" }, [text("Titulek")]);
    const oddil = prvek({ tagName: "section" }, [h3]);
    const vysledek = zajistiI18nKlice(editorSKorenem([oddil]), "news", "a");

    expect(vysledek.vyrazeno).toBe(1);
    expect(oddil.getAttributes()["data-i18n-key"]).toBeUndefined();
    expect(h3.getAttributes()["data-i18n-key"]).toBeDefined();
  });

  it("prázdný prvek a obrázek klíč nedostanou", () => {
    const mezera = prvek({ tagName: "div" });
    const obrazek = prvek({ tagName: "img", atributy: { src: "x.png" } });
    const vysledek = zajistiI18nKlice(editorSKorenem([mezera, obrazek]), "news", "a");

    expect(vysledek).toEqual({ vyrazeno: 0, meli: 0 });
  });

  it("skript a styl se nepřekládají ani se do nich nesahá", () => {
    const skript = prvek({ tagName: "script", type: "text" }, [text("var a = 1")]);
    const styl = prvek({ tagName: "style", type: "text" }, [text(".a{color:red}")]);
    const vysledek = zajistiI18nKlice(editorSKorenem([skript, styl]), "news", "a");

    expect(vysledek).toEqual({ vyrazeno: 0, meli: 0 });
    expect(skript.getAttributes()["data-i18n-key"]).toBeUndefined();
  });

  it("smíšený strom: každý textový list dostane vlastní klíč", () => {
    const listy = [
      prvek({ tagName: "h1", type: "text" }, [text("Titulek")]),
      prvek({ tagName: "p", type: "text" }, [text("První odstavec")]),
      prvek({ tagName: "p", type: "text" }, [text("Druhý odstavec")]),
    ];
    const oddil = prvek({ tagName: "section" }, listy);
    const vysledek = zajistiI18nKlice(editorSKorenem([oddil]), "news", "clanek");

    expect(vysledek.vyrazeno).toBe(3);
    const klice = listy.map((l) => l.getAttributes()["data-i18n-key"]);
    expect(new Set(klice).size, "klíče musí být různé, jinak by se texty přepsaly").toBe(3);
  });
});
