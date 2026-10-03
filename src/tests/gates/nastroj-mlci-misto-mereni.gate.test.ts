/**
 * Brána: nástroj, který neměřil, nesmí mlčet — a mlčení se nesmí dát vyložit jako výsledek.
 *
 * TŘÍDA VADY: shellový volající si vezme STDOUT jednoho nástroje jako měření.
 * Když nástroj nic nevypíše a skončí nulou, volající dostane prázdný řetězec —
 * a ten projde všemi větvemi až do catch-allu, který z něj vyrobí NÁLEZ.
 * Selhání nástroje se převlékne za zjištění o platformě.
 *
 * Naměřeno 2026-08-14 na riqu i na aishe, ve stejné hlášce, ze DVOU nezávislých
 * příčin, které se sešly:
 *
 *   ⚠ subnet NEODPOVÍDÁ odvození:            ← detail chybí, protože nic neměřilo
 *
 *   PRVNÍ (volající): doctor předával `"$ENV_PROD_BACKUP"` — proměnnou, kterou
 *   nikdy nedefinoval; je to pojem cold-startu. Pod `set -u` shodí nedefinovaná
 *   proměnná celou substituci a ta vrátí prázdno.
 *
 *   DRUHÁ (nástroj): CLI blok se hlídal porovnáním ŘETĚZCŮ
 *   `import.meta.url === pathToFileURL(process.argv[1]).href`. `import.meta.url`
 *   je cesta po rozpletení symlinků, `argv[1]` je to, co napsal volající —
 *   symlink, git worktree nebo `/tmp` → `/private/tmp` na macOS ty dva řetězce
 *   rozejde a blok se TIŠE přeskočí. Nula na výstupu, prázdno na stdout.
 *
 * CO SE TU MĚŘÍ (spuštěním, ne pinem):
 *   • `isDirectRun` odpoví správně i přes symlink a při importu mlčí,
 *   • `subnet-drift.mjs` na nečitelných vstupech vydá NEZMERENO, ne prázdno,
 *   • doctorův výpočet cesty k vaultu přežije `set -u` — spustí se doslova ty
 *     řádky, které jsou v doctoru (kdo je vrátí na `$ENV_PROD_BACKUP`, ten
 *     tenhle test položí).
 *
 * CO SE PINUJE (a proč to stačí): že žádný sledovaný .mjs nemá vlastní kopii
 * strážce vstupu. Tohle je otázka o CELÉM repu, na kterou se nedá odpovědět
 * spuštěním jednoho modulu.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDirectRun } from "../../../scripts/lib/cli-entry.mjs";

const ROOT = resolve(process.cwd());
const NODE = process.execPath;

describe("strážce vstupu do CLI má jeden domov a nelže o symlinku", () => {
  test("žádný sledovaný .mjs neporovnává vstupní bod jako ŘETĚZEC", () => {
    const files = execFileSync("git", ["ls-files", "-z", "*.mjs"], { cwd: ROOT, encoding: "utf-8" })
      .split("\0")
      .filter(Boolean);
    expect(files.length, "git ls-files nic nevrátil — měření neproběhlo").toBeGreaterThan(20);

    const vlastniKopie = files.filter((f) => {
      if (f === "scripts/lib/cli-entry.mjs") return false; // jediný domov
      const s = readFileSync(join(ROOT, f), "utf-8");
      return /pathToFileURL\s*\(\s*process\.argv\[1\]/.test(s);
    });
    expect(
      vlastniKopie,
      "tyhle soubory si strážce vstupu píšou vlastní — použij isDirectRun z lib/cli-entry.mjs",
    ).toEqual([]);
  });

  test("isDirectRun pozná spuštění přes symlink (tam, kde porovnání řetězců selhalo)", () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-vstup-"));
    const skutecny = join(dir, "skutecny.mjs");
    writeFileSync(
      skutecny,
      `import { isDirectRun } from ${JSON.stringify(join(ROOT, "scripts/lib/cli-entry.mjs"))};\n` +
        `process.stdout.write(isDirectRun(import.meta.url) ? "PRIMO" : "IMPORT");\n`,
    );
    const přes = join(dir, "odkaz.mjs");
    symlinkSync(skutecny, přes);

    expect(execFileSync(NODE, [skutecny], { encoding: "utf-8" })).toBe("PRIMO");
    expect(
      execFileSync(NODE, [přes], { encoding: "utf-8" }),
      "spuštění přes symlink je pořád přímé spuštění",
    ).toBe("PRIMO");
  });

  test("isDirectRun mlčí, když je modul jen naimportovaný", () => {
    // Tenhle test běží uvnitř vitestu — vstupní bod procesu není tenhle soubor.
    expect(isDirectRun(import.meta.url)).toBe(false);
  });
});

describe("nezměřený subnet se nesmí stát nálezem", () => {
  test("subnet-drift.mjs na nečitelných vstupech vydá NEZMERENO, ne prázdno", () => {
    const out = execFileSync(NODE, [join(ROOT, "scripts/lib/subnet-drift.mjs"), "/neni/a", "/neni/b"], {
      encoding: "utf-8",
    });
    expect(out.trim(), "prázdný výstup by volající vyložil jako verdikt").not.toBe("");
    expect(out).toMatch(/^NEZMERENO/);
  });

  test("doctorův výpočet cesty k vaultu přežije `set -u`", () => {
    const sh = readFileSync(join(ROOT, "scripts/cold-start-doctor.sh"), "utf-8");
    const radek = sh.split("\n").find((r) => /^_doctor_vault=/.test(r));
    expect(radek, "doctor musí mít vlastní výpočet cesty k vaultu").toBeTruthy();

    // Doslova ten řádek z doctoru, spuštěný v prostředí, kde ENV_PROD_BACKUP
    // NENÍ definovaná — přesně jak doctor běží. `set -u` udělá z odkazu na
    // cizí proměnnou pád, ne prázdno.
    const skript = `set -euo pipefail\nREPO_ROOT=${JSON.stringify(ROOT)}\n${radek}\nprintf '%s' "$_doctor_vault"\n`;
    const vysledek = execFileSync("bash", ["-c", skript], {
      encoding: "utf-8",
      env: { PATH: process.env.PATH ?? "" },
    });
    expect(vysledek, "cesta k vaultu vyšla prázdná — z prázdna se rodí falešné verdikty").not.toBe("");
    expect(vysledek).toContain(".env-prod-backup");
  });

  test("doctor mlčí u NEZMERENO a nález hlásí jen z neprázdného verdiktu", () => {
    const sh = readFileSync(join(ROOT, "scripts/cold-start-doctor.sh"), "utf-8");
    const zacatek = sh.indexOf('case "$_subnet_drift" in');
    expect(zacatek, "rozhodovací tabulka nad subnetem musí existovat").toBeGreaterThan(-1);
    const blok = sh.slice(zacatek, sh.indexOf("esac", zacatek));
    // NEZMERENO je vlastní větev, a je TICHÁ — ne warn, ne ok.
    expect(blok).toMatch(/NEZMERENO\*\)\s*: ;;/);
    // Catch-all nesmí být první větví — jinak by pohltil i NEZMERENO.
    expect(blok.indexOf("NEZMERENO*)")).toBeLessThan(blok.indexOf("*)"));
  });
});
