/**
 * Brána: změněný POHLED musí jít NAHRADIT nad běžící databází, ne jen vytvořit
 * na prázdné.
 *
 * ⛔ NAMĚŘENO V PROD 2026-09-06 10:02Z: do `audience_admin_twin_directory_v`
 * přibyl sloupec `relation_kinds` uprostřed seznamu (hned za `relations`).
 * Postgres to čte jako PŘEJMENOVÁNÍ všech následujících sloupců a odmítne:
 * „cannot change name of view column open_beats to relation_kinds". Migrate
 * skončil exit 1, stack zůstal bez gateway, API dalo 502.
 *
 * Proč to žádný test nechytil: jednorázová databáze pohled VYTVÁŘÍ z baseline
 * (tam je pořadí jedno), provoz ho NAHRAZUJE přes heals. Rozdíl mezi „vzniká"
 * a „nahrazuje se" je přesně ta třída vad, kterou čerstvá databáze neumí vidět.
 *
 * CO SE MĚŘÍ: pro každý pohled změněný proti `origin/main` musí být nový seznam
 * sloupců NADMNOŽINOU starého se zachovaným pořadím (nové jen na konci) —
 * a rozhoduje o tom sám Postgres, ne odhad z textu: obě verze se vytvoří pod
 * dočasným jménem a porovná se skutečné pořadí sloupců.
 *
 * VÝJIMKA je poctivá součást pravidla: pohled, který heals před načtením
 * výslovně MAŽE (`drop view if exists …` nad tímtéž jménem), se nenahrazuje,
 * ale vytváří — pak pořadí sloupců nikoho nepálí. Pravidlo tedy zní „nový
 * sloupec na konec, NEBO pohled napřed smaž".
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { psqlMultiline, psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

const ROOT = path.resolve(__dirname, "../../..");
const VIEWS = "aisha/db/sql/views";
const dbAvailable = isPgReachable();

/** Pohledy změněné proti `origin/main` — jen ty mají co nahrazovat. */
function zmenenePohledy(): string[] {
  try {
    return execFileSync("git", ["diff", "--name-only", "origin/main", "--", VIEWS], {
      cwd: ROOT,
      encoding: "utf-8",
    })
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.endsWith(".sql") && fs.existsSync(path.join(ROOT, s)));
  } catch {
    return []; // bez origin/main (mělká kopie) se neměří, netvrdí se nic
  }
}

function starsiZnenie(cesta: string): string | null {
  try {
    return execFileSync("git", ["show", `origin/main:${cesta}`], { cwd: ROOT, encoding: "utf-8" });
  } catch {
    return null; // nový soubor: nahrazovat není co
  }
}

/** Vytvoří pohled pod dočasným jménem a vrátí pořadí jeho sloupců. */
function sloupceDocasne(sql: string, puvodni: string, docasne: string): string[] {
  const telo = sql.replace(new RegExp(`\\b${puvodni}\\b`, "g"), docasne);
  psqlMultiline(`\\set ON_ERROR_STOP on\nDROP VIEW IF EXISTS public.${docasne} CASCADE;\n${telo}`);
  return psqlQuery(
    `SELECT string_agg(column_name, ',' ORDER BY ordinal_position)
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = '${docasne}'`,
  )
    .split(",")
    .filter(Boolean);
}

describe("změněný pohled jde nahradit nad běžící databází", () => {
  beforeAll(() => reportTestCapabilities("pohled jde nahradit"));

  it.skipIf(!dbAvailable)("nový sloupec je na KONCI (jinak Postgres odmítne CREATE OR REPLACE)", () => {
    const zmenene = zmenenePohledy();
    const heals = fs.readFileSync(path.join(ROOT, "aisha/db/heals.sql"), "utf-8");
    const problemy: string[] = [];
    for (const cesta of zmenene) {
      const stare = starsiZnenie(cesta);
      if (!stare) continue;
      const jmenoPohledu = path.basename(cesta, ".sql");
      // Přetváří-li heals pohled (drop před \ir), nenahrazuje se a pravidlo neplatí.
      if (new RegExp(`drop view if exists (public\\.)?${jmenoPohledu}\\b`, "i").test(heals)) continue;
      const nove = fs.readFileSync(path.join(ROOT, cesta), "utf-8");
      const jmeno = jmenoPohledu;
      const docasne = `zz_replace_${jmeno}`.slice(0, 63);
      const predtim = sloupceDocasne(stare, jmeno, docasne);
      const potom = sloupceDocasne(nove, jmeno, docasne);
      psqlMultiline(`DROP VIEW IF EXISTS public.${docasne} CASCADE;`);
      const prefix = potom.slice(0, predtim.length).join(",") === predtim.join(",");
      if (!prefix) {
        const i = predtim.findIndex((c, n) => potom[n] !== c);
        problemy.push(
          `${cesta}: pořadí se rozešlo na pozici ${i + 1} — bylo '${predtim[i]}', je '${potom[i] ?? "(chybí)"}'. ` +
            `CREATE OR REPLACE VIEW umí sloupce jen PŘIDAT ZA POSLEDNÍ; nový sloupec patří na konec.`,
        );
      }
    }
    expect(problemy, problemy.join("\n")).toEqual([]);
  });
});
