/**
 * PageBodyBlock — Runtime block that renders a static page's prose body.
 *
 * Why a runtime block and not `data-i18n-key` on the markup:
 *
 *  1. A migrated page body is ONE per-locale HTML document, not a structure that
 *     can be keyed element-by-element. Human translators merge and split
 *     paragraphs as their language reads best — e.g. an instance's `donate` body
 *     has 5 <p> in EN, 6 in CS and 7 in ES. Per-element keys would force every
 *     translation to mirror the source's shape.
 *  2. `canvas_html` is one document per PAGE, not per locale, so the differing
 *     shapes cannot live there either.
 *  3. Text bindings round-trip through `extractI18nFromCanvas`, which reads
 *     `textContent` by design (it deliberately strips nested markup). Putting the
 *     body in a `data-i18n-key` would render fine and then flatten to plain text
 *     the first time an admin saved the page in the builder.
 *
 * So the body lives where the platform already keeps per-locale HTML — a
 * `translations` value, exactly like `news_articles.content_key` — and this block
 * fetches it. A runtime block is opaque to the builder's text extraction, so the
 * markup survives editing the page around it.
 *
 * Editor placeholder:
 *   <div data-runtime-block="page-body" data-block-config='{"contentKey":"about.body"}'></div>
 *
 * @module
 */
import DOMPurify from "dompurify";
import { useDynamicTranslationsMap } from "@/hooks/useDynamicTranslations";
import type { RuntimeBlockProps } from "@/lib/builder/runtimeBlockRegistry";

/**
 * Namespace holding migrated static-page bodies.
 *
 * Separate from `web` (GrapesJS chrome — plain-text values, editable in the
 * builder) and from `news` (article bodies). Must match the namespace the
 * instance-data content seed writes these keys under.
 */
const PAGE_CONTENT_NAMESPACE = "pages";

export default function PageBodyBlock({ config }: RuntimeBlockProps) {
  const contentKey =
    typeof config.contentKey === "string" ? config.contentKey.trim() : "";

  // "en" fallback: a locale with no body row must show English, not the raw key.
  // The DB resolves this per key (get_translations_map_with_fallback).
  const translations = useDynamicTranslationsMap(
    contentKey ? [contentKey] : [],
    PAGE_CONTENT_NAMESPACE,
    "en",
  );

  if (!contentKey) return null;

  const html = translations[contentKey];
  // Absent while the query is in flight, and also when neither the locale nor the
  // EN fallback has a row. Rendering nothing beats rendering the key as prose.
  if (!html) return null;

  return (
    <div
      className="page-body prose"
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
    />
  );
}
