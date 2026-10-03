import type { Editor } from "grapesjs";

/**
 * V jaké locale je plátno editoru PRÁVĚ TEĎ.
 *
 * ⛔ PROČ EXISTUJE (naměřeno 2026-09-03, audit U5-2): uložení plátna zapisovalo
 * texty pod jazyk UI administrátora, ačkoli plátno se načítá z canvas_html
 * (zdrojová angličtina) a překlady do něj vstupují až tlačítkem v postranním
 * panelu. Admin s českým UI tak při uložení přepsal české hodnoty anglickým
 * zdrojem. Ten, kdo překlady injektuje (useEditorI18nResolver), tu locale
 * zapíše; ten, kdo ukládá (CanvasEditor), si ji přečte. Editor sám takové
 * pole nemá — proto WeakMap nad instancí, ne vlastnost na `Editor`.
 *
 * Bez záznamu plátno nese zdrojový text — angličtinu seedu.
 */
const localePlatna = new WeakMap<Editor, string>();

export function zapisLocalePlatna(editor: Editor, locale: string): void {
  localePlatna.set(editor, locale);
}

export function ctiLocalePlatna(editor: Editor): string | undefined {
  return localePlatna.get(editor);
}
