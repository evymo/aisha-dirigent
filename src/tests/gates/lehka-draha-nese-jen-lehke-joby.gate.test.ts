/**
 * Brána: lehká dráha runneru nese jen lehké joby, těžké joby se uvnitř běhu
 * neřadí za sebe, a žádná úloha nedeklaruje víc času, než jí runner dá
 *
 * ⛔ NAMĚŘENO 2026-09-29 (39 h provozu, log runneru + API tasků Forgejo):
 * linuxový runner byl na instanci JEDEN, 4 sloty, fronta FIFO přes všechna
 * repa, a job po doběhnutí `needs` se řadí na KONEC fronty. Jeden PR měl na
 * kritické cestě 59 min práce a běžel 121 min; detect (0,7 min) čekal na slot
 * až 25 min, verdikt (0,1 min) 21 min. Náprava má tři části a všechny tu hlídáme:
 *
 *   1. LEHKÁ DRÁHA — krátké joby a nasazovací joby (jen čekají na Coolify API)
 *      smí běžet na vlastním runneru. Zapíná ji INSTANCE proměnnou repa
 *      (`.forgejo/ci-drahy.json` → lehka.promenna); bez ní běží tytéž joby na
 *      výchozím štítku, takže instance bez lehkého runneru nepozná rozdíl.
 *      Job s dockerem, throwaway DB nebo plnou sadou testů by malý lehký runner
 *      zadusil — a zpomalil by právě začátek a konec každého běhu.
 *   2. ŽÁDNÝ ŘETĚZ — těžké joby dřív čekaly jeden na druhý (#279, OOM). Ochrana
 *      platila jen uvnitř JEDNOHO běhu, takže nic nechránila: těžké joby z různých
 *      běhů se na slotech potkávaly stejně (18× Web: Tests vedle tří dalších
 *      těžkých jobů, vše zelené, cgroup DinD `oom_kill 0`). Stála jen čas.
 *   3. STROP RUNNERU JE TVRDÝ a přebíjí timeout-minutes. 2026-09-30 runner utnul
 *      nasazení s `timeout-minutes: 240` přesně v 60. minutě. Úloha proto smí
 *      deklarovat nejvýš strop KAŽDÉ dráhy, na kterou může vyjít — podle
 *      deklarace platformy (`.forgejo/ci-drahy.json`, co workflow předpokládá)
 *      a deklarace instance v overlayi (ci-drahy.json, co instance skutečně má).
 *
 * ⚠️ Brána NEMĚŘÍ SVĚT: že runner se štítkem běží, měří doktor (KONTRAKT_CI).
 *
 * Spouští se přes: npm run test:gates (instanční část v lane overlay-gates)
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { overlayDirOrRequired } from "../../../scripts/lib/instance-overlay.mjs";
import { drahyUlohy, nactiDeklaraci, type Deklarace } from "./lib/ci-drahy";

const ROOT = process.cwd();
const CI = ".forgejo/workflows/ci.yml";

interface Krok { run?: string; uses?: string }
interface Uloha {
  "runs-on"?: string | string[];
  "timeout-minutes"?: unknown;
  needs?: string | string[];
  if?: string;
  services?: unknown;
  container?: unknown;
  steps?: Krok[];
}

const DEKLARACE: Deklarace = nactiDeklaraci(ROOT);

const workflowy = (): string[] =>
  readdirSync(join(ROOT, ".forgejo/workflows")).filter((f) => /\.ya?ml$/.test(f)).map((f) => `.forgejo/workflows/${f}`);
function ulohy(soubor: string): Record<string, Uloha> {
  const d = parse(readFileSync(join(ROOT, soubor), "utf-8")) as { jobs?: Record<string, Uloha> };
  if (!d.jobs || Object.keys(d.jobs).length === 0) throw new Error(`${soubor} nemá jedinou úlohu — měřidlo se dívá na špatný soubor`);
  return d.jobs;
}
const needsOf = (u: Uloha): string[] => (Array.isArray(u.needs) ? u.needs : typeof u.needs === "string" ? [u.needs] : []);

/** Na které dráhy může úloha vyjít (deklarace platformy, sdílené s bránou izolovany-runner-nese-jen-ciste-joby). */
const drahy = (u: Uloha) => drahyUlohy(u["runs-on"], DEKLARACE);
const naLehke = (u: Uloha) => drahy(u).some((d) => d.draha === "lehka");

/** Příkazy jobu bez komentářů a bez obsahu uvozovek (vzor pro grep ani text echo job těžkým nedělá). */
function prikazy(u: Uloha): string {
  return (u.steps ?? [])
    .map((k) =>
      String(k.run ?? "")
        .split("\n")
        .filter((r) => !r.trim().startsWith("#"))
        .join("\n")
        .replace(/'[^']*'/g, "''")
        .replace(/"(?:[^"\\]|\\.)*"/g, '""'),
    )
    .join("\n");
}
/** Co dělá job těžkým — konkrétní VZOR, kvůli kterému lehká dráha vznikla. */
const TEZKE: Array<[RegExp, string]> = [
  [/\bdocker\s+(build|buildx|run|compose|pull)\b/, "spouští kontejnery v DinD"],
  [/with-throwaway|db-kontrakt-jmenovite/, "staví throwaway DB"],
  [/npm run (test:run|test:gates|test:scripts|test:db:\S+|build:packages|build)\b/, "pouští plnou sadu testů, DB testy nebo build"],
  [/run-service-tests|verify-cold-start|aisha-cold-start\.sh/, "pouští těžkou sadu"],
  [/\bgradle|\bxcodebuild/, "staví mobilní aplikaci"],
];
function proc(u: Uloha): string[] {
  const d: string[] = [];
  if (u.services) d.push("má `services:` (kontejnery vedle jobu)");
  if (u.container) d.push("má vlastní `container:`");
  const p = prikazy(u);
  for (const [vzor, popis] of TEZKE) if (vzor.test(p)) d.push(popis);
  return d;
}

function stropy(deklarace: Deklarace, popis: string): string[] {
  const vady: string[] = [];
  const nespousti = new Map((deklarace.nespousti_se ?? []).map((n) => [`${n.soubor} › ${n.job}`, n]));
  for (const soubor of workflowy()) {
    for (const [jmeno, u] of Object.entries(ulohy(soubor))) {
      const klic = `${soubor} › ${jmeno}`;
      const vyjimka = nespousti.get(klic);
      if (vyjimka) {
        // Deklarace „nespouští se“ platí jen s PLNIČEM: úloha nese podmínku z téže proměnné.
        if (!String(u.if ?? "").includes(`vars.${vyjimka.promenna} == 'on'`)) {
          vady.push(`  ${klic}: ${popis} ji vede jako „nespouští se“, ale úloha nemá podmínku vars.${vyjimka.promenna} == 'on' — deklarace bez vynucení`);
        }
        continue;
      }
      const limit = u["timeout-minutes"];
      if (limit !== undefined && typeof limit !== "number") {
        vady.push(`  ${klic}: timeout-minutes je výraz (${String(limit)}) — brána umí jen číslo; výraz zaveďte až s výběrem mezi stropy deklarace`);
        continue;
      }
      for (const d of drahy(u)) {
        if (d.draha === "?") {
          vady.push(`  ${klic}: štítek „${d.stitek}“ deklarace nezná — doplňte ho do vychozi.stitky, nebo jde o jinou dráhu`);
          continue;
        }
        // Dráhu, kterou instance nedeklaruje (třeba izolovanou bez vlastního runneru), měří deklarace platformy.
        const strop = (deklarace[d.draha] ?? DEKLARACE[d.draha])!.strop_min;
        if (typeof limit === "number" && limit > strop) {
          vady.push(`  ${klic}: timeout-minutes ${limit} > strop ${popis} pro dráhu ${d.draha} (${d.stitek}) ${strop} min`);
        }
      }
    }
  }
  return vady;
}

describe("lehká dráha runneru nese jen lehké joby", () => {
  const J = ulohy(CI);

  it("univerzum není prázdné a měřidlo těžkost pozná", () => {
    const lehke = Object.values(J).filter(naLehke);
    const tezke = Object.values(J).filter((u) => !naLehke(u));
    expect(lehke.length, "na lehké dráze není skoro nic — měřidlo nevidí výraz štítku").toBeGreaterThan(5);
    expect(tezke.length, "na těžké dráze není skoro nic").toBeGreaterThan(5);
    expect(proc(J["test-web"]), "vzory nepoznají ani Web: Tests — měřidlo je slepé").not.toEqual([]);
    expect(proc(J["coldstart-db-gate"]), "vzory nepoznají ani cold-start").not.toEqual([]);
  });

  it("na lehké dráze není žádný těžký job (ve všech workflow)", () => {
    const spatne: string[] = [];
    for (const soubor of workflowy()) {
      for (const [jmeno, u] of Object.entries(ulohy(soubor))) {
        if (!naLehke(u)) continue;
        const d = proc(u);
        if (d.length) spatne.push(`  ${soubor} › ${jmeno}: ${d.join(", ")}`);
      }
    }
    expect(spatne, `Tyhle joby mohou vyjít na lehkou dráhu, ale jsou těžké:\n${spatne.join("\n")}`).toEqual([]);
  });

  it("začátek a konec běhu i nasazovací joby mohou jet lehkou dráhou", () => {
    // Detect je kořen celého grafu a verdikt jediná povinná kontrola mainu — oba
    // trvají pod minutu a čekaly na slot 20+ min. Nasazovací joby jen pollují Coolify.
    const nasazovaci = Object.keys(J).filter((n) => n.startsWith("deploy-") && n !== "deploy-n8n");
    expect(nasazovaci.length, "nenašel jsem nasazovací joby — změnilo se pojmenování?").toBeGreaterThan(3);
    const mimo = ["detect", "pr-verdikt", ...nasazovaci].filter((n) => !naLehke(J[n]));
    expect(mimo, `runs-on musí být ${"${{"} vars.${DEKLARACE.lehka.promenna} || '…' }}`).toEqual([]);
  });
});

describe("těžké joby se uvnitř běhu neřadí za sebe", () => {
  const J = ulohy(CI);
  const DRIV_V_RETEZU = ["test-web", "test-web-brany", "build-web", "service-tests", "surface-tests", "av-integration-gate", "blockchain-integration", "surface-contract-gate"];

  it("čekají jen na detect", () => {
    const retez = DRIV_V_RETEZU.filter((n) => {
      expect(J[n], `úloha ${n} v ci.yml chybí — seznam brány je zastaralý`).toBeDefined();
      return needsOf(J[n]).some((x) => x !== "detect");
    }).map((n) => `  ${n}: needs ${JSON.stringify(needsOf(J[n]))}`);
    expect(
      retez,
      `Těžký job zase čeká na jiný těžký job:\n${retez.join("\n")}\n` +
        `Každý článek řetězu = druhé zařazení na konec sdílené fronty (naměřeno 12–34 min). ` +
        `Kdo řazení vrací, ať přiloží měření OOM (cgroup DinD \`memory.events\`), ne dojem.`,
    ).toEqual([]);
  });

  it("nasazení pořád čeká na testy, brány i build", () => {
    for (const nasazeni of ["deploy-core", "deploy-edge", "deploy-extranet", "deploy-koren", "deploy-zacatek"]) {
      const n = needsOf(J[nasazeni]);
      for (const nutne of ["test-web", "test-web-brany", "build-web"]) expect(n, `${nasazeni} musí čekat na ${nutne}`).toContain(nutne);
    }
  });
});

describe("žádná úloha nedeklaruje víc času, než jí runner dá", () => {
  it("deklarace platformy má obě dráhy a čísla", () => {
    expect(DEKLARACE.vychozi.stitky).toContain("ubuntu-latest");
    expect(DEKLARACE.vychozi.strop_min).toBeGreaterThan(0);
    expect(DEKLARACE.lehka.strop_min).toBeGreaterThan(0);
    expect(DEKLARACE.lehka.promenna).toMatch(/^[A-Z][A-Z0-9_]+$/);
  });

  it("timeout-minutes ≤ strop každé dráhy podle deklarace PLATFORMY", () => {
    const v = stropy(DEKLARACE, "platformy");
    expect(v, `Úloha deklaruje víc, než platforma předpokládá:\n${v.join("\n")}`).toEqual([]);
  });

  it("timeout-minutes ≤ strop každé dráhy podle deklarace INSTANCE (overlay)", (ctx) => {
    // Bez overlaye jen v režimu bez vynucení; v lane overlay-gates (AISHA_OVERLAY_REQUIRED=1) to shodí.
    const dir = overlayDirOrRequired("lehka-draha-nese-jen-lehke-joby");
    const soubor = dir ? join(dir, "ci-drahy.json") : "";
    if (!dir || !existsSync(soubor)) {
      // Deklarace instance je volitelná (platí výchozí platformy) — ale řečeno nahlas.
      console.warn(`[lehka-draha] instance nedeklaruje stropy runnerů (${dir ? "ci-drahy.json v overlayi chybí" : "bez overlaye"}) — NEMĚŘENO, platí deklarace platformy`);
      ctx.skip();
      return;
    }
    const instance = JSON.parse(readFileSync(soubor, "utf8")) as Deklarace;
    const v = stropy(instance, "instance");
    expect(v, `Úloha deklaruje víc, než runnery instance dovolí:\n${v.join("\n")}`).toEqual([]);
  });
});
