/**
 * Brána: každé povolené jméno nástroje má PRÁVĚ JEDEN původ (SELF_IMPROVEMENT_LOOP.md §3b, K-35).
 *
 * /chat spouští nástroj ze dvou původů: registr `agent_tools` (executor → RPC/webhook) a
 * server MCP svc-mcp-knowledge (`TOOL_DEFINITIONS`, tentýž, přes který volá /v1). Executor
 * jméno bez původu ani jméno v obou nespustí (fail-closed, nikdy hádat); tahle brána drží
 * totéž v repu, ať se to nezjistí až za běhu jako tichý nástroj, který „není“:
 *
 *   1. KOLIZE: jméno v agent_tools i v MCP je dvojznačné → zakázané (jméno = jeden původ).
 *   2. FANTOMY jako třída: každé jméno v `allowed_tools` — výchozí hodnota kanálu, řádky
 *      kanálů v seedech i `agent_catalog.allowed_tools` v seedech — existuje v agent_tools
 *      nebo v MCP.
 *
 * ⛔ NAMĚŘENO 2026-10-01 na main 8640db9ac: výchozí `allowed_tools` kanálu nese
 * `search_ragnarok`, který při přechodu z edge funkce na svc-mcp-knowledge zmizel (gateway ho
 * kvůli tomu už vyřadila); agent `dirigent` povoluje šest nástrojů, které MCP server
 * nikdy neimplementoval. Stávající fantomy jsou dluh v `nastroj-ma-jeden-puvod.baseline.json`
 * (RATCHET, ne allowlist: smí jen klesat — nový fantom brána zastaví, opravený se musí smazat).
 *
 * Měřidlo se kontroluje samo: počet rozebraných řádků agent_catalog se musí rovnat počtu
 * INSERTů a podvržený fantom ve výchozí hodnotě kanálu musí brána najít.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { extractToolDefinitions } from "./aitg/_mcp-extract";

const ROOT = process.cwd();
const MCP = join(ROOT, "services/svc-mcp-knowledge/src/routes/mcp.ts");
const KANAL = join(ROOT, "aisha/db/sql/tables/public_chat_channels.sql");
const SEED = join(ROOT, "aisha/db/seed");
const DLUH = join(ROOT, "src/tests/gates/nastroj-ma-jeden-puvod.baseline.json");

function sqlSoubory(dir: string): string[] {
  return readdirSync(dir).flatMap((jmeno) => {
    const cesta = join(dir, jmeno);
    if (statSync(cesta).isDirectory()) return sqlSoubory(cesta);
    return jmeno.endsWith(".sql") ? [cesta] : [];
  });
}

/** Textové literály ('…') v úseku SQL. */
const literaly = (usek: string) => [...usek.matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]);

/** Výchozí `allowed_tools` kanálu (jsonb pole jmen). */
function vychoziNastrojeKanalu(sql: string): string[] {
  const m = sql.match(/allowed_tools\s+jsonb\s+NOT NULL\s+DEFAULT\s+'(\[[\s\S]*?\])'::jsonb/);
  if (!m) throw new Error("public_chat_channels.sql: výchozí allowed_tools nenalezen — měřidlo slepé");
  return JSON.parse(m[1]) as string[];
}

/** Jména registrovaná v `agent_tools` (první hodnota každé n-tice INSERTu). */
function jmenaAgentTools(sql: string): string[] {
  return [...sql.matchAll(/INSERT INTO public\.agent_tools\s*\([^)]*\)\s*VALUES([\s\S]*?);\s*$/gm)].flatMap((ins) =>
    [...ins[1].matchAll(/^\s*\(\s*'([a-z0-9_]+)'/gm)].map((m) => m[1]),
  );
}

/** Řádky `agent_catalog`: slug + allowed_tools. Jiný tvar INSERTu = slepé měřidlo → spadne nahlas. */
function radkyAgentCatalog(sql: string): Array<{ slug: string; allowed: string[] }> {
  return [...sql.matchAll(/INSERT INTO public\.agent_catalog\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)\s*ON CONFLICT/g)].map((ins) => {
    const sloupce = ins[1].split(",").map((s) => s.trim());
    const textPole = sloupce.filter((s) => s === "allowed_tools" || s === "denied_tools");
    if (sloupce[0] !== "id" || sloupce[1] !== "slug" || textPole[0] !== "allowed_tools") {
      throw new Error(`agent_catalog INSERT má nečekané pořadí sloupců (${sloupce.slice(0, 3).join(", ")}…) — měřidlo slepé`);
    }
    const slug = ins[2].match(/^\s*'[^']*',\s*'([^']+)'/)?.[1];
    if (!slug) throw new Error("agent_catalog INSERT: slug nenalezen — měřidlo slepé");
    // allowed_tools je první text[] mezi hodnotami (denied_tools druhé)
    const pole = [...ins[2].matchAll(/ARRAY\[([^\]]*)\]::text\[\]/g)].map((m) => literaly(m[1]));
    return { slug, allowed: pole[0] ?? [] };
  });
}

/** Řádky kanálů v seedech: allowed_tools jako jsonb pole v INSERT do public_chat_channels. */
function nastrojeKanaluVSeedu(sql: string): string[] {
  return [...sql.matchAll(/INSERT INTO public\.public_chat_channels[\s\S]*?;\s*$/gm)].flatMap((ins) =>
    [...ins[0].matchAll(/'(\[[^\]]*\])'::jsonb/g)].flatMap((m) => {
      try {
        const pole = JSON.parse(m[1]) as unknown[];
        return pole.every((x) => typeof x === "string") ? (pole as string[]) : [];
      } catch {
        return [];
      }
    }),
  );
}

type Vyskyt = { klic: string; jmeno: string; kde: string };

function zmer(kanalSql: string) {
  const mcp = new Set(extractToolDefinitions(readFileSync(MCP, "utf-8")));
  const seedy = sqlSoubory(SEED).map((cesta) => ({ kde: relative(ROOT, cesta), sql: readFileSync(cesta, "utf-8") }));
  const agentTools = new Set(seedy.flatMap((s) => jmenaAgentTools(s.sql)));

  const vyskyty: Vyskyt[] = [
    ...vychoziNastrojeKanalu(kanalSql).map((jmeno) => ({ klic: `kanal-vychozi:${jmeno}`, jmeno, kde: relative(ROOT, KANAL) })),
    ...seedy.flatMap((s) => nastrojeKanaluVSeedu(s.sql).map((jmeno) => ({ klic: `kanal-seed:${jmeno}`, jmeno, kde: s.kde }))),
    ...seedy.flatMap((s) =>
      radkyAgentCatalog(s.sql).flatMap((r) => r.allowed.map((jmeno) => ({ klic: `agent:${r.slug}:${jmeno}`, jmeno, kde: s.kde }))),
    ),
  ];
  return {
    mcp,
    agentTools,
    vyskyty,
    agentInserty: seedy.reduce((n, s) => n + (s.sql.match(/INSERT INTO public\.agent_catalog\b/g)?.length ?? 0), 0),
    agentRadky: seedy.reduce((n, s) => n + radkyAgentCatalog(s.sql).length, 0),
    fantomy: (v: Vyskyt[]) => v.filter((x) => !agentTools.has(x.jmeno) && !mcp.has(x.jmeno)),
  };
}

const dluh = JSON.parse(readFileSync(DLUH, "utf-8")) as { fantomy: string[] };

describe("nástroj má právě jeden původ (K-35)", () => {
  const m = zmer(readFileSync(KANAL, "utf-8"));

  it("měřidlo vidí oba registry i všechny řádky agent_catalog (kontrolní vzorek)", () => {
    expect(m.mcp.size).toBeGreaterThan(10);
    expect(m.agentTools.size).toBeGreaterThan(0);
    expect(m.agentInserty).toBeGreaterThan(0);
    expect(m.agentRadky, "rozebraných řádků agent_catalog musí být tolik, kolik je INSERTů").toBe(m.agentInserty);
    expect(m.vyskyty.some((v) => v.klic.startsWith("kanal-vychozi:"))).toBe(true);
  });

  it("žádné jméno není v agent_tools i v MCP zároveň", () => {
    expect([...m.agentTools].filter((j) => m.mcp.has(j)), "jméno = jeden původ; přejmenuj jednu stranu").toEqual([]);
  });

  it("každé povolené jméno má původ — nový fantom neprojde", () => {
    const nove = m.fantomy(m.vyskyty).filter((v) => !dluh.fantomy.includes(v.klic));
    expect(
      nove.map((v) => `${v.klic} (${v.kde})`),
      "jméno v allowed_tools neexistuje v agent_tools ani v MCP — executor ho nespustí; oprav jméno nebo nástroj doplň",
    ).toEqual([]);
  });

  it("dluh jen klesá — opravený fantom se z baseline smaže", () => {
    const fantomy = new Set(m.fantomy(m.vyskyty).map((v) => v.klic));
    expect(dluh.fantomy.filter((k) => !fantomy.has(k)), "smaž z nastroj-ma-jeden-puvod.baseline.json").toEqual([]);
  });

  it("podvržený fantom ve výchozí hodnotě kanálu brána najde (kontrolní vzorek)", () => {
    const podvrh = readFileSync(KANAL, "utf-8").replace('"search_knowledge",', '"search_knowledge",\n    "k35_fantom",');
    const p = zmer(podvrh);
    expect(p.fantomy(p.vyskyty).map((v) => v.klic)).toContain("kanal-vychozi:k35_fantom");
  });
});
