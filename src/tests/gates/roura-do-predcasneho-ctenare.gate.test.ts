/**
 * Ráčna: roura do PŘEDČASNĚ končícího čtenáře pod `pipefail` jen ubývá.
 *
 * Mechanismus a náprava: `lib/predcasny-ctenar.ts` (jeden domov pravidla —
 * sdílí ho i brána orákula `jmeno-na-sdilene-siti-nese-identitu`).
 *
 * ⛔ NAMĚŘENO 2026-09-23 (orákulum aliasů compose, druhý výskyt té vady):
 * roura `printf … | grep -qxF` dala pod zátěží 43 falešných „osiřelých" jmen
 * z 6 000 lookupů, herestring 0 z 6 000 (týž běh, táž zátěž). Oprava orákula
 * přitom od 19. 9. ležela na nesloučené větvi — pravidlo, které hlídá jen JEDEN
 * soubor, nechá třídu žít všude jinde.
 *
 * Proč RÁČNA, ne zákaz: v `scripts/*.sh`, které pipefail zapínají v kódu, je
 * takových rour 246 v 51 souborech (grep -q/-m 100, head 140, awk exit 6;
 * změřeno 2026-09-23 nad a36749a79). Ne každá dostane vstup větší než jeden
 * zápis, takže se projeví jen některé — a hromadná úprava 51 souborů by byla
 * riziko sama o sobě. Nové nepřibývají; staré se předělávají, kdykoli se jich
 * někdo dotkne. Snížit je vždy v pořádku; zvýšit ne.
 *
 * Univerzum chůzí stromem `scripts/` (bez podprocesu). Soubory, které pipefail
 * jen ZMIŇUJÍ v komentáři, se nepočítají — tam roura status nemění.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { beziPodPipefail, predcasniCtenari } from "./lib/predcasny-ctenar";

const ROOT = process.cwd();
// 246 → 209 (2026-09-24, #1024 + sloučení main): 17 skriptů přepsaných na herestring
// (grep -q/-m 100 → 65) a v main coolify-sync-envs.sh bez roury (awk … exit 6 → 4).
// Odečteno TÍMTO detektorem nad sloučeným stromem; main samotný 244, větev samotná 211.
const RACNA = 209;

function shSoubory(adresar: string): string[] {
  const ven: string[] = [];
  for (const e of readdirSync(adresar, { withFileTypes: true })) {
    const p = join(adresar, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") ven.push(...shSoubory(p));
    } else if (e.name.endsWith(".sh")) {
      ven.push(p);
    }
  }
  return ven;
}

describe("roura do předčasně končícího čtenáře pod pipefail", () => {
  it("výskytů nepřibývá (ráčna nad scripts/)", () => {
    const soubory = shSoubory(join(ROOT, "scripts"));
    // Prázdné univerzum = brána by prošla tím, že nic nenašla.
    expect(soubory.length, "ve scripts/ nejsou žádné .sh — chůze stromem je slepá").toBeGreaterThan(50);
    const nalezy: string[] = [];
    const rozpad = new Map<string, number>();
    let sPipefail = 0;
    for (const f of soubory) {
      const zdroj = readFileSync(f, "utf8");
      if (!beziPodPipefail(zdroj)) continue;
      sPipefail++;
      for (const n of predcasniCtenari(zdroj)) {
        nalezy.push(`${relative(ROOT, f)}: [${n.druh}] ${n.radek}`);
        rozpad.set(n.druh, (rozpad.get(n.druh) ?? 0) + 1);
      }
    }
    expect(sPipefail, "žádný skript s pipefail — detekce pipefail je slepá").toBeGreaterThan(20);
    const popis = [...rozpad].map(([d, n]) => `${d} ${n}`).join(", ");
    expect(
      nalezy.length,
      `roura do předčasného čtenáře pod pipefail: ${nalezy.length} (${popis}), ráčna ${RACNA}. ` +
        `Nový výskyt přepiš (herestring \`grep -q … <<< "$x"\`, \`sed -n '1,Np'\` místo head); ` +
        `ubylo-li jich, sniž RACNA.\n${nalezy.slice(0, 15).join("\n")}`,
    ).toBeLessThanOrEqual(RACNA);
  });
});
