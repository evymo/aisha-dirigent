/**
 * pgtap-fixture-seed-kolize — JEDINÝ vlastník otázky „kolidují fixture
 * pgTAP schema testů s řádky seedu na jedinečném klíči?".
 *
 * ⛔ NAMĚŘENO 2026-09-13: `aisha/db/tests/schema/25_acs_core.sql` vkládal fixture
 * `acs_message_schemas('acs.task.assign@1.0')`, který totéž schéma nese i seed
 * (`aisha/db/seed/core/…`, v `seed.compiled.sql`). Nad DB se seedem
 * (`node scripts/db/with-throwaway-db.mjs -- node scripts/db/run-schema-tests.mjs`)
 * test padal `duplicate key value violates unique constraint
 * "acs_message_schemas_pkey"`, v CI bráně (baseline + heals BEZ seedu) procházel.
 * Test tedy neměřil ACS vrstvu, ale to, zda DB náhodou nemá seed — a CI tu
 * závislost vidět nemohla, protože seed nikdy nepouští.
 *
 * VLASTNOST, kterou modul měří: pro každý INSERT v pgTAP souboru (i uvnitř
 * `$$ … $$` v throws_ok/lives_ok — i očekávaně selhávající INSERT by nad seedem
 * dostal 23505 místo svého kódu) a každý jedinečný klíč cílové tabulky (PRIMARY
 * KEY, UNIQUE, CREATE UNIQUE INDEX) platí: n-tice literálních hodnot klíče se
 * NESHODUJE s n-ticí žádného literálního řádku seedu do téže tabulky.
 *
 * ON CONFLICT NEOMLOUVÁ. `ON CONFLICT DO NOTHING` nad seedem nepadne, ale tiše
 * nechá v tabulce SEEDOVÝ řádek místo fixture — test pak tvrdí něco o hodnotách,
 * které nevložil (jiný `mode`, jiný `is_default`, jiná měna). Takový INSERT je
 * hlášen zvlášť (`sOnConflict: true`), aby ho brána mohla posoudit, ne přehlédnout.
 *
 * CO MODUL NEMĚŘÍ (a říká to nahlas přes `nemeritelne`):
 *  - hodnoty z `gen_random_uuid()`, `format(%L)`, `SELECT …` — nejsou literál, pro
 *    každý běh jiné nebo odvozené; statická kolize z nich plyne jen náhodou;
 *  - sloupce klíče, které INSERT vůbec neuvádí (hodnota = DEFAULT tabulky);
 *  - řádky seedu vložené přes `INSERT … SELECT` (nemají literální n-tici);
 *  - výrazové a částečné unikátní indexy (`lower(x)`, `WHERE …`) — částečný index
 *    se měří BEZ své podmínky (nadhodnocení = hlasitě, ne tiše), výrazový se
 *    přeskočí a vrací se v `nemeritelne`.
 *
 * `current_setting('k')` se rozřeší, pokud soubor obsahuje `set_config('k', '<literál>', …)`
 * — fixture s pevnou hodnotou schovanou za nastavením je pořád pevná hodnota.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// ── lexikální vrstva ─────────────────────────────────────────────────────────

const DOLAR = /\$([A-Za-z_]\w*)?\$/y;
const vyplnMezerami = (s) => s.replace(/[^\n]/g, " ");

/**
 * Lexer jedné úrovně SQL textu. Délka i pozice znaků se zachovávají, aby offsety
 * v `clean` a `masked` odpovídaly originálu.
 *   clean  — komentáře `--` a `/* *\/` (mimo řetězce) → mezery; obsah dolarových
 *            řetězců beze změny (hodnota `$json$…$json$` je literál).
 *   masked — jako clean, ale OBSAH dolarových řetězců → mezery. Struktura (závorky,
 *            čárky, klíčová slova) se čte odtud: čárka v JSONu ani apostrof v
 *            `$json$ "don't" $json$` pak nerozbijí n-tici.
 *   regions — dolarové řetězce této úrovně { start, end } (rozsah obsahu). INSERT
 *            uvnitř `$$ … $$` (throws_ok/lives_ok/DO) je skutečný příkaz, který se nad
 *            DB spustí — měří se rekurzí do jeho obsahu, ne přeskočením.
 */
export function lex(sql) {
  let clean = "";
  let masked = "";
  const regions = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue; } break; }
        j += 1;
      }
      const s = sql.slice(i, j + 1);
      clean += s; masked += s; i = j + 1;
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      let j = i;
      while (j < sql.length && sql[j] !== "\n") j += 1;
      const sp = " ".repeat(j - i);
      clean += sp; masked += sp; i = j;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const k = sql.indexOf("*/", i + 2);
      const j = k === -1 ? sql.length : k + 2;
      const sp = vyplnMezerami(sql.slice(i, j));
      clean += sp; masked += sp; i = j;
      continue;
    }
    if (c === "$" && !/[\w$]/.test(sql[i - 1] || "")) {
      DOLAR.lastIndex = i;
      const m = DOLAR.exec(sql);
      if (m) {
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        if (close !== -1) {
          const content = sql.slice(i + tag.length, close);
          regions.push({ start: i + tag.length, end: close });
          clean += tag + content + tag;
          masked += tag + vyplnMezerami(content) + tag;
          i = close + tag.length;
          continue;
        }
      }
    }
    clean += c; masked += c; i += 1;
  }
  return { clean, masked, regions };
}

const vypadaJakoSql = (s) => /\b(INSERT|SELECT|PERFORM|DECLARE|BEGIN|UPDATE|CREATE)\b/i.test(s);

/**
 * Text bez komentářů na VŠECH úrovních: obsah dolarového řetězce, který vypadá jako
 * SQL (tělo DO/funkce, argument throws_ok), se čistí rekurzivně; datový řetězec
 * (`$json$…$json$`) zůstává, jak je.
 */
export function bezKomentaru(sql) {
  const { clean, regions } = lex(sql);
  let out = "";
  let pos = 0;
  for (const r of regions) {
    const content = sql.slice(r.start, r.end);
    out += clean.slice(pos, r.start) + (vypadaJakoSql(content) ? bezKomentaru(content) : content);
    pos = r.end;
  }
  return out + clean.slice(pos);
}

const skipWs = (s, i) => { while (i < s.length && /\s/.test(s[i])) i += 1; return i; };

/**
 * Závorkový blok od `(` na pozici i (nad `masked` textem); vrátí { from, to, end }:
 * obsah je s.slice(from, to), end = index za `)`.
 */
function readParens(s, i) {
  if (s[i] !== "(") return null;
  let depth = 0;
  for (let j = i; j < s.length; j += 1) {
    const c = s[j];
    if (c === "'") {
      j += 1;
      while (j < s.length && !(s[j] === "'" && s[j + 1] !== "'")) j += s[j] === "'" ? 2 : 1;
      continue;
    }
    if (c === "(") depth += 1;
    else if (c === ")") { depth -= 1; if (depth === 0) return { from: i + 1, to: j, end: j + 1 }; }
  }
  return null;
}

/** Rozsahy částí rozdělených čárkou na nejvyšší úrovni v s[from, to) (respektuje závorky a uvozovky). */
function splitRanges(s, from = 0, to = s.length) {
  const parts = [];
  let depth = 0;
  let start = from;
  for (let j = from; j < to; j += 1) {
    const c = s[j];
    if (c === "'") {
      j += 1;
      while (j < to && !(s[j] === "'" && s[j + 1] !== "'")) j += s[j] === "'" ? 2 : 1;
      continue;
    }
    if (c === "(" || c === "[") depth += 1;
    else if (c === ")" || c === "]") depth -= 1;
    else if (c === "," && depth === 0) { parts.push([start, j]); start = j + 1; }
  }
  if (s.slice(start, to).trim()) parts.push([start, to]);
  return parts;
}

/** Rozdělí text na nejvyšší úrovni podle čárek (dolarové řetězce respektuje). */
export function splitTopLevel(s) {
  const { masked } = lex(s);
  return splitRanges(masked).map(([a, b]) => s.slice(a, b).trim());
}

const normIdent = (x) => x.trim().replace(/"/g, "").toLowerCase().replace(/^public\./, "");

// ── INSERT příkazy ───────────────────────────────────────────────────────────

/**
 * Všechny INSERT příkazy v textu (i v dolarových blocích):
 *   { table, columns|null, rows|null, kind, onConflict, line }
 * kind: 'values' (rows = pole textů výrazů), 'select' | 'default' (rows = null).
 */
export function extractInserts(sql) {
  return extractNaUrovni(sql, 1).sort((a, b) => a.line - b.line);
}

function extractNaUrovni(sql, prvniRadek) {
  const { clean, masked, regions } = lex(sql);
  const radek = (idx) => prvniRadek + (masked.slice(0, idx).match(/\n/g)?.length ?? 0);
  const re = /\bINSERT\s+INTO\s+(?:ONLY\s+)?((?:"?[A-Za-z_]\w*"?\.)?"?[A-Za-z_]\w*"?)/gi;
  const found = [];
  let m;
  while ((m = re.exec(masked)) !== null) {
    const table = normIdent(m[1]);
    const line = radek(m.index);
    let i = skipWs(masked, m.index + m[0].length);
    let columns = null;
    if (masked[i] === "(") {
      const p = readParens(masked, i);
      if (!p) continue;
      columns = splitRanges(masked, p.from, p.to).map(([a, b]) => normIdent(masked.slice(a, b)));
      i = skipWs(masked, p.end);
    }
    const overriding = /^OVERRIDING\s+(?:SYSTEM|USER)\s+VALUE\s+/i.exec(masked.slice(i, i + 40));
    if (overriding) i = skipWs(masked, i + overriding[0].length);
    const head = masked.slice(i, i + 16);
    if (/^DEFAULT\s+VALUES/i.test(head)) { found.push({ table, columns, rows: null, kind: "default", onConflict: null, line }); continue; }
    if (!/^VALUES\b/i.test(head)) { found.push({ table, columns, rows: null, kind: "select", onConflict: null, line }); continue; }
    i = skipWs(masked, i + "VALUES".length);
    const rows = [];
    while (masked[i] === "(") {
      const p = readParens(masked, i);
      if (!p) break;
      rows.push(splitRanges(masked, p.from, p.to).map(([a, b]) => clean.slice(a, b).trim()));
      i = skipWs(masked, p.end);
      if (masked[i] !== ",") break;
      i = skipWs(masked, i + 1);
    }
    found.push({ table, columns, rows, kind: "values", onConflict: parseOnConflict(masked, clean, i), line });
  }
  for (const r of regions) {
    const content = sql.slice(r.start, r.end);
    if (/\bINSERT\s+INTO\b/i.test(content)) found.push(...extractNaUrovni(content, radek(r.start)));
  }
  return found;
}

/**
 * `ON CONFLICT [(cíl)] DO NOTHING | DO UPDATE SET a = EXCLUDED.a, …` na pozici i.
 * Vrací null (žádná klauzule) nebo { target: [sloupce]|null, action, set: Map sloupec → výraz }.
 */
function parseOnConflict(masked, clean, i) {
  const head = /^ON\s+CONFLICT\s*/i.exec(masked.slice(i, i + 32));
  if (!head) return null;
  let j = i + head[0].length;
  let target = null;
  if (masked[j] === "(") {
    const p = readParens(masked, j);
    if (!p) return { target: null, action: "?", set: new Map() };
    target = splitRanges(masked, p.from, p.to).map(([a, b]) => normIdent(masked.slice(a, b)));
    j = skipWs(masked, p.end);
  } else {
    // `ON CONSTRAINT jméno` nelze staticky spárovat se sloupci klíče → target zůstane null
    const oc = /^ON\s+CONSTRAINT\s+"?\w+"?\s*/i.exec(masked.slice(j, j + 200));
    if (oc) j += oc[0].length;
  }
  if (/^DO\s+NOTHING\b/i.test(masked.slice(j, j + 16))) return { target, action: "nothing", set: new Map() };
  const upd = /^DO\s+UPDATE\s+SET\s+/i.exec(masked.slice(j, j + 32));
  if (!upd) return { target, action: "?", set: new Map() };
  j += upd[0].length;
  // SET končí `;`, `WHERE`/`RETURNING` na nejvyšší úrovni, nebo `)` o úroveň výš (konec vnoření)
  let depth = 0;
  let end = j;
  for (; end < masked.length; end += 1) {
    const c = masked[end];
    if (c === "'") {
      end += 1;
      while (end < masked.length && !(masked[end] === "'" && masked[end + 1] !== "'")) end += masked[end] === "'" ? 2 : 1;
      continue;
    }
    if (c === "(") depth += 1;
    else if (c === ")") { if (depth === 0) break; depth -= 1; }
    else if (depth === 0 && (c === ";" || /^\s(WHERE|RETURNING)\b/i.test(masked.slice(end, end + 12)))) break;
  }
  const set = new Map();
  for (const [a, b] of splitRanges(masked, j, end)) {
    const eq = /^"?([A-Za-z_]\w*)"?\s*=\s*([\s\S]+)$/.exec(clean.slice(a, b).trim());
    if (eq) set.set(normIdent(eq[1]), eq[2].trim());
  }
  return { target, action: "update", set };
}

/**
 * Vyhraje fixture nad kolidujícím seedovým řádkem deterministicky?
 * Ano jen tehdy, když `ON CONFLICT (<přesně sloupce kolidujícího klíče>) DO UPDATE SET`
 * přepíše KAŽDÝ sloupec, který fixture deklaruje (mimo klíč), hodnotou `EXCLUDED.<týž sloupec>`.
 * Pak je stav deklarovaných sloupců po INSERTu totožný nad DB se seedem i bez něj —
 * ať seed (kterýkoli profil, dnes i zítra) nese v těch sloupcích cokoli.
 */
export function fixtureVyhrava(ins, keyColumns) {
  const oc = ins.onConflict;
  if (!oc || oc.action !== "update" || !oc.target) return false;
  const same = oc.target.length === keyColumns.length && keyColumns.every((c) => oc.target.includes(c));
  if (!same) return false;
  return (ins.columns || [])
    .filter((c) => !keyColumns.includes(c))
    .every((c) => new RegExp(`^excluded\\."?${c}"?$`, "i").test(oc.set.get(c) || ""));
}

/**
 * Pevné hodnoty schované za jménem:
 *  - `set_config('k', '<literál>', …)` → klíč 'k' (pro current_setting('k'));
 *  - PL/pgSQL `v_uid uuid := '<literál>';` → klíč 'var:v_uid'
 *    (NAMĚŘENO 2026-09-13: 17_connector_substrate.sql vkládá aisha_auth.users přes v_uid).
 * Tentýž klíč s RŮZNÝMI literály → null (hodnota v místě INSERTu není staticky
 * jednoznačná → neměřitelné), ne „první vyhrává".
 */
export function literalSettings(rawSql) {
  const sql = bezKomentaru(rawSql);
  const map = new Map();
  const put = (key, val) => {
    if (map.has(key) && map.get(key) !== val) map.set(key, null);
    else map.set(key, val);
  };
  let m;
  const sc = /\bset_config\s*\(\s*'([^']+)'\s*,\s*'((?:[^']|'')*)'\s*(?:::\s*\w+\s*)?,/gi;
  while ((m = sc.exec(sql)) !== null) put(m[1], m[2].replace(/''/g, "'"));
  const dv = /\b([A-Za-z_]\w*)\s+[\w.]+(?:\s*\[\s*\])?\s*:=\s*'((?:[^']|'')*)'\s*(?:::\s*[\w.]+\s*)?;/g;
  while ((m = dv.exec(sql)) !== null) put(`var:${m[1].toLowerCase()}`, m[2].replace(/''/g, "'"));
  return map;
}

/**
 * Literální hodnota výrazu: { known: true, value } | { known: false }.
 * value === null znamená SQL NULL (v unikátním klíči nikdy nekoliduje).
 */
export function literalValue(expr, settings = new Map()) {
  let e = expr.trim();
  // odlep koncové přetypování `::typ`, `::typ[]`, `::"typ"` (i opakovaně)
  for (;;) {
    const c = /::\s*"?[\w.]+"?(?:\s*\[\s*\])?\s*$/.exec(e);
    if (!c) break;
    e = e.slice(0, c.index).trim();
  }
  if (e.startsWith("(")) {
    const { masked } = lex(e);
    const p = readParens(masked, 0);
    if (p && p.end === e.length) return literalValue(e.slice(p.from, p.to), settings);
  }
  let m = /^'((?:[^']|'')*)'$/s.exec(e);
  if (m) return { known: true, value: m[1].replace(/''/g, "'") };
  m = /^E'((?:[^'\\]|\\.|'')*)'$/is.exec(e);
  if (m) return { known: true, value: m[1].replace(/''/g, "'").replace(/\\(.)/g, "$1") };
  m = /^(\$(?:[A-Za-z_]\w*)?\$)([\s\S]*)\1$/.exec(e);
  if (m) return { known: true, value: m[2] };
  if (/^NULL$/i.test(e)) return { known: true, value: null };
  if (/^(TRUE|FALSE)$/i.test(e)) return { known: true, value: e.toLowerCase() };
  if (/^-?\d+(?:\.\d+)?$/.test(e)) return { known: true, value: String(Number(e)) };
  m = /^current_setting\s*\(\s*'([^']+)'\s*(?:,\s*\w+\s*)?\)$/i.exec(e);
  if (m && settings.has(m[1]) && settings.get(m[1]) !== null) return { known: true, value: settings.get(m[1]) };
  m = /^([A-Za-z_]\w*)$/.exec(e);
  if (m) {
    const key = `var:${m[1].toLowerCase()}`;
    if (settings.has(key) && settings.get(key) !== null) return { known: true, value: settings.get(key) };
  }
  return { known: false };
}

// ── jedinečné klíče ze SoT schématu ─────────────────────────────────────────

const listSql = (dir) => {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listSql(p));
    else if (name.endsWith(".sql")) out.push(p);
  }
  return out.sort();
};

const plainCols = (inner) => {
  const cols = splitTopLevel(inner).map((c) => c.replace(/\s+(ASC|DESC)\b.*$/i, "").replace(/\s+NULLS\s+(FIRST|LAST)\b.*$/i, ""));
  return cols.every((c) => /^"?[A-Za-z_]\w*"?$/.test(c.trim())) ? cols.map(normIdent) : null;
};

/**
 * Map tabulka → [{ columns, source, partial }] ze `aisha/db/sql/**` + substrátu infra/postgres.
 * Výrazové indexy vrací zvlášť v `vyrazove` (neměřitelné).
 */
// ⛔ NAMĚŘENO 2026-09-16: #973 přejmenoval infra/pg17 → infra/postgres a filtr
// `existsSync` níž chybějící substrát tiše vynechal — klíče aisha_auth.* zmizely
// a brána hlásila fixture jako neměřitelné. Chybějící substrát je teď chyba.
export const SUBSTRAT = join(ROOT, "infra/postgres/000_init_roles_schemas.sql");

export function uniqueKeys(sqlDir = join(ROOT, "aisha/db/sql"), extraFiles = [SUBSTRAT]) {
  const keys = new Map();
  const vyrazove = [];
  const add = (table, columns, source, partial = false) => {
    const t = normIdent(table);
    if (!keys.has(t)) keys.set(t, []);
    const sig = columns.join(",");
    if (!keys.get(t).some((k) => k.columns.join(",") === sig)) keys.get(t).push({ columns, source, partial });
  };
  // Substrát (aisha_auth.*) není v aisha/db/sql, ale jeho tabulky seed i testy plní.
  const chybi = extraFiles.filter((f) => !existsSync(f));
  if (chybi.length) throw new Error(`substrát schématu nenalezen: ${chybi.map((f) => relative(ROOT, f)).join(", ")} — klíče jeho tabulek by tiše zmizely`);
  for (const file of [...listSql(sqlDir), ...extraFiles]) {
    const sql = lex(bezKomentaru(readFileSync(file, "utf8"))).clean;
    const rel = relative(ROOT, file);
    const ct = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"?\w+"?\.)?"?\w+"?)\s*\(/gi;
    let m;
    while ((m = ct.exec(sql)) !== null) {
      const p = readParens(sql, m.index + m[0].length - 1);
      if (!p) continue;
      for (const el of splitTopLevel(sql.slice(p.from, p.to))) {
        const tc = /^(?:CONSTRAINT\s+"?\w+"?\s+)?(PRIMARY\s+KEY|UNIQUE)(?:\s+NULLS\s+(?:NOT\s+)?DISTINCT)?\s*\(/i.exec(el);
        if (tc) {
          const pp = readParens(el, tc[0].length - 1);
          const cols = pp && plainCols(el.slice(pp.from, pp.to));
          if (cols) add(m[1], cols, rel);
          continue;
        }
        const col = /^"?([A-Za-z_]\w*)"?\s/.exec(el);
        if (!col || /^(CONSTRAINT|CHECK|FOREIGN|EXCLUDE|LIKE)$/i.test(col[1])) continue;
        // PRIMARY KEY / UNIQUE v definici sloupce — mimo závorky (CHECK(...), REFERENCES x(y))
        const flat = el.replace(/\((?:[^()]|\([^()]*\))*\)/g, "()").replace(/'(?:[^']|'')*'/g, "''");
        if (/\bPRIMARY\s+KEY\b|\bUNIQUE\b/i.test(flat)) add(m[1], [normIdent(col[1])], rel);
      }
    }
    const at = /\bALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?((?:"?\w+"?\.)?"?\w+"?)\s+ADD\s+(?:CONSTRAINT\s+"?\w+"?\s+)?(PRIMARY\s+KEY|UNIQUE)(?:\s+NULLS\s+(?:NOT\s+)?DISTINCT)?\s*\(/gi;
    while ((m = at.exec(sql)) !== null) {
      const p = readParens(sql, m.index + m[0].length - 1);
      const cols = p && plainCols(sql.slice(p.from, p.to));
      if (cols) add(m[1], cols, rel);
    }
    const ui = /\bCREATE\s+UNIQUE\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:"?\w+"?\s+)?ON\s+(?:ONLY\s+)?((?:"?\w+"?\.)?"?\w+"?)\s*(?:USING\s+\w+\s*)?\(/gi;
    while ((m = ui.exec(sql)) !== null) {
      const p = readParens(sql, m.index + m[0].length - 1);
      if (!p) continue;
      const inner = sql.slice(p.from, p.to);
      const cols = plainCols(inner);
      const after = sql.slice(p.end, p.end + 200);
      const partial = /^\s*(?:INCLUDE\s*\([^)]*\)\s*)?(?:WITH\s*\([^)]*\)\s*)?WHERE\b/i.test(after);
      if (cols) add(m[1], cols, rel, partial);
      else vyrazove.push({ table: normIdent(m[1]), expr: inner.trim(), source: rel });
    }
  }
  return { keys, vyrazove };
}

// ── seed a testy ─────────────────────────────────────────────────────────────

/** Seedové soubory: kompilovaný seed + VŠECHNY zdroje všech profilů. */
export function seedFiles() {
  const files = [];
  const compiled = join(ROOT, "aisha/db/seed.compiled.sql");
  if (existsSync(compiled)) files.push(compiled);
  files.push(...listSql(join(ROOT, "aisha/db/seed")));
  return files;
}

/** pgTAP soubory: aisha/db/tests/schema/**.sql (i omni/, které pouští acceptance harness). */
export function pgtapFiles() {
  return listSql(join(ROOT, "aisha/db/tests/schema"));
}

/** Literální n-tice klíče pro řádek INSERTu, nebo důvod, proč ji nelze změřit. */
function keyTuple(ins, row, key, settings) {
  if (!ins.columns) return { known: false, proc: "INSERT bez seznamu sloupců" };
  const values = [];
  for (const col of key.columns) {
    const idx = ins.columns.indexOf(col);
    if (idx === -1) return { known: false, proc: `sloupec klíče ${col} není v INSERTu (DEFAULT)` };
    const v = literalValue(row[idx] ?? "", settings);
    if (!v.known) return { known: false, proc: `sloupec ${col} není literál` };
    if (v.value === null) return { known: false, proc: `sloupec ${col} je NULL (v unikátním klíči nekoliduje)`, isNull: true };
    values.push(v.value);
  }
  return { known: true, values };
}

/**
 * Čisté měření nad texty (bez disku — i negativní sondy brány jdou touto cestou).
 *
 *   testy, seedy: [{ jmeno, sql }]
 *   klice: výsledek uniqueKeys()
 *
 * Vrací { kolize, prijate, nemeritelne, mereno }:
 *  kolize: [{ test, line, table, key, values, druh, seed, seedLine }] — PORUŠENÍ vlastnosti:
 *    druh 'tvrda' — INSERT bez ON CONFLICT: nad seedem 23505, test padne;
 *    druh 'ticha' — ON CONFLICT, ale fixture nevyhraje (DO NOTHING / neúplný SET):
 *                   nad seedem test tiše běží nad SEEDOVÝM řádkem, ne nad svou fixture.
 *  prijate: kolize, kde fixture vyhrává (fixtureVyhrava) — stav řádku je nad seedem
 *    i bez něj totožný.
 *  nemeritelne: [{ test, line, table, proc }] — literální fixture, u které kolizi
 *    NELZE staticky vyloučit (seed plní tabulku přes INSERT … SELECT; výrazový
 *    unikátní index; tabulka bez klíče v SoT, kterou seed plní). Brána je bere jako
 *    porušení: co neumí změřit, nesmí vydávat za zelené.
 *  mereno: počet porovnaných párů (literální řádek fixture × jedinečný klíč).
 */
export function zmerKolize({ testy, seedy, klice }) {
  const { keys, vyrazove } = klice;

  const seedIndex = new Map();
  const seedNeliteralni = new Map();
  const seedTabulky = new Set();
  for (const { jmeno, sql } of seedy) {
    const settings = literalSettings(sql);
    for (const ins of extractInserts(sql)) {
      seedTabulky.add(ins.table);
      const tkeys = keys.get(ins.table) || [];
      if (ins.kind === "select") {
        if (!seedNeliteralni.has(ins.table)) seedNeliteralni.set(ins.table, []);
        seedNeliteralni.get(ins.table).push(`${jmeno}:${ins.line}`);
      }
      if (ins.kind !== "values") continue;
      for (const row of ins.rows) {
        for (const key of tkeys) {
          const t = keyTuple(ins, row, key, settings);
          if (!t.known) continue;
          const sig = `${ins.table}|${key.columns.join(",")}`;
          if (!seedIndex.has(sig)) seedIndex.set(sig, new Map());
          const tupleSig = JSON.stringify(t.values);
          if (!seedIndex.get(sig).has(tupleSig)) seedIndex.get(sig).set(tupleSig, { seed: jmeno, line: ins.line });
        }
      }
    }
  }

  const kolize = [];
  const prijate = [];
  const nemeritelne = [];
  let mereno = 0;
  for (const { jmeno: test, sql } of testy) {
    const settings = literalSettings(sql);
    for (const ins of extractInserts(sql)) {
      if (ins.kind !== "values" || !seedTabulky.has(ins.table)) continue;
      const tkeys = keys.get(ins.table) || [];
      const literalniSloupce = (row) => (ins.columns || []).filter((c, idx) => {
        const v = literalValue(row[idx] ?? "", settings);
        return v.known && v.value !== null;
      });
      for (const row of ins.rows) {
        if (!tkeys.length) {
          if (literalniSloupce(row).length) {
            nemeritelne.push({ test, line: ins.line, table: ins.table, proc: `seed plní ${ins.table}, ale jedinečný klíč tabulky není v aisha/db/sql — kolizi literálních sloupců (${literalniSloupce(row).join(", ")}) nelze vyloučit` });
          }
          continue;
        }
        for (const key of tkeys) {
          const t = keyTuple(ins, row, key, settings);
          if (!t.known) continue; // neliterál = per-běh jedinečný / odvozený; NULL v klíči nekoliduje
          mereno += 1;
          const vyhrava = fixtureVyhrava(ins, key.columns);
          const hit = seedIndex.get(`${ins.table}|${key.columns.join(",")}`)?.get(JSON.stringify(t.values));
          if (hit) {
            const zaznam = { test, line: ins.line, table: ins.table, key: key.columns, values: t.values, seed: hit.seed, seedLine: hit.line };
            if (vyhrava) prijate.push(zaznam);
            else kolize.push({ ...zaznam, druh: ins.onConflict ? "ticha" : "tvrda" });
          } else if (seedNeliteralni.has(ins.table) && !vyhrava) {
            nemeritelne.push({ test, line: ins.line, table: ins.table, proc: `seed plní ${ins.table} i přes INSERT … SELECT (${seedNeliteralni.get(ins.table).join(", ")}) — literální klíč ${key.columns.join(",")}=${JSON.stringify(t.values)} nelze staticky vyloučit` });
          }
        }
        for (const v of vyrazove.filter((x) => x.table === ins.table)) {
          const lit = literalniSloupce(row).filter((c) => new RegExp(`\\b${c}\\b`, "i").test(v.expr));
          if (lit.length) nemeritelne.push({ test, line: ins.line, table: ins.table, proc: `výrazový unikátní index ${v.expr} (${v.source}) nad literálními sloupci ${lit.join(", ")}` });
        }
      }
    }
  }
  return { kolize, prijate, nemeritelne, mereno };
}

/** Měření nad repozitářem: všechny pgTAP soubory × kompilovaný seed + zdroje všech profilů. */
export function najdiKolize({ testFiles = pgtapFiles(), seeds = seedFiles(), sqlDir } = {}) {
  const nacti = (f) => ({ jmeno: relative(ROOT, f), sql: readFileSync(f, "utf8") });
  return zmerKolize({ testy: testFiles.map(nacti), seedy: seeds.map(nacti), klice: uniqueKeys(sqlDir) });
}
