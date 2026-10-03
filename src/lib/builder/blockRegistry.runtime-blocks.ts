/**
 * Runtime block definitions for the AISHA Story Canvas editor.
 *
 * 14 blocks: hero-slides, news-list, contact-form, discussion-thread,
 * archive-preview, knowledge-preview, faq-accordion, product-catalog,
 * news-browser, knowledge-browser, archive-browser, studies-browser,
 * guild-directory, aisha-pruvodce.
 *
 * Each entry produces a `data-runtime-block` placeholder in canvas_html.
 */
import {
  Archive,
  BookOpen,
  Compass,
  FlaskConical,
  HelpCircle,
  Image,
  Mail,
  MessagesSquare,
  Newspaper,
  Scroll,
  ShoppingBag,
  Swords,
} from "lucide-react";
import type { RuntimeBlockDefinition, RuntimeConfigField } from "./blockRegistry.types";

/** Reusable limit config field (1-50, default 6). */
const LIMIT_FIELD: RuntimeConfigField = {
  name: "limit",
  type: "number",
  labelKey: "builder.runtime.limit",
  defaultValue: 6,
  min: 1,
  max: 50,
};

/** Reusable columns config field (1-4, default 3). */
const COLUMNS_FIELD: RuntimeConfigField = {
  name: "columns",
  type: "number",
  labelKey: "builder.runtime.columns",
  defaultValue: 3,
  min: 1,
  max: 4,
};

/** @public Runtime blocks available in the GrapesJS editor panel. */
export const RUNTIME_BLOCK_DEFINITIONS: RuntimeBlockDefinition[] = [
  {
    blockType: "hero-slides",
    category: "web",
    descriptionKey: "builder.blocks.hero-slides.description",
    icon: Image,
    nameKey: "builder.blocks.hero-slides.title",
    configFields: [
      { name: "autoplay", type: "checkbox", labelKey: "builder.runtime.autoplay", defaultValue: true },
      { name: "interval", type: "number", labelKey: "builder.runtime.interval", defaultValue: 5000, min: 1000, max: 30000 },
    ],
    editorHtml: `<div data-runtime-block="hero-slides" style="min-height:400px;background:linear-gradient(135deg,var(--sc-ink) 0%,var(--sc-surface-dark) 100%);color:var(--sc-white);display:flex;align-items:center;justify-content:center;padding:40px;text-align:center;border:2px dashed var(--sc-brand);border-radius:8px;">
      <div>
        <div style="font-size:2rem;margin-bottom:8px;">&#9655;</div>
        <p style="font-family:var(--sc-font-family);font-weight:700;font-size:1.1rem;margin:0;">Hero Slides (Runtime Block)</p>
        <p style="color:var(--sc-text-subtle);font-size:0.85rem;margin-top:4px;">Dynamic carousel — rendered at page view time</p>
      </div>
    </div>`,
  },
  {
    blockType: "news-list",
    category: "web",
    descriptionKey: "builder.blocks.news-list.description",
    icon: Newspaper,
    nameKey: "builder.blocks.news-list.title",
    configFields: [LIMIT_FIELD, COLUMNS_FIELD],
    editorHtml: `<div data-runtime-block="news-list" data-block-config='{"limit":6}' style="min-height:200px;background:linear-gradient(135deg,var(--sc-ink) 0%,var(--sc-surface-dark) 100%);color:var(--sc-white);display:flex;align-items:center;justify-content:center;padding:40px;text-align:center;border:2px dashed var(--sc-brand);border-radius:8px;">
      <div>
        <div style="font-size:2rem;margin-bottom:8px;">&#128240;</div>
        <p style="font-family:var(--sc-font-family);font-weight:700;font-size:1.1rem;margin:0;">News List (Runtime Block)</p>
        <p style="color:var(--sc-text-subtle);font-size:0.85rem;margin-top:4px;">Published articles — rendered at page view time</p>
      </div>
    </div>`,
  },
  {
    blockType: "contact-form",
    category: "web",
    descriptionKey: "builder.blocks.contact-form.description",
    icon: Mail,
    nameKey: "builder.blocks.contact-form.title",
    editorHtml: `<div data-runtime-block="contact-form" style="min-height:200px;background:linear-gradient(135deg,var(--sc-ink) 0%,var(--sc-surface-dark) 100%);color:var(--sc-white);display:flex;align-items:center;justify-content:center;padding:40px;text-align:center;border:2px dashed var(--sc-brand);border-radius:8px;">
      <div>
        <div style="font-size:2rem;margin-bottom:8px;">&#9993;</div>
        <p style="font-family:var(--sc-font-family);font-weight:700;font-size:1.1rem;margin:0;">Contact Form (Runtime Block)</p>
        <p style="color:var(--sc-text-subtle);font-size:0.85rem;margin-top:4px;">Interactive contact form — rendered at page view time</p>
      </div>
    </div>`,
  },
  {
    blockType: "discussion-thread",
    category: "web",
    descriptionKey: "builder.blocks.discussion-thread.description",
    icon: MessagesSquare,
    nameKey: "builder.blocks.discussion-thread.title",
    configFields: [
      { name: "nodeType", type: "select", labelKey: "builder.runtime.nodeType.label", defaultValue: "news_article",
        options: [{ id: "news_article", labelKey: "builder.runtime.nodeType.news_article" },
                  { id: "web_page", labelKey: "builder.runtime.nodeType.web_page" }] },
      { name: "nodeId", type: "text", labelKey: "builder.runtime.nodeId", defaultValue: "" },
      LIMIT_FIELD,
    ],
    editorHtml: `<div data-runtime-block="discussion-thread" data-block-config='{"nodeType":"news_article","nodeId":""}' style="min-height:200px;background:linear-gradient(135deg,var(--sc-ink) 0%,var(--sc-surface-dark) 100%);color:var(--sc-white);display:flex;align-items:center;justify-content:center;padding:40px;text-align:center;border:2px dashed var(--sc-brand);border-radius:8px;">
      <div>
        <div style="font-size:2rem;margin-bottom:8px;">&#128172;</div>
        <p style="font-family:var(--sc-font-family);font-weight:700;font-size:1.1rem;margin:0;">Discussion (Runtime Block)</p>
        <p style="color:var(--sc-text-subtle);font-size:0.85rem;margin-top:4px;">User posts under this node — rendered at page view time</p>
      </div>
    </div>`,
  },
  {
    blockType: "archive-preview",
    category: "web",
    descriptionKey: "builder.blocks.archive-preview.description",
    icon: Archive,
    nameKey: "builder.blocks.archive-preview.title",
    configFields: [LIMIT_FIELD],
    editorHtml: `<div data-runtime-block="archive-preview" data-block-config='{"limit":6}' style="min-height:200px;background:linear-gradient(135deg,var(--sc-ink) 0%,var(--sc-surface-dark) 100%);color:var(--sc-white);display:flex;align-items:center;justify-content:center;padding:40px;text-align:center;border:2px dashed var(--sc-brand);border-radius:8px;">
      <div>
        <div style="font-size:2rem;margin-bottom:8px;">&#128451;</div>
        <p style="font-family:var(--sc-font-family);font-weight:700;font-size:1.1rem;margin:0;">Archive Preview (Runtime Block)</p>
        <p style="color:var(--sc-text-subtle);font-size:0.85rem;margin-top:4px;">Archive documents — rendered at page view time</p>
      </div>
    </div>`,
  },
  {
    blockType: "knowledge-preview",
    category: "web",
    descriptionKey: "builder.blocks.knowledge-preview.description",
    icon: BookOpen,
    nameKey: "builder.blocks.knowledge-preview.title",
    configFields: [LIMIT_FIELD],
    editorHtml: `<div data-runtime-block="knowledge-preview" data-block-config='{"limit":6}' style="min-height:200px;background:linear-gradient(135deg,var(--sc-ink) 0%,var(--sc-surface-dark) 100%);color:var(--sc-white);display:flex;align-items:center;justify-content:center;padding:40px;text-align:center;border:2px dashed var(--sc-brand);border-radius:8px;">
      <div>
        <div style="font-size:2rem;margin-bottom:8px;">&#128214;</div>
        <p style="font-family:var(--sc-font-family);font-weight:700;font-size:1.1rem;margin:0;">Knowledge Topics (Runtime Block)</p>
        <p style="color:var(--sc-text-subtle);font-size:0.85rem;margin-top:4px;">Knowledge base topics — rendered at page view time</p>
      </div>
    </div>`,
  },
  {
    blockType: "faq-accordion",
    category: "web",
    descriptionKey: "builder.blocks.faq-accordion.description",
    icon: HelpCircle,
    nameKey: "builder.blocks.faq-accordion.title",
    configFields: [LIMIT_FIELD],
    editorHtml: `<div data-runtime-block="faq-accordion" style="min-height:200px;background:linear-gradient(135deg,var(--sc-ink) 0%,var(--sc-surface-dark) 100%);color:var(--sc-white);display:flex;align-items:center;justify-content:center;padding:40px;text-align:center;border:2px dashed var(--sc-brand);border-radius:8px;">
      <div>
        <div style="font-size:2rem;margin-bottom:8px;">&#10067;</div>
        <p style="font-family:var(--sc-font-family);font-weight:700;font-size:1.1rem;margin:0;">FAQ Accordion (Runtime Block)</p>
        <p style="color:var(--sc-text-subtle);font-size:0.85rem;margin-top:4px;">FAQ categories with accordion — rendered at page view time</p>
      </div>
    </div>`,
  },
  {
    blockType: "product-catalog",
    category: "web",
    descriptionKey: "builder.blocks.product-catalog.description",
    icon: ShoppingBag,
    nameKey: "builder.blocks.product-catalog.title",
    configFields: [COLUMNS_FIELD, LIMIT_FIELD],
    editorHtml: `<div data-runtime-block="product-catalog" data-block-config='{"columns":3}' style="min-height:200px;background:linear-gradient(135deg,var(--sc-ink) 0%,var(--sc-surface-dark) 100%);color:var(--sc-white);display:flex;align-items:center;justify-content:center;padding:40px;text-align:center;border:2px dashed var(--sc-brand);border-radius:8px;">
      <div>
        <div style="font-size:2rem;margin-bottom:8px;">&#128722;</div>
        <p style="font-family:var(--sc-font-family);font-weight:700;font-size:1.1rem;margin:0;">Product Catalog (Runtime Block)</p>
        <p style="color:var(--sc-text-subtle);font-size:0.85rem;margin-top:4px;">Shop products grid &mdash; rendered at page view time</p>
      </div>
    </div>`,
  },
  {
    blockType: "news-browser",
    category: "web",
    descriptionKey: "builder.blocks.news-browser.description",
    icon: Scroll,
    nameKey: "builder.blocks.news-browser.title",
    // Parameterized listing — the admin sets WHAT to show; articles are pulled
    // dynamically from the backend (search/tags/sort), never placed by hand.
    configFields: [
      LIMIT_FIELD,
      { name: "showFilters", type: "checkbox", labelKey: "builder.runtime.showFilters", defaultValue: true },
      { name: "tag", type: "text", labelKey: "builder.runtime.tag", defaultValue: "" },
    ],
    editorHtml: `<div data-runtime-block="news-browser" style="min-height:200px;background:linear-gradient(135deg,var(--sc-ink) 0%,var(--sc-surface-dark) 100%);color:var(--sc-white);display:flex;align-items:center;justify-content:center;padding:40px;text-align:center;border:2px dashed var(--sc-brand);border-radius:8px;">
      <div>
        <div style="font-size:2rem;margin-bottom:8px;">&#128240;</div>
        <p style="font-family:var(--sc-font-family);font-weight:700;font-size:1.1rem;margin:0;">News Browser (Runtime Block)</p>
        <p style="color:var(--sc-text-subtle);font-size:0.85rem;margin-top:4px;">Full news listing with cards &mdash; rendered at page view time</p>
      </div>
    </div>`,
  },
  {
    blockType: "knowledge-browser",
    category: "web",
    descriptionKey: "builder.blocks.knowledge-browser.description",
    icon: BookOpen,
    nameKey: "builder.blocks.knowledge-browser.title",
    configFields: [LIMIT_FIELD, COLUMNS_FIELD],
    editorHtml: `<div data-runtime-block="knowledge-browser" style="min-height:200px;background:linear-gradient(135deg,var(--sc-ink) 0%,var(--sc-surface-dark) 100%);color:var(--sc-white);display:flex;align-items:center;justify-content:center;padding:40px;text-align:center;border:2px dashed var(--sc-brand);border-radius:8px;">
      <div>
        <div style="font-size:2rem;margin-bottom:8px;">&#128218;</div>
        <p style="font-family:var(--sc-font-family);font-weight:700;font-size:1.1rem;margin:0;">Knowledge Browser (Runtime Block)</p>
        <p style="color:var(--sc-text-subtle);font-size:0.85rem;margin-top:4px;">Knowledge topics with search &amp; filters &mdash; rendered at page view time</p>
      </div>
    </div>`,
  },
  {
    blockType: "archive-browser",
    category: "web",
    descriptionKey: "builder.blocks.archive-browser.description",
    icon: Archive,
    nameKey: "builder.blocks.archive-browser.title",
    configFields: [LIMIT_FIELD, COLUMNS_FIELD],
    editorHtml: `<div data-runtime-block="archive-browser" style="min-height:200px;background:linear-gradient(135deg,var(--sc-ink) 0%,var(--sc-surface-dark) 100%);color:var(--sc-white);display:flex;align-items:center;justify-content:center;padding:40px;text-align:center;border:2px dashed var(--sc-brand);border-radius:8px;">
      <div>
        <div style="font-size:2rem;margin-bottom:8px;">&#128451;</div>
        <p style="font-family:var(--sc-font-family);font-weight:700;font-size:1.1rem;margin:0;">Archive Browser (Runtime Block)</p>
        <p style="color:var(--sc-text-subtle);font-size:0.85rem;margin-top:4px;">Full archive with 4-axis filtering &mdash; rendered at page view time</p>
      </div>
    </div>`,
  },
  {
    blockType: "studies-browser",
    category: "web",
    descriptionKey: "builder.blocks.studies-browser.description",
    icon: FlaskConical,
    nameKey: "builder.blocks.studies-browser.title",
    configFields: [LIMIT_FIELD, COLUMNS_FIELD],
    editorHtml: `<div data-runtime-block="studies-browser" style="min-height:200px;background:linear-gradient(135deg,var(--sc-ink) 0%,var(--sc-surface-dark) 100%);color:var(--sc-white);display:flex;align-items:center;justify-content:center;padding:40px;text-align:center;border:2px dashed var(--sc-brand);border-radius:8px;">
      <div>
        <div style="font-size:2rem;margin-bottom:8px;">&#128300;</div>
        <p style="font-family:var(--sc-font-family);font-weight:700;font-size:1.1rem;margin:0;">Studies Browser (Runtime Block)</p>
        <p style="color:var(--sc-text-subtle);font-size:0.85rem;margin-top:4px;">Studies with tab filtering &amp; funding progress &mdash; rendered at page view time</p>
      </div>
    </div>`,
  },
  {
    blockType: "guild-directory",
    category: "web",
    descriptionKey: "builder.blocks.guild-directory.description",
    icon: Swords,
    nameKey: "builder.blocks.guild-directory.title",
    configFields: [LIMIT_FIELD, COLUMNS_FIELD],
    editorHtml: `<div data-runtime-block="guild-directory" style="min-height:200px;background:linear-gradient(135deg,var(--sc-ink) 0%,var(--sc-surface-dark) 100%);color:var(--sc-white);display:flex;align-items:center;justify-content:center;padding:40px;text-align:center;border:2px dashed var(--sc-brand);border-radius:8px;">
      <div>
        <div style="font-size:2rem;margin-bottom:8px;">&#9876;</div>
        <p style="font-family:var(--sc-font-family);font-weight:700;font-size:1.1rem;margin:0;">Guild Directory (Runtime Block)</p>
        <p style="color:var(--sc-text-subtle);font-size:0.85rem;margin-top:4px;">Specialist marketplace with filters &amp; pagination &mdash; rendered at page view time</p>
      </div>
    </div>`,
  },
  {
    blockType: "aisha-pruvodce",
    category: "web",
    descriptionKey: "builder.blocks.aisha-pruvodce.description",
    icon: Compass,
    nameKey: "builder.blocks.aisha-pruvodce.title",
    configFields: [
      { name: "skipHref", type: "text", labelKey: "builder.runtime.skipHref", defaultValue: "/aisha" },
    ],
    editorHtml: `<div data-runtime-block="aisha-pruvodce" data-block-config='{"skipHref":"/aisha"}' style="min-height:400px;background:linear-gradient(135deg,var(--sc-ink) 0%,var(--sc-surface-dark) 100%);color:var(--sc-white);display:flex;align-items:center;justify-content:center;padding:40px;text-align:center;border:2px dashed var(--sc-brand);border-radius:8px;">
      <div>
        <div style="font-size:2rem;margin-bottom:8px;">&#129517;</div>
        <p style="font-family:var(--sc-font-family);font-weight:700;font-size:1.1rem;margin:0;">AISHA Pr\u016fvodce (Runtime Block)</p>
        <p style="color:var(--sc-text-subtle);font-size:0.85rem;margin-top:4px;">13-slide first-visit guide + 5-question quiz &mdash; rendered at page view time</p>
      </div>
    </div>`,
  },
];
