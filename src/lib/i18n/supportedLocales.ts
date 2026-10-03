/**
 * Supported locale registry — leaf module with zero runtime imports.
 *
 * Why a separate file (instead of co-locating with useDynamicTranslations.ts):
 *   `useDynamicTranslations` transitively pulls in @tanstack/react-query, the
 *   aisha PostgREST client, react-i18next, useAdminGuard, etc. Putting
 *   `SUPPORTED_LOCALES` (a `const` — TDZ-affected) inside that file meant any
 *   top-level usage of the constant elsewhere in the bundle had to wait for
 *   the *entire* dependency chain to evaluate before the value was bound.
 *
 *   In a multi-chunk build (admin-area / admin-production / shared / vendor),
 *   evaluation order is dictated by the dependency graph, not script order.
 *   With circular references through that chain (e.g. admin-production has
 *   known internal cycles via WorkflowDesigner), the TDZ window expanded —
 *   `admin-area` could enter top-level evaluation, request the imported
 *   `SUPPORTED_LOCALES` binding, and find it uninitialized → runtime
 *   "Cannot access 'SUPPORTED_LOCALES' before initialization" crash.
 *
 *   Moving the constants here (leaf, no `import` from app code) eliminates
 *   the TDZ window: this file's evaluation has no dependencies, so the
 *   binding is always live the moment any consumer asks for it.
 *
 * Stay in sync with:
 *   - src/i18n/index.ts          (supportedLngs)
 *   - DB supported_languages table
 *   - mobile-app i18n config (if mobile shares locale set)
 */

/**
 * Locales the app SHIPS UI chrome for — those with a `src/i18n/locales/` bundle
 * (see `localeImportMap` in src/i18n/index.ts) and a full-parity segment set
 * (~12k keys, enforced by `npm run i18n:check`).
 *
 * Correctly hardcoded: Vite needs literal import paths to code-split the
 * bundles, and the parity gate makes shipping a locale a compile-time fact.
 *
 * It is NOT the set of languages an instance publishes — that is
 * `supported_languages` (DB, admin-managed); read it via `useActiveLocales`.
 * The two legitimately differ: an instance may publish es/it content but ship
 * no es/it chrome, and the per-key EN fallback covers the gap
 * (`get_translation_value_with_fallback`). Use this only as the bootstrap
 * fallback for "the DB has not answered yet".
 */
export const SUPPORTED_LOCALES = ["en", "cs", "de", "fr", "ru", "th"] as const;

/**
 * A locale the app ships chrome for. Closed union — it describes OUR bundles.
 *
 * Do not use it for locales that come from the DB: `supported_languages.code` is
 * a `string`, and narrowing it into this union forces a type guard
 *
 *     const isSupportedLocale = (c: string): c is SupportedLocale =>
 *       (SUPPORTED_LOCALES as readonly string[]).includes(c);
 *
 * which is a no-op while an instance's languages are a subset of ours, then
 * silently drops every locale an instance adds (e.g. its es/it). Use
 * {@link LocaleCode} on those paths instead.
 */
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Any locale code (ISO 639-1, e.g. "cs", "es") — including ones this app ships
 * no chrome for.
 *
 * Deliberately open: which languages exist is DATA (`supported_languages`), not
 * a compile-time fact. Use this wherever locales originate from the DB —
 * translation status, the page builder, per-locale editors — so DB rows reach
 * the UI without being filtered through {@link SUPPORTED_LOCALES} on the way.
 */
export type LocaleCode = string;

/**
 * Display names for the shipped chrome locales — a bootstrap fallback only.
 *
 * `supported_languages.name_native` is the source of truth and wins whenever the
 * DB has answered; an instance's own locales only ever appear there. Keyed by
 * {@link LocaleCode} (OPEN) so DB locales can be looked up without a cast.
 */
export const LOCALE_LABELS: Record<LocaleCode, string> = {
  en: "English",
  cs: "Čeština",
  de: "Deutsch",
  fr: "Français",
  ru: "Русский",
  th: "ไทย",
};
