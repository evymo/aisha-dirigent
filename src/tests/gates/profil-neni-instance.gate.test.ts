/**
 * Profil NENÍ instance (CLASS gate)
 *
 * TŘÍDA VADY: dosadit jednu veličinu za druhou, protože „obě popisují instalaci".
 * Vznikne hodnota, která projde všemi kontrolami tvaru a přitom ukazuje na něco,
 * co nemůže existovat.
 *
 *   AISHA_PROFILE  = TVAR BĚHU        (cloud-multi / cloud-single / local-dev)
 *   AISHA_INSTANCE = ADRESÁŘ OVERLAYE (instances/<jméno>/app.config.json)
 *
 * NAMĚŘENO 2026-08-10 při cold-startu po `--wipe`:
 *   `AISHA_INSTANCE=${… || topo.profile}` → `AISHA_INSTANCE=cloud-multi`
 *   → `INSTANCE_DIR=instances/cloud-multi`
 *   → build workbench-shellu: ENOENT /app/instances/cloud-multi/app.config.json
 *   → aisha-extranet se nenasadil → VLNA 4 VYPRŠELA (717 s).
 * Deterministicky — opakování to nemohlo zachránit, jen spálilo sloty ve vlně.
 *
 * Repo veze jen generický `instances/_default` (brána split-rule to potvrzuje).
 * Nemá-li instance vlastní overlay, je `_default` správná odpověď — a je to táž
 * hodnota, kterou nese `deploy/surface-host/Dockerfile` jako ARG default.
 * Compose ten rozumný default přebíjel odvozeninou, která neexistuje.
 *
 * INVARIANT: AISHA_INSTANCE se nikdy nedosazuje z AISHA_PROFILE ani z `topo.profile`.
 *
 * Spousti se pres: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DERIVE = join(ROOT, "scripts/lib/derive-domains.mjs");
const COLDSTART = join(ROOT, "scripts/aisha-cold-start.sh");

/** Řádky, kde se AISHA_INSTANCE dosazuje z profilu. */
export function findProfileAsInstance(src: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  src.split("\n").forEach((raw, i) => {
    if (/^\s*(#|\/\/)/.test(raw)) return;                    // komentář není kód
    if (!/AISHA_INSTANCE\s*=/.test(raw)) return;
    if (/AISHA_INSTANCE_(CONFIG_DIR|DATA)/.test(raw)) return; // jiné proměnné
    if (/\bAISHA_PROFILE\b|topo\.profile|\bprofile\b/.test(raw)) {
      out.push({ line: i + 1, text: raw.trim() });
    }
  });
  return out;
}

describe("profil není instance", () => {
  test("oba soubory existují (brána má co měřit)", () => {
    expect(existsSync(DERIVE)).toBe(true);
    expect(existsSync(COLDSTART)).toBe(true);
  });

  test("AISHA_INSTANCE se nedosazuje z profilu", () => {
    const bad = [
      ...findProfileAsInstance(readFileSync(DERIVE, "utf-8")).map((v) => ({ ...v, f: "derive-domains.mjs" })),
      ...findProfileAsInstance(readFileSync(COLDSTART, "utf-8")).map((v) => ({ ...v, f: "aisha-cold-start.sh" })),
    ];
    if (bad.length) {
      throw new Error(
        `AISHA_INSTANCE se dosazuje z PROFILU (${bad.length}×).\n` +
          `Profil je TVAR BĚHU (cloud-multi), instance je ADRESÁŘ OVERLAYE.\n` +
          `Záměna vyrobí instances/<profil>, který neexistuje → build padá na ENOENT.\n` +
          `Bez deklarace použij "_default" — ten v repu JE.\n\n` +
          bad.map((b) => `  ${b.f}:${b.line}  ${b.text}`).join("\n"),
      );
    }
    expect(bad).toEqual([]);
  });

  // ⛔ OTOČENO 2026-08-22. Tenhle test dřív VYŽADOVAL, aby v obou souborech
  // fallback `_default` BYL — a tím vadu držel: byl zelený přesně tak dlouho,
  // dokud vada žila, a zčervenal až po narovnání.
  //
  // Úvaha z 08-10 nebyla hloupá, jen zastarala. Zněla: „nemá-li instance
  // vlastní overlay, je `_default` správná odpověď" — a v té době znala jen
  // overlaye v upstream stromu (`instances/`). Kanál z INSTANČNÍHO REPA
  // (SURFACE_OVERLAY_*) přibyl potom. Od té chvíle instance overlay MĚLA
  // a `_default` ji přesto přebilo: majitel skončil na cizím IdP
  // (`idp.example.invalid`), aniž cokoli spadlo.
  //
  // Invariant „AISHA_INSTANCE se nedosazuje z profilu" PLATÍ DÁL — hlídá ho
  // test o kus výš. Mění se jen odpověď na otázku „a co když identitu neznáme":
  // dřív `_default`, teď TICHO. Nevydaný řádek nechá spadnout stráž
  // `${AISHA_INSTANCE:?}` v compose — hlasitě a hned.
  test("identita se nedosazuje literálem — ani v derivaci, ani v cold-startu", () => {
    const derive = readFileSync(DERIVE, "utf-8");
    const kodDerive = derive.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(
      kodDerive,
      "derivace zase dosazuje `_default` za identitu instance — povrch se postaví z referenční šablony",
    ).not.toMatch(/AISHA_INSTANCE=\$\{[^}]*\|\|\s*"_default"\}/);

    const cs = readFileSync(COLDSTART, "utf-8");
    const kodCs = cs.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    expect(
      kodCs,
      "cold-start zase dosazuje výchozí jméno instance — a přebije tím derivaci",
    ).not.toMatch(/AISHA_INSTANCE=\$\{AISHA_INSTANCE:-/);

    // Stráž musí NĚKDE být, jinak by ticho znamenalo prázdnou hodnotu místo pádu.
    expect(kodCs, "chybějící identita musí cold-start ZASTAVIT, ne projít prázdná").toMatch(
      /AISHA_INSTANCE=\$\{AISHA_INSTANCE:\?/,
    );

    // `instances/_default` v repu zůstává: je to referenční šablona pro
    // upstream bez instance. Vada nebyla v její existenci, ale v tom, že se
    // dosazovala tam, kde instance svůj povrch má.
    expect(existsSync(join(ROOT, "instances/_default")), "referenční šablona musí existovat").toBe(true);
  });

  // ── Negativní testy ────────────────────────────────────────────────────────
  test("dosazení z topo.profile je nález", () => {
    expect(findProfileAsInstance('lines.push(`AISHA_INSTANCE=${x || topo.profile}`);').length).toBe(1);
  });

  test("dosazení z AISHA_PROFILE je nález", () => {
    expect(findProfileAsInstance("AISHA_INSTANCE=${AISHA_INSTANCE:-${AISHA_PROFILE:-}}").length).toBe(1);
  });

  test("_default není nález TÉHLE brány (měří dosazení PROFILU, ne literálu)", () => {
    // Pozor na čtení: neznamená to, že `_default` je v pořádku — od 2026-08-22
    // ho zakazuje test výš. Tenhle detektor hledá jinou vadu: profil dosazený
    // za identitu. Dvě různé vady, dvě různá měřidla.
    expect(findProfileAsInstance("AISHA_INSTANCE=${AISHA_INSTANCE:-_default}")).toEqual([]);
  });

  test("AISHA_INSTANCE_CONFIG_DIR se nepočítá", () => {
    expect(findProfileAsInstance('AISHA_INSTANCE_CONFIG_DIR="$profile"')).toEqual([]);
  });
});
