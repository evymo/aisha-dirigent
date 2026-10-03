/**
 * Číslo vlny má JEDEN DOMOV
 *
 * ── PRAVIDLO ──────────────────────────────────────────────────────────────────
 * Rozsah vln se v cold-startu NEOPISUJE. Hranice fází vydává
 * `aisha-redeploy.mjs --print-phases` ze stejného pole, které vlny definuje.
 *
 * ── PROČ (naměřeno 2026-08-13) ────────────────────────────────────────────────
 * Cold-start volal vlny doslovnými čísly (`--until=3`, `--from=4 --until=4`,
 * `--from=5`) na OSMI místech. Rozdělení jedné vlny by znamenalo přepsat osm
 * nezávislých literálů — a jedno minout znamená TIŠE PŘESKOČENOU VLNU: log
 * pokračuje, stack se nenasadí, nikde ani slovo.
 *
 * Není to teorie. 2026-08-11 se vlna 0 (warmup — hostitelské sítě) přidala do
 * pole WAVES, ale výchozí `--from=1` ji přeskakoval: log šel rovnou na „Wave 1",
 * na hostech nevznikl jediný netinit kontejner a varra zůstala bez sítí.
 *
 * ── CO SE MĚŘÍ ────────────────────────────────────────────────────────────────
 * 1. cold-start nevolá redeploy s číselným `--from=`/`--until=` (jen proměnnou),
 * 2. `--print-phases` běží BEZ přihlašovacích údajů a vrací úplnou sadu,
 * 3. hranice odpovídají skutečným jménům vln (Keycloak / OIDC / mesh).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as path from "node:path";

const ROOT = process.cwd();
const COLD_START = path.join(ROOT, "scripts/aisha-cold-start.sh");
const REDEPLOY = path.join(ROOT, "scripts/aisha-redeploy.mjs");

/** Řádky kódu (bez komentářů) — komentář smí čísla ZMIŇOVAT, kód je volat nesmí. */
function kodoveRadky(soubor: string): { radek: number; text: string }[] {
  return readFileSync(soubor, "utf8")
    .split("\n")
    .map((text, i) => ({ radek: i + 1, text }))
    .filter(({ text }) => !text.trim().startsWith("#"));
}

describe("číslo vlny má jeden domov", () => {
  it("cold-start nevolá redeploy s číselným rozsahem vln", () => {
    const literaly = kodoveRadky(COLD_START)
      .filter(({ text }) => /--(from|until)=\d/.test(text))
      .map(({ radek, text }) => `${radek}: ${text.trim().slice(0, 100)}`);

    expect(
      literaly,
      "Opsané číslo vlny je druhý domov. Rozdělení vlny pak vyžaduje najít VŠECHNY\n" +
        "výskyty a jedno minout znamená tiše přeskočenou vlnu — nenasazený stack\n" +
        "bez chybové hlášky. Použij ${AISHA_WAVE_PHASE_*} z `--print-phases`.",
    ).toEqual([]);
  });

  it("--print-phases běží bez přihlašovacích údajů a vrací úplnou sadu", () => {
    // Statický výpis struktury nesmí chtít tajemství: jinak ho nespustí ani
    // tenhle test, ani fork, který Coolify nepoužívá — a hranice by se zase
    // opsaly ručně.
    const env = { ...process.env };
    for (const k of ["COOLIFY_URL", "COOLIFY_BASE_URL", "COOLIFY_API_TOKEN"]) delete env[k];

    const out = execFileSync("node", [REDEPLOY, "--print-phases"], {
      cwd: ROOT,
      encoding: "utf8",
      env,
    });

    const map = new Map<string, string>();
    for (const line of out.split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) map.set(m[1], m[2]);
    }

    // Patička = důkaz úplnosti. Uříznutý výstup (roura + exit) by jinak vypadal
    // jako platná, jen kratší sada.
    expect(map.get("__PHASES_END__"), "patička chybí — výstup mohl být uříznut").toBeTruthy();

    for (const klic of [
      "AISHA_WAVE_PHASE_A_UNTIL",
      "AISHA_WAVE_PHASE_C_FROM",
      "AISHA_WAVE_PHASE_C_UNTIL",
      "AISHA_WAVE_PHASE_D_FROM",
      "AISHA_WAVE_LAST",
    ]) {
      expect(map.get(klic), `${klic} chybí ve výstupu --print-phases`).toMatch(/^\d+$/);
    }
  });

  it("cold-start používá právě ty klíče, které --print-phases vydává", () => {
    // Mlčení sondy je samo nálezem: kdyby se klíč přejmenoval jen na jedné
    // straně, shell by dosadil prázdno a `--until=` by nasadilo VŠECHNO.
    const text = readFileSync(COLD_START, "utf8");
    const pouzite = new Set([...text.matchAll(/\$\{(AISHA_WAVE_PHASE_[A-Z0-9_]*)\}/g)].map((m) => m[1]));
    expect(pouzite.size, "cold-start nepoužívá ŽÁDNOU hranici fáze — kanál není zapojen").toBeGreaterThan(2);

    const env = { ...process.env };
    for (const k of ["COOLIFY_URL", "COOLIFY_BASE_URL", "COOLIFY_API_TOKEN"]) delete env[k];
    const vydane = new Set(
      execFileSync("node", [REDEPLOY, "--print-phases"], { cwd: ROOT, encoding: "utf8", env })
        .split("\n")
        .map((l) => l.match(/^(AISHA_WAVE_PHASE_[A-Z0-9_]*)=/)?.[1])
        .filter(Boolean) as string[],
    );

    const sirotci = [...pouzite].filter((k) => !vydane.has(k)).sort();
    expect(
      sirotci,
      "cold-start čte hranici, kterou --print-phases nevydává — shell by dosadil\n" +
        "prázdno a rozsah vln by tiše zmizel:",
    ).toEqual([]);
  });
});
