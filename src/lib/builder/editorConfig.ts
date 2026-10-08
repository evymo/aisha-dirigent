/**
 * GrapesJS editor configuration for the Aisha page builder.
 *
 * Provides Style Manager sectors, device presets, and other
 * editor configuration that enables full visual editing of
 * page properties (backgrounds, typography, spacing, etc.)
 *
 * Typography font-family options are derived from the active
 * branding profile tokens when available.
 *
 * @module
 */

import type { CustomParserCss, EditorConfig, UploadFileClb } from "grapesjs";
import ikonySablonCssUrl from "@/styles/ikony-sablon.css?url";
import { parserCssZachovaPromenne } from "./parserCssZachovaPromenne";

/**
 * Branding tokens subset consumed by the editor config.
 * Keeps the dependency surface minimal — only what the editor needs.
 */
export interface EditorBrandingTokens {
  font_family_body: string;
  font_family_brand: string;
  font_family_code: string;
}

// =====================================================
// Style Manager Sectors
// =====================================================

/** Default font tokens used when no branding profile is available. */
const DEFAULT_EDITOR_FONTS: EditorBrandingTokens = {
  font_family_body: "Nunito Sans, sans-serif",
  font_family_brand: "Nunito Sans, sans-serif",
  font_family_code: "JetBrains Mono, monospace",
};

/**
 * Build font-family select options from branding tokens.
 * Always includes System UI as a fallback option.
 */
function buildFontFamilyOptions(tokens: EditorBrandingTokens) {
  const seen = new Set<string>();
  const options: { id: string; label: string }[] = [];

  const add = (value: string, label: string) => {
    if (!seen.has(value)) {
      seen.add(value);
      options.push({ id: value, label });
    }
  };

  add(tokens.font_family_brand, extractFontLabel(tokens.font_family_brand));
  if (tokens.font_family_body !== tokens.font_family_brand) {
    add(tokens.font_family_body, extractFontLabel(tokens.font_family_body));
  }
  add(tokens.font_family_code, extractFontLabel(tokens.font_family_code));
  add("Georgia, serif", "Georgia");
  add("system-ui, sans-serif", "System UI");

  return options;
}

/** Extract a display label from a CSS font-family value (first family name). */
function extractFontLabel(fontStack: string): string {
  const first = fontStack.split(",")[0].trim().replace(/['"]/g, "");
  return first || fontStack;
}

/**
 * Style Manager sectors define which CSS properties the user
 * can edit in the Styles panel for any selected element.
 */
function buildStyleManagerSectors(tokens: EditorBrandingTokens): EditorConfig["styleManager"] {
  return {
    sectors: [
    {
      name: "Layout",
      open: false,
      properties: [
        { property: "display", type: "select", options: [
          { id: "block", label: "Block" },
          { id: "flex", label: "Flex" },
          { id: "grid", label: "Grid" },
          { id: "inline-block", label: "Inline Block" },
          { id: "none", label: "None" },
        ]},
        { property: "flex-direction", type: "select", options: [
          { id: "row", label: "Row" },
          { id: "column", label: "Column" },
          { id: "row-reverse", label: "Row Reverse" },
          { id: "column-reverse", label: "Column Reverse" },
        ]},
        { property: "justify-content", type: "select", options: [
          { id: "flex-start", label: "Start" },
          { id: "center", label: "Center" },
          { id: "flex-end", label: "End" },
          { id: "space-between", label: "Space Between" },
          { id: "space-around", label: "Space Around" },
          { id: "space-evenly", label: "Space Evenly" },
        ]},
        { property: "align-items", type: "select", options: [
          { id: "flex-start", label: "Start" },
          { id: "center", label: "Center" },
          { id: "flex-end", label: "End" },
          { id: "stretch", label: "Stretch" },
          { id: "baseline", label: "Baseline" },
        ]},
        { property: "gap" },
        { property: "position", type: "select", options: [
          { id: "static", label: "Static" },
          { id: "relative", label: "Relative" },
          { id: "absolute", label: "Absolute" },
          { id: "fixed", label: "Fixed" },
          { id: "sticky", label: "Sticky" },
        ]},
        { property: "overflow", type: "select", options: [
          { id: "visible", label: "Visible" },
          { id: "hidden", label: "Hidden" },
          { id: "auto", label: "Auto" },
          { id: "scroll", label: "Scroll" },
        ]},
        { property: "z-index" },
      ],
    },
    {
      name: "Dimension",
      open: false,
      properties: [
        { property: "width" },
        { property: "min-width" },
        { property: "max-width" },
        { property: "height" },
        { property: "min-height" },
        { property: "max-height" },
        { property: "padding", type: "composite", properties: [
          { property: "padding-top" },
          { property: "padding-right" },
          { property: "padding-bottom" },
          { property: "padding-left" },
        ]},
        { property: "margin", type: "composite", properties: [
          { property: "margin-top" },
          { property: "margin-right" },
          { property: "margin-bottom" },
          { property: "margin-left" },
        ]},
      ],
    },
    {
      name: "Typography",
      open: false,
      properties: [
        { property: "font-family", type: "select", options: buildFontFamilyOptions(tokens) },
        { property: "font-size" },
        { property: "font-weight", type: "select", options: [
          { id: "300", label: "Light" },
          { id: "400", label: "Normal" },
          { id: "500", label: "Medium" },
          { id: "600", label: "Semibold" },
          { id: "700", label: "Bold" },
          { id: "800", label: "Extra Bold" },
        ]},
        { property: "line-height" },
        { property: "letter-spacing" },
        { property: "text-align", type: "select", options: [
          { id: "left", label: "Left" },
          { id: "center", label: "Center" },
          { id: "right", label: "Right" },
          { id: "justify", label: "Justify" },
        ]},
        { property: "text-transform", type: "select", options: [
          { id: "none", label: "None" },
          { id: "uppercase", label: "Uppercase" },
          { id: "lowercase", label: "Lowercase" },
          { id: "capitalize", label: "Capitalize" },
        ]},
        { property: "text-decoration", type: "select", options: [
          { id: "none", label: "None" },
          { id: "underline", label: "Underline" },
          { id: "line-through", label: "Line Through" },
        ]},
        { property: "color", type: "color" },
      ],
    },
    {
      name: "Background",
      open: true,
      properties: [
        { property: "background-color", type: "color" },
        { property: "background-image" },
        { property: "background-repeat", type: "select", options: [
          { id: "no-repeat", label: "No Repeat" },
          { id: "repeat", label: "Repeat" },
          { id: "repeat-x", label: "Repeat X" },
          { id: "repeat-y", label: "Repeat Y" },
        ]},
        { property: "background-position" },
        { property: "background-size", type: "select", options: [
          { id: "auto", label: "Auto" },
          { id: "cover", label: "Cover" },
          { id: "contain", label: "Contain" },
        ]},
        { property: "background" },
      ],
    },
    {
      name: "Borders",
      open: false,
      properties: [
        { property: "border-radius" },
        { property: "border", type: "composite", properties: [
          { property: "border-width" },
          { property: "border-style", type: "select", options: [
            { id: "none", label: "None" },
            { id: "solid", label: "Solid" },
            { id: "dashed", label: "Dashed" },
            { id: "dotted", label: "Dotted" },
          ]},
          { property: "border-color", type: "color" },
        ]},
        { property: "box-shadow" },
      ],
    },
    {
      name: "Effects",
      open: false,
      properties: [
        { property: "opacity" },
        { property: "transition" },
        { property: "transform" },
        { property: "backdrop-filter" },
      ],
    },
  ],
  };
}

// =====================================================
// Device Presets
// =====================================================

/**
 * Device presets for responsive preview in the editor.
 */
const DEVICE_MANAGER_DEVICES: EditorConfig["deviceManager"] = {
  devices: [
    { name: "Desktop", width: "" },
    { name: "Tablet", width: "768px", widthMedia: "992px" },
    { name: "Mobile", width: "375px", widthMedia: "480px" },
  ],
};

// =====================================================
// Canvas Styles
// =====================================================

/**
 * Build canvas CSS with font from branding tokens.
 * Imports the brand font, sets sensible defaults, and injects
 * Story Canvas (--sc-*) tokens so var() refs in block templates resolve.
 */
function buildCanvasCss(tokens: EditorBrandingTokens): string {
  return `
  @import url('/fonts/nunito-sans/fonts.css');
  :root {
    --sc-brand: #FF6A1A;
    --sc-brand-tint-15: rgba(255, 106, 26, 0.15);
    --sc-brand-tint-10: rgba(255, 106, 26, 0.1);
    --sc-ink: #1A1A1A;
    --sc-surface-dark: #2D2D2D;
    --sc-surface-footer: #111;
    --sc-text-body: #333;
    --sc-text-medium: #444;
    --sc-text-muted: #666;
    --sc-text-subtle: #aaa;
    --sc-text-light: #ccc;
    --sc-text-footer: #9ca3af;
    --sc-white: #fff;
    --sc-surface-light: #fafafa;
    --sc-surface-lighter: #f8f8f8;
    --sc-border: #e5e5e5;
    --sc-border-input: #d1d5db;
    --sc-shadow-subtle: rgba(0, 0, 0, 0.1);
    --sc-font-family: 'Nunito Sans', sans-serif;
    --sc-wf-meeting: #60a5fa;
    --sc-wf-questionnaire: #a78bfa;
    --sc-wf-consent: #34d399;
    --sc-wf-action: #fb923c;
    --sc-wf-info: #94a3b8;
    --sc-wf-text: #6b7280;
  }

  /* Color Scheme Overrides */
  .sc-scheme-warm-sunset {
    --sc-brand: #E85D26;
    --sc-brand-tint-15: rgba(232, 93, 38, 0.15);
    --sc-brand-tint-10: rgba(232, 93, 38, 0.10);
    --sc-ink: #2C1810;
    --sc-surface-dark: #3D2014;
    --sc-text-body: #4A2C1A;
    --sc-text-medium: #5C3A24;
    --sc-surface-light: #FFF8F4;
    --sc-surface-lighter: #FFF5EF;
  }
  .sc-scheme-cool-ocean {
    --sc-brand: #2563EB;
    --sc-brand-tint-15: rgba(37, 99, 235, 0.15);
    --sc-brand-tint-10: rgba(37, 99, 235, 0.10);
    --sc-ink: #0F172A;
    --sc-surface-dark: #1E293B;
    --sc-text-body: #1E3A5F;
    --sc-text-medium: #2D4A6F;
    --sc-surface-light: #F0F7FF;
    --sc-surface-lighter: #F5F9FF;
  }
  .sc-scheme-forest-green {
    --sc-brand: #16A34A;
    --sc-brand-tint-15: rgba(22, 163, 74, 0.15);
    --sc-brand-tint-10: rgba(22, 163, 74, 0.10);
    --sc-ink: #14291A;
    --sc-surface-dark: #1A3D24;
    --sc-text-body: #1C4428;
    --sc-text-medium: #2D5A3A;
    --sc-surface-light: #F0FDF4;
    --sc-surface-lighter: #F5FFF8;
  }
  .sc-scheme-dark-elegant {
    --sc-brand: #A78BFA;
    --sc-brand-tint-15: rgba(167, 139, 250, 0.15);
    --sc-brand-tint-10: rgba(167, 139, 250, 0.10);
    --sc-ink: #E2E8F0;
    --sc-surface-dark: #0F0F23;
    --sc-surface-footer: #08081A;
    --sc-text-body: #CBD5E1;
    --sc-text-medium: #94A3B8;
    --sc-text-muted: #64748B;
    --sc-white: #1E1E3A;
    --sc-surface-light: #1A1A35;
    --sc-surface-lighter: #16162E;
    --sc-border: #334155;
  }
  .sc-scheme-soft-lavender {
    --sc-brand: #8B5CF6;
    --sc-brand-tint-15: rgba(139, 92, 246, 0.15);
    --sc-brand-tint-10: rgba(139, 92, 246, 0.10);
    --sc-ink: #1E1033;
    --sc-surface-dark: #2D1B4E;
    --sc-text-body: #3B2463;
    --sc-text-medium: #4C3575;
    --sc-surface-light: #FAF5FF;
    --sc-surface-lighter: #FDF8FF;
  }
  .sc-scheme-neutral-slate {
    --sc-brand: #64748B;
    --sc-brand-tint-15: rgba(100, 116, 139, 0.15);
    --sc-brand-tint-10: rgba(100, 116, 139, 0.10);
    --sc-ink: #0F172A;
    --sc-surface-dark: #1E293B;
    --sc-text-body: #334155;
    --sc-text-medium: #475569;
    --sc-surface-light: #F8FAFC;
    --sc-surface-lighter: #F1F5F9;
  }

  body {
    font-family: ${tokens.font_family_body};
    margin: 0;
    padding: 0;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  * { box-sizing: border-box; }
`;
}

// =====================================================
// Exported Config
// =====================================================

/** Callback type for uploading an asset file. Returns public URL. */
export type AssetUploadHandler = (file: File) => Promise<string>;

/**
 * Returns the GrapesJS editor options for the page builder.
 *
 * Merges style manager, device manager, asset manager, and canvas
 * config with caller-provided overrides. When branding tokens are
 * provided, typography options and canvas CSS reflect the active profile.
 *
 * @param brandingTokens - Optional branding font tokens for dynamic theming.
 * @param assetUploadHandler - Optional handler for uploading assets to storage.
 * @param overrides - Additional GrapesJS config overrides.
 */
export function getPageEditorConfig(
  brandingTokens?: EditorBrandingTokens,
  assetUploadHandler?: AssetUploadHandler,
  overrides?: Partial<EditorConfig>,
): Partial<EditorConfig> {
  const tokens = brandingTokens ?? DEFAULT_EDITOR_FONTS;

  return {
    height: "100%",
    storageManager: false,
    // ⛔ CSS PRAVIDLA BEZ SELEKTORU NA PLÁTNĚ SE PŘI ULOŽENÍ NESMÍ ZAHODIT
    // (naměřeno 2026-09-03 headless GrapesJS 0.22.16 + jsdom, audit U5-1).
    // Výchozí `getCss()` vydá jen pravidla, jejichž selektor právě sedí na
    // nějaké komponentě. Útržky nav/footer jsou v plátně prázdné
    // `<div data-partial>`, takže .nav*, .foot*, .pagehead, .prose, h1–h4, p
    // na plátně „nejsou" — a index.canvas_css šel z 27 032 B na 9 777 B,
    // 34 selektorů pryč. Autosave běží 5 s po změně: stačilo stránku otevřít
    // a kliknout. Sdílené CSS webu patří stránce celé, ne jen tomu, co je
    // zrovna vidět.
    keepUnusedStyles: true,
    panels: { defaults: [] },
    // Výchozí `cssIcons` táhne font-awesome z cdnjs — CSP ho blokuje a vlastní UI
    // editoru (EditorSidebar, lucide ikony) ho nepotřebuje.
    cssIcons: "",
    styleManager: buildStyleManagerSectors(tokens),
    deviceManager: DEVICE_MANAGER_DEVICES,
    assetManager: {
      uploadFile: assetUploadHandler
        ? async (ev: DragEvent, clb?: UploadFileClb) => {
            const files: File[] = [];
            const dropped = ev.dataTransfer?.files;
            if (dropped && dropped.length > 0) {
              for (let i = 0; i < dropped.length; i++) {
                files.push(dropped[i]);
              }
            } else {
              const target = ev.target;
              const input = target instanceof HTMLInputElement ? target : null;
              if (input?.files) {
                for (let i = 0; i < input.files.length; i++) {
                  files.push(input.files[i]);
                }
              }
            }
            const urls: string[] = [];
            for (const file of files) {
              const url = await assetUploadHandler(file);
              urls.push(url);
            }
            // GrapesJS consumes uploaded assets via the callback (autoAdd wires
            // them into the asset manager); the return value is void.
            clb?.({ data: urls });
          }
        : undefined,
      autoAdd: true,
    },
    canvas: {
      // Ikony šablon (`ti ti-…`) i v plátně editoru — týž soubor jako na webu
      // (src/index.css ho importuje). Odkazem, ne textem: soubor je jediný zdroj.
      styles: [ikonySablonCssUrl],
      scripts: [],
    },
    canvasCss: buildCanvasCss(tokens),
    // ⛔ Výchozí parser CSS zahazoval zkratky s proměnnými (`background:
    // linear-gradient(… var(--x) …)`, `padding: var(--space-6)` …) — první
    // změna stylu pak uložila CSS celé stránky bez nich (2026-10-02, z instance:
    // 40/40 takových deklarací pryč z úvodní stránky). Viz parserCssZachovaPromenne.
    // Výstup má tvar vestavěného parseru (pole selektorů), ne užší ParsedCssRule
    // z typů GrapesJS — checkNode ho propouští beze změny.
    parser: { parserCss: parserCssZachovaPromenne as unknown as CustomParserCss },
    ...overrides,
  };
}
