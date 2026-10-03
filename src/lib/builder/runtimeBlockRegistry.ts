/**
 * Runtime Block Registry — maps block types to lazy-loaded React components.
 *
 * Runtime blocks are interactive React components that get hydrated into
 * GrapesJS canvas HTML at render time. Unlike static blocks (pure HTML with
 * i18n keys), runtime blocks fetch data from RPC hooks and render dynamic
 * content.
 *
 * Contract:
 * - In canvas_html: `<div data-runtime-block="hero-slides" data-block-config='{"limit":5}'></div>`
 * - PageRenderer detects these placeholders and delegates to this registry
 * - Each runtime block component receives parsed config as props
 *
 * @module
 */

import { lazy, type ComponentType } from "react";

// =====================================================
// Types
// =====================================================

/** Configuration passed from canvas data-block-config attribute */
export type RuntimeBlockConfig = Record<string, unknown>;

/** Props every runtime block component receives */
export interface RuntimeBlockProps {
  /** Parsed JSON config from data-block-config attribute */
  config: RuntimeBlockConfig;
}

/** Registry entry for a runtime block */
interface RuntimeBlockEntry {
  /** Lazy-loaded React component */
  component: ComponentType<RuntimeBlockProps>;
}

// =====================================================
// Registry
// =====================================================

const registry = new Map<string, RuntimeBlockEntry>();

/**
 * Register a runtime block type with its lazy-loaded component.
 *
 * @param blockType - Unique block type identifier (matches data-runtime-block value)
 * @param component - Lazy-loaded React component for this block
 */
export function registerRuntimeBlock(
  blockType: string,
  component: ComponentType<RuntimeBlockProps>,
): void {
  registry.set(blockType, { component });
}

/**
 * Look up a registered runtime block by type.
 *
 * @param blockType - The block type to resolve
 * @returns The registry entry or undefined if not registered
 */
export function resolveRuntimeBlock(
  blockType: string,
): RuntimeBlockEntry | undefined {
  return registry.get(blockType);
}

/**
 * Check whether a block type has a registered runtime component.
 *
 * @param blockType - The block type to check
 */
export function hasRuntimeBlock(blockType: string): boolean {
  return registry.has(blockType);
}

// =====================================================
// Block registrations (lazy-loaded)
// =====================================================

registerRuntimeBlock(
  "page-body",
  lazy(() => import("@/components/web/blocks/PageBodyBlock")),
);

registerRuntimeBlock(
  "hero-slides",
  lazy(() => import("@/components/web/blocks/HeroSlidesBlock")),
);
registerRuntimeBlock(
  "community-counter",
  lazy(() => import("@/components/web/blocks/CommunityCounterBlock")),
);

registerRuntimeBlock(
  "news-list",
  lazy(() => import("@/components/web/blocks/NewsListBlock")),
);

// POZOR: DETAIL PATŘÍ NA PLÁTNO STEJNĚ JAKO SEZNAM. `/news` prochází
// `EditorPageGate`, takže smí být z plátna; `/news/:slug` mířil rovnou na
// platformní komponentu a nesl proto platformní hlavičku, patičku i písmo —
// design webu na něj nedosáhl (naměřeno 2026-08-31 na produkci). Blok
// vykresluje jen obsah článku; chrome dodá plátno týmiž útržky jako všem
// ostatním stránkám, takže detail dědí design i formátování automaticky.
//
// Slug si bere z URL, ne z konfigurace: detail je z definice stránka
// „o jednom záznamu" a z konfigurace by jedna stránka uměla ukázat jen jeden.
registerRuntimeBlock(
  "article-detail",
  lazy(() => import("@/components/web/blocks/ArticleDetailBlock")),
);

// POZOR: VOLBA JAZYKA PATŘÍ WEBU, NE PLATFORMĚ. Hlavička webu je útržek plátna
// a předloha webu instance přepínač nemá — je JEDNOJAZYČNÁ (`html lang="en"`,
// žádné hreflang). Naše instance nabízí osm jazyků, takže bez tohohle prvku
// rozhoduje o jazyce jen prohlížeč a návštěvník do toho nemá jak sáhnout.
// Předloha je závazná pro vzhled, ne pro schopnosti.
registerRuntimeBlock(
  "language-switcher",
  lazy(() => import("@/components/web/blocks/LanguageSwitcherBlock")),
);

registerRuntimeBlock(
  "contact-form",
  lazy(() => import("@/components/web/blocks/ContactFormBlock")),
);

registerRuntimeBlock(
  "archive-preview",
  lazy(() => import("@/components/web/blocks/ArchivePreviewBlock")),
);

registerRuntimeBlock(
  "knowledge-preview",
  lazy(() => import("@/components/web/blocks/KnowledgePreviewBlock")),
);

registerRuntimeBlock(
  "faq-accordion",
  lazy(() => import("@/components/web/blocks/FaqAccordionBlock")),
);

registerRuntimeBlock(
  "product-catalog",
  lazy(() => import("@/components/web/blocks/ProductCatalogBlock")),
);

registerRuntimeBlock(
  "news-browser",
  lazy(() => import("@/components/web/blocks/NewsBrowserBlock")),
);

registerRuntimeBlock(
  "knowledge-browser",
  lazy(() => import("@/components/web/blocks/KnowledgeBrowserBlock")),
);

registerRuntimeBlock(
  "archive-browser",
  lazy(() => import("@/components/web/blocks/ArchiveBrowserBlock")),
);

registerRuntimeBlock(
  "studies-browser",
  lazy(() => import("@/components/web/blocks/StudiesBrowserBlock")),
);

registerRuntimeBlock(
  "guild-directory",
  lazy(() => import("@/components/web/blocks/GuildDirectoryBlock")),
);

registerRuntimeBlock(
  "aisha-pruvodce",
  lazy(() => import("@/components/web/blocks/AishaPruvodceBlock")),
);

registerRuntimeBlock(
  "discussion-thread",
  lazy(() => import("@/components/web/blocks/DiscussionThreadBlock")),
);
