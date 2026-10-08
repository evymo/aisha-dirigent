/**
 * Brána: rozhraní nástroje MCP = jeho zod schéma, parametry RPC = podpis funkce v SQL.
 *
 * ⛔ NAMĚŘENO 2026-10-01: tools/list nabízel u všech 40 nástrojů svc-mcp-knowledge prázdné
 * schéma (`properties: {}`), handler si argumenty tahal ze syrového objektu (asString/asNumber).
 * Teď je zod schéma vstupu JEDINÝ zdroj rozhraní (validace + inputSchema přes z.toJSONSchema)
 * a podpis RPC v aisha/db/sql je zdroj DB. Brána drží oba konce, třetí tabulka nevzniká:
 *
 *   1. SYROVÉ ARGUMENTY jen do `.parse(rawArgs)`: dispatchery berou syrový objekt jako
 *      `rawArgs` a nic jiného s ním nedělají — čtení mimo schéma pak chytí tsc (typovaný výstup).
 *   2. ŽÁDNÝ KLÍČ LADEM: každý klíč schématu handler (nebo funkce, které předá vstup) použije.
 *   3. PARAMETRY RPC: každý `p_*`, který handler pošle do RPC, existuje v podpisu té funkce
 *      v SQL a povinné parametry (bez DEFAULT) handler posílá. Přejmenování v SQL bránu shodí.
 *
 * Popisy vlastností a převod čísel měří unit test služby (tool-input-schemas.unit.test.ts)
 * přímo nad tools/list.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SVC = join(ROOT, "services/svc-mcp-knowledge/src");
const read = (rel: string) => readFileSync(join(SVC, rel), "utf-8");
const bezKomentaru = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Úsek od `od` po odpovídající uzavírací závorku (`(`→`)`, `{`→`}`), přeskakuje řetězce. */
function blok(src: string, od: number, otevri: string, zavri: string): string {
  let hloubka = 0;
  let retezec: string | null = null;
  for (let i = od; i < src.length; i++) {
    const c = src[i];
    if (retezec) {
      if (c === "\\") i++;
      else if (c === retezec) retezec = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") retezec = c;
    else if (c === otevri) hloubka++;
    else if (c === zavri && --hloubka === 0) return src.slice(od, i + 1);
  }
  throw new Error(`neuzavřený blok od ${od}`);
}

/**
 * Tělo funkce NEJVYŠŠÍ úrovně: od hlavičky po `}` na začátku řádku. (Párování závorek by
 * rozhodily regulární výrazy s uvozovkami v těle, např. ve validateCompliance.)
 */
function teloFunkce(src: string, hlavicka: RegExp): string {
  const m = hlavicka.exec(src);
  if (!m) throw new Error(`funkce ${hlavicka} nenalezena — měřidlo slepé`);
  const konec = src.indexOf("\n}\n", m.index);
  if (konec < 0) throw new Error(`konec funkce ${hlavicka} nenalezen — měřidlo slepé`);
  return src.slice(m.index, konec + 2);
}

/** Dispatchery a funkce, kterým předávají PARSOVANÝ vstup (počítají se do „použití klíče“). */
const MCP = bezKomentaru(read("routes/mcp.ts"));
const AITG = bezKomentaru(read("lib/aitg-tools.ts"));
const FLOW = bezKomentaru(read("lib/flowboard-tools.ts"));
const DISPATCHERY = {
  "routes/mcp.ts:callTool": teloFunkce(MCP, /async function callTool\([^)]*\)[^{]*\{/),
  "lib/aitg-tools.ts:aitgDispatch": teloFunkce(AITG, /export async function aitgDispatch\([^)]*\)[^{]*\{/),
  "lib/flowboard-tools.ts:flowboardDispatch": teloFunkce(FLOW, /export async function flowboardDispatch\([^)]*\)[^{]*\{/),
};
const DELEGATI: Record<string, string> = {
  search_knowledge_v2: teloFunkce(MCP, /async function searchKnowledgeProd\([^)]*\)[^{]*\{/),
  validate_compliance: teloFunkce(MCP, /function validateCompliance\([^)]*\)[^{]*\{/),
  aitg_classify_response: teloFunkce(AITG, /function runClassifier\([^)]*\)[^{]*\{/),
};

/** Text větve `case 'nástroj':` až po další `case`/`default` v dispatcheru. */
function vetev(telo: string, nastroj: string): string | null {
  const i = telo.indexOf(`case '${nastroj}':`);
  if (i < 0) return null;
  const dalsi = telo.slice(i + 1).search(/\n\s*(case '|default:)/);
  return dalsi < 0 ? telo.slice(i) : telo.slice(i, i + 1 + dalsi);
}

/** Klíče z.object({…}) — jen první úroveň. */
function klicePrvniUrovne(objekt: string): string[] {
  const vnitrek = objekt.slice(1, -1);
  const klice: string[] = [];
  let hloubka = 0;
  let zacatek = true;
  for (let i = 0; i < vnitrek.length; i++) {
    const c = vnitrek[i];
    if ("([{".includes(c)) hloubka++;
    else if (")]}".includes(c)) hloubka--;
    else if (c === "," && hloubka === 0) zacatek = true;
    else if (zacatek && hloubka === 0 && /[A-Za-z_]/.test(c)) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(vnitrek.slice(i));
      if (m) klice.push(m[1]);
      zacatek = false;
    }
  }
  return klice;
}

/** nástroj → klíče jeho schématu (ze tří zdrojových modulů). */
function schemataNastroju(): Map<string, string[]> {
  const ven = new Map<string, string[]>();
  const znalosti = bezKomentaru(read("lib/knowledge-tool-inputs.ts"));
  const mapa = blok(znalosti, znalosti.indexOf("{", znalosti.indexOf("KNOWLEDGE_TOOL_INPUTS")), "{", "}");
  for (const m of mapa.matchAll(/\n\s{2}(\w+): z\.object\(/g)) {
    const od = mapa.indexOf("(", m.index! + m[0].length - 1);
    const obj = blok(mapa, mapa.indexOf("{", od), "{", "}");
    ven.set(m[1], klicePrvniUrovne(obj));
  }
  for (const soubor of ["lib/aitg-tool-inputs.ts", "lib/flowboard-tool-inputs.ts"]) {
    const src = bezKomentaru(read(soubor));
    const konst = new Map<string, string[]>();
    for (const m of src.matchAll(/export const (\w+) = (?:z\.object\(|(\w+);)/g)) {
      if (m[2]) {
        konst.set(m[1], konst.get(m[2]) ?? []);
        continue;
      }
      const obj = blok(src, src.indexOf("{", m.index! + m[0].length - 1), "{", "}");
      konst.set(m[1], klicePrvniUrovne(obj));
    }
    const nazevMapy = soubor.includes("aitg") ? "AITG_TOOL_INPUTS" : "FLOWBOARD_TOOL_INPUTS";
    const mapaSrc = blok(src, src.indexOf("{", src.indexOf(nazevMapy)), "{", "}");
    for (const m of mapaSrc.matchAll(/(\w+): (z\.object\(\{\}\)|\w+)/g)) {
      ven.set(m[1], m[2].startsWith("z.object") ? [] : (konst.get(m[2]) ?? ["<neznámé schéma " + m[2] + ">"]));
    }
  }
  return ven;
}

/** Podpisy funkcí v SQL: jméno → přetížení → [{jméno, povinný}]. */
function podpisySql(): Map<string, Array<Array<{ jmeno: string; povinny: boolean }>>> {
  const ven = new Map<string, Array<Array<{ jmeno: string; povinny: boolean }>>>();
  const projdi = (d: string) => {
    for (const j of readdirSync(d)) {
      const c = join(d, j);
      if (statSync(c).isDirectory()) projdi(c);
      else if (j.endsWith(".sql")) {
        const sql = readFileSync(c, "utf-8").replace(/--.*$/gm, "");
        for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(/gi)) {
          const params = blok(sql, m.index! + m[0].length - 1, "(", ")").slice(1, -1);
          const polozky: string[] = [];
          let h = 0;
          let akt = "";
          for (const ch of params) {
            if (ch === "(") h++;
            if (ch === ")") h--;
            if (ch === "," && h === 0) { polozky.push(akt); akt = ""; } else akt += ch;
          }
          if (akt.trim()) polozky.push(akt);
          const pretizeni = polozky
            .map((p) => p.trim().replace(/^(IN|INOUT)\s+/i, ""))
            .filter((p) => p && !/^OUT\s/i.test(p))
            .map((p) => ({ jmeno: p.split(/\s+/)[0].toLowerCase(), povinny: !/\bDEFAULT\b|=/i.test(p) }));
          ven.set(m[1].toLowerCase(), [...(ven.get(m[1].toLowerCase()) ?? []), pretizeni]);
        }
      }
    }
  };
  projdi(join(ROOT, "aisha/db/sql"));
  return ven;
}

/** Volání RPC v textu: [{fn, klíče p_*}]. */
function volaniRpc(text: string): Array<{ fn: string; klice: string[] }> {
  const ven: Array<{ fn: string; klice: string[] }> = [];
  for (const m of text.matchAll(/rpc(?:Service|UserClaims)(?:<[^>]*>)?\(\s*'(\w+)'/g)) {
    const volani = blok(text, text.indexOf("(", m.index!), "(", ")");
    const obj = volani.indexOf("{");
    const klice = obj < 0 ? [] : klicePrvniUrovne(blok(volani, obj, "{", "}"));
    ven.push({ fn: m[1], klice });
  }
  return ven;
}

describe("rozhraní nástroje MCP = zod schéma, parametry RPC = podpis v SQL", () => {
  const schemata = schemataNastroju();

  it("měřidlo vidí schémata i dispatchery (kontrolní vzorek)", () => {
    expect(schemata.size, "schémat nástrojů").toBeGreaterThanOrEqual(40);
    expect(schemata.get("search_knowledge")).toContain("query");
    expect(schemata.get("aitg_detect_drift")).toEqual(["windowHours", "minRuns", "dropThresholdPp"]);
    expect(schemata.get("aitg_get_trust_score")).toEqual(["windowDays"]);
  });

  it("syrové argumenty jdou jen do .parse(rawArgs)", () => {
    for (const [kde, telo] of Object.entries(DISPATCHERY)) {
      const vyskyty = [...telo.matchAll(/\brawArgs\b/g)].length - 1; // −1 = parametr v hlavičce
      const doParse = [...telo.matchAll(/\.parse\(\s*rawArgs\b/g)].length;
      // Delegace podřízenému dispatcheru, který vstup parsuje sám (aitgDispatch, flowboardDispatch).
      const delegace = [...telo.matchAll(/\b(?:aitg|flowboard)Dispatch\(\s*name,\s*rawArgs\b/g)].length;
      expect(doParse + delegace, `${kde}: rawArgs mimo .parse — čti typovaný výstup schématu`).toBe(vyskyty);
      expect(telo, `${kde}: dispatcher nesmí sahat na syrové argumenty přes args.`).not.toMatch(/\bas(?:String|Number|StringArray|Record)\(\s*(?:raw)?args\b/);
    }
  });

  it("žádný klíč schématu neleží ladem", () => {
    const lade: string[] = [];
    for (const [nastroj, klice] of schemata) {
      const text = [
        ...Object.values(DISPATCHERY).map((t) => vetev(t, nastroj) ?? ""),
        DELEGATI[nastroj] ?? "",
      ].join("\n");
      expect(text.trim(), `${nastroj}: větev v dispatcheru nenalezena — měřidlo slepé`).not.toBe("");
      for (const k of klice) {
        if (!new RegExp(`\\.${k}\\b`).test(text)) lade.push(`${nastroj}.${k}`);
      }
    }
    expect(lade, "klíč schématu, který handler nikomu nepředá — smaž ho, nebo ho použij").toEqual([]);
  });

  it("každý p_* do RPC existuje v podpisu funkce v SQL a povinné se posílají", () => {
    const podpisy = podpisySql();
    const vady: string[] = [];
    let volani = 0;
    const texty = [MCP, AITG, FLOW];
    for (const text of texty) {
      for (const { fn, klice } of volaniRpc(text)) {
        volani++;
        const pretizeni = podpisy.get(fn);
        if (!pretizeni) { vady.push(`${fn}: funkce v aisha/db/sql nenalezena`); continue; }
        const sedi = pretizeni.some((p) => {
          const jmena = new Set(p.map((x) => x.jmeno));
          return klice.every((k) => jmena.has(k)) && p.filter((x) => x.povinny).every((x) => klice.includes(x.jmeno));
        });
        if (!sedi) vady.push(`${fn}(${klice.join(", ")}) — žádné přetížení: ${pretizeni.map((p) => p.map((x) => x.jmeno + (x.povinny ? "!" : "")).join(",")).join(" | ")}`);
      }
    }
    expect(volani, "měřidlo nenašlo volání RPC — slepé").toBeGreaterThan(20);
    expect(vady, "parametr RPC neexistuje v podpisu SQL (nebo chybí povinný)").toEqual([]);
  });
});
