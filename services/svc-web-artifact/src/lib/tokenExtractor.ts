/**
 * CSS token extractor — parses :root custom-property declarations,
 * font-family stacks, and a rough spacing scale from raw CSS.
 *
 * Tolerant: never throws on malformed CSS; bad fragments are skipped.
 */
import type { ExtractedTokens } from '../schemas.js';

const ROOT_BLOCK_RE = /:root\s*\{([^}]*)\}/g;
const VAR_DECL_RE = /(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+)\s*;/g;
const FONT_FAMILY_RE = /font-family\s*:\s*([^;}]+)\s*[;}]/g;

export function extractTokens(css: string): ExtractedTokens {
  const colors: Record<string, string> = {};
  const fonts: Record<string, string> = {};
  const spacing: Record<string, string> = {};
  const other: Record<string, string> = {};

  for (const rootMatch of css.matchAll(ROOT_BLOCK_RE)) {
    const body = rootMatch[1] ?? '';
    for (const declMatch of body.matchAll(VAR_DECL_RE)) {
      const name = declMatch[1].trim();
      const value = declMatch[2].trim();
      if (!name || !value) continue;
      const lower = name.toLowerCase();
      if (lower.includes('color') || lower.includes('bg') || lower.includes('ink') || value.startsWith('#') || value.startsWith('rgb')) {
        colors[name] = value;
      } else if (lower.includes('font') || value.includes('serif') || value.includes('sans-serif') || value.includes('monospace')) {
        fonts[name] = value;
      } else if (lower.includes('space') || lower.includes('gap') || lower.includes('size') || /\b\d+(px|rem|em)\b/.test(value)) {
        spacing[name] = value;
      } else {
        other[name] = value;
      }
    }
  }

  let i = 0;
  for (const m of css.matchAll(FONT_FAMILY_RE)) {
    const value = m[1].trim();
    if (!value) continue;
    if (!Object.values(fonts).includes(value)) {
      fonts[`font_stack_${i++}`] = value;
      if (i > 20) break;
    }
  }

  return { colors, fonts, spacing, other };
}
