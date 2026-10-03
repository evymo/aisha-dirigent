import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Co bundler rozkládá, to musí CI umět spustit.
 *
 * ⛔ PROČ EXISTUJE
 * Archiv do TestFlightu spadl 2026-08-09 na `Unable to resolve module
 * @aisha/knock-protocol`. Vada NEBYLA v `mobile-app/` — byla to rozložitelnost
 * VAZBY mezi aplikací a sdíleným balíkem. Balicí krok, který na to vznikl,
 * ale bydlí v jobu spouštěném filtrem `^mobile-app/`, takže by u změny toho
 * balíku mlčel: měřidlo slepé přesně na třídu, kvůli které je.
 *
 * ⭐ UNIVERZUM SE BERE Z METRO KONFIGURACE, NEPÍŠE SE SEM
 * `extraNodeModules` a `watchFolders` říkají, do kterých balíků bundler sahá.
 * Kdyby tenhle soubor nesl vlastní výčet, byl by to druhý ručně udržovaný
 * seznam — a rozešel by se stejně tiše jako ten, který má hlídat.
 *
 * ⚠️ Brána NEKONTROLUJE, že filtr je „správný". Kontroluje, že OBĚ STRANY
 * MLUVÍ O TÝCHŽ BALÍCÍCH. Přidat sdílený balík do metro konfigurace a
 * zapomenout na CI je pak červená, ne tichý slepý bod.
 */
const ROOT = join(__dirname, "../../..");
const METRO = join(ROOT, "mobile-app/metro.config.js");
const CI = join(ROOT, "scripts/ci/zmenene-cesty.sh"); // směrování = jeden domov (ci.yml i hook ho volají)

/** Balíky z kořene repa, do kterých metro sahá (`packages/<jméno>`). */
function balikyZMetra(): Set<string> {
  const src = readFileSync(METRO, "utf8");
  return new Set([...src.matchAll(/["'`]packages\/([a-z0-9][a-z0-9-]*)["'`/]/g)].map((m) => m[1]));
}

/** Balíky, které vyjmenovává filtr `MOBILE_APP` v CI. */
function balikyZCi(): { jmena: Set<string>; radek: string } {
  const src = readFileSync(CI, "utf8");
  const radek = src.split("\n").find((r) => r.includes("MOBILE_APP=true"));
  if (!radek) throw new Error("ve scripts/ci/zmenene-cesty.sh není řádek, který zapíná MOBILE_APP");
  return {
    jmena: new Set([...radek.matchAll(/packages\/\(?([a-z0-9|-]+)\)?\//g)].flatMap((m) =>
      m[1].split("|").filter(Boolean),
    )),
    radek,
  };
}

describe("mobilní bundle — CI vidí na všechno, co se rozkládá", () => {
  const metro = balikyZMetra();
  const ci = balikyZCi();

  it("vzorec nad metro konfigurací něco našel", () => {
    // Prázdná množina by udělala tvrzení níž bezobsažným: brána by svítila
    // zeleně nad libovolným filtrem, protože by neměla co porovnávat.
    expect(
      [...metro],
      "v metro.config.js jsem nenašel žádný `packages/…` — buď se změnil zápis, " +
        "nebo je vzorec téhle brány slepý. V obou případech neměří nic.",
    ).not.toEqual([]);
  });

  it("každý balík, který bundler rozkládá, spouští mobilní lane", () => {
    const chybi = [...metro].filter((p) => !ci.jmena.has(p)).sort();
    expect(
      chybi,
      `Balíky, do kterých metro sahá, ale filtr MOBILE_APP je nevidí: ${chybi.join(", ")}.\n` +
        `Změna v nich rozbije bundle a CI o tom NEŘEKNE — přesně ta třída, kvůli které\n` +
        `balicí krok vznikl. Doplň je do filtru ve scripts/ci/zmenene-cesty.sh.`,
    ).toEqual([]);
  });

  it("filtr nevyjmenovává balík, který metro nezná", () => {
    const navic = [...ci.jmena].filter((p) => !metro.has(p)).sort();
    expect(
      navic,
      `Filtr MOBILE_APP spouští mobilní lane kvůli balíkům, do kterých bundler nesahá: ` +
        `${navic.join(", ")}.\nBuď zmizely z metro.config.js a zůstaly tu, nebo je to překlep — ` +
        `obojí stojí čas runneru za nic.`,
    ).toEqual([]);
  });

  it("změna samotné lane ji spustí", () => {
    // Repo tenhle princip vyslovuje u `db_change` i u `CI_CHANGE`: „změna brány
    // MUSÍ bránu spustit". Bez toho se balicí krok nedá vyzkoušet jinak než
    // mergnout naslepo — což je přesně, jak vznikl PR #140.
    expect(
      ci.radek,
      "filtr MOBILE_APP nereaguje na .forgejo/workflows/ — balicí krok by neproběhl " +
        "ani na PR, který ho mění",
    ).toContain(".forgejo/workflows/");
  });
});
