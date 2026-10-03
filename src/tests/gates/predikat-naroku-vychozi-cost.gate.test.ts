/**
 * COST funkce se nezvedá bez měření u VŠECH volajících (CLASS gate)
 *
 * ⛔ NAMĚŘENO 2026-09-30 (revize kola 13, produkce). Kolo 13 dalo predikátu nároku
 * `workflow_step_visible_to` klauzuli `COST 100000` — „realistickou cenu" ~0,56 ms na
 * volání —, aby ho planner nepouštěl před levný předfiltr. Pro jednoho volajícího to
 * byla pravda. Jenže cenu restrikční podmínky účtuje planner za KAŽDÝ PROSKENOVANÝ
 * ŘÁDEK (costsize.c cost_seqscan: cpu_per_tuple × baserel->tuples), ne za kandidáty:
 *
 *     sken kroků s predikátem − bez něj = 30 809,25 = přesně 123 237 × 0,25
 *
 * S COST 100000 → +30,8 mil. u `get_kiosk_rozvozy`, 60× nad jit_optimize_above_cost,
 * tedy plný JIT při každém volání tabletu — přesně ta vada, kterou kolo opravovalo
 * (JIT = 97 % času pomalých bloků). Pořadí drahého predikátu se řeší PLOTEM
 * u volajícího (MATERIALIZED CTE, množiny předem), ne cenou funkce.
 *
 * Pravidlo: SoT funkce nedeklaruje `COST` ani `ROWS`. Výjimka jen se záznamem níž —
 * a ten musí říct, u kterých volajících se změřil odhad proti jit_*_above_cost.
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const FN_DIR = join(process.cwd(), "aisha/db/sql/functions");

/**
 * Výjimky: soubor → proč a co bylo změřeno. Výjimka smí jen říct PRAVDU o funkci
 * (ROWS u SRF, která vrací pevný počet řádků), nikdy „ladit" cenu predikátu.
 */
const VYJIMKY: Record<string, string> = {
  "counterparty_resolve.sql":
    "ROWS 1 — závěrečný SELECT bez FROM vrací vždy právě 1 řádek. Změřeno riq 2026-09-30 " +
    "(generický plán, md5 36/36 proti živé funkci, správce + člen, s protistranou i bez) u všech " +
    "volajících: get_counterparty_card 676 317 → 4 038, _aging 810 514 → 811, _web 305 974 → 4 606, " +
    "_trend 66 186 → 222, _metric 4 038 beze změny (vše pod jit_above_cost); answer_verified_facts " +
    "(plpgsql, odhad jen klesá). Hlídá runtime test odhad-karty-protistrany.",
};

/** `COST n` / `ROWS n` jako klauzule definice (ne v komentáři, ne v těle funkce). */
const KLAUZULE = /^\s*(COST|ROWS)\s+\d+/i;

/** Hlavička definice = řádky před `AS $…$`; tělo se nečte (COST tam není klauzule). */
function hlavickoveRadky(src: string): string[] {
  const out: string[] = [];
  let vTele = false;
  let tag = "";
  for (const raw of src.split("\n")) {
    const line = raw.replace(/--.*$/, "");
    if (!vTele) {
      out.push(line);
      const m = line.match(/\bAS\s+(\$[A-Za-z_]*\$)/i);
      if (m) {
        vTele = true;
        tag = m[1]!;
        // tělo může skončit na témže řádku
        if (line.split(tag).length > 2) vTele = false;
      }
    } else if (line.includes(tag)) {
      vTele = false;
    }
  }
  return out;
}

describe("COST/ROWS funkcí jen s měřením u všech volajících (gate)", () => {
  const soubory = readdirSync(FN_DIR).filter((f) => f.endsWith(".sql"));

  test("brána vůbec něco čte", () => {
    expect(soubory.length).toBeGreaterThan(100);
  });

  test("žádná SoT funkce nedeklaruje COST/ROWS bez záznamu výjimky", () => {
    const offenders: string[] = [];
    for (const f of soubory) {
      if (VYJIMKY[f]) continue;
      hlavickoveRadky(readFileSync(join(FN_DIR, f), "utf8")).forEach((l, i) => {
        if (KLAUZULE.test(l)) offenders.push(`${f}:${i + 1}: ${l.trim()}`);
      });
    }
    expect(
      offenders,
      "COST/ROWS se účtuje za KAŽDÝ proskenovaný řádek u každého volajícího — zvýšení " +
        "přivolá JIT jinde. Pořadí řeš plotem (MATERIALIZED CTE); výjimku jen se změřeným " +
        "EXPLAIN všech volajících v VYJIMKY:\n" + offenders.join("\n"),
    ).toEqual([]);
  });

  test("detektor chytí klauzuli z kola 13, ne komentář ani tělo (mutace)", () => {
    const zle = "CREATE FUNCTION f() RETURNS boolean\nLANGUAGE plpgsql\nSTABLE\nCOST 100000\nAS $function$\nBEGIN RETURN true; END;\n$function$;";
    const komentar = "CREATE FUNCTION f() RETURNS boolean\n-- COST 100000 kdysi\nLANGUAGE sql\nAS $$ select true $$;";
    const telo = "CREATE FUNCTION f() RETURNS int\nLANGUAGE plpgsql\nAS $f$\nDECLARE x int;\nBEGIN\n  COST 5;\nEND;\n$f$;";
    const najdi = (s: string) => hlavickoveRadky(s).some((l) => KLAUZULE.test(l));
    expect(najdi(zle)).toBe(true);
    expect(najdi(komentar)).toBe(false);
    expect(najdi(telo)).toBe(false);
  });
});
