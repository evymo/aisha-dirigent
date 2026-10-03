/**
 * Extracts i18n key-value pairs from GrapesJS canvas HTML so admin-authored
 * translations can be upserted into the `translations` table on save.
 *
 * This is the persist half of the editor round-trip; it must recognise every
 * binding the inject half (useEditorI18nResolver) writes, or those edits are
 * silently dropped. Both sides read their binding definitions from
 * {@link webI18nBindings} to stay in lock-step:
 *  - text bindings   (`data-i18n-key`, alias `data-i18n`) → element text content
 *  - attribute bindings (`data-i18n-placeholder-key`, …)  → the bound attribute's value
 *
 * @module
 */

import {
  WEB_I18N_ATTRIBUTE_BINDINGS,
  WEB_TEXT_I18N_KEY_ATTRS,
} from "./webI18nBindings";

/** A single i18n entry extracted from canvas HTML */
export interface CanvasI18nEntry {
  /** The i18n key from a data-i18n* attribute */
  key: string;
  /** The current value (text content or bound attribute value) */
  value: string;
}

/**
 * Extract i18n key-value pairs from canvas HTML.
 *
 * Text example:  `<h1 data-i18n-key="web.hero.title">Hero Title</h1>`
 *                → `{ key: "web.hero.title", value: "Hero Title" }`
 * Attribute ex.: `<input data-i18n-placeholder-key="web.search.ph" placeholder="Search…">`
 *                → `{ key: "web.search.ph", value: "Search…" }`
 *
 * @param html - GrapesJS-generated HTML string
 * @returns Array of key-value pairs (deduplicated by key, last occurrence wins)
 */
export function extractI18nFromCanvas(html: string): CanvasI18nEntry[] {
  if (!html) return [];

  const doc = new DOMParser().parseFromString(html, "text/html");
  const entries = new Map<string, string>();

  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("*"))) {
    // Text-content bindings: the first present key attribute wins for the element.
    for (const attr of WEB_TEXT_I18N_KEY_ATTRS) {
      const key = el.getAttribute(attr)?.trim();
      if (!key) continue;
      // ⛔ PRVEK SE ZNAČKAMI UVNITŘ SE UKLÁDÁ JAKO HTML, NE JAKO HOLÝ TEXT
      // (naměřeno 2026-09-03, audit U5-3). Druhá půlka smyčky —
      // resolveI18nInHtml v packages/web-canvas — překlad přiřazuje do
      // `innerHTML` záměrně, aby překlad SMĚL nést značky (odkaz v perexu,
      // <br>, <strong>). `textContent` tady odkazy a zvýraznění při uložení
      // tiše sloupl: perex hero s odkazem na dzogchen.net by po prvním
      // uložení odkaz ztratil. Čistě textový prvek zůstává textem — jinak by
      // se do překladu dostaly entity (&amp;) tam, kde dřív nebyly.
      const value = (el.children.length > 0 ? el.innerHTML : (el.textContent ?? "")).trim();
      if (value) entries.set(key, value);
      break;
    }

    // Attribute bindings: persist the value of the bound DOM attribute.
    for (const binding of WEB_I18N_ATTRIBUTE_BINDINGS) {
      const key = el.getAttribute(binding.keyAttr)?.trim();
      if (!key) continue;
      const value = (el.getAttribute(binding.targetAttr) ?? "").trim();
      if (value) entries.set(key, value);
    }
  }

  return Array.from(entries, ([key, value]) => ({ key, value }));
}
