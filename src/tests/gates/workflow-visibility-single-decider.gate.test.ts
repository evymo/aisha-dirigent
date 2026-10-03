/**
 * Workflow Visibility — Single Decider Gate
 *
 * `workflow_step_visible_to` o sobě v hlavičce říká, že je JEDINÉ místo, které
 * rozhoduje, kdo smí krok procesu vidět, a že inline kopie neexistují. Tahle
 * brána z toho dělá vlastnost, kterou nejde omylem zrušit.
 *
 * PROČ (2026-07-30): dispečerský pohled („admin vidí všechna nevyřízená předání")
 * šel nejdřív udělat ve volajícím:
 *
 *     and (case when cfg.want_all and is_admin_or_staff() then true
 *               else workflow_step_visible_to(...) end)
 *
 * Funguje to a je to špatně. Ta konjunkce s rolí je bezpečnostní pojistka
 * v podobě JEDNOHO ŘÁDKU uvnitř čtecí funkce: kdo ho smaže, promění příznak
 * `all_assignees` v `source_params` v tichou eskalaci práv — a `source_params`
 * jsou instanční DATA, takže je zakládá kdokoli s přístupem k instančnímu SQL,
 * ne nutně někdo, kdo čte bezpečnostní review.
 *
 * Rozsah proto rozhoduje predikát sám (`p_scope`), volající ho volá
 * BEZPODMÍNEČNĚ a nemá jak ho obejít. Zrušit kontrolu pak znamená sáhnout do
 * sdílené funkce, na které stojí všechny workflow povrchy — hlučné, ne tiché.
 *
 * Brána kontroluje TVAR, ne text:
 *   1. predikát existuje a role se v něm vyhodnocuje,
 *   2. žádný jeho VOLAJÍCÍ nerozhoduje o viditelnosti sám (nesmí mít
 *      is_admin_or_staff / has_role vedle volání predikátu),
 *   3. starý podpis bez rozsahu je zahozený — jinak by `CREATE OR REPLACE`
 *      nechal v DB dvě funkce a volání se 4 argumenty by mohlo trefit tu BEZ
 *      dispečerské větve.
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FN_DIR = join(ROOT, "aisha/db/sql/functions");
const PREDICATE = join(FN_DIR, "workflow_step_visible_to.sql");

/** Rozhodovatelé role, které volající nesmí používat k viditelnosti kroku. */
const ROLE_DECIDERS = /\b(is_admin_or_staff|has_role)\s*\(/;

function sqlFiles(): string[] {
  return readdirSync(FN_DIR).filter((f) => f.endsWith(".sql"));
}

/** Kód bez komentářů — brána musí číst příkazy, ne prózu o nich. */
function code(src: string): string {
  return src
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
}

describe("workflow visibility: one decider (gate)", () => {
  test("sdílený predikát existuje a rozhoduje o rozsahu sám", () => {
    expect(existsSync(PREDICATE)).toBe(true);
    const src = code(readFileSync(PREDICATE, "utf8"));
    expect(src, "predikát musí přijímat rozsah, jinak by ho musel řešit volající").toMatch(
      /p_scope\s+text/,
    );
    // Rozsah smí platit JEN v konjunkci s rolí — samotné `p_scope = 'dispatch'`
    // by z parametru udělalo klíč k cizím řádkům.
    expect(src, "rozšíření rozsahu musí být podmíněné rolí").toMatch(
      /p_scope\s*=\s*'dispatch'\s+AND\s+public\.is_admin_or_staff\(\)/i,
    );
  });

  test("starý podpis bez rozsahu je zahozený (jinak by v DB zůstaly dvě funkce)", () => {
    const src = code(readFileSync(PREDICATE, "utf8"));
    expect(src).toMatch(/DROP FUNCTION IF EXISTS public\.workflow_step_visible_to\(uuid,uuid,text,jsonb\)/i);
  });

  /**
   * Hlídá se ŘÁDKOVÝ FILTR, ne autorizace.
   *
   * První verze téhle brány zakazovala role-logiku kdekoli poblíž predikátu a
   * označila čtyři funkce, které jsou v pořádku:
   *   complete_workflow_step:      if not (visible_to(…) or is_admin_or_staff(…)) then <chyba>
   *   get_batch_workflow_progress: v_visible := is_service_role() or is_admin_or_staff(…) or exists(…)
   * To je autorizace JEDNOHO ZNÁMÉHO řádku (nebo dávky) před akcí — rozhodnutí
   * „smí tenhle volající tohle?", které vrací chybu, ne data.
   *
   * Nebezpečná je jiná věc: role-logika uvnitř `WHERE`, které řádky VYRÁBÍ.
   * Tam smazaná podmínka nevrátí chybu — tiše vrátí cizí řádky, a nikdo si toho
   * nevšimne, protože blok se normálně vykreslí. Brána proto flaguje jen to.
   */
  test("žádný ŘÁDKOVÝ FILTR nerozhoduje o viditelnosti sám", () => {
    const offenders: string[] = [];
    for (const f of sqlFiles()) {
      if (f === "workflow_step_visible_to.sql") continue;
      const src = code(readFileSync(join(FN_DIR, f), "utf8"));
      if (!src.includes("workflow_step_visible_to(")) continue;
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        if (!line.includes("workflow_step_visible_to(")) return;
        // Najdi KLAUZULI, ve které volání stojí — ne řádek s voláním. Ve tvaru
        //     and (case when … then true
        //          else public.workflow_step_visible_to(…)
        // je `and` o dva řádky výš, takže test na začátek TÉHOŽ řádku by tenhle
        // (a právě jen tenhle) tvar minul. Ověřeno mutací: první verze brány ho
        // opravdu propustila.
        let start = -1;
        for (let k = i; k >= Math.max(0, i - 8); k -= 1) {
          if (/^\s*(and|where)\b/i.test(lines[k]!)) { start = k; break; }
          // `if …then` / přiřazení = autorizační tvar, ne řádkový filtr → konec hledání
          if (/^\s*(if|elsif)\b|:=/i.test(lines[k]!)) break;
        }
        if (start < 0) return;
        const expr = lines.slice(start, i + 6).join("\n");
        if (ROLE_DECIDERS.test(expr)) offenders.push(`${f}:${start + 1}`);
      });
    }
    expect(
      offenders,
      "role-logika stojí v řádkovém filtru vedle predikátu — o tom, KTERÉ řádky " +
        "existují, pak rozhoduje volající a smazání jedné podmínky tiše pustí cizí " +
        "data (žádná chyba, blok se vykreslí): " + offenders.join(", "),
    ).toEqual([]);
  });
});
