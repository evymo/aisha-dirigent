/**
 * HTML → GrapesJS ProjectData converter.
 *
 * - jsdom parses raw HTML.
 * - DOMPurify strips hostile content (script tags, on* handlers, javascript: URLs).
 * - The cleaned body is wrapped into a single-page ProjectData document.
 * - `<style>` blocks + same-origin .css files combined into canvas_css.
 * - Runtime block suggestions are produced from the cleaned DOM.
 * - i18n keys collected.
 *
 * Tolerant: malformed input never throws — only the worst-case empty document.
 */
import { JSDOM } from 'jsdom';
import DOMPurify from 'isomorphic-dompurify';
import type { ParseResult, ProjectData, ExtractedTokens, RuntimeBlockSuggestion } from '../schemas.js';
import { extractTokens } from './tokenExtractor.js';
// ⛔ JEDINÝ DOMOV TRANSFORMACE. Tahle funkce tu dřív žila v lokálním
// `i18nKeyExtractor.ts` — jenže tutéž logiku měl i PageRenderer v prohlížeči,
// takže existovaly DVĚ implementace téhož a nic je nedrželo v souladu.
// Nález 2026-08-30 při stavbě generátoru statických stránek, kde by vznikla
// TŘETÍ. Sjednoceno do @aisha/web-canvas; lokální kopie smazána.
import { extractI18nKeysFromDocument as extractI18nKeys } from '@aisha/web-canvas';
import { detectRuntimeBlocks } from './runtimeBlockDetector.js';

export interface ConvertInput {
  /** Primary HTML file content. */
  html: string;
  /** Concatenated CSS from <link>/<style> + inline. */
  css: string;
  /** Map of asset filename → public URL (already uploaded somewhere). */
  assetUrlMap?: Record<string, string>;
}

export type ConvertResult = ParseResult;

export function htmlToProjectData(input: ConvertInput): ConvertResult {
  const dom = new JSDOM(input.html || '<!doctype html><html><head></head><body></body></html>');
  const doc = dom.window.document;

  const purify = DOMPurify;
  purify.setConfig({
    USE_PROFILES: { html: true, svg: true },
    FORBID_TAGS: ['script', 'object', 'embed', 'iframe'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'onsubmit', 'onchange', 'onkeydown', 'onkeyup', 'onkeypress'],
    ADD_ATTR: [
      'data-i18n-key',
      'data-i18n',
      'data-i18n-placeholder-key',
      'data-i18n-title-key',
      'data-i18n-aria-label-key',
      'data-i18n-alt-key',
      'data-section',
      'data-template',
      'data-runtime-block',
      'data-block-config',
      'placeholder',
      'title',
      'aria-label',
      'alt',
    ],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|sms):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });

  const sanitizedBody = purify.sanitize(doc.body.innerHTML, { RETURN_DOM_FRAGMENT: false });
  const safeDom = new JSDOM(`<!doctype html><html><head></head><body>${sanitizedBody}</body></html>`);
  const safeDoc = safeDom.window.document;

  if (input.assetUrlMap) {
    safeDoc.querySelectorAll('img,source,video,audio').forEach((el: Element) => {
      const src = el.getAttribute('src');
      if (src && input.assetUrlMap![src]) el.setAttribute('src', input.assetUrlMap![src]);
    });
    safeDoc.querySelectorAll('a').forEach((el: Element) => {
      const href = el.getAttribute('href');
      if (href && input.assetUrlMap![href]) el.setAttribute('href', input.assetUrlMap![href]);
    });
  }

  const canvas_html = safeDoc.body.innerHTML;
  const canvas_css = stripCssImports(input.css);
  const extracted_tokens: ExtractedTokens = extractTokens(canvas_css);
  const runtime_block_suggestions: RuntimeBlockSuggestion[] = detectRuntimeBlocks(safeDoc);
  const i18n_keys_used = extractI18nKeys(safeDoc);

  const assets = collectAssets(safeDoc, input.assetUrlMap ?? {});
  const broken_assets = collectBrokenAssets(safeDoc, input.assetUrlMap ?? {});

  const projectData: ProjectData = {
    pages: [
      {
        component: `<body>${canvas_html}</body>`,
        frame: { x: 0, y: 0 },
      },
    ],
    styles: [
      {
        selectors: ['__inline__'],
        style: {} as Record<string, string>,
      },
    ],
    assets: assets.map((src) => ({ src, type: inferAssetType(src) })),
  };

  return {
    canvas_data: projectData,
    canvas_html,
    canvas_css,
    extracted_tokens,
    runtime_block_suggestions,
    i18n_keys_used,
    broken_assets,
  };
}

function stripCssImports(css: string): string {
  return css.replace(/@import\s+[^;]+;/g, '').trim();
}

function collectAssets(doc: Document, mapping: Record<string, string>): string[] {
  const set = new Set<string>();
  doc.querySelectorAll('img,source,video,audio').forEach((el) => {
    const src = el.getAttribute('src');
    if (src) set.add(mapping[src] ?? src);
  });
  return Array.from(set);
}

function collectBrokenAssets(doc: Document, mapping: Record<string, string>): string[] {
  const broken: string[] = [];
  doc.querySelectorAll('img,source,video,audio').forEach((el) => {
    const src = el.getAttribute('src');
    if (!src) return;
    if (!mapping[src] && !/^https?:\/\//i.test(src) && !src.startsWith('data:')) {
      broken.push(src);
    }
  });
  return broken;
}

function inferAssetType(src: string): string {
  const lower = src.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|svg|avif)(\?|$)/.test(lower)) return 'image';
  if (/\.(mp4|webm|mov)(\?|$)/.test(lower)) return 'video';
  if (/\.(mp3|wav|ogg|aac)(\?|$)/.test(lower)) return 'audio';
  if (/\.(woff2?|ttf|otf|eot)(\?|$)/.test(lower)) return 'font';
  return 'other';
}
