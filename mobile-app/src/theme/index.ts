/**
 * Theme constants for the mobile surface — AISHA brand design tokens.
 *
 * AUTO-GENERATED from a design-tokens brand file — do not edit.
 *   npm run gen:tokens                      (this stack's brand)
 *   node packages/design-tokens/build.mjs --brand <file> --out <path>
 *
 * @brand packages/design-tokens/tokens.json
 *
 * The shape (colors/spacing/typography) is the contract this app's call sites
 * depend on; the values are the brand. Instances re-skin by supplying their own
 * brand file — the app is not forked.
 */
export const colors = {
  primary: "#FF6A1A",        // brand orange
  primaryDark: "#E55A10",    // hover / press
  secondary: "#FF8A4D",      // warm orange tint (was violet)
  background: "#0E0E10",     // editorial near-black
  surface: "#141417",        // lifted panel
  surfaceLight: "#1F1F24",   // elevated
  text: "#FFFFFF",
  textSecondary: "#9A9AA2",  // muted
  textMuted: "#6A6A72",      // meta / captions
  border: "#26262B",         // hairline
  error: "#F87171",
  warning: "#FACC15",
  success: "#4ADE80",
  info: "#60A5FA",
  // Severity scale (functional spectrum — kept)
  critical: "#DC2626",
  high: "#EA580C",
  moderate: "#D97706",
  low: "#65A30D",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const typography = {
  h1: { fontSize: 28, fontWeight: "700" as const, color: colors.text, },
  h2: { fontSize: 22, fontWeight: "600" as const, color: colors.text, },
  h3: { fontSize: 18, fontWeight: "600" as const, color: colors.text, },
  body: { fontSize: 16, fontWeight: "400" as const, color: colors.text, },
  bodySmall: { fontSize: 14, fontWeight: "400" as const, color: colors.textSecondary, },
  caption: { fontSize: 12, fontWeight: "400" as const, color: colors.textMuted, },
  label: { fontSize: 14, fontWeight: "600" as const, color: colors.textSecondary, },
  micro: { fontSize: 10, fontWeight: "700" as const, color: colors.textSecondary, },
  nano: { fontSize: 9, fontWeight: "700" as const, color: colors.textMuted, },
  ghost: { fontSize: 84, fontWeight: "800" as const, color: colors.textMuted, },
  data: { fontSize: 16, fontWeight: "600" as const, color: colors.text, fontFamily: "ui-monospace, \"JetBrains Mono\", \"SF Mono\", Menlo, Consolas, monospace", },
  dataSmall: { fontSize: 13, fontWeight: "500" as const, color: colors.textSecondary, fontFamily: "ui-monospace, \"JetBrains Mono\", \"SF Mono\", Menlo, Consolas, monospace", },
  dataMicro: { fontSize: 10, fontWeight: "500" as const, color: colors.textMuted, fontFamily: "ui-monospace, \"JetBrains Mono\", \"SF Mono\", Menlo, Consolas, monospace", },
  dataHero: { fontSize: 44, fontWeight: "800" as const, color: colors.text, fontFamily: "ui-monospace, \"JetBrains Mono\", \"SF Mono\", Menlo, Consolas, monospace", },
} as const;
