/**
 * Brána: pověření poskytovatelů (`credential:*` v trezoru instance) má JEDNOHO čtenáře.
 *
 * Rozhodnutí 2026-10-02 (přechodný domov pověření): hodnoty pověření poskytovatelů
 * leží ve vault.secrets pod jmenným prostorem `credential:<JMÉNO>` za JEDNÍM
 * rozhraním — SQL `get_provider_credentials` (jen service_role, katalog, audit)
 * a TS čtečka `@aisha/security` createCredentialReader. Výměna domova podle návrhu
 * „jeden domov pověření" (2026-09-28) pak znamená změnit jen tohle rozhraní a data;
 * spotřebitelé se nemění. Druhý čtenář by tu výměnu potichu obešel — a četl by bez
 * katalogu a bez auditu.
 *
 * Třída se ODVOZUJE ze zdrojů, ne ze seznamu funkcí:
 *   SQL (aisha/db/sql, heals.sql, infra/postgres):
 *     A) každý kód, který čte vault.decrypted_secrets, buď prostor vylučuje
 *        (`NOT LIKE 'credential:%'`), nebo se ptá jen na PEVNÁ jména mimo prostor
 *        (`name = 'GITHUB_APP_ID'`); jinak by vydal i `credential:*`.
 *        Výjimka: definice pohledu (CREATE VIEW vault.decrypted_secrets) a jediný čtenář.
 *     B) kód, který zmiňuje `credential:` A ZÁROVEŇ dešifruje, je jen get_provider_credentials
 *        (zápisy a stav přítomnosti — set_/delete_…, katalog — nedešifrují).
 *   TS (služby, balíčky, frontend; bez testů a generovaných typů):
 *     C) RPC `get_provider_credentials` volá jen packages/security/src/credentials.ts.
 *     D) žádný TS kód nečte trezor napřímo (`credential:` spolu s vault.*).
 *     E) @aisha/llm-dispatch nebere klíč pověření z process.env jako HODNOTU (fáze 1b):
 *        klíč cloudových backendů jde při volání přes zdroj pověření služby
 *        (setProviderKeySource → tatáž čtečka). Jména se odvozují z registru
 *        (BACKENDY_S_POVERENIM v backendRegistry.ts); smí zůstat jen test přítomnosti
 *        `!process.env.X` (synchronní start registru).
 *
 * KONTROLNÍ VZOREK (mutace): detektory se pouští i na syntetický „druhý čtenář" —
 * musí ho chytit, jinak by brána prošla i slepá.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const JEDINY_SQL_CTENAR = "aisha/db/sql/functions/get_provider_credentials.sql";
const JEDINY_TS_CTENAR = "packages/security/src/credentials.ts";

const bezSqlKomentaru = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, "");
const bezTsKomentaru = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

function soubory(adresar: string, pripony: RegExp, vynech: RegExp = /$^/): string[] {
  const abs = join(ROOT, adresar);
  if (!existsSync(abs)) return [];
  return (readdirSync(abs, { recursive: true }) as string[])
    .map((f) => join(adresar, f))
    .filter((f) => pripony.test(f) && !vynech.test(f));
}

// ── SQL ──────────────────────────────────────────────────────────────────────
const VYLOUCENI = /NOT\s+LIKE\s+'credential:%'/i;
const VYLOUCENI_VSE = /NOT\s+LIKE\s+'credential:%'/gi;
/** Stráž zápisu: `IF v_key LIKE 'credential:%' THEN RAISE …` — odmítnutí, ne čtení prostoru. */
const STRAZ_ZAPISU = /\bIF\s+[\w.]+\s+LIKE\s+'credential:%'\s+THEN\s+RAISE\b[\s\S]*?\bEND\s+IF\s*;/gi;
const definujePohled = (sql: string) => /CREATE\s+(OR\s+REPLACE\s+)?VIEW\s+vault\.decrypted_secrets\b/i.test(sql);
const ctePohled = (sql: string) => /\bvault\.decrypted_secrets\b/i.test(sql);
const desifruje = (sql: string) => /\bvault\.decrypted_secrets\b|\bpgp_sym_decrypt\b|\baisha_vault_encryption_key\s*\(/i.test(sql);

/** Predikáty na jméno řádku trezoru: [výraz napravo] — literál, nebo cokoli jiného. */
function predikatyJmena(sql: string): string[] {
  const out: string[] = [];
  const re = /\b(?:\w+\.)?name\s*(=\s*ANY|=|IN\b|LIKE\b)\s*([^\n]{0,40})/gi;
  for (const m of sql.matchAll(re)) out.push(`${m[1]} ${m[2].trim()}`);
  return out;
}

/** A) Vydá tenhle SQL kód z trezoru i `credential:*`? (null = ne; jinak důvod) */
function vydaPovereni(sql: string): string | null {
  const kod = bezSqlKomentaru(sql);
  if (!ctePohled(kod) || definujePohled(kod)) return null;
  if (VYLOUCENI.test(kod)) return null;
  const predikaty = predikatyJmena(kod);
  if (predikaty.length === 0) return "čte vault.decrypted_secrets bez predikátu na jméno";
  const zly = predikaty.find((p) => !/^=\s*'(?!credential:)[^']*'/i.test(p));
  return zly ? `čte vault.decrypted_secrets s nepevným jménem (${zly}) bez NOT LIKE 'credential:%'` : null;
}

/** B) Zmiňuje prostor `credential:` a dešifruje? (vyloučení NOT LIKE se nepočítá) */
function desifrujePovereni(sql: string): boolean {
  const kod = bezSqlKomentaru(sql).replace(VYLOUCENI_VSE, "").replace(STRAZ_ZAPISU, "");
  return /'credential:/i.test(kod) && desifruje(kod);
}

// ── TS ───────────────────────────────────────────────────────────────────────
function volaCtenare(ts: string): boolean {
  return /['"`]get_provider_credentials['"`]/.test(bezTsKomentaru(ts));
}
function cteTrezorNapimo(ts: string): boolean {
  const kod = bezTsKomentaru(ts);
  return /credential:/.test(kod) && /\bvault\.(decrypted_secrets|secrets)\b/.test(kod);
}

const SQL_ZDROJE = [
  ...soubory("aisha/db/sql", /\.sql$/),
  "aisha/db/heals.sql",
  ...soubory("infra/postgres", /\.sql$/),
];
const TS_VYNECH = /(^|\/)(node_modules|dist|__tests__|tests?|__mocks__)\/|\.(test|spec)\.tsx?$|integrations\/db\/types\.ts$|types\/database\.ts$/;
const TS_ZDROJE = [
  ...soubory("services", /\.tsx?$/, TS_VYNECH),
  ...soubory("packages", /\.tsx?$/, TS_VYNECH),
  ...soubory("src", /\.tsx?$/, TS_VYNECH),
  ...soubory("apps", /\.tsx?$/, TS_VYNECH),
];
const cti = (f: string) => readFileSync(join(ROOT, f), "utf-8");

const REGISTR_DISPATCHE = "packages/llm-dispatch/src/backendRegistry.ts";
/** Jména pověření cloudových backendů, jak je deklaruje registr dispatche. */
function jmenaPovereniDispatche(): string[] {
  const m = cti(REGISTR_DISPATCHE).match(/BACKENDY_S_POVERENIM[\s\S]*?\];/);
  return m ? [...m[0].matchAll(/envVar:\s*"([A-Z][A-Z0-9_]+)"/g)].map((x) => x[1]) : [];
}
/** E) Čte TS kód hodnotu pověření z process.env? (`!process.env.X` = jen přítomnost, smí) */
function cteKlicZProstredi(ts: string, jmena: string[]): string[] {
  const kod = bezTsKomentaru(ts);
  return jmena.filter((j) => new RegExp(String.raw`(^|[^!])process\.env(\.${j}\b|\[["'\`]${j}["'\`]\])`).test(kod));
}

describe("brána: pověření credential:* má jednoho čtenáře", () => {
  it("KONTROLNÍ VZOREK: univerzum není prázdné a obsahuje dnešní čtenáře trezoru i jediného čtenáře", () => {
    expect(SQL_ZDROJE.length).toBeGreaterThan(1000);
    expect(TS_ZDROJE.length).toBeGreaterThan(500);
    const ctenari = SQL_ZDROJE.filter((f) => ctePohled(bezSqlKomentaru(cti(f)))).map((f) => relative(ROOT, join(ROOT, f)));
    for (const f of [JEDINY_SQL_CTENAR, "aisha/db/sql/functions/get_app_secret.sql", "aisha/db/sql/functions/get_github_app_secrets_from_vault.sql"]) {
      expect(ctenari, `čtenář ${f} musí být v měřeném univerzu`).toContain(f);
    }
    expect(desifrujePovereni(cti(JEDINY_SQL_CTENAR)), "jediný čtenář musí detektor B chytit").toBe(true);
    expect(volaCtenare(cti(JEDINY_TS_CTENAR)), "TS čtečka musí detektor C chytit").toBe(true);
  });

  it("KONTROLNÍ VZOREK (mutace): detektory chytí druhého čtenáře a nechají projít vyloučení i pevná jména", () => {
    const druhy = "SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'credential:' || p_env_var;";
    expect(vydaPovereni(druhy)).not.toBeNull();
    expect(desifrujePovereni(druhy)).toBe(true);
    expect(vydaPovereni("SELECT decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.name = p_key;")).not.toBeNull();
    expect(vydaPovereni("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ANY(p_keys);")).not.toBeNull();
    expect(vydaPovereni("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'credential:OPENAI_API_KEY';")).not.toBeNull();
    expect(vydaPovereni("SELECT count(*) FROM vault.decrypted_secrets;")).not.toBeNull();
    expect(vydaPovereni("SELECT x FROM vault.decrypted_secrets ds WHERE ds.name = p_key AND ds.name NOT LIKE 'credential:%';")).toBeNull();
    expect(vydaPovereni("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'GITHUB_APP_ID';")).toBeNull();
    expect(desifrujePovereni("SELECT 1 FROM vault.secrets s WHERE s.name = 'credential:' || p_env_var;")).toBe(false);
    // stráž zápisu (odmítnutí) čtenářem není; čtení prostoru přes LIKE ano
    expect(desifrujePovereni("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name NOT LIKE 'credential:%'; IF v_key LIKE 'credential:%' THEN RAISE EXCEPTION 'credential:* jen přes …'; END IF;")).toBe(false);
    expect(desifrujePovereni("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name LIKE 'credential:%';")).toBe(true);
    expect(volaCtenare("await rpc('get_provider_credentials', { p_env_vars: ['X_KEY'] })")).toBe(true);
    expect(volaCtenare("await rpc('get_provider_credential_catalog', {})")).toBe(false);
    expect(cteTrezorNapimo("sql`SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'credential:X'`")).toBe(true);
  });

  it("KONTROLNÍ VZOREK (mutace) E: detektor chytí klíč z env jako hodnotu, test přítomnosti nechá", () => {
    const jmena = jmenaPovereniDispatche();
    expect(jmena).toEqual(expect.arrayContaining(["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_AI_API_KEY", "XAI_API_KEY"]));
    expect(cteKlicZProstredi('this.apiKey = apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";', jmena)).toEqual(["ANTHROPIC_API_KEY"]);
    expect(cteKlicZProstredi("const key = process.env.OPENAI_API_KEY;", jmena)).toEqual(["OPENAI_API_KEY"]);
    expect(cteKlicZProstredi("if (!process.env.XAI_API_KEY) return null;", jmena)).toEqual([]);
  });

  it("E) @aisha/llm-dispatch nebere klíč pověření z process.env jako hodnotu (jen přes zdroj pověření)", () => {
    const jmena = jmenaPovereniDispatche();
    const vady = soubory("packages/llm-dispatch/src", /\.ts$/, TS_VYNECH)
      .flatMap((f) => cteKlicZProstredi(cti(f), jmena).map((j) => `${f}: process.env.${j}`));
    expect(vady, "klíč poskytovatele se bere při volání přes resolveProviderKey, ne z env").toEqual([]);
  });

  it("A) žádný SQL kód kromě jediného čtenáře nevydá z trezoru credential:*", () => {
    const vady = SQL_ZDROJE.filter((f) => f !== JEDINY_SQL_CTENAR)
      .map((f) => ({ f, d: vydaPovereni(cti(f)) }))
      .filter((x) => x.d !== null)
      .map((x) => `${x.f}: ${x.d}`);
    expect(vady, "druhý čtenář pověření — přidej NOT LIKE 'credential:%' nebo čti přes get_provider_credentials").toEqual([]);
  });

  it("B) prostor credential: dešifruje jen get_provider_credentials", () => {
    const vady = SQL_ZDROJE.filter((f) => f !== JEDINY_SQL_CTENAR && desifrujePovereni(cti(f)));
    expect(vady, "druhý dešifrující čtenář credential:*").toEqual([]);
  });

  it("C) RPC get_provider_credentials volá jen TS čtečka (@aisha/security credentials.ts)", () => {
    const vady = TS_ZDROJE.filter((f) => f !== JEDINY_TS_CTENAR && volaCtenare(cti(f)));
    expect(vady, "služby čtou pověření přes createCredentialReader, ne vlastním voláním RPC").toEqual([]);
  });

  it("D) žádný TS kód nečte trezor napřímo", () => {
    expect(TS_ZDROJE.filter((f) => cteTrezorNapimo(cti(f)))).toEqual([]);
  });
});
