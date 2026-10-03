import type { Locale } from "date-fns";
import { cs, de, enUS, fr, ru, th } from "date-fns/locale";

const normalizePrimaryLocale = (value: string | undefined) => {
  const raw = (value ?? "").trim();
  if (!raw) return "en";

  const primary = raw.split("-")[0]?.toLowerCase();
  return primary || "en";
};

/**
 * Získá primární jazyk z jazykového tagu.
 * 
 * Normalizuje vstup (např. "cs-CZ" -> "cs").
 * Pokud je vstup neplatný, vrací "en".
 * 
 * @param languageTag - Jazykový tag (např. z prohlížeče)
 * @returns Primární jazyk (např. "cs", "en")
 */
export const getI18nPrimaryLocale = (languageTag: string | undefined) => normalizePrimaryLocale(languageTag);

/**
 * Consent locale — resolves over the FULL supported-language set (en/cs/de/fr/
 * ru/th) so a de/fr/ru/th user gets consent content in their language when it
 * exists, with EN as the terminal failover. Not a cs/en collapse: consents are
 * localized like any other content (the DB provides per-locale rows + EN
 * fallback downstream).
 */
export const getConsentLocale = (languageTag: string | undefined) =>
  getTranslationLocale(languageTag);

/**
 * Locale to request DB/CMS content in (studies, products, web pages, …).
 *
 * Returns the normalized primary subtag and deliberately does NOT filter it
 * against any list. Which languages exist is DATA — `supported_languages`, which
 * this synchronous helper cannot read (the root loader prefetches it without
 * awaiting) — and per-key EN fallback is the DB's job, not ours:
 * `get_translation_value_with_fallback` / `get_translations_map_with_fallback`
 * resolve requested locale -> 'en' -> default, which is the documented chain.
 *
 * This used to filter through the shipped-chrome list (en/cs/de/fr/ru/th) and
 * collapse anything else to "en". That is a whole-language collapse standing in
 * front of a per-key fallback: it made every es/it row in `translations`
 * unreachable on such an instance, because the request never asked for them.
 *
 * Callers that pass the result to an RPC must use a `*_with_fallback` variant
 * (or an RPC that COALESCEs to 'en' internally) — otherwise a locale with no row
 * yields nothing instead of English.
 *
 * @param languageTag - Language tag (e.g. "es-ES", from i18n.language)
 * @returns Primary subtag (e.g. "es"), or "en" when the tag is empty/invalid
 */
export const getTranslationLocale = (languageTag: string | undefined) =>
  normalizePrimaryLocale(languageTag);

/**
 * date-fns Locale map over all supported languages.
 * English (enUS) is the designed terminal failover for any language whose
 * date-fns locale is not bundled — never a cs/en binary collapse.
 */
const DATE_FNS_LOCALE_MAP: Record<string, Locale> = {
  cs,
  de,
  en: enUS,
  fr,
  ru,
  th,
};

/**
 * Resolve the date-fns Locale for the active language tag.
 *
 * Covers every entry in SUPPORTED_TRANSLATION_LOCALES (cs/de/en/fr/ru/th),
 * falling back to enUS as the terminal failover. Replaces the historic
 * `i18n.language === 'cs' ? cs : enUS` binaries that collapsed six languages
 * down to two.
 *
 * @param languageTag - Language tag (e.g. from i18n.language)
 * @returns date-fns Locale for the resolved language, enUS as failover
 */
export const getDateFnsLocale = (languageTag: string | undefined): Locale => {
  const primary = normalizePrimaryLocale(languageTag);
  return DATE_FNS_LOCALE_MAP[primary] ?? enUS;
};
