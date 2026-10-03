/**
 * Gate (universalization anti-regression): currency and locale are dynamic
 * DATA/config, never hardcoded — across the app code, not just the DB SoT (the
 * DB SoT is covered by currency-dynamic-no-hardcode.gate.test.ts).
 *
 * The platform is multi-tenant × multi-currency × multi-language. A fork/instance
 * picks its own currency and locales via config; the code must resolve them, not
 * bake them in. This gate fails if the two patterns we just eliminated creep back:
 *
 *  (A) A cs/en LOCALE BINARY that collapses the 6 supported languages
 *      (en/cs/de/fr/ru/th) down to two — e.g. `x === 'cs' ? … : …`,
 *      `lang === 'cs' ? 'cs' : 'en'`, or a date-fns `? cs : enUS` pick. These
 *      silently serve de/fr/ru/th users the wrong language. Locale must be
 *      resolved over the full set (helpers in src/lib/i18n/locale.ts), with EN as
 *      the terminal failover — never a 2-way ternary.
 *
 *  (B) A hardcoded fiat ISO CURRENCY literal ('CZK'|'EUR'|'USD'|'GBP'|'PLN'|'CHF')
 *      used as a value in app code. Currency is data: read it from config
 *      (commerce_base_currency / useCurrency) or the row's `currency`.
 *
 * Scans src/** and services/**. Skips tests, i18n translation DATA, generated
 * types, comments, and a small documented allowlist of genuinely-legit sites
 * (the single last-resort BASE_CURRENCY_FALLBACK constant; the supported-language
 * catalog; provider cost_json 'usd' reads). Tests are exempt (they verify cases).
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src", "services"];

/** Path substrings that are NOT app code (tests, generated, i18n data, vendored). */
const SKIP_PATH =
  /(^|\/)(node_modules|dist|build|coverage)\/|\.test\.|\.spec\.|__tests__\/|\/tests?\/|\/i18n\/locales\/|\/locales\/|integrations\/db\/types\.ts$|types\/database\.ts$/;

/**
 * Documented allowlist — genuinely-legit single sites, by relative path. The
 * base-currency last-resort constant lives in ONE place (config is the real
 * source); the supported-language catalog legitimately lists locale codes; the
 * currency registry maps codes to symbols.
 */
const FILE_ALLOWLIST = new Set<string>([
  "src/lib/currency/constants.ts", // the single BASE_CURRENCY_FALLBACK last-resort
  // POZOR: registr dodávaných locale (SUPPORTED_LOCALES) se tu ADRESOU
  // NEPOVOLUJE — viz test „registr dodávaných locale existuje právě jednou".
  // VALID_LANGS mirrors the keys of the literal copy table `L` in the same file
  // (auth e-mail bodies ship in code, not in `translations`). Widening it without
  // adding copy would send an untranslated e-mail.
  "services/gateway/src/routes/auth-email.ts",
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(join(ROOT, dir));
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = `${dir}/${e}`;
    const abs = join(ROOT, rel);
    let s;
    try {
      s = statSync(abs);
    } catch {
      continue;
    }
    if (s.isDirectory()) out.push(...walk(rel));
    else if (/\.(ts|tsx)$/.test(e) && !SKIP_PATH.test(rel + "/")) out.push(rel);
  }
  return out;
}

/** Strip line and block comments so prose/commented code never matches. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

// (A) cs/en LOCALE-VALUE collapse: a ternary that RESOLVES A LOCALE down to two
//     languages — the regression that makes de/fr/ru/th silently fetch the wrong
//     language's DATA. We flag only ternaries whose branches are the locale
//     CODES ('cs'/'en') or the date-fns locale OBJECTS (cs/enUS) — NOT a ternary
//     that merely selects bilingual CONTENT (a Czech vs English string / name /
//     format) by language, where EN is the accepted terminal failover and the
//     real fix is an i18n-key migration of that content, not a code collapse.
const CS_EN_BINARY = [
  /\?\s*['"]cs['"]\s*:\s*['"]en['"]/, // ? 'cs' : 'en'   (resolves a locale code)
  /\?\s*['"]en['"]\s*:\s*['"]cs['"]/, // ? 'en' : 'cs'
  /\?\s*\bcs\b\s*:\s*\benUS\b/, // ? cs : enUS   (date-fns locale object)
  /\?\s*\benUS\b\s*:\s*\bcs\b/,
];

// (B) fiat ISO currency literal as a value.
const FIAT_LITERAL = /['"](CZK|EUR|USD|GBP|PLN|CHF)['"]/;
// provider cost_json 'usd' key access is legit (provider billing fact), lowercase.
const PROVIDER_USD_READ = /cost_json\s*->>\s*'usd'|\[['"]usd['"]\]|\.usd\b/i;

// (C) A LOCALE-SET LITERAL: an array/Set of 3+ locale codes written into app
//     code. Which languages an instance publishes is DATA (`supported_languages`,
//     admin-managed via RPC) — read it with `useActiveLocales()`.
//
//     A copied list is a no-op while an instance's languages happen to be a
//     subset of it, then silently diverges for every fork. Real damage this
//     caught: the page-builder i18n panel and 2 admin catalogs each carried
//     their own ["cs","en","de","fr","ru","th"], so an instance with (cs/en/es/it/ru)
//     showed permanent "missing" badges for de/fr/th while never showing es/it —
//     the coverage report lied in both directions.
//
//     Two locales are NOT flagged: that shape is (A)'s job, and a `z.enum(["cs","en"])`
//     on a request contract is a different (API-surface) decision.
const LOCALE_SET_LITERAL =
  /\[\s*(['"](?:en|cs|de|fr|ru|th|es|it|pl|sk|uk)['"]\s*,\s*){2,}['"](?:en|cs|de|fr|ru|th|es|it|pl|sk|uk)['"]\s*,?\s*\]/;

const files = SCAN_DIRS.flatMap((d) => walk(d));

const localeBinaryHits: string[] = [];
const currencyLiteralHits: string[] = [];
const localeSetHits: string[] = [];
for (const f of files) {
  if (FILE_ALLOWLIST.has(f)) continue;
  const text = stripComments(readFileSync(join(ROOT, f), "utf8"));
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (CS_EN_BINARY.some((re) => re.test(line)))
      localeBinaryHits.push(`${f}:${i + 1}  ${line.trim().slice(0, 100)}`);
    if (FIAT_LITERAL.test(line) && !PROVIDER_USD_READ.test(line))
      currencyLiteralHits.push(`${f}:${i + 1}  ${line.trim().slice(0, 100)}`);
    if (LOCALE_SET_LITERAL.test(line))
      localeSetHits.push(`${f}:${i + 1}  ${line.trim().slice(0, 100)}`);
  });
}

describe("universalization — currency + locale are dynamic (no hardcoded literals in app code)", () => {
  test("sanity: the scan sees real app files", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  test("(A) no cs/en locale binary that collapses the supported-language set", () => {
    expect(
      localeBinaryHits,
      `Locale must resolve over ALL supported_languages (en/cs/de/fr/ru/th) with EN as the ` +
        `terminal failover — never a 2-way cs/en ternary. Offenders (${localeBinaryHits.length}):\n  ` +
        localeBinaryHits.join("\n  "),
    ).toEqual([]);
  });

  // Registr locale, pro které DODÁVÁME UI (chrome), je legitimně compile-time:
  // Vite potřebuje literální cesty importů, aby mohl balíky rozdělit, a paritní
  // brána nad ~12k klíči z toho dělá kompilační fakt. NENÍ to sada, kterou
  // instance publikuje — ta žije v `supported_languages` (DB).
  //
  // Dřív se to řešilo VÝJIMKOU NA CESTU (`src/hooks/useDynamicTranslations.ts`).
  // Jenže cesta není invariant: jakmile se konstanta přesunula do leaf modulu
  // (kvůli TDZ pádu při inicializaci chunků), brána spadla na změně, která
  // nezhoršila vůbec nic — a naopak by NEZACHYTILA druhou kopii jinde.
  //
  // Invariant zní: takový registr existuje v repu PRÁVĚ JEDNOU. To se dá ověřit
  // bez jediné adresy — a chytí to i to, co výjimka na cestu chytit neuměla.
  test("registr dodávaných locale existuje právě jednou (a jinde se nekopíruje)", () => {
    expect(
      localeSetHits.length,
      "Deklarace sady dodávaných locale musí být v repu jedna jediná — jinak se " +
        "kopie rozejdou a jedna z nich tiše zahodí jazyk, který instance přidala. " +
        `Nalezeno ${localeSetHits.length}:\n  ` + localeSetHits.join("\n  "),
    ).toBe(1);
  });

  test("(C) no hardcoded locale-set literal mimo ten jediný registr", () => {
    const mimoRegistr = localeSetHits.slice(1);
    expect(
      mimoRegistr,
      `Which languages an instance publishes lives in \`supported_languages\` (DB, ` +
        `admin-managed) — read it via useActiveLocales(), never copy the list into code. ` +
        `A copied list looks correct until a fork's language set differs, then silently ` +
        `drops its locales. Offenders (${mimoRegistr.length}):\n  ` +
        mimoRegistr.join("\n  "),
    ).toEqual([]);
  });

  test("(B) no hardcoded fiat ISO currency literal as a value in app code", () => {
    expect(
      currencyLiteralHits,
      `Currency is data/config — read commerce_base_currency / useCurrency / the row currency, ` +
        `never a baked ISO literal. Offenders (${currencyLiteralHits.length}):\n  ` +
        currencyLiteralHits.join("\n  "),
    ).toEqual([]);
  });
});
