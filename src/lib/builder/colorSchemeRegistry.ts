/**
 * Color scheme registry for the AISHA Story Canvas builder.
 *
 * Each scheme applies a CSS class to the block section that overrides
 * `--sc-*` tokens locally. Schemes are **orthogonal** to layout variants:
 * any block variant × any color scheme = valid combination.
 *
 * Admin can restrict which schemes are available per story via
 * the `allowed_color_schemes` column on `web_pages`.
 *
 * @module
 */

/** A single color scheme definition. */
export interface ColorScheme {
  /** Unique identifier (kebab-case). Used as `data-color-scheme` attribute value. */
  id: string;
  /** CSS class applied to the section element (e.g. `"sc-scheme-warm-sunset"`). */
  cssClass: string;
  /** i18n key for the scheme label shown in the traits panel. */
  labelKey: string;
}

/**
 * Default color scheme catalog.
 *
 * Design principle: schemes control **accent + surface tones**, never layout.
 * Every scheme maps to a CSS class that overrides `--sc-brand`, `--sc-ink`,
 * `--sc-surface-*`, and `--sc-text-*` tokens.
 */
export const COLOR_SCHEME_REGISTRY: ColorScheme[] = [
  {
    id: "default",
    cssClass: "",
    labelKey: "builder.schemes.default",
  },
  {
    id: "warm-sunset",
    cssClass: "sc-scheme-warm-sunset",
    labelKey: "builder.schemes.warmSunset",
  },
  {
    id: "cool-ocean",
    cssClass: "sc-scheme-cool-ocean",
    labelKey: "builder.schemes.coolOcean",
  },
  {
    id: "forest-green",
    cssClass: "sc-scheme-forest-green",
    labelKey: "builder.schemes.forestGreen",
  },
  {
    id: "dark-elegant",
    cssClass: "sc-scheme-dark-elegant",
    labelKey: "builder.schemes.darkElegant",
  },
  {
    id: "soft-lavender",
    cssClass: "sc-scheme-soft-lavender",
    labelKey: "builder.schemes.softLavender",
  },
  {
    id: "neutral-slate",
    cssClass: "sc-scheme-neutral-slate",
    labelKey: "builder.schemes.neutralSlate",
  },
];

/** Lookup a scheme by ID. Falls back to "default" if not found. */
export function getColorScheme(schemeId: string): ColorScheme {
  return (
    COLOR_SCHEME_REGISTRY.find((s) => s.id === schemeId) ??
    COLOR_SCHEME_REGISTRY[0]
  );
}

/** Build trait options for the color scheme dropdown. */
export function getColorSchemeTraitOptions(
  allowedIds: string[] | null,
  t: (key: string) => string,
): Array<{ id: string; label: string }> {
  const schemes = allowedIds
    ? COLOR_SCHEME_REGISTRY.filter((s) => s.id === "default" || allowedIds.includes(s.id))
    : COLOR_SCHEME_REGISTRY;

  return schemes.map((s) => ({
    id: s.id,
    label: t(s.labelKey),
  }));
}
