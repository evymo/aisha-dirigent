/**
 * tenant-sentinels.mjs — jména instancí pro kontroly úniku, z jediného místa.
 *
 * PROČ TADY A NE V BRÁNĚ
 * Seznam přesných jmen nájemců se nikdy necommituje: commitnutý seznam skutečných
 * zákazníků ve VEŘEJNÉM repu by sám prozradil, kdo jsou (viz
 * src/tests/gates/lib/tenant-leak-detect.ts). Čte se proto jen z míst mimo strom:
 *   1. `config/tenant.json` (gitignorovaný, `{ "sentinels": [...] }`),
 *   2. proměnná `AISHA_TENANT_SENTINELS` (čárky / mezery),
 * a k nim jména VLASTNÍ instance odvozená z adresářů `instances/` (bez `_`
 * předpony) — tentýž vzor jako split-rule gate a brána no-instance-data-in-public.
 *
 * Do 2026-10-05 tohle čtení žilo jen v TypeScriptu brány. Generátor seedu znalostí
 * (scripts/db/gen-knowledge-seed.mjs) potřebuje TOTÉŽ čtení v Node bez vitestu, a
 * druhá kopie by se časem rozešla (jiný oddělovač, jiné normalizování). Brána proto
 * re-exportuje odsud a obě cesty čtou jeden kód.
 *
 * V upstreamu a ve forcích je seznam obvykle PRÁZDNÝ (žádný tenant.json, v
 * `instances/` jen `_default`). To není „čisto", ale „nezměřeno" — rozhodnutí,
 * jestli prázdný seznam vadí, patří volajícímu (generátor má `--vyzaduj-jmena`).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Přesná jména od operátora — `config/tenant.json` + `AISHA_TENANT_SENTINELS`.
 * Malá písmena, bez prázdných, bez duplicit. Nečitelný tenant.json se ignoruje
 * (strukturální vrstvy bran běží dál); volající, kterému na seznamu záleží, ho
 * má vyžadovat neprázdný.
 *
 * @param {string} [root] kořen stromu platformy (výchozí `process.cwd()`)
 * @param {Record<string, string | undefined>} [env] prostředí (výchozí `process.env`)
 * @returns {string[]}
 */
export function loadTenantSentinels(root = process.cwd(), env = process.env) {
  const out = [];
  const zEnv = env.AISHA_TENANT_SENTINELS;
  if (zEnv) out.push(...zEnv.split(/[\s,]+/));
  const p = join(root, "config/tenant.json");
  if (existsSync(p)) {
    try {
      const j = JSON.parse(readFileSync(p, "utf8"));
      if (Array.isArray(j?.sentinels)) out.push(...j.sentinels.map(String));
    } catch (e) {
      // Poškozený soukromý soubor neshodí strukturální vrstvy bran, ale NESMÍ zmizet
      // potichu: seznam z něj pak chybí a kontrola jmen je bez něj nezměřená.
      // ⛔ Hláška parseru se NEVYPISUJE: Node 22 do ní dává výřez obsahu souboru
      // (změřeno: „…"tinels": [acme-…" — tedy jméno ze seznamu). Jen soubor a místo.
      console.warn(`tenant-sentinels: config/tenant.json nejde přečíst (${mistoChyby(e)}) — seznam jmen z něj chybí`);
    }
  }
  return [...new Set(out.map((s) => s.trim().toLowerCase()).filter(Boolean))];
}

/**
 * Místo chyby čtení BEZ obsahu souboru: řádek / sloupec / pozice, jsou-li v hlášce, jinak
 * jen třída chyby. Hláška JSON.parse nese výřez textu — ten do výpisu nesmí.
 *
 * @param {unknown} e
 * @returns {string}
 */
export function mistoChyby(e) {
  const zprava = e instanceof Error ? e.message : String(e);
  const radek = zprava.match(/line (\d+) column (\d+)/);
  if (radek) return `neplatný JSON, řádek ${radek[1]}, sloupec ${radek[2]}`;
  const pozice = zprava.match(/position (\d+)/);
  if (pozice) return `neplatný JSON, pozice ${pozice[1]}`;
  return e instanceof SyntaxError ? "neplatný JSON" : `chyba čtení (${e instanceof Error ? e.name : typeof e})`;
}

/**
 * Jména implementací, které strom sám deklaruje v `instances/` (adresáře bez `_`).
 * V upstreamu jen `_default` ⇒ prázdný seznam.
 *
 * @param {string} [root]
 * @returns {string[]}
 */
export function ownTenantIds(root = process.cwd()) {
  try {
    return readdirSync(join(root, "instances"), { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
      .map((e) => e.name.toLowerCase());
  } catch {
    return [];
  }
}

/**
 * Všechna jména, která do veřejného artefaktu nesmí: operátorská + vlastní instance.
 *
 * @param {string} [root]
 * @param {Record<string, string | undefined>} [env]
 * @returns {string[]}
 */
export function allTenantNames(root = process.cwd(), env = process.env) {
  return [...new Set([...loadTenantSentinels(root, env), ...ownTenantIds(root)])];
}

/**
 * Výskyty jmen v textu — bez ohledu na velikost písmen, jako PODŘETĚZEC (kratší
 * jméno pokrývá i delší tvary; tak je seznam operátorů psaný).
 *
 * @param {string} content
 * @param {string[]} sentinels
 * @returns {string[]} jména, která se v textu vyskytla
 */
export function privateSentinelHits(content, sentinels) {
  const lc = String(content).toLowerCase();
  return sentinels.filter((s) => lc.includes(s));
}
