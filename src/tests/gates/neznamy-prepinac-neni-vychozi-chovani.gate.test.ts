/**
 * Neznámý přepínač je STOP, ne výchozí chování (ROHATKA)
 *
 * ── PRAVIDLO ──────────────────────────────────────────────────────────────────
 * Nástroj, který čte přepínače z `process.argv` A ZÁROVEŇ umí zapisovat, musí
 * neznámý přepínač ODMÍTNOUT. Mlčky ho ignorovat znamená spadnout do výchozího
 * režimu — a ten u nasazovacích a opravných nástrojů MĚNÍ SVĚT.
 *
 * ── PROČ (dvakrát naměřeno, pokaždé jinde) ────────────────────────────────────
 * 2026-08-27, `aisha-env-doctor.mjs`: nástroj neměl `--help`, takže `--help`
 * SÁM byl tím neznámým přepínačem, který spustil zápis — 36 klíčů do
 * `.env.coolify` a odvozeninou z prázdného prostředí smazaný alias.
 *
 * 2026-09-05, `aisha-redeploy.mjs`: dotaz na nápovědu spadl do NASAZOVÁNÍ.
 *
 *     node scripts/aisha-redeploy.mjs --help
 *     → Mode: execute ; ✓ Found 33 <prefix>-* applications
 *
 * Zachránila mě jen roura do `head`, která proces zabila nad výpisem stavu.
 *
 * ⭐ TŘÍDA: NEJISTOTA ROZHODNUTÁ NEJDESTRUKTIVNĚJŠÍM VÝKLADEM. Táž třída jako
 * chybějící hodnota, ze které se stane výchozí — jen tady je vstupem argv.
 *
 * ⭐ A ZDE JE TŘETÍ CESTA DO TÉHOŽ: pod **zsh** se neuvozovkovaná expanze
 * NEDĚLÍ na slova, takže `node nastroj $M` předá JEDEN slepený argument.
 * Ten neodpovídá žádnému přepínači ⇒ bez stráže nástroj běží, jako by se
 * nespecifikovalo nic. Ověřeno na `aisha-redeploy.mjs`: se stráží exit 2.
 *
 * ── PROČ ROHATKA A NE NULA ────────────────────────────────────────────────────
 * V okamžiku psaní čte přepínače 126 skriptů, z toho 70 umí zapisovat a stráž
 * mají DVA. Vynutit nulu naráz by znamenalo přepsat 68 nástrojů v jednom kroku.
 * Dluh proto smí jen KLESAT — a `scripts/aisha-redeploy.mjs` je první splátka.
 *
 * ── UNIVERZUM ────────────────────────────────────────────────────────────────
 * Odvozeno z gitu, ne psáno rukou. Brána, jejíž seznam souborů je zapsaný
 * ručně, dědí své díry — nový nástroj by do ní nikdy nespadl.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

const ROOT = process.cwd();
const BASELINE = path.join(ROOT, "src/tests/gates/neznamy-prepinac-neni-vychozi-chovani.baseline.json");

function skripty(): string[] {
  return execFileSync("git", ["ls-files", "scripts/*.mjs", "scripts/**/*.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

/** Ptá se nástroj na přepínače z argv? */
function ctePrepinace(src: string): boolean {
  return (
    /process\.argv[\s\S]{0,240}?(includes|startsWith|find|filter)\s*\(/.test(src) ||
    /\bargv\.(includes|find|filter)\s*\(/.test(src)
  );
}

/**
 * Umí měnit svět? Zápis na disk nebo mutující HTTP.
 *
 * Čtoucí nástroj s ignorovaným přepínačem je vada v ergonomii; zapisující je
 * vada v bezpečnosti. Rohatka hlídá tu druhou.
 */
function umiZapisovat(src: string): boolean {
  return /writeFileSync|appendFileSync|renameSync|unlinkSync|rmSync|method:\s*"(POST|PATCH|PUT|DELETE)"/.test(src);
}

/**
 * Má stráž? Vyžadují se OBĚ půlky, aby ji nešlo předstírat komentářem:
 *   1. filtr nad argv, který porovná `-…` proti známé množině
 *   2. ukončení NENULOVÝM kódem
 */
function maStraz(src: string): boolean {
  const filtr =
    /startsWith\(\s*["'`]-["'`]\s*\)[\s\S]{0,240}?\.(has|includes)\s*\(/.test(src) ||
    /\.(has|includes)\s*\([\s\S]{0,80}?\)[\s\S]{0,160}?startsWith\(\s*["'`]-["'`]\s*\)/.test(src);
  const konciNenulou = /process\.exit\(\s*[1-9]\d*\s*\)/.test(src);
  return filtr && konciNenulou;
}

function bezStraze(): string[] {
  return skripty()
    .filter((f) => {
      const src = readFileSync(path.join(ROOT, f), "utf8");
      return ctePrepinace(src) && umiZapisovat(src) && !maStraz(src);
    })
    .sort();
}

type Baseline = { dluh: number; soubory: string[] };

describe("neznámý přepínač není výchozí chování", () => {
  it("univerzum není prázdné — jinak by rohatka mlčela z neznalosti", () => {
    const vsechny = skripty();
    expect(vsechny.length).toBeGreaterThan(50);
    const ctouci = vsechny.filter((f) => ctePrepinace(readFileSync(path.join(ROOT, f), "utf8")));
    expect(ctouci.length).toBeGreaterThan(10);
  });

  it("aisha-redeploy.mjs stráž MÁ — je to první splátka dluhu", () => {
    const src = readFileSync(path.join(ROOT, "scripts/aisha-redeploy.mjs"), "utf8");
    expect(umiZapisovat(src)).toBe(true);
    expect(maStraz(src)).toBe(true);
  });

  it("dluh smí jen KLESAT", () => {
    const baseline: Baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
    const ted = bezStraze();

    if (process.env.AISHA_UPDATE_BASELINE === "1") {
      writeFileSync(BASELINE, JSON.stringify({ dluh: ted.length, soubory: ted }, null, 2) + "\n");
      return;
    }

    const nove = ted.filter((f) => !baseline.soubory.includes(f));
    expect(
      nove,
      `Nový nástroj, který zapisuje a neznámý přepínač neodmítá:\n${nove.join("\n")}\n` +
        `Přidej registr známých přepínačů a ukonči nenulovým kódem — vzor: scripts/aisha-redeploy.mjs`,
    ).toEqual([]);

    expect(
      ted.length,
      `Dluh vzrostl z ${baseline.dluh} na ${ted.length} — rohatka smí jen klesat.`,
    ).toBeLessThanOrEqual(baseline.dluh);
  });
});
