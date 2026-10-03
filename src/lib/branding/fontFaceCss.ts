/**
 * Self-hosted `@font-face` CSS builder for per-instance branding.
 *
 * Extracted from BrandingThemeProvider so the provider file exports only the
 * component (restores React Fast Refresh / HMR) — a pure CSS-string builder is
 * not a component and belongs in lib, per the repo's separation-of-concerns rule.
 */
import type { BrandingProfile } from "@/lib/schemas/brandingProfileSchemas";

/** Allow https:// or root-relative URLs with no CSS-/quote-breaking characters. */
function isSafeFontUrl(url: string): boolean {
  return /^(https:\/\/[^\s)'"\\;,]+|\/[^\s)'"\\;,]+)$/.test(url);
}

/** Font-family names: a letter/digit start, then letters, digits, spaces, hyphens. */
function isSafeFontFamily(family: string): boolean {
  return /^[\w][\w -]*$/.test(family);
}

/**
 * Build self-hosted `@font-face` rules from a branding profile's `font_faces`.
 *
 * The stack default (Nunito Sans, OSS) ships statically in the repo. This lets
 * a private instance inject its OWN licensed font (e.g. Avenir) from the
 * instance's branding-assets host, referenced by the font_family_* tokens.
 *
 * Security: each `src_url` is rendered into a CSS `url(...)` and the family /
 * weight / range into the block. Values are admin-set, but are still validated
 * to prevent CSS injection — an entry that fails validation is skipped, not
 * emitted. Only https:// or root-relative URLs without CSS-breaking characters
 * are allowed.
 */
export function buildFontFaceCss(profile: BrandingProfile): string {
  const faces = profile.font_faces ?? [];
  return faces
    .map((face) => {
      if (!isSafeFontUrl(face.src_url)) return "";
      if (!isSafeFontFamily(face.family)) return "";
      const weight = face.weight && /^[\d ]+$/.test(face.weight) ? face.weight : "400 800";
      const style = face.style === "italic" ? "italic" : "normal";
      const range =
        face.unicode_range && /^[\w +,-]+$/.test(face.unicode_range)
          ? ` unicode-range: ${face.unicode_range};`
          : "";
      return `@font-face { font-family: '${face.family}'; src: url('${face.src_url}') format('woff2'); font-weight: ${weight}; font-style: ${style}; font-display: swap;${range} }`;
    })
    .filter(Boolean)
    .join("\n");
}
