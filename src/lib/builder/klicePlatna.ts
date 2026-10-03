/**
 * Razítko i18n klíčů na plátně — z textu napsaného v editoru dělá PŘELOŽITELNÝ text.
 *
 * ⛔ PROČ TO MUSÍ EXISTOVAT (naměřeno 2026-09-21).
 *
 * Překladová smyčka editoru má tři půlky, které na sebe navazují:
 *   1. `extractI18nFromCanvas` posbírá při uložení páry `data-i18n-key` → text
 *      a pošle je do `translations`.
 *   2. `PageRenderer` je při zobrazení rozřeší podle jazyka návštěvníka.
 *   3. …a klíče do plátna nikdo nikdy nenapsal.
 *
 * Klíče v dnešních stránkách pocházejí ze SEEDU (`instance-data`, ručně psané
 * HTML s `data-i18n-key="web.…"`). Bloky v editoru (`aishaBlocksPlugin`) žádné
 * nevyrábějí — v celém souboru je `data-i18n-key` jednou, a to ve funkci, která
 * je jen ČTE. Text napsaný v editoru tedy klíč nemá, extrakce nenajde nic
 * (`entries.length === 0`), zápis do `translations` se ani nezavolá a článek
 * zůstane jednojazyčný: uložený do `canvas_html` v tom jazyce, ve kterém ho
 * autor napsal, a nepřeložitelný ani ručně ve správě překladů.
 *
 * Tenhle modul tu mezeru zavírá na JEDNOM místě: před uložením dorazí klíče
 * textovým prvkům, které ho nemají. Klíč se pak uloží v plátně (je to atribut
 * komponenty, tedy část `ProjectData`), takže je STABILNÍ — razí se jednou
 * a napříště se jen najde a nechá být. Tím se text stává adresovatelným:
 * `translations` mu drží hodnoty pro každý jazyk a renderer je vydá.
 *
 * ⚠️ Namespace klíče a namespace zápisu MUSÍ souhlasit. `PageRenderer` volá
 * rozřešení s `namespace = null`, což zapíná odvození namespacu z PRVNÍHO
 * segmentu klíče (migrace 20260525130000). Klíč `news.…` se proto hledá
 * v namespacu `news`; kdyby se razil `web.…` a ukládal do `news`, renderer by
 * ho nenašel a text by zmizel. Proto se prefix skládá z téhož namespacu, pod
 * kterým `CanvasEditor` ukládá — ne z parametru, který by se mohl rozejít.
 *
 * @module
 */

import type { Component, Editor } from "grapesjs";

import { firstTextI18nKey } from "./webI18nBindings";

/** Prvky, jejichž text se nepřekládá (a nesmí dostat klíč). */
const NETEXTOVE_TAGY = new Set(["script", "style", "noscript", "svg", "iframe"]);

/**
 * Text prvku bez vnořených značek. Vrací prázdno, když prvek nese další prvky
 * (pak patří klíč jim, ne jejich rodiči) — jinak by se do jednoho klíče slil
 * celý oddíl a překladatel by dostal k přeložení půl stránky.
 */
function vlastniText(c: Component): string {
  const deti = c.components();
  if (deti.length === 0) {
    const obsah = c.get("content");
    return typeof obsah === "string" ? obsah.trim() : "";
  }
  let text = "";
  for (const dite of deti.models) {
    if (dite.get("type") !== "textnode") return "";
    const obsah = dite.get("content");
    if (typeof obsah === "string") text += obsah;
  }
  return text.trim();
}

/** Krátký náhodný chvost klíče. Jednou vyražený už se nemění (je v plátně). */
function chvost(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

export interface VyslednekRazeni {
  /** Kolik prvků klíč dostalo (0 = plátno už bylo celé adresovatelné). */
  vyrazeno: number;
  /** Kolik textových prvků klíč UŽ mělo. */
  meli: number;
}

/**
 * Dorazí `data-i18n-key` textovým prvkům plátna, které ho nemají.
 *
 * @param editor - Živý editor GrapesJS.
 * @param namespace - Namespace, pod kterým se texty ukládají (prefix klíče).
 * @param oblast - Rozlišení uvnitř namespacu (např. slug článku) — jen pro
 *                 čitelnost klíče, na rozřešení nemá vliv.
 * @returns Počty — volající je smí ukázat autorovi.
 */
export function zajistiI18nKlice(
  editor: Editor,
  namespace: string,
  oblast: string,
): VyslednekRazeni {
  const wrapper = editor.getWrapper();
  if (!wrapper) return { vyrazeno: 0, meli: 0 };

  const prefix = `${namespace}.${oblast}`;
  let vyrazeno = 0;
  let meli = 0;

  const projdi = (c: Component): void => {
    const tag = (c.get("tagName") ?? "").toString().toLowerCase();
    if (NETEXTOVE_TAGY.has(tag)) return;

    if (c.get("type") !== "textnode" && vlastniText(c)) {
      if (firstTextI18nKey(c.getAttributes() as Record<string, unknown>)) {
        meli += 1;
      } else {
        c.addAttributes({ "data-i18n-key": `${prefix}.${chvost()}` });
        vyrazeno += 1;
      }
    }

    c.components().forEach((dite: Component) => projdi(dite));
  };

  wrapper.components().forEach((dite: Component) => projdi(dite));

  return { vyrazeno, meli };
}
