// =============================================================================
// rohatka-test-db.mjs — verdikt celé sady `src/tests/db` proti známým pádům
// =============================================================================
// ⛔ NAMĚŘENO 2026-09-27 na forku: celá `test:db` v CI nikdy neběžela (běží jen
// jmenované soubory v lane „DB: Kontrakt bloků povrchu"). Dvě regrese (trigger
// kotvy běhu 2026-07-26, totální guardy 2026-08-04) tak prošly zeleně a tři
// agentní runtime testy padaly dva měsíce, aniž by to kdo viděl. Na čisté bázi
// padá 13 testů v 7 souborech. Zapnout sadu naslepo by shodilo pipeline
// z cizích důvodů, proto rohatka: nový pád shodí, známý se jen ohlásí, dluh
// smí jen klesat (týž idiom jako surface-block-contract.baseline.json).
//
// Tři stavy (scripts/test/verdikt-kody.mjs): 0 změřeno a bez nového pádu,
// 1 nový pád, 75 NEZMĚŘENO (report chybí, chybí v něm soubor sady, nebo soubor
// nedostal DB — viz ZNACKA_DB_NEDOSTUPNA).
// Chybějící soubor není zelená: sada, která ho tiše vynechá, nic nezměřila.
// =============================================================================
import { readdirSync } from "node:fs";
import path from "node:path";
import { KOD_NEZMERENO, KOD_SELHANI, KOD_ZELENA } from "../test/verdikt-kody.mjs";

export const SADA = "src/tests/db";

/**
 * Značka chyby „DB nedostupná v povinném režimu" (src/tests/db/test-env-probe.ts,
 * AISHA_TESTDB_POVINNA=1). Soubor s touto chybou NENÍ nový pád ani změřená
 * zelená — je NEZMĚŘEN. ⛔ Rozbor #1113: sonda 3 s / 5 s pod zátěží vypršela,
 * soubor se celý přeskočil a rohatka ho brala jako změřený („dutá zelená").
 */
export const ZNACKA_DB_NEDOSTUPNA = "AISHA_TESTDB_NEDOSTUPNA";

/** Env, kterým rohatka zapne povinnou DB v sondě testů. */
export const ENV_DB_POVINNA = "AISHA_TESTDB_POVINNA";

/**
 * Soubory, které do celé sady NEPATŘÍ, protože potřebují jiný stav DB než seed
 * a mají vlastní skript. `demo-seed-nabehne-na-cisto` běží bez seedu
 * (`test:db:demo-seed`, AISHA_TESTDB_NO_SEED=1); v celé sadě padne vždy.
 */
export const MIMO_SADU = ["src/tests/db/demo-seed-nabehne-na-cisto-runtime.test.ts"];

/** Soubory sady, které se MAJÍ změřit: `*.test|spec.ts(x)` pod SADA, bez MIMO_SADU. */
export function souboryDbSady(koren) {
  return readdirSync(path.join(koren, SADA), { recursive: true })
    .map((f) => `${SADA}/${String(f).split(path.sep).join("/")}`)
    .filter((f) => /\.(test|spec)\.tsx?$/.test(f) && !MIMO_SADU.includes(f))
    .sort();
}

/** Jméno pádu: `soubor › předci › název`. Stabilní napříč běhy (bez času, bez id). */
export const jmenoPadu = (soubor, predci, nazev) => [soubor, ...predci, nazev].join(" › ");

/** Soubor, který spadl bez jediného padlého testu, se nenačetl (import, beforeAll). */
export const NENACETL = "(soubor se nenačetl)";

/**
 * Pády a změřené soubory z JSON reportu vitestu.
 * @param {{testResults?: Array<{name: string, status: string, message?: string,
 *   assertionResults?: Array<{ancestorTitles: string[], title: string, status: string,
 *   failureMessages?: string[]}>}>}} report
 * @param {string} koren kořen repa — jména souborů jsou relativní k němu
 */
export function padyZReportu(report, koren) {
  const pady = [];
  const zpravy = new Map();
  const soubory = [];
  const bezDb = [];
  for (const tr of report?.testResults ?? []) {
    const soubor = path.relative(koren, tr.name).split(path.sep).join("/");
    soubory.push(soubor);
    const padle = (tr.assertionResults ?? []).filter((a) => a.status === "failed");
    // Soubor bez DB (povinný režim) není pád ani změřený soubor — je NEZMĚŘEN.
    const texty = [tr.message ?? "", ...padle.flatMap((a) => a.failureMessages ?? [])];
    if (texty.some((t) => t.includes(ZNACKA_DB_NEDOSTUPNA))) {
      bezDb.push(soubor);
      continue;
    }
    for (const a of padle) {
      const jmeno = jmenoPadu(soubor, a.ancestorTitles ?? [], a.title);
      pady.push(jmeno);
      zpravy.set(jmeno, (a.failureMessages ?? []).join("\n"));
    }
    if (tr.status === "failed" && padle.length === 0) {
      const jmeno = jmenoPadu(soubor, [], NENACETL);
      pady.push(jmeno);
      zpravy.set(jmeno, tr.message ?? "");
    }
  }
  return { pady: [...new Set(pady)].sort(), zpravy, soubory, bezDb: [...new Set(bezDb)].sort() };
}

/** Rozdělí pády na NOVÉ (shodí), známé (ohlásí) a opravené položky baseline (ohlásí). */
export function protiBaseline(pady, znami) {
  const z = new Set(znami);
  const p = new Set(pady);
  return {
    nove: pady.filter((x) => !z.has(x)),
    zname: pady.filter((x) => z.has(x)),
    opravene: [...z].filter((x) => !p.has(x)).sort(),
  };
}

/**
 * Verdikt běhu.
 * @param {{report: unknown, koren: string, ocekavane: string[], znami: string[]}} vstup
 *   ocekavane = soubory sady, které se MĚLY změřit (relativní, s lomítky)
 */
export function verdikt({ report, koren, ocekavane, znami }) {
  if (!report || !Array.isArray(report.testResults) || report.testResults.length === 0) {
    return { kod: KOD_NEZMERENO, duvod: "report chybí nebo je prázdný", nove: [], zname: [], opravene: [], chybi: ocekavane, zpravy: new Map() };
  }
  const { pady, zpravy, soubory, bezDb } = padyZReportu(report, koren);
  const zmereno = new Set(soubory.filter((s) => !bezDb.includes(s)));
  const chybi = ocekavane.filter((s) => !zmereno.has(s)).sort();
  const { nove, zname, opravene } = protiBaseline(pady, znami);
  // Nový pád je změřená vada a platí i vedle nezměřených souborů (verdikt-kody: pravidlo 2).
  if (nove.length > 0) return { kod: KOD_SELHANI, duvod: "nový pád", nove, zname, opravene, chybi, zpravy };
  if (bezDb.length > 0) return { kod: KOD_NEZMERENO, duvod: `${bezDb.length} souborů nedostalo DB (povinný režim)`, nove, zname, opravene, chybi, zpravy };
  if (chybi.length > 0) return { kod: KOD_NEZMERENO, duvod: "v reportu chybí soubory sady", nove, zname, opravene, chybi, zpravy };
  return { kod: KOD_ZELENA, duvod: "bez nového pádu", nove, zname, opravene, chybi, zpravy };
}
