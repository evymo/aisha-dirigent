/**
 * Single source of truth for the i18n key-binding attributes used across the
 * web editor's translation round-trip.
 *
 * Three sides consume these definitions and MUST agree, or admin-authored
 * translations silently disappear:
 *  - inject  (useEditorI18nResolver): DB translations → canvas attributes/text
 *  - persist (extractI18nFromCanvas): saved canvas → DB translation upserts
 *  - preserve (aishaBlocksPlugin):    user edits kept across a variant swap
 *
 * Keeping the lists here (instead of duplicated in each consumer) is the fix
 * for the drift that let attribute- and alias-bound edits round-trip on inject
 * but get dropped on save.
 *
 * @module
 */

/**
 * Attributes whose i18n key binds to the element's text content.
 * `data-i18n` is a convenience alias for `data-i18n-key`; the first present
 * one wins for a given element.
 */
// ⛔ JEDINÝ ZDROJ. Tyhle konstanty tu dřív žily jako vlastní definice —
// jenže tutéž čtveřici vazeb měl PageRenderer, svc-web-artifact i (nově)
// generátor statických stránek. Čtyři seznamy téhož: přidat pátou vazbu
// znamenalo najít a upravit všechny, a kdo by na jeden zapomněl, dostal by
// klíč, který ingest vytáhne a renderer nikdy nerozřeší.
// Sjednoceno do @aisha/web-canvas 2026-08-30; tady zůstává jen re-export
// pod DOMÁCÍMI jmény, aby se nemusela přepisovat všechna volání v editoru.
import {
  ATTRIBUTE_I18N_BINDINGS,
  TEXT_I18N_KEY_ATTRS,
} from "@aisha/web-canvas";

export const WEB_TEXT_I18N_KEY_ATTRS = TEXT_I18N_KEY_ATTRS;

/**
 * Attributes whose i18n key binds to the value of another DOM attribute
 * (rather than text content) — e.g. an input placeholder or an image alt.
 */
// Editor používá `targetAttr`, balíček `target` — přejmenování je tady,
// na JEDNOM místě, místo aby se sjednocovalo napříč všemi voláními.
export const WEB_I18N_ATTRIBUTE_BINDINGS = ATTRIBUTE_I18N_BINDINGS.map((b) => ({
  keyAttr: b.keyAttr,
  targetAttr: b.target,
})) as ReadonlyArray<{ keyAttr: string; targetAttr: string }>;

/**
 * Return the first text-binding i18n key declared on an attribute bag, or
 * undefined. Mirrors the precedence used by inject and persist.
 */
export function firstTextI18nKey(
  attrs: Record<string, unknown>,
): string | undefined {
  for (const attr of WEB_TEXT_I18N_KEY_ATTRS) {
    const key = attrs[attr];
    if (typeof key === "string" && key.trim()) return key.trim();
  }
  return undefined;
}
