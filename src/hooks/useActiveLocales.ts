/**
 * The instance's CONTENT locales — which languages this deployment publishes.
 *
 * Source of truth is the `supported_languages` table (admin-managed via
 * `useCreateLanguage` / `useUpdateLanguage` / `useDeleteLanguage`). A fork picks
 * its own set; the code resolves it and never bakes it in.
 *
 * Do not confuse this with `SUPPORTED_LOCALES` (src/hooks/useDynamicTranslations),
 * which is the set the app ships UI chrome bundles for. The two legitimately
 * differ — an instance may publish es/it content but ship no es/it chrome — and
 * conflating them is what silently stranded every es/it row in `translations`.
 *
 * This hook exists because the DB→codes→labels resolution was copy-pasted across
 * ~8 admin screens, each re-deriving it slightly differently, and each filtering
 * DB codes through the hardcoded chrome list on the way.
 *
 * @module
 */

import { useSupportedLanguages } from "@/hooks/useSupportedLanguages";
import {
  LOCALE_LABELS,
  SUPPORTED_LOCALES,
  type LocaleCode,
} from "@/hooks/useDynamicTranslations";

export interface ActiveLocales {
  /** Codes this instance publishes, in admin-defined `sort_order`. Never empty. */
  codes: LocaleCode[];
  /** code → display name. `supported_languages.name_native` wins; chrome labels back it up. */
  labels: Record<LocaleCode, string>;
  /** The instance default (`supported_languages.is_default`), else the first code. */
  defaultLocale: LocaleCode;
  /** False while `codes` is still the bootstrap fallback rather than DB truth. */
  isResolved: boolean;
}

/**
 * Resolve the instance's active content locales from the DB.
 *
 * While the query is in flight (the root loader prefetches it but deliberately
 * does not await — see router.tsx), `codes` falls back to the shipped chrome
 * locales and `isResolved` is false. The hook is reactive: once the DB answers,
 * consumers re-render and any query key derived from these codes refetches.
 *
 * @returns The active locale codes, display labels, and instance default.
 */
export function useActiveLocales(): ActiveLocales {
  const { data: languages } = useSupportedLanguages(true);

  // No manual useMemo: the React Compiler (WP 4.5) memoizes this derivation, and
  // the manual-memo ratchet gate forbids adding new ones. The work is cheap —
  // a filter+sort+map over the small supported_languages set.
  const active = (languages ?? [])
    .filter((lang) => lang.is_active !== false)
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  // NOTE: no `.filter(isSupportedLocale)` here — on purpose. Narrowing DB codes
  // through the shipped-chrome list is exactly what dropped es/it.
  const codes = active.map((lang) => lang.code);
  const isResolved = codes.length > 0;

  const labels: Record<LocaleCode, string> = { ...LOCALE_LABELS };
  for (const lang of active) {
    labels[lang.code] = lang.name_native || lang.name_key || lang.code.toUpperCase();
  }

  const resolvedCodes = isResolved ? codes : [...SUPPORTED_LOCALES];

  return {
    codes: resolvedCodes,
    labels,
    defaultLocale:
      active.find((lang) => lang.is_default === true)?.code ?? resolvedCodes[0] ?? "en",
    isResolved,
  };
}
