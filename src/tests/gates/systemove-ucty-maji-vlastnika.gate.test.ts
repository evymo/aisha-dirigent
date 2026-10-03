import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// ⛔ Overlay se čte JEDINÝMI dveřmi — rozcestníkem, ne z proměnné napřímo.
// Hlídá to brána `overlay-jde-jen-jednemi-dvermi`, a právem: kdyby si každá
// brána sáhla po `AISHA_INSTANCE_CONFIG_DIR` sama, rozpadne se jediné místo,
// kde je vidět, KDO overlay potřebuje a v jakém režimu.
import { overlayDir } from "../../../scripts/lib/instance-overlay.mjs";

/**
 * ⛔ NAMĚŘENO 2026-09-02. Servisní účet je v datech k NEROZEZNÁNÍ od člověka —
 * `profiles` nemá typ a registr strojových účtů neexistoval. Účet se tak ztratí
 * v seznamu uživatelů a po roce ho nikdo netroufne smazat, protože nikdo neví,
 * co na něm visí. Tak vznikají účty, které přežijí všechny, kdo o nich věděli.
 *
 * ⭐ Brána nehlídá EXISTENCI registru (instance ho mít nemusí), ale jeho
 * UŽITEČNOST: záznam bez vlastníka a bez výčtu oprávnění je řádek, ne evidence.
 *
 * ⛔ `permissions`, NIKDY `roles`. Role odpovídá na „kdo to je“, oprávnění na
 * „co smí“ — a stroj není staff. Kdyby se sem role pustily, vrátí se přesně ta
 * vada, kvůli které registr vznikl: účet dostane všechno, co role smí, a s ní
 * i každé právo, které té roli někdo v budoucnu přidá.
 */
const OVERLAY: string = overlayDir() ?? "";

interface Ucet {
  clientId?: string;
  owner?: string;
  permissions?: unknown;
  roles?: unknown;
}

function nacti(): { cesta: string; ucty: Ucet[] } | null {
  // ⛔ ŽÁDNÉ ODHADOVÁNÍ CESTY. Původně se sem dopisovalo jméno konkrétního
  // forku — a brána `stack-nesmi-znat-jmeno-instance` to právem odmítla:
  // generický stack nesmí vědět, jak se instance jmenuje. (Neprošlo ani to
  // jméno uvedené jen ve VYSVĚTLUJÍCÍM komentáři — a je to správně, protože
  // brána nemá jak poznat, že zrovna tenhle výskyt nic neřídí.)
  // Overlay se PŘEDÁVÁ rozcestníkem; když nedorazí, brána nemá co kontrolovat
  // a mlčí — instance registr mít nemusí.
  for (const base of [OVERLAY]) {
    if (!base) continue;
    const cesta = join(base, "system-accounts.json");
    if (!existsSync(cesta)) continue;
    const syrove = JSON.parse(readFileSync(cesta, "utf8")) as Ucet[];
    // `$`-prefix je v těchhle souborech konvence pro POZNÁMKU (viz tokens.json).
    return { cesta, ucty: syrove.filter((z) => !Object.keys(z).some((k) => k.startsWith("$"))) };
  }
  return null;
}

describe("systémové účty: registr je evidence, ne seznam jmen", () => {
  it("každý účet má vlastníka a výčet OPRÁVNĚNÍ (ne rolí)", () => {
    const nacteno = nacti();
    if (!nacteno) {
      // Instance registr mít NEMUSÍ — nemá-li strojové účty, nemá co evidovat.
      expect(true).toBe(true);
      return;
    }
    const vady: string[] = [];
    for (const u of nacteno.ucty) {
      const kdo = u.clientId ?? "<bez clientId>";
      if (!u.clientId) vady.push(`${kdo}: chybí clientId`);
      if (!u.owner || !String(u.owner).includes("@"))
        vady.push(`${kdo}: chybí owner — a musí to být konkrétní člověk, ne tým`);
      if (!Array.isArray(u.permissions) || u.permissions.length === 0)
        vady.push(`${kdo}: chybí permissions (neprázdný výčet kódů)`);
      if (u.roles !== undefined)
        vady.push(
          `${kdo}: má roles — systémový účet se popisuje OPRÁVNĚNÍMI, ne rolí. ` +
            `Role by mu dala i každé právo, které k ní někdo v budoucnu přidá.`,
        );
    }
    expect(vady, `${nacteno.cesta}\n${vady.join("\n")}`).toEqual([]);
  });
});
