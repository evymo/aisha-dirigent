/**
 * Brand tokens for the current build — the single runtime source for the app's
 * product name, set by version.json (app.displayName + brand.shortName) via the
 * resolved Expo config. Anything user-facing that names the product must read
 * from here (or from an i18n {{brand}}/{{brandFull}} placeholder) so a white-label
 * reskin — which edits only version.json — has no leftover brand literal in the UI.
 */
import Constants from "expo-constants";

/** Full product name — version.json `app.displayName` (Expo config.name). */
export const BRAND_FULL: string = Constants.expoConfig?.name ?? "App";

/** Short brand token — version.json `brand.shortName` (extra.AISHA_BRAND_SHORT). */
export const BRAND_SHORT: string =
  (Constants.expoConfig?.extra?.AISHA_BRAND_SHORT as string | undefined) ?? BRAND_FULL;

/**
 * The AI assistant's own name — version.json `brand.assistantName`
 * (extra.AISHA_ASSISTANT_NAME). Distinct from the product brand: the AISHA build
 * calls its assistant "AISHA"; a re-skinned build can name its assistant distinctly
 * from its product brand — so chat copy reads "<assistant> is thinking…", not
 * "<brand> is thinking…". Falls back to the short brand.
 */
export const BRAND_ASSISTANT: string =
  (Constants.expoConfig?.extra?.AISHA_ASSISTANT_NAME as string | undefined) ?? BRAND_SHORT;
