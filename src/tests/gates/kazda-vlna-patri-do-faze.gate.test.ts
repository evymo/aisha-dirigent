/**
 * KAŽDÁ VLNA MUSÍ PATŘIT DO NĚJAKÉ FÁZE — JINAK JI COLD-START PŘESKOČÍ.
 *
 * ⛔ NAMĚŘENO 2026-08-23. Do WAVES jsem vložil vlny „Vznik meshe (netbird)" a
 * „Přepnutí do meshe" mezi Keycloak a OIDC aplikace. Hranice fází se ale
 * odvozují ze JMEN tří konkrétních vln, takže vyšlo:
 *
 *     A: 0-4     C: 7-7     D: 8-10
 *     → vlny 5 a 6 MIMO VŠECHNY FÁZE
 *
 * Cold-start pouští jen A, C a D. Mesh by tedy NIKDY NEPOSTAVIL a tiše by ho
 * přeskočil — a všech 7000+ bran přitom bylo ZELENÝCH, protože pokrytí vln
 * fázemi NIKDO NEMĚŘIL. Zjistilo by se to až při wipe, tedy ve chvíli, kdy
 * už není kam se vrátit.
 *
 * ⭐ Přidání vlny je změna na jednom místě — ale JEN pokud padne do
 * existujícího rozsahu. Vlna vložená mezi dvě fáze se ztratí bez hlášky.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const zdroj = readFileSync(join(ROOT, "scripts/aisha-redeploy.mjs"), "utf-8");

const blok = zdroj.slice(zdroj.indexOf("const WAVES"), zdroj.indexOf("\n]", zdroj.indexOf("const WAVES")) + 2);
const vlny = [...blok.matchAll(/num:\s*(\d+),\s*name:\s*"([^"]+)"/g)].map((m) => ({
  num: Number(m[1]),
  name: m[2],
}));

/** Jména, ze kterých se hranice odvozují — čte se ZE ZDROJE, nepíše se sem. */
function hraniceZeZdroje(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [, klic, jmeno] of zdroj.matchAll(/(A_UNTIL|C_FROM|C_UNTIL|D_FROM):\s*(?:numFor\("([^"]+)"\)|(\w+))/g)) {
    if (jmeno) {
      const v = vlny.find((w) => w.name.includes(jmeno));
      if (v) out[klic] = v.num;
    }
  }
  // proměnné (keycloak/oidcApps/zbytek) se rozřeší přes jejich vlastní numFor()
  for (const [, jm, jmeno] of zdroj.matchAll(/const (\w+) = numFor\("([^"]+)"\)/g)) {
    const v = vlny.find((w) => w.name.includes(jmeno));
    if (!v) continue;
    for (const [, klic, promenna] of zdroj.matchAll(/(A_UNTIL|C_FROM|C_UNTIL|D_FROM):\s*(\w+),/g)) {
      if (promenna === jm) out[klic] = v.num;
    }
  }
  return out;
}

describe("každá vlna patří do fáze (brána)", () => {
  test("univerzum není prázdné — jinak je tvrzení níž vakuové", () => {
    expect(vlny.length, "ve WAVES není ANI JEDNA vlna — brána ztratila vstup").toBeGreaterThan(3);
  });

  test("žádná vlna nepropadne mezi fázemi", () => {
    const h = hraniceZeZdroje();
    for (const k of ["A_UNTIL", "C_FROM", "C_UNTIL", "D_FROM"]) {
      expect(h[k], `hranici ${k} se nepodařilo odvodit — brána by měřila prázdno`).toBeTypeOf("number");
    }
    const posledni = Math.max(...vlny.map((w) => w.num));
    const pokryto = new Set<number>();
    for (let i = 0; i <= h.A_UNTIL; i++) pokryto.add(i);
    for (let i = h.C_FROM; i <= h.C_UNTIL; i++) pokryto.add(i);
    for (let i = h.D_FROM; i <= posledni; i++) pokryto.add(i);

    const propadle = vlny.filter((w) => !pokryto.has(w.num));
    expect(
      propadle.map((w) => `vlna ${w.num} — ${w.name}`),
      "tyhle vlny nepatří do ŽÁDNÉ fáze, takže je cold-start NESPUSTÍ:\n  " +
        propadle.map((w) => `${w.num} — ${w.name}`).join("\n  ") +
        `\n\nFáze: A 0-${h.A_UNTIL} | C ${h.C_FROM}-${h.C_UNTIL} | D ${h.D_FROM}-${posledni}\n` +
        "Cold-start pouští JEN tyhle tři rozsahy. Vlna mezi nimi se ztratí BEZ HLÁŠKY —\n" +
        "zjistí se to až při wipe. Rozšiř příslušnou hranici v PHASE_BOUNDARIES.",
    ).toEqual([]);
  });
});
