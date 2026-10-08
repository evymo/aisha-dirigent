/**
 * grant-na-schema.mjs — kdo dostává (a komu se bere) právo na SCHÉMA.
 *
 * Čistý měřák nad textem: najde příkazy `GRANT … ON SCHEMA … TO …` a
 * `REVOKE … ON SCHEMA … FROM …` a vrátí je rozložené. Nečte disk a nic nespouští;
 * univerzum souborů dodává `univerzumSql()` níž.
 *
 * ⛔ PROČ VZNIKL (2026-10-03): pravidlo „žádný GRANT … TO PUBLIC“ hlídala brána
 * `postgres-grants` jen v JEDNOM souboru (init skript rolí). Grant, který dával
 * všem rolím právo vytvářet ve schématu `public`, bydlel o soubor vedle —
 * v řetězci uvnitř skriptu migrace — a žádné měřidlo ho nevidělo. Měří se proto
 * příkaz kdekoli, kde může být SQL: v `.sql`, v řetězcích skriptů, v compose.
 *
 * Rozhoduje se o KÓDU, ne o komentářích: v `.sql` je odstraňuje společný
 * `stripSqlComments`, ve skriptech `bezKomentaru()` níž podle jazyka souboru.
 * Tělo `DO $$ … $$` se NEPŘESKAKUJE — je to kód, který se vykoná.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { stripSqlComments } from "../db/lib/sql-comments.mjs";

/**
 * Přípona → druh komentářů v souboru.
 *   sql  — SQL (`--`, blokový); řetězce v apostrofech se respektují
 *   js   — `//` a blokový komentář, s ohledem na řetězce
 *   hash — celý řádek začínající `#`
 */
const DRUH = {
  ".sql": "sql",
  ".mjs": "js",
  ".js": "js",
  ".cjs": "js",
  ".ts": "js",
  ".tsx": "js",
  ".sh": "hash",
  ".py": "hash",
  ".yml": "hash",
  ".yaml": "hash",
};

/** Znaky, podle kterých se pozná, že jméno není literál (šablona, format(), skládání). */
const DYNAMICKE = /[%${}|()]/;

/** Skript v jazyce s `//` a blokovými komentáři: komentáře pryč, řetězce zůstávají. */
function bezKomentaruJs(text) {
  let out = "";
  let i = 0;
  let retezec = null;
  while (i < text.length) {
    const c = text[i];
    if (retezec) {
      out += c;
      if (c === "\\" && i + 1 < text.length) { out += text[i + 1]; i += 2; continue; }
      if (c === retezec || (c === "\n" && retezec !== "`")) retezec = null;
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { retezec = c; out += c; i++; continue; }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      out += " ";
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Text bez komentářů — podle druhu souboru.
 *
 * ⛔ ODSTRAŇUJE SE JEN TO, CO KOMENTÁŘEM PROKAZATELNĚ JE. V shellu a YAMLu padá
 * jen celý řádek začínající `#`: `--` je tam přepínač a `/*` glob, a SQL pravidla
 * by za `psql --quiet -c "GRANT …"` nebo za `"$DIR"/*.sql` schovala zbytek řádku
 * (nebo souboru). SQL komentář uvnitř řetězce skriptu proto zůstává — doslovný
 * příkaz v něm měřák uvidí. To je správný směr chyby: raději přeformulovat
 * komentář než přehlédnout grant.
 */
export function bezKomentaru(text, pripona = ".sql") {
  const druh = DRUH[pripona];
  if (druh === "sql") return stripSqlComments(text);
  if (druh === "js") return bezKomentaruJs(text);
  return text.replace(/^[ \t]*#.*$/gm, "");
}

function jmeno(surove) {
  const j = surove.trim().replace(/^GROUP\s+/i, "").replace(/^"([^"]+)"$/, "$1");
  if (DYNAMICKE.test(j) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(j)) return { jmeno: j, literal: false };
  return { jmeno: j.toLowerCase() === "public" ? "PUBLIC" : j.toLowerCase(), literal: true };
}

/**
 * Seznam příjemců. Osamocená uvozovka (ne `"role"`) je konec řetězce hostitelského
 * jazyka u příkazu bez středníku — co je za ní, už k příkazu nepatří.
 */
function prijemci(seznam) {
  const out = [];
  for (const kus of seznam.split(",")) {
    const k = kus.trim();
    if (/^(GROUP\s+)?"[^"]+"$/i.test(k) || !k.includes('"')) {
      if (k !== "") out.push(jmeno(k));
      continue;
    }
    const pred = k.slice(0, k.indexOf('"')).trim();
    if (pred !== "") out.push(jmeno(pred));
    break;
  }
  return out;
}

function schema(surove) {
  const s = surove.trim().replace(/^"(.*)"$/, "$1");
  if (DYNAMICKE.test(s) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) return { jmeno: s, literal: false };
  return { jmeno: s.toLowerCase(), literal: true };
}

const PRIKAZ =
  /\b(GRANT|REVOKE)\s+(?:GRANT\s+OPTION\s+FOR\s+)?((?:[A-Za-z]+(?:\s+PRIVILEGES)?\s*,\s*)*[A-Za-z]+(?:\s+PRIVILEGES)?)\s+ON\s+SCHEMA\s+([^;]*?)\s+(TO|FROM)\s+([^;'`\\]+)/gi;

/**
 * Příkazy GRANT/REVOKE na schéma v textu (už BEZ komentářů).
 *
 * @returns {{akce:'GRANT'|'REVOKE', prava:string[], schemata:{jmeno:string,literal:boolean}[],
 *            role:{jmeno:string,literal:boolean}[], text:string}[]}
 */
export function prikazyNaSchema(text) {
  const out = [];
  for (const m of text.matchAll(PRIKAZ)) {
    const akce = m[1].toUpperCase();
    if ((akce === "GRANT") !== (m[4].toUpperCase() === "TO")) continue;
    const prava = m[2]
      .split(",")
      .map((p) => p.trim().toUpperCase().replace(/\s+PRIVILEGES$/, ""))
      .filter(Boolean);
    const komu = m[5]
      .replace(/\s+WITH\s+GRANT\s+OPTION[\s\S]*$/i, "")
      .replace(/\s+GRANTED\s+BY[\s\S]*$/i, "")
      .replace(/\s+(CASCADE|RESTRICT)\s*$/i, "");
    out.push({
      akce,
      prava,
      schemata: m[3].split(",").map(schema),
      role: prijemci(komu),
      text: m[0].replace(/\s+/g, " ").trim(),
    });
  }
  return out;
}

/** Právo, kterým se ve schématu dá vytvářet (`ALL` ho obsahuje). */
export const jePravoVytvaret = (pravo) => pravo === "CREATE" || pravo === "ALL";

/**
 * Kdo v textu dostává právo VYTVÁŘET v daném schématu.
 *
 * `nezmereno` = grant práva vytvářet, u kterého nejde z textu říct, komu nebo
 * do jakého schématu míří (jméno se skládá za běhu). Není to „čisto“.
 *
 * @returns {{tvurci:{role:string,text:string}[], nezmereno:string[]}}
 */
export function kdoSmiVytvaret(text, jmenoSchematu = "public") {
  const tvurci = [];
  const nezmereno = [];
  for (const p of prikazyNaSchema(text)) {
    if (p.akce !== "GRANT" || !p.prava.some(jePravoVytvaret)) continue;
    const neliteralniSchema = p.schemata.some((s) => !s.literal);
    const miriSem = p.schemata.some((s) => s.literal && s.jmeno === jmenoSchematu);
    if (!miriSem && !neliteralniSchema) continue;
    if (neliteralniSchema || p.role.some((r) => !r.literal)) {
      nezmereno.push(p.text);
      continue;
    }
    for (const r of p.role) tvurci.push({ role: r.jmeno, text: p.text });
  }
  return { tvurci, nezmereno };
}

const PRESKOCIT = new Set([
  "node_modules", ".git", "dist", "build", "coverage", "archive", "trash", ".tmp", ".expo", ".next",
]);

/**
 * Soubory stromu, které mohou nést SQL vykonané proti databázi — relativní cesty.
 * Testy se neměří (nesou vzorky vad jako data), dokumentace nic nevykonává.
 */
export function univerzumSql(koren) {
  const out = [];
  const projdi = (adresar) => {
    for (const polozka of readdirSync(adresar)) {
      if (PRESKOCIT.has(polozka)) continue;
      const cesta = path.join(adresar, polozka);
      const st = statSync(cesta, { throwIfNoEntry: false });
      if (!st) continue;
      if (st.isDirectory()) {
        projdi(cesta);
        continue;
      }
      const rel = path.relative(koren, cesta).split(path.sep).join("/");
      if (!(path.extname(polozka) in DRUH)) continue;
      if (/\.test\.[a-z]+$/.test(polozka) || rel.startsWith("src/tests/") || rel.includes("/__tests__/")) continue;
      out.push(rel);
    }
  };
  projdi(koren);
  return out.sort();
}

/** Změří jeden soubor stromu. */
export function zmerSoubor(koren, rel, jmenoSchematu = "public") {
  const surovy = readFileSync(path.join(koren, rel), "utf-8");
  // Levný předfiltr: soubor bez „ON SCHEMA“ žádný takový příkaz nenese.
  if (!/ON\s+SCHEMA/i.test(surovy)) return { tvurci: [], nezmereno: [] };
  return kdoSmiVytvaret(bezKomentaru(surovy, path.extname(rel)), jmenoSchematu);
}
