/**
 * Zod schemas for branding profile — unified white-label design language.
 *
 * @module lib/schemas/brandingProfileSchemas
 */

import { z } from "zod";

/** HSL color string pattern: "H S% L%" */
const hslColor = z.string().regex(/^\d{1,3}\s+\d{1,3}%\s+\d{1,3}%$/, "Must be HSL format: H S% L%");

/**
 * A single self-hosted `@font-face` an instance may inject via its branding
 * profile. The stack default (Nunito Sans, OSS) ships in the repo; this lets a
 * private instance supply its OWN licensed font (e.g. Avenir) hosted on the
 * instance's branding-assets host — the binary never enters the OSS repo.
 *
 * `src_url` is rendered into a CSS `url(...)`, so it is sanitised at render
 * time (see BrandingThemeProvider.buildFontFaceCss) — only root-relative or
 * https URLs without CSS-breaking characters are emitted.
 */
export const fontFaceSchema = z.object({
  /** font-family name; must match the font_family_* token that references it */
  family: z.string().min(1),
  /** woff2 URL — https://… or root-relative /… (instance-hosted) */
  src_url: z.string().min(1),
  /** font-weight, e.g. "400" or a variable range "400 800" */
  weight: z.string().nullable().optional(),
  /** font-style: "normal" | "italic" */
  style: z.string().nullable().optional(),
  /** optional unicode-range subset */
  unicode_range: z.string().nullable().optional(),
});

export type FontFace = z.infer<typeof fontFaceSchema>;

/** Branding profile as returned by get_branding_profile RPC */
export const brandingProfileSchema = z.object({
  id: z.string().uuid(),
  partner_id: z.string().uuid().nullable(),
  status: z.enum(["draft", "published"]),

  // Colors (light mode)
  color_accent: hslColor,
  color_background: hslColor,
  color_destructive: hslColor,
  color_foreground: hslColor,
  color_muted: hslColor,
  color_primary: hslColor,
  color_secondary: hslColor,
  color_surface: hslColor,

  // Colors (dark mode overrides — nullable, auto-derived if absent)
  dark_color_background: hslColor.nullable().optional(),
  dark_color_foreground: hslColor.nullable().optional(),
  dark_color_muted: hslColor.nullable().optional(),
  dark_color_primary: hslColor.nullable().optional(),
  dark_color_surface: hslColor.nullable().optional(),

  // Typography
  font_family_body: z.string().min(1),
  font_family_brand: z.string().min(1),
  font_family_code: z.string().min(1),
  /**
   * Optional per-instance self-hosted @font-face definitions. Absent/null for
   * the OSS default (Nunito Sans ships statically); populated by private
   * instances to load their own licensed font referenced by font_family_*.
   */
  font_faces: z.array(fontFaceSchema).nullable().optional(),

  // Brand assets
  favicon_path: z.string().nullable().optional(),
  login_logo_path: z.string().nullable().optional(),
  logo_dark_path: z.string().nullable().optional(),
  logo_path: z.string().nullable().optional(),

  // Operator identity
  operator_address: z.string().nullable().optional(),
  operator_email: z.string().email(),
  operator_name: z.string().min(1),
  operator_phone: z.string().nullable().optional(),
  operator_url: z.string().url().nullable().optional(),

  // Email styling
  email_footer_text: z.string().nullable().optional(),
  email_header_bg: hslColor.nullable().optional(),

  // Login / Keycloak theme
  login_accent_color: hslColor.nullable().optional(),
  login_background_color: hslColor.nullable().optional(),
  login_card_bg: z.string().nullable().optional(),

  // Metadata
  profile_version: z.number(),
  published_at: z.string().nullable().optional(),
  resolved_for: z.string().uuid().optional(),
  updated_at: z.string(),
});

export type BrandingProfile = z.infer<typeof brandingProfileSchema>;

/** RPC response wrapper from get_branding_profile */
export const brandingProfileRpcResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), profile: brandingProfileSchema }),
  z.object({ status: z.literal("not_found") }),
]);

export type BrandingProfileRpcResponse = z.infer<typeof brandingProfileRpcResponseSchema>;

/** Form data shape for admin branding editor */
export const brandingProfileFormSchema = z.object({
  color_accent: hslColor,
  color_background: hslColor,
  color_destructive: hslColor,
  color_foreground: hslColor,
  color_muted: hslColor,
  color_primary: hslColor,
  color_secondary: hslColor,
  color_surface: hslColor,
  dark_color_background: hslColor.optional(),
  dark_color_foreground: hslColor.optional(),
  dark_color_muted: hslColor.optional(),
  dark_color_primary: hslColor.optional(),
  dark_color_surface: hslColor.optional(),
  email_footer_text: z.string().optional(),
  email_header_bg: hslColor.optional(),
  favicon_path: z.string().optional(),
  font_family_body: z.string().min(1),
  font_family_brand: z.string().min(1),
  font_family_code: z.string().min(1),
  font_faces: z.array(fontFaceSchema).nullable().optional(),
  login_accent_color: hslColor.optional(),
  login_background_color: hslColor.optional(),
  login_card_bg: z.string().optional(),
  login_logo_path: z.string().optional(),
  logo_dark_path: z.string().optional(),
  logo_path: z.string().optional(),
  operator_address: z.string().optional(),
  operator_email: z.string().email(),
  operator_name: z.string().min(1),
  operator_phone: z.string().optional(),
  operator_url: z.string().url().optional().or(z.literal("")),
  partner_id: z.string().uuid().nullable(),
});

export type BrandingProfileFormData = z.infer<typeof brandingProfileFormSchema>;

/** Default values for new branding profile form */
export const DEFAULT_BRANDING_PROFILE: BrandingProfileFormData = {
  color_accent: "22 100% 88%",
  color_background: "210 20% 98%",
  color_destructive: "0 85% 66%",
  color_foreground: "0 0% 10%",
  color_muted: "220 9% 46%",
  color_primary: "23 100% 55%",
  color_secondary: "210 16% 95%",
  color_surface: "0 0% 100%",
  font_family_body: "Nunito Sans, sans-serif",
  font_family_brand: "Nunito Sans, sans-serif",
  font_family_code: "JetBrains Mono, monospace",
  font_faces: null,
  operator_email: "support@platform.com",
  operator_name: "Platform",
  partner_id: null,
};

/**
 * Derive CSS custom properties map from a branding profile.
 * Used by BrandingThemeProvider to inject runtime variables.
 */
export function brandingToCssVariables(profile: BrandingProfile): Record<string, string> {
  return {
    "--primary": profile.color_primary,
    "--secondary": profile.color_secondary,
    "--accent": profile.color_accent,
    "--background": profile.color_background,
    "--foreground": profile.color_foreground,
    "--muted-foreground": profile.color_muted,
    "--card": profile.color_surface,
    "--destructive": profile.color_destructive,
    "--ring": profile.color_primary,
    "--brand": profile.color_primary,
    "--brand-light": profile.color_accent,
    "--sidebar-primary": profile.color_primary,
    "--sidebar-ring": profile.color_primary,
  };
}

/**
 * Derive dark-mode CSS custom properties.
 * Falls back to reasonable auto-derivation when dark overrides not specified.
 */
export function brandingToDarkCssVariables(profile: BrandingProfile): Record<string, string> {
  return {
    "--primary": profile.dark_color_primary ?? profile.color_primary,
    "--background": profile.dark_color_background ?? "0 0% 10%",
    "--foreground": profile.dark_color_foreground ?? "0 0% 98%",
    "--card": profile.dark_color_surface ?? "0 0% 16%",
    "--muted-foreground": profile.dark_color_muted ?? "220 9% 65%",
    "--accent": profile.color_accent,
    "--ring": profile.dark_color_primary ?? profile.color_primary,
    "--brand": profile.dark_color_primary ?? profile.color_primary,
    "--sidebar-primary": profile.dark_color_primary ?? profile.color_primary,
    "--sidebar-ring": profile.dark_color_primary ?? profile.color_primary,
  };
}
