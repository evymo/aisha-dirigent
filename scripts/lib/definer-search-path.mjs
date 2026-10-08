/**
 * definer-search-path.mjs — funkce SECURITY DEFINER × search_path × odkazy bez schématu.
 *
 * Čistý měřák nad zdrojem pravdy (aisha/db/sql). Nic nespouští.
 *
 * ⛔ PROČ (změřeno 2026-10-03): funkce SECURITY DEFINER běží právy vlastníka — tady
 * superuživatele. Dvě cesty, jak jí podstrčit cizí objekt, a každou zavírá něco jiného:
 *
 *   STÍNĚNÍ DOČASNÝM OBJEKTEM. Když `search_path` NEJMENUJE `pg_temp`, PostgreSQL ho
 *   pro RELACE a TYPY prohledá jako první. Kdo smí v relaci založit dočasnou tabulku
 *   a funkci zavolat, přesměruje nekvalifikovaný odkaz (`FROM profiles`, `::app_role`,
 *   `x%ROWTYPE`) na svůj objekt. Zavírá to `pg_temp` POSLEDNÍ v cestě
 *   (`SET search_path TO 'pg_catalog', 'public', 'pg_temp'`) nebo kvalifikace odkazu.
 *
 *   PŘETÍŽENÍ VE SCHÉMATU NA CESTĚ. Pro FUNKCE a OPERÁTORY se `pg_temp` bez výslovné
 *   kvalifikace nehledá nikdy; tam rozhoduje, kdo smí VYTVÁŘET ve schématu na cestě.
 *   Volání funkce instance bez schématu (`is_admin()` místo `public.is_admin()`) je
 *   proto druhá, samostatná míra.
 *
 * Co se NEMĚŘÍ a měřák to říká: obsah dynamického SQL (`EXECUTE '…'`) — řetězce se
 * z těla vyjímají; funkce bez dolarového těla jdou do `nerozebrano`, ne do „čisto“.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripSqlComments } from "../db/lib/sql-comments.mjs";

const KLICOVA = new Set([
  "select", "lateral", "only", "set", "of", "skip", "nowait", "values", "default", "unnest", "table", "rows", "each",
  "where", "group", "order", "limit", "on", "using", "as", "into", "from", "join", "left", "right", "inner", "outer",
  "cross", "full", "natural", "returning", "with", "recursive", "if", "then", "else", "end", "loop", "begin", "case",
  "when", "not", "null", "true", "false", "and", "or", "in", "exists", "all", "any", "some", "strict",
]);
/** Funkce, ve kterých `FROM` není klauzule dotazu. */
const FROM_V_ARGUMENTU = new Set(["extract", "substring", "trim", "overlay", "position", "btrim", "ltrim", "rtrim"]);

/** Řetězcové literály pryč — obsah dynamického SQL se neměří (hlásí se zvlášť). */
function bezRetezcu(s) {
  return s.replace(/\$[A-Za-z_]*\$[\s\S]*?\$[A-Za-z_]*\$/g, " '' ").replace(/E?'(?:[^']|'')*'/g, " '' ");
}

/** Tělo první funkce v souboru (mezi dolarovými uvozovkami), hlavička před ním a zbytek za ním. */
function rozdel(text) {
  const m = /\bAS\s+(\$[A-Za-z_0-9]*\$)/i.exec(text);
  if (!m) return null;
  const od = m.index + m[0].length;
  const konec = text.indexOf(m[1], od);
  if (konec === -1) return null;
  return { hlavicka: text.slice(0, m.index), telo: text.slice(od, konec), zbytek: text.slice(konec + m[1].length) };
}

function nazvyCte(telo) {
  const out = new Set();
  const re = /(?:\bWITH\s+(?:RECURSIVE\s+)?|,\s*)([a-z_][a-z0-9_]*)\s*(?:\([^()]*\))?\s+AS\s+(?:NOT\s+MATERIALIZED\s+|MATERIALIZED\s+)?\(/gi;
  for (const m of telo.matchAll(re)) out.add(m[1].toLowerCase());
  return out;
}

/** Slova těla se zásobníkem závorek: ke každému slovu jméno funkce, v jejíchž závorkách stojí. */
function slovaSeZavorkami(telo) {
  const out = [];
  const zasobnik = [];
  const re = /([A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*)*)|(\()|(\))|(::)|(%)|(\S)/g;
  let posledni = null;
  for (let m = re.exec(telo); m; m = re.exec(telo)) {
    const v = zasobnik[zasobnik.length - 1] ?? null;
    if (m[1]) {
      out.push({ s: m[1], v });
      posledni = m[1];
    } else if (m[2]) {
      out.push({ s: "(", v });
      zasobnik.push(posledni ? posledni.toLowerCase() : "");
      posledni = null;
    } else if (m[3]) {
      zasobnik.pop();
      out.push({ s: ")", v: zasobnik[zasobnik.length - 1] ?? null });
      posledni = null;
    } else {
      out.push({ s: m[0], v });
      posledni = null;
    }
  }
  return out;
}

/** Odkazy bez schématu v těle funkce. `slovnik` = { relace, typy, funkce } (Set jmen malými písmeny). */
export function odkazyBezSchematu(telo, slovnik) {
  const cisty = bezRetezcu(stripSqlComments(telo));
  const cte = nazvyCte(cisty);
  const w = slovaSeZavorkami(cisty);
  const relace = new Set();
  const katalog = new Set();
  const typy = new Set();
  const funkce = new Set();

  const jeRelace = (jmeno) => {
    const n = jmeno.toLowerCase();
    if (n.includes(".")) return; // kvalifikované (schema.relace) nebo pole záznamu — obojí mimo třídu
    if (KLICOVA.has(n) || cte.has(n)) return;
    if (slovnik.relace.has(n)) relace.add(n);
    else if (/^pg_|^information_schema$/.test(n)) katalog.add(n);
  };
  const jeJmeno = (x) => Boolean(x) && /^[A-Za-z_]/.test(x.s);

  for (let i = 0; i < w.length; i++) {
    const s = w[i].s;
    const low = s.toLowerCase();
    const pred = w[i - 1]?.s.toLowerCase();
    const dalsi = w[i + 1];

    if (low === "from" || low === "join") {
      if (low === "from" && (FROM_V_ARGUMENTU.has(w[i].v ?? "") || pred === "distinct")) continue; // extract(… FROM …), IS DISTINCT FROM
      let k = i + 1;
      if (w[k]?.s.toLowerCase() === "only" || w[k]?.s.toLowerCase() === "lateral") k += 1;
      if (!jeJmeno(w[k])) continue; // poddotaz v závorce
      if (w[k + 1]?.s === "(") continue; // funkce vracející řádky — měří se u funkcí níž
      jeRelace(w[k].s);
    } else if (low === "into") {
      if ((pred === "insert" || pred === "merge") && jeJmeno(dalsi)) jeRelace(dalsi.s);
    } else if (low === "update") {
      if (pred === "do" || pred === "for" || pred === "key") continue; // ON CONFLICT DO UPDATE, FOR [NO KEY] UPDATE
      let k = i + 1;
      if (w[k]?.s.toLowerCase() === "only") k += 1;
      if (jeJmeno(w[k])) jeRelace(w[k].s);
    } else if (low === "truncate") {
      let k = i + 1;
      if (w[k]?.s.toLowerCase() === "table") k += 1;
      if (jeJmeno(w[k])) jeRelace(w[k].s);
    }

    // Typy: `tabulka%ROWTYPE`, `tabulka.sloupec%TYPE`, `::typ_instance`.
    if (s === "%" && dalsi && /^(rowtype|type)$/i.test(dalsi.s)) {
      const co = pred ?? "";
      const casti = co.split(".");
      if (/^rowtype$/i.test(dalsi.s)) {
        if (casti.length === 1 && slovnik.relace.has(casti[0])) typy.add(`${co}%rowtype`);
      } else if (casti.length === 2 && slovnik.relace.has(casti[0])) typy.add(`${co}%type`);
    }
    if (s === "::" && dalsi && slovnik.typy.has(dalsi.s.toLowerCase())) typy.add(`::${dalsi.s.toLowerCase()}`);

    // Funkce instance volaná bez schématu.
    if (jeJmeno(w[i]) && !s.includes(".") && dalsi?.s === "(" && slovnik.funkce.has(low) && !KLICOVA.has(low)) funkce.add(low);
  }
  return {
    relace: [...relace].sort(),
    katalog: [...katalog].sort(),
    typy: [...typy].sort(),
    funkce: [...funkce].sort(),
    dynamicke: /\bEXECUTE\b(?!\s+(ON|PROCEDURE|FUNCTION)\b)/i.test(stripSqlComments(telo)),
  };
}

/**
 * Dočasné tabulky, které si funkce zakládá a nepoužívá je bezpečně.
 *
 * ⛔ `CREATE TEMPORARY TABLE IF NOT EXISTS x` v definer funkci převezme tabulku `x`,
 * kterou si volající v relaci založil PŘEDEM — s vlastními spouštěmi, výchozími
 * hodnotami a omezeními, které pak běží právy vlastníka funkce. Nekvalifikovaný
 * odkaz navíc najde dřív stejnojmennou tabulku ve schématu před `pg_temp`.
 * Bezpečný tvar: `DROP TABLE IF EXISTS pg_temp.x;` → `CREATE TEMPORARY TABLE x (…)`
 * (bez IF NOT EXISTS) → všechny další odkazy `pg_temp.x`.
 *
 * @returns {string[]} jména dočasných tabulek, která tvar nedodržují (seřazená)
 */
export function docasneNebezpecne(telo) {
  const cisty = bezRetezcu(stripSqlComments(telo));
  const vady = new Set();
  const re = /\bCREATE\s+(?:TEMP|TEMPORARY)\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?((?:pg_temp\.)?[a-z_][a-z0-9_]*)/gi;
  const zalozene = new Map(); // jméno → kolikrát vzniká BEZ kvalifikace (ten výskyt je dovolený)
  for (const m of cisty.matchAll(re)) {
    const jmeno = m[2].toLowerCase().replace(/^pg_temp\./, "");
    if (m[1]) vady.add(jmeno);
    zalozene.set(jmeno, (zalozene.get(jmeno) ?? 0) + (m[2].toLowerCase().startsWith("pg_temp.") ? 0 : 1));
  }
  for (const [jmeno, priZalozeni] of zalozene) {
    const j = jmeno.replace(/[$]/g, "\\$&");
    if (!new RegExp(`\\bDROP\\s+TABLE\\s+IF\\s+EXISTS\\s+pg_temp\\.${j}\\b`, "i").test(cisty)) vady.add(jmeno);
    const vsechny = (cisty.match(new RegExp(`(?<![A-Za-z0-9_$.])${j}(?![A-Za-z0-9_$])`, "gi")) ?? []).length;
    if (vsechny > priZalozeni) vady.add(jmeno); // odkaz bez `pg_temp.` mimo samotné založení
  }
  return [...vady].sort();
}

/** Cesta ze `SET search_path …` v hlavičce funkce; `null`, když ji funkce nenastavuje. */
export function cestaHledani(hlavicka) {
  const m = /SET\s+search_path\s*(?:TO|=)\s*([^\n]*)/i.exec(stripSqlComments(hlavicka));
  if (!m) return null;
  return m[1]
    .replace(/\bAS\b.*$/i, "")
    .split(",")
    .map((x) => x.replace(/['"\s;]/g, "").toLowerCase())
    .filter(Boolean);
}

/**
 * Rozbor jednoho souboru funkce.
 *
 * @returns {null | {nerozebrano: true} | {cesta: string[]|null, tempPosledni: boolean, stinitelna: boolean,
 *   volaBezSchematu: boolean, docasne: string[], relace: string[], katalog: string[], typy: string[], funkce: string[],
 *   dynamicke: boolean}}
 *   `null` = funkce není SECURITY DEFINER.
 */
export function rozborDefineru(text, slovnik) {
  if (!/SECURITY\s+DEFINER/i.test(stripSqlComments(text))) return null;
  const r = rozdel(text);
  if (!r) return { nerozebrano: true };
  const cesta = cestaHledani(r.hlavicka) ?? cestaHledani(r.zbytek);
  const tempPosledni = Boolean(cesta) && cesta[cesta.length - 1] === "pg_temp";
  const o = odkazyBezSchematu(r.telo, slovnik);
  return {
    cesta,
    tempPosledni,
    stinitelna: !tempPosledni && o.relace.length + o.katalog.length + o.typy.length > 0,
    volaBezSchematu: o.funkce.length > 0,
    docasne: docasneNebezpecne(r.telo),
    ...o,
  };
}

const SQL = "aisha/db/sql";
const sqlSoubory = (koren, slozka) => readdirSync(join(koren, SQL, slozka)).filter((f) => f.endsWith(".sql")).sort();

/** Jména relací, typů a funkcí instance ze zdroje pravdy. */
export function slovnikZdroje(koren) {
  const relace = new Set();
  const reRelace = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:UNLOGGED\s+)?(?:TABLE|VIEW|MATERIALIZED\s+VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?/gi;
  for (const slozka of ["tables", "views", "materialized_views"]) {
    for (const f of sqlSoubory(koren, slozka)) {
      const t = stripSqlComments(readFileSync(join(koren, SQL, slozka, f), "utf-8"));
      for (const m of t.matchAll(reRelace)) relace.add(m[1].toLowerCase());
    }
  }
  const typy = new Set();
  for (const f of sqlSoubory(koren, "enums")) {
    const t = stripSqlComments(readFileSync(join(koren, SQL, "enums", f), "utf-8"));
    for (const m of t.matchAll(/CREATE\s+TYPE\s+(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?/gi)) typy.add(m[1].toLowerCase());
  }
  const funkce = new Set(sqlSoubory(koren, "functions").map((f) => f.replace(/\.sql$/, "").toLowerCase()));
  return { relace, typy, funkce };
}

/**
 * Změří všechny funkce zdroje pravdy.
 *
 * @returns {{definery: number, sTemp: number, stinitelne: string[], volaniBezSchematu: string[], docasne: string[],
 *   nerozebrano: string[], dynamicke: number, slovnik: {relace: number, typy: number, funkce: number}}}
 *   Seznamy nesou jména souborů funkcí (bez přípony), seřazená.
 */
export function zmerDefinery(koren) {
  const slovnik = slovnikZdroje(koren);
  const out = { definery: 0, sTemp: 0, stinitelne: [], volaniBezSchematu: [], docasne: [], nerozebrano: [], dynamicke: 0 };
  for (const f of sqlSoubory(koren, "functions")) {
    const r = rozborDefineru(readFileSync(join(koren, SQL, "functions", f), "utf-8"), slovnik);
    if (!r) continue;
    const jmeno = f.replace(/\.sql$/, "");
    out.definery += 1;
    if (r.nerozebrano) {
      out.nerozebrano.push(jmeno);
      continue;
    }
    if (r.tempPosledni) out.sTemp += 1;
    if (r.stinitelna) out.stinitelne.push(jmeno);
    if (r.volaBezSchematu) out.volaniBezSchematu.push(jmeno);
    if (r.docasne.length > 0) out.docasne.push(jmeno);
    if (r.dynamicke) out.dynamicke += 1;
  }
  return { ...out, slovnik: { relace: slovnik.relace.size, typy: slovnik.typy.size, funkce: slovnik.funkce.size } };
}
