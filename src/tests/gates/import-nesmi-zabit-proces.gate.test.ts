/**
 * Modul, který někdo importuje, se nesmí při NAČTENÍ zabít (CLASS gate)
 *
 * TŘÍDA VADY: skript je zároveň nástroj i knihovna. Stráže chybějících vstupů
 * stojí v MODULOVÉM rozsahu a volají `process.exit`. Nástroj se tak chová
 * správně, ale každý, kdo si z něj naimportuje čistou funkci, dostane místo
 * modulu ukončený proces.
 *
 * Naměřeno DVAKRÁT ve dvou dnech, pokaždé v jiném souboru:
 *   · 2026-08-26 `coolify-pull-envs.mjs` — CI spadla po 27 minutách;
 *   · 2026-08-27 `coolify-deploy-watch.mjs` — brána `cekani-meri-vlastni-svet`
 *     nespadla na tvrzení, ale na NAČTENÍ:
 *         Error: process.exit unexpectedly called with "2"
 *
 * Podruhé to bylo proto, že jsem opravil VÝSKYT, ne TŘÍDU. Tohle je ta třída.
 *
 * ⛔ LOKÁLNĚ SE TO NEPOZNÁ. Stráže padají na chybějícím `.env.coolify`, který
 * na stroji vývojáře JE a v CI NENÍ. Proto se tu import spouští s ODSUNUTÝM
 * prostředím — jinak by brána měřila jiný svět než ten, ve kterém selhává.
 *
 * ⭐ UNIVERZUM SE HLEDÁ, NEPÍŠE: měří se přesně ty moduly, které si nějaká
 * brána importuje. Ručně psaný seznam by zdědil svoje díry.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as acorn from "acorn";

const ROOT = process.cwd();
const GATES = join(ROOT, "src", "tests", "gates");

/** Moduly ze `scripts/`, které si brány importují — univerzum se odvozuje. */
function importovaneModuly(): string[] {
  const nalezene = new Set<string>();
  const projdi = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { projdi(p); continue; }
      if (!e.name.endsWith(".ts")) continue;
      for (const m of readFileSync(p, "utf-8").matchAll(/from\s+"([^"]*\/scripts\/[^"]+)"/g)) {
        nalezene.add(m[1].slice(m[1].indexOf("/scripts/") + 1));
      }
    }
  };
  projdi(GATES);
  return [...nalezene].sort();
}

/**
 * Řádky, kde se `process.exit` volá v MODULOVÉM rozsahu.
 *
 * ⛔ Měří se ROZBOREM KÓDU, ne pokusem o import.
 *
 * První verze téhle brány import ZKOUŠELA a čistila proměnné prostředí — jenže
 * stráže čtou i SOUBOR `.env.coolify`, který na stroji vývojáře JE a v CI NENÍ.
 * Mutace (vrácení stráže do modulového rozsahu) proto neprošla červeně: brána
 * měřila týž jiný svět, kvůli kterému ta vada vůbec vznikla. Rozbor kódu na
 * světě nezávisí a je deterministický.
 */
function exitVModulovemRozsahu(zdroj: string): number[] {
  const strom = acorn.parse(zdroj, { ecmaVersion: "latest", sourceType: "module", locations: true });
  const radky: number[] = [];
  type Uzel = { type?: string; [k: string]: unknown };
  const jako = (v: unknown): Uzel => (v ?? {}) as Uzel;
  const jeExit = (uzel: Uzel): boolean => {
    if (uzel.type !== "CallExpression") return false;
    const callee = jako(uzel.callee);
    return (
      callee.type === "MemberExpression" &&
      jako(callee.object).name === "process" &&
      jako(callee.property).name === "exit"
    );
  };

  // Prohledává se jen to, co se při načtení VYKONÁ: těla funkcí se přeskakují,
  // protože ta se spustí teprve při zavolání.
  /**
   * Blok chráněný `isDirectRun(import.meta.url)` je VSTUPNÍ BOD CLI — při
   * importu se nevykoná, takže `process.exit` uvnitř je v pořádku. Je to
   * sankcionovaný idiom repa (lib/cli-entry.mjs) a brána, která by ho hlásila,
   * by nutila lidi obcházet ji místo aby ji používali.
   */
  const jeVstupniStraz = (uzel: Uzel): boolean => {
    const test = uzel.test as { start?: number; end?: number } | undefined;
    if (!test || typeof test.start !== "number" || typeof test.end !== "number") return false;
    return /isDirectRun\s*\(/.test(zdroj.slice(test.start, test.end));
  };

  const projdi = (surovy: unknown): void => {
    const uzel = jako(surovy);
    if (typeof uzel.type !== "string") return;
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ClassBody"].includes(uzel.type)) return;
    if (uzel.type === "IfStatement" && jeVstupniStraz(uzel)) return;
    if (jeExit(uzel)) {
      const loc = uzel.loc as { start?: { line?: number } } | undefined;
      if (typeof loc?.start?.line === "number") radky.push(loc.start.line);
    }
    for (const k of Object.keys(uzel)) {
      const v = uzel[k];
      if (Array.isArray(v)) v.forEach(projdi);
      else if (v && typeof v === "object" && "type" in (v as object)) projdi(v);
    }
  };
  projdi(strom);
  return radky;
}

describe("import modulu nesmí zabít proces", () => {
  const moduly = importovaneModuly();

  test("univerzum není prázdné", () => {
    expect(
      moduly.length,
      "Brány si nějaké moduly ze scripts/ importují — prázdné univerzum by " +
        "znamenalo, že se hledá špatně, a mlčení by vypadalo jako čistý štít.",
    ).toBeGreaterThan(0);
  });

  /**
   * ROHATKA, ne absolutní zákaz. Repo má zděděné vstupní body psané STARÝM
   * řetězcovým idiomem (`resolve(process.argv[1]) === …`) místo `isDirectRun`;
   * ten je sám o sobě vadný (symlink, worktree, diakritika), ale přepsat ho je
   * samostatná práce, ne příloha k jiné opravě. Tady se drží, že jich NEPŘIBUDE.
   *
   * Číslo smí jen KLESAT. Když soubor v seznamu není, musí mít nulu.
   */
  const ZDEDENY_DLUH: Record<string, number> = {
    "scripts/lib/derive-bundle-consumers.mjs": 1,
    "scripts/lib/derive-domains.mjs": 3,
    "scripts/lib/placeholder-scan.mjs": 3,
  };

  test.each(moduly)("%s nevolá process.exit při načtení", (modul) => {
    const zdroj = readFileSync(join(ROOT, modul), "utf-8");
    const radky = exitVModulovemRozsahu(zdroj);
    const strop = ZDEDENY_DLUH[modul] ?? 0;
    expect(
      radky.length,
      `${modul}: ${radky.length} volání \`process.exit\` v modulovém rozsahu ` +
        `(řádky ${radky.join(", ")}), zděděný strop je ${strop}. ` +
        "Stráž chybějícího vstupu patří do funkce volané při SPUŠTĚNÍ — jinak " +
        "dostane každý, kdo si odtud vezme čistou funkci, ukončený proces " +
        "místo modulu. Naměřeno dvakrát ve dvou dnech, pokaždé jinde.",
    ).toBeLessThanOrEqual(strop);
    expect(
      radky,
      `${modul}: \`process.exit\` v modulovém rozsahu na řádku ${radky.join(", ")}. ` +
        "Stráž chybějícího vstupu patří do funkce volané při SPUŠTĚNÍ — jinak " +
        "dostane každý, kdo si odtud vezme čistou funkci, ukončený proces " +
        "místo modulu. Naměřeno dvakrát ve dvou dnech, pokaždé jinde.",
    ).toBeInstanceOf(Array);
  });
});
