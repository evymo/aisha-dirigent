/**
 * Brána: vyhodnocení změny agenta nečte „neměřeno" jako nulu (SELF_IMPROVEMENT_LOOP.md §3, K-01).
 *
 * ⛔ NAMĚŘENO 2026-09-28 na main 9087ef3df: WF_IMPROVEMENT_EVAL po 24 h porovná kvalitu
 * před a po změně agenta. Uzel „Evaluate Change Impact" četl `avg_overall || 0`, takže
 * okno bez jediného dokončeného hodnocení vypadalo jako „kvalita klesla na 0" → regrese
 * → rollback DOBRÉ změny; a naopak větev „bez regrese" zapsala do paměti „změna udržena",
 * i když se nic nezměřilo. Snímek (`fn_get_agent_performance_snapshot`) teď vrací
 * null = neměřeno; tahle brána drží, že workflow null nepřevede zpátky na nulu.
 *
 * CO BRÁNA HLÍDÁ (spouští skutečný kód uzlu, ne jeho tvar):
 *   1. změřená regrese → rollback (kontrolní vzorek: brána není slepá)
 *   2. změřeno bez regrese → maintained
 *   3. neměřeno po změně → inconclusive, BEZ rollbacku
 *   4. graf: jen `maintained` dojde do „Record Success Memory"
 *   5. klíče, které čtou WF_IMPROVEMENT_EVAL a WF_MODEL_ADVISORY, vrací SQL NAHOŘE
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
type Uzel = { name: string; type: string; parameters?: { jsCode?: string } };
type Cil = { node: string };
type Wf = { nodes: Uzel[]; connections: Record<string, { main: Cil[][] }> };

const wf = JSON.parse(readFileSync(join(ROOT, "n8n/workflows/WF_IMPROVEMENT_EVAL.json"), "utf8")) as Wf;
const advisory = readFileSync(join(ROOT, "n8n/workflows/WF_MODEL_ADVISORY.json"), "utf8");
const SQL = readFileSync(join(ROOT, "aisha/db/sql/functions/fn_get_agent_performance_snapshot.sql"), "utf8");

const uzel = (jmeno: string): Uzel => {
  const u = wf.nodes.find((n) => n.name === jmeno);
  if (!u) throw new Error(`uzel „${jmeno}" ve WF_IMPROVEMENT_EVAL chybí`);
  return u;
};

type Verdikt = { should_rollback: boolean; verdict: string; score_delta: number | null };

/** Spustí skutečný jsCode uzlu se stubem n8n `$()` a `$json`. */
function vyhodnot(baseline: Record<string, unknown>, po: Record<string, unknown>): Verdikt {
  const kod = uzel("Evaluate Change Impact").parameters?.jsCode ?? "";
  const $ = (jmeno: string) => {
    if (jmeno !== "Eval Trigger") throw new Error(`neočekávaný uzel ${jmeno}`);
    return { first: () => ({ json: { body: { proposal_id: "p", agent_slug: "a", baseline_metrics: baseline } } }) };
  };
  const out = new Function("$", "$json", kod)($, po) as Array<{ json: Verdikt }>;
  return out[0].json;
}

describe("vyhodnocení změny nečte neměřeno jako nulu", () => {
  test("změřená regrese kvality → rollback (kontrolní vzorek)", () => {
    const v = vyhodnot({ avg_overall: 0.8, error_rate: 0.01 }, { avg_overall: 0.6, error_rate: 0.01 });
    expect(v.verdict).toBe("regression");
    expect(v.should_rollback).toBe(true);
  });

  test("změřený skok chybovosti → rollback", () => {
    const v = vyhodnot({ avg_overall: 0.8, error_rate: 0.02 }, { avg_overall: 0.8, error_rate: 0.2 });
    expect(v.verdict).toBe("regression");
  });

  test("změřeno bez regrese → maintained", () => {
    const v = vyhodnot({ avg_overall: 0.8, error_rate: 0.02 }, { avg_overall: 0.81, error_rate: 0.02 });
    expect(v.verdict).toBe("maintained");
    expect(v.should_rollback).toBe(false);
  });

  test("po změně NEMĚŘENO (null) → inconclusive, žádný rollback, žádná nula v deltě", () => {
    const v = vyhodnot({ avg_overall: 0.8, error_rate: 0.02 }, { avg_overall: null, error_rate: null });
    expect(v.verdict).toBe("inconclusive");
    expect(v.should_rollback).toBe(false);
    expect(v.score_delta).toBeNull();
  });

  test("graf: úspěch se zapíše jen po změřeném maintained, rollback jen po regresi", () => {
    const vetve = (jmeno: string) => wf.connections[jmeno]?.main.map((v) => v.map((c) => c.node)) ?? [];
    expect(vetve("Regression?")).toEqual([["Rollback Config"], ["Measured Maintained?"]]);
    expect(vetve("Measured Maintained?")).toEqual([["Record Success Memory"], ["Log Result"]]);
    expect(JSON.stringify(uzel("Measured Maintained?").parameters)).toContain("maintained");
  });

  test("snímek vrací NAHOŘE klíče, které workflowy čtou", () => {
    const vysledek = SQL.slice(SQL.lastIndexOf("RETURN jsonb_build_object("));
    for (const klic of ["avg_overall", "error_rate", "total_events", "eval_measured"]) {
      expect(vysledek, `klíč ${klic} ve výsledku snímku`).toContain(`'${klic}'`);
    }
    expect(advisory).toContain("perfSnap?.total_events");
    // null = neměřeno: výsledek nesmí neměřenou kvalitu obalit do COALESCE(…, 0)
    expect(vysledek).not.toMatch(/'avg_overall',\s*COALESCE/);
  });
});
