/**
 * Recipient-language resolution (master-plan Brick 7 — "answer in the recipient's language").
 *
 * The AISHA principle: knowledge is language-AGNOSTIC, but the ANSWER must render in the
 * RECIPIENT's language. Locale handling is capability-derived via `Intl` — never a cs/en
 * allowlist, never a hardcoded language-name map — so ANY BCP47 language works (cs / en /
 * ru / th / fr / de / …), and the model is told to express other-language context naturally
 * in the recipient's language. Extracted from routes/chat.ts so the behavior is unit-testable
 * and reused by the multilanguage proof harness.
 *
 * @module
 */

/**
 * Validate a recipient language tag. Accepts ANY BCP47-style locale; throws on a malformed
 * tag — validation is via `Intl.getCanonicalLocales` (capability-derived, no regex, no
 * allowlist). Returns the tag unchanged so callers can use it inline.
 */
export function assertValidLocale(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new Error("language must be a string locale code");
  }
  try {
    Intl.getCanonicalLocales(raw);
  } catch {
    throw new Error(
      'language must be a BCP47-style locale code (e.g. "en", "cs", "ru", "th", "fr", "de")',
    );
  }
  return raw;
}

/**
 * The English display name of a locale, DERIVED via `Intl.DisplayNames` (no hardcoded map).
 * Falls back to the tag itself if the runtime cannot name it — so an exotic-but-valid locale
 * still yields a usable instruction rather than throwing.
 */
export function languageDisplayName(language: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(language) ?? language;
  } catch {
    return language;
  }
}

/**
 * The system-prompt instruction that makes AISHA answer in the recipient's language while
 * fully understanding context supplied in OTHER languages — the cross-lingual expression
 * half of the recipient principle. The language NAME is Intl-derived, so this works for any
 * locale without a per-language branch.
 */
export function buildLanguageInstruction(language: string): string {
  const name = languageDisplayName(language);
  return (
    `\n\nRespond to the user in ${name} (locale "${language}"). The provided context and ` +
    `knowledge may be in OTHER languages — understand them fully, but express the answer ` +
    `naturally, fluently and idiomatically in ${name}, as a native speaker would. Do not ` +
    `leave source-language fragments untranslated or mix languages.`
  );
}
