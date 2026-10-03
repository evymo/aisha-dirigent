/**
 * Brána: stav Coolify aplikace se posuzuje po CELÝCH hodnotách, ne podřetězcem.
 *
 * ⛔ NAMĚŘENO 2026-08-16 — proč tahle brána existuje:
 *
 * `npm run cold-start:verify` hlásil „0 unhealthy app(s)", zatímco 18 z 34
 * aplikací bylo nezdravých, včetně `<fork>-edge` — vstupní brány, kvůli které
 * vracelo všechno veřejné 503. Příčina: `unhealthy` OBSAHUJE `healthy`, takže
 * `/running|healthy|online/i.test("exited:unhealthy")` je `true`.
 *
 * Táž past byla nezávisle ve čtyřech nástrojích. Nešlo o překlep — je to past
 * jazyka, která vznikne pokaždé, když někdo napíše nový nástroj a stav otestuje
 * `includes`. Proto se nehlídá pravopis jednoho souboru, ale VLASTNOST:
 *
 *   1. primitiv odpovídá správně na stavy, které Coolify doopravdy vrací,
 *   2. každý nástroj, který o zdraví rozhoduje, ho má od primitivu — nesmí si
 *      pravidlo psát znovu.
 *
 * Bod 2 je to podstatné. Kdyby brána uměla jen bod 1, další nástroj si past
 * zavede znovu a brána zůstane zelená.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  klasifikovatStavAppky,
  jeProkazatelneZdrava,
  jeProkazatelneSpatna,
} from "../../../scripts/lib/coolify-app-status.mjs";

const ROOT = join(__dirname, "../../..");

/**
 * Stavy skutečně naměřené na produkci 2026-08-16 (`GET /applications`), plus
 * varianty, které Coolify vrací u vícekontejnerových compose aplikací.
 */
const NAMERENE: Array<[stav: string, zdrava: boolean | null]> = [
  ["running:healthy", true],
  ["online:healthy", true],

  // ⛔ Jádro věci: tyhle čtyři propouštěl podřetězcový vzor jako zdravé.
  ["running:unhealthy", false],
  ["exited:unhealthy", false],
  ["degraded:unhealthy", false],
  ["restarting:unhealthy", false],

  ["exited:unknown", false],
  ["exited", false],
  ["dead", false],
  ["stopped", false],

  // Přechodné a neměřené — NENÍ to důkaz zdraví, ale ani nemoci.
  ["starting:unknown", null],
  ["restarting", null],
  ["running:unknown", null],
  ["running", null],

  // Neznámé slovo musí padat do nezdravého, ne do zdravého (fail-closed).
  ["", false],
  ["podivnost", false],
];

describe("Coolify: stav aplikace se posuzuje po celých hodnotách", () => {
  it.each(NAMERENE)("%s → zdravá=%s", (stav, ocekavano) => {
    expect(klasifikovatStavAppky(stav).zdrava).toBe(ocekavano);
  });

  it("`unhealthy` NIKDY neprojde jako zdravé, ať je stav jakýkoli", () => {
    // Vlastnost, ne výčet: projdi všechny kombinace a ověř, že žádná
    // s `unhealthy` neprojde. Tohle je přesně to, co podřetězec porušoval.
    const stavy = ["running", "online", "exited", "starting", "restarting", "degraded", "dead"];
    for (const s of stavy) {
      expect(jeProkazatelneZdrava(`${s}:unhealthy`)).toBe(false);
    }
  });

  it("aplikace není zdravější než její nejslabší kontejner", () => {
    expect(jeProkazatelneZdrava("running:healthy,running:healthy")).toBe(true);
    expect(jeProkazatelneZdrava("running:healthy,exited:unhealthy")).toBe(false);
    expect(klasifikovatStavAppky("running:healthy,starting:unknown").zdrava).toBe(null);
  });

  it("NEZMĚŘENO se nepočítá ani jako zdravé, ani jako špatné", () => {
    // Čekací smyčka nesmí kvůli `starting` skončit, verdikt o úplnosti
    // nasazení ho ale nesmí brát jako splněno.
    expect(jeProkazatelneZdrava("starting:unknown")).toBe(false);
    expect(jeProkazatelneSpatna("starting:unknown")).toBe(false);
  });
});

/**
 * Nástroje, které o zdraví aplikace rozhodují. Každý z nich měl vlastní
 * podřetězcový vzor; každý ho teď musí mít od primitivu.
 */
const ROZHODUJI_O_ZDRAVI = [
  "scripts/cold-start-verify.mjs",
  "scripts/blue-green-smoke-runner.mjs",
  "scripts/pki-bridge-deploy.mjs",
  "scripts/coolify-deploy-watch.mjs",
];

describe("žádný nástroj si pravidlo nepíše znovu", () => {
  it.each(ROZHODUJI_O_ZDRAVI)("%s bere verdikt od primitivu", (relativni) => {
    const zdroj = readFileSync(join(ROOT, relativni), "utf8");
    expect(
      /from\s+["'].*coolify-app-status\.mjs["']/.test(zdroj),
      `${relativni} rozhoduje o zdraví aplikace, ale neimportuje ` +
        `scripts/lib/coolify-app-status.mjs. Vlastní vzor nad slovem 'healthy' ` +
        `je fail-open — 'unhealthy' ten podřetězec obsahuje.`,
    ).toBe(true);
  });

  it("nikde nezůstal podřetězcový test nad 'healthy'", () => {
    const pristizeni: string[] = [];
    for (const relativni of ROZHODUJI_O_ZDRAVI) {
      const radky = readFileSync(join(ROOT, relativni), "utf8").split("\n");
      radky.forEach((radek, i) => {
        // Komentáře popisují past záměrně — hlídá se jen kód.
        const kod = radek.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
        const podezrele =
          /\.includes\(\s*["']healthy["']\s*\)/.test(kod) ||
          /\/[^/\n]*\bhealthy\b[^/\n]*\/[gimsuy]*\s*\.test\(/.test(kod) ||
          /startsWith\(\s*["']running["']\s*\)/.test(kod);
        if (podezrele) pristizeni.push(`${relativni}:${i + 1}: ${radek.trim()}`);
      });
    }
    expect(
      pristizeni,
      `Podřetězcový test nad stavem je fail-open ('unhealthy' obsahuje ` +
        `'healthy'). Použij klasifikovatStavAppky() ze ` +
        `scripts/lib/coolify-app-status.mjs.\n  ${pristizeni.join("\n  ")}`,
    ).toEqual([]);
  });
});
