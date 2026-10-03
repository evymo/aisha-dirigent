/**
 * Odvozená data se nesmí zahazovat u dveří (CLASS gate)
 *
 * TŘÍDA VADY: producent vyrábí víc, než konzument čte — a rozdíl NIKDE nevznikne
 * jako chyba. Nespotřebovaný artefakt se chová přesně jako artefakt, který se
 * nikdy nevyrobil: ticho se čte jako „všechno prošlo".
 *
 * ⛔ NAMĚŘENO 2026-08-30: engine vyráběl 18 artefaktů, driver četl 11. Mezi
 * nečtenými byl `entity_relation_artifact.jsonl` — 345 odvozených VZTAHŮ. Právě
 * z vazeb má podle axiomu vznikat story („story je uzel v síti vazeb"), jenže
 * vazby nikdy nedopadly: `graph_nodes` i `graph_edges` měly NULA řádků, a přitom
 * nikde nevznikla chyba. Půl dne se hledalo, proč se síť nestaví.
 *
 * OBRANA JE DVOJÍ, každá měří něco jiného:
 *   1. ZA BĚHU (li-driver): balíček SÁM říká, co veze (`manifest.files`), takže
 *      univerzum se nepíše rukou — nemůže minout artefakt, o kterém nevíme.
 *      Nekonzumovaný artefakt se hlásí WARNINGEM, NE odmítnutím: uzavřený
 *      kontrakt mezi enginem a platformou už jednou zastavil replay 44 320
 *      dokladů kvůli jedinému neznámému řádku (viz `li_entity_suggestions`).
 *   2. TATO BRÁNA: deklarace `KONZUMOVANE_ARTEFAKTY` se musí shodovat s tím, co
 *      kód SKUTEČNĚ čte. Bez toho by měřidlo z bodu 1 tiše zestárlo — nový pruh
 *      by se přidal, deklarace ne, a warning by hlásil nesmysl.
 *
 * ⭐ Shoda se vyžaduje OBĚMA SMĚRY. Artefakt čtený a nedeklarovaný = warning
 * lže o zahazování; deklarovaný a nečtený = tichá díra přesně toho tvaru, kvůli
 * kterému brána vznikla.
 *
 * Spousti se pres: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const BROKER = join(ROOT, "services", "svc-source-broker", "src");
const DRIVER = join(BROKER, "clients", "li-driver.ts");

/** Zdrojové soubory brokera bez testů — fixtures nejsou chování. */
function zdroje(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e !== "__tests__" && e !== "node_modules") zdroje(p, out);
    } else if (e.endsWith(".ts") && !e.endsWith(".test.ts")) {
      out.push(p);
    }
  }
  return out;
}

/** Deklarace driveru — co o sobě tvrdí, že čte. */
function deklarovane(src: string): Set<string> {
  const blok = src.match(/KONZUMOVANE_ARTEFAKTY[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/);
  if (!blok) return new Set();
  return new Set([...blok[1].matchAll(/'([a-z_]+\.jsonl)'/g)].map((m) => m[1]));
}

describe("žádný artefakt se nesmí zahazovat mlčky", () => {
  const driverSrc = readFileSync(DRIVER, "utf8");
  const declared = deklarovane(driverSrc);

  // Univerzum se HLEDÁ ve zdrojích, nepíše se sem rukou: brána, která si seznam
  // napíše, zdědí jeho díry (naměřeno dřív — 3 aplikace z 33).
  //
  // ⛔ Univerzum NESMÍ obsahovat samo sebe. Deklarace `KONZUMOVANE_ARTEFAKTY`
  // stojí v li-driver.ts, tedy v jednom ze skenovaných souborů — dokud se
  // z hledání nevyřízla, každý deklarovaný název se „našel" jako čtený a
  // kontrola byla prázdná. Naměřeno mutací 2026-08-30: přidal jsem do deklarace
  // `cases_artifact.jsonl`, který nikdo nečte, a brána zůstala ZELENÁ.
  const bezDeklarace = (src: string) =>
    src.replace(/KONZUMOVANE_ARTEFAKTY[^=]*=\s*new Set\(\[[\s\S]*?\]\)/, "");

  const ctene = new Set<string>();
  for (const f of zdroje(BROKER)) {
    const src = bezDeklarace(readFileSync(f, "utf8"));
    for (const m of src.matchAll(/'([a-z_]+_artifact\.jsonl)'/g)) ctene.add(m[1]);
  }

  test("deklarace vůbec existuje a není prázdná", () => {
    expect(
      declared.size,
      "V li-driver.ts chybí `KONZUMOVANE_ARTEFAKTY`. Bez deklarace nemá měřidlo\n" +
        "za běhu s čím porovnávat a hlásilo by, že se nekonzumuje NIC.",
    ).toBeGreaterThan(0);
  });

  test("co kód čte, musí být deklarované", () => {
    const chybi = [...ctene].filter((a) => !declared.has(a)).sort();
    expect(
      chybi,
      `Driver čte artefakty, které nemá v deklaraci: ${chybi.join(", ")}.\n` +
        "Měřidlo za běhu by je hlásilo jako zahazované — lhalo by o vlastní práci.",
    ).toEqual([]);
  });

  test("co je deklarované, musí kód opravdu číst", () => {
    const navic = [...declared].filter((a) => !ctene.has(a)).sort();
    expect(
      navic,
      `Deklarované, ale nečtené artefakty: ${navic.join(", ")}.\n` +
        "To je přesně ta tichá díra, kvůli které brána vznikla: 345 odvozených\n" +
        "vztahů se zahazovalo u dveří a nikde nevznikla chyba.",
    ).toEqual([]);
  });

  test("měřidlo za běhu čte univerzum z manifestu, ne z ručního seznamu", () => {
    expect(
      driverSrc,
      "Měřidlo musí vycházet z `manifest.files` — balíček sám říká, co veze.\n" +
        "Ruční seznam by minul artefakt, o kterém nevíme, že existuje.",
    ).toMatch(/manifest\.files\.filter/);
    expect(driverSrc).toMatch(/KONZUMOVANE_ARTEFAKTY\.has/);
  });

  test("nekonzumovaný artefakt se HLÁSÍ, ale balíček neodmítá", () => {
    const usek = driverSrc.slice(driverSrc.indexOf("const nekonzumovane"));
    const blok = usek.slice(0, usek.indexOf("── VYHODNOCENÍ PRUHŮ"));
    expect(blok, "Nález musí být hlasitý — ticho se čte jako „vše prošlo\".").toMatch(/logger\.warn/);
    expect(
      /throw new Error/.test(blok),
      "Nekonzumovaný artefakt NESMÍ shodit replay. Uzavřený kontrakt mezi enginem\n" +
        "a platformou už jednou zastavil 44 320 dokladů kvůli jedinému neznámému řádku.",
    ).toBe(false);
  });
});
