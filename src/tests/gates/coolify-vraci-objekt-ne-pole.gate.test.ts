/**
 * Odpověď Coolify je OBJEKT s číselnými klíči, ne pole (CLASS gate)
 *
 * TŘÍDA VADY: `Array.isArray(odpoved)` na PHP-serializovaném poli vrátí false.
 * Kód pak vezme prázdnou větev a **prázdný seznam vypadá k nerozeznání od
 * klidného stavu** — nula nasazení, nula peerů, nula proměnných.
 *
 * Naměřeno TŘIKRÁT:
 *   · 2026-08-26 `/deployments` — poprvé popsáno v komentáři;
 *   · 2026-08-26 `coolify-mesh-sync` — `Array.isArray(peers) ? peers.length : 0`
 *     hlásilo NULA peerů nad meshí se 17 agenty, pár hodin po tom zápisu;
 *   · 2026-08-27 `coolify-deploy-watch` — vlastní kopie `deploymentList()`
 *     měla jen tři větve pro pole. Měřidlo tvrdilo `deploys 0 active` a u každé
 *     appky `none`, zatímco syrové `/deployments` mělo `in_progress`. Kvůli
 *     tomu jsem prohlásil za doběhlé nasazení, které běželo dál.
 *
 * ⭐ Kořen je DUPLICITNÍ PARSER: `lib/coolify-http.mjs` tvar ošetřuje, ale
 * nástroje si dělaly vlastní kopie a ty tu znalost nezdědily.
 *
 * INVARIANT: každá funkce, která normalizuje odpověď Coolify na seznam, musí
 * uznat i objekt s číselnými klíči. Měří se CHOVÁNÍM na obou tvarech.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/**
 * Vyřízne tělo funkce ze skutečného zdroje a udělá z něj volatelnou funkci.
 * Měří se to, co se opravdu spouští — ne opis, který by časem přestal platit.
 */
function funkceZeZdroje(soubor: string, jmeno: string): (v: unknown) => unknown[] {
  const zdroj = readFileSync(join(ROOT, soubor), "utf-8");
  const zacatek = zdroj.indexOf(`function ${jmeno}(`);
  expect(zacatek, `${soubor}: funkce ${jmeno} musí existovat`).toBeGreaterThan(-1);
  // Konec = první `\n}` na začátku řádku po začátku funkce.
  const konec = zdroj.indexOf("\n}", zacatek);
  expect(konec, `${soubor}: konec ${jmeno} se nenašel`).toBeGreaterThan(zacatek);
  const telo = zdroj.slice(zacatek, konec + 2);
  return new Function(`${telo}; return ${jmeno};`)() as (v: unknown) => unknown[];
}

describe("normalizace odpovědi Coolify uzná objekt s číselnými klíči", () => {
  const deploymentList = funkceZeZdroje("scripts/coolify-deploy-watch.mjs", "deploymentList");

  test("pole projde (to fungovalo vždycky)", () => {
    expect(deploymentList([{ status: "in_progress" }])).toHaveLength(1);
    expect(deploymentList({ data: [{ status: "queued" }] })).toHaveLength(1);
    expect(deploymentList({ deployments: [{ status: "queued" }] })).toHaveLength(1);
  });

  test("OBJEKT s číselnými klíči taky — jinak měřidlo hlásí klid", () => {
    const phpPole = { 0: { status: "in_progress", application_name: "a" }, 1: { status: "queued", application_name: "b" } };
    expect(
      deploymentList(phpPole),
      "Coolify vrací PHP-serializované pole jako objekt `{0:…,1:…}`. " +
        "Když ho normalizace nepozná, vrátí prázdno — a prázdná fronta " +
        "vypadá k nerozeznání od klidu. Naměřeno třikrát ve dvou dnech.",
    ).toHaveLength(2);
  });

  test("prázdno zůstane prázdnem (žádné vymýšlení)", () => {
    expect(deploymentList(null)).toEqual([]);
    expect(deploymentList({})).toEqual([]);
    expect(deploymentList([])).toEqual([]);
  });
});
