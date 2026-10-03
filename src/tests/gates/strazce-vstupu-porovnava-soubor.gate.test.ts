/**
 * Brána: strážce vstupu porovnává SOUBOR, ne zápis cesty.
 *
 * TŘÍDA VADY: modul, který je zároveň knihovnou i nástrojem, se ptá „spustili
 * mě přímo?" porovnáním dvou ŘETĚZCŮ. Ty se ale mohou lišit, i když ukazují na
 * týž soubor — a blok se pak TIŠE přeskočí: nic na stdout, návratový kód 0.
 * Volající v shellu si to prázdno vyloží jako měření.
 *
 * NAMĚŘENO 2026-08-14. Dva git worktree se STEJNÝM commitem, lišící se jen
 * jménem adresáře:
 *
 *   .claude/worktrees/pki-cistý  →  derive-domains.mjs --shell  =     0 bajtů
 *   .claude/worktrees/pki-clean  →  totéž                       =  6039 bajtů
 *
 * Prostředí nemá nastavené LANG ani LC_ALL (C locale). `import.meta.url` nese
 * cestu percent-enkódovanou (`pki-cist%C3%BD`), kdežto `process.argv[1]` syrové
 * bajty — a `import.meta.url === \`file://\${process.argv[1]}\`` je proto na
 * cestě s diakritikou VŽDY nepravda. Následek: resolver „neemitoval" ani jednu
 * doménu a shodil dvanáct bran topologie, přestože byl v pořádku.
 *
 * Pro česky mluvící uživatele to není exotika — repo ve složce s háčkem je
 * běžný případ, a vada je do té doby neviditelná.
 *
 * ODPOVĚĎ: neporovnávat ZÁPIS, ale SOUBOR — dvojice `dev` + `ino` je POSIXová
 * definice „totožný soubor". Nezávisí na kódování, symlincích ani na tom, jak
 * cestu napsal volající.
 *
 * CO SE TU MĚŘÍ: spuštěním z adresáře s diakritikou. Bez toho testu se vada
 * vrátí, protože v ASCII cestě je neviditelná.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const NODE = process.execPath;
const CLI_ENTRY = join(ROOT, "scripts/lib/cli-entry.mjs");

/** Adresář, jehož jméno NENÍ ASCII — přesně ten případ, který vadu odhalil. */
function adresarSDiakritikou(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "vstup-")), "ověření-č");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Kód bez komentářů. Brána musí měřit, co se SPUSTÍ — ne co je o tom napsáno.
 * Bez toho tenhle test spadl na VLASTNÍM komentáři, který ten starý tvar cituje
 * jako varování. Je to táž vada, jakou už evidujeme u env-doctor kontroly (čte
 * `${VAR}` i v komentářích compose): kdo hledá vzor v syrovém textu, najde ho
 * i v próze o něm.
 */
function bezKomentaru(zdroj: string): string {
  return zdroj
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("strážce vstupu porovnává soubor, ne zápis cesty", () => {
  test("modul spuštěný z cesty s diakritikou POZNÁ, že běží přímo", () => {
    const dir = adresarSDiakritikou();
    const modul = join(dir, "nastroj.mjs");
    writeFileSync(
      modul,
      `import { isDirectRun } from ${JSON.stringify(CLI_ENTRY)};\n` +
        `process.stdout.write(isDirectRun(import.meta.url) ? "PRIMO" : "IMPORT");\n`,
    );
    expect(execFileSync(NODE, [modul], { encoding: "utf-8" })).toBe("PRIMO");
    // A totéž při volání RELATIVNÍ cestou z toho adresáře — tak to dělá shell.
    expect(execFileSync(NODE, ["nastroj.mjs"], { cwd: dir, encoding: "utf-8" })).toBe("PRIMO");
  });

  test("porovnání ŘETĚZCŮ by na téže cestě selhalo — proto se neporovnávají", () => {
    // Kontrolní měření: starý idiom se na cestě s diakritikou rozejde. Kdyby
    // se jednou ukázalo, že se nerozchází, tahle brána hlídá neexistující vadu
    // a patří přepsat.
    const dir = adresarSDiakritikou();
    const modul = join(dir, "stary.mjs");
    writeFileSync(
      modul,
      'process.stdout.write(import.meta.url === `file://${process.argv[1]}` ? "PRIMO" : "IMPORT");\n',
    );
    expect(
      execFileSync(NODE, [modul], { encoding: "utf-8" }),
      "starý idiom na diakritice selhává — to je ta vada, kterou domov řeší",
    ).toBe("IMPORT");
  });

  test("přes adresář se SYMLINKEM: isDirectRun pozná přímý běh, porovnání cest ne", () => {
    // NAMĚŘENO 2026-09-27: `resolve(process.argv[1]) === fileURLToPath(import.meta.url)`
    // — argv[1] nese cestu přes symlink, import.meta.url rozřešenou (macOS /var →
    // /private/var). Tady výslovný symlink, aby se to měřilo i na Linuxu.
    const zaklad = mkdtempSync(join(tmpdir(), "vstup-odkaz-"));
    const skutecny = join(zaklad, "skutecny");
    mkdirSync(skutecny);
    const odkaz = join(zaklad, "odkaz");
    symlinkSync(skutecny, odkaz);
    writeFileSync(
      join(skutecny, "novy.mjs"),
      `import { isDirectRun } from ${JSON.stringify(CLI_ENTRY)};\n` +
        `process.stdout.write(isDirectRun(import.meta.url) ? "PRIMO" : "IMPORT");\n`,
    );
    writeFileSync(
      join(skutecny, "stary.mjs"),
      `import { resolve } from "node:path";\nimport { fileURLToPath } from "node:url";\n` +
        `process.stdout.write(resolve(process.argv[1]) === fileURLToPath(import.meta.url) ? "PRIMO" : "IMPORT");\n`,
    );
    expect(execFileSync(NODE, [join(odkaz, "novy.mjs")], { encoding: "utf-8" })).toBe("PRIMO");
    expect(
      execFileSync(NODE, [join(odkaz, "stary.mjs")], { encoding: "utf-8" }),
      "kontrolní měření: porovnání cest se přes symlink rozejde — to je ta vada",
    ).toBe("IMPORT");
  });

  test("při importu modul mlčí — knihovna nesmí nic vypsat", () => {
    const dir = adresarSDiakritikou();
    const modul = join(dir, "knihovna.mjs");
    writeFileSync(
      modul,
      `import { isDirectRun } from ${JSON.stringify(CLI_ENTRY)};\n` +
        `if (isDirectRun(import.meta.url)) process.stdout.write("PRIMO");\n` +
        `export const nic = 1;\n`,
    );
    const volajici = join(dir, "volajici.mjs");
    writeFileSync(volajici, `import "./knihovna.mjs";\nprocess.stdout.write("HOTOVO");\n`);
    expect(execFileSync(NODE, [volajici], { encoding: "utf-8" })).toBe("HOTOVO");
  });

  test("žádný sledovaný modul neporovnává vstupní bod jako řetězec", () => {
    const soubory = execFileSync("git", ["ls-files", "-z", "*.mjs", "*.js"], {
      cwd: ROOT,
      encoding: "utf-8",
    })
      .split("\0")
      .filter(Boolean);
    expect(soubory.length, "git ls-files nic nevrátil — měření neproběhlo").toBeGreaterThan(20);

    const vlastniKopie = soubory.filter((f) => {
      if (f === "scripts/lib/cli-entry.mjs") return false; // jediný domov
      const s = bezKomentaru(readFileSync(join(ROOT, f), "utf-8"));
      // Tři známé podoby: přes pathToFileURL, syrové `file://${argv[1]}` a
      // `resolve(argv[1]) === fileURLToPath(import.meta.url)` (v obou pořadích).
      // Třetí NAMĚŘENO 2026-09-27 (brána izolace cold-startu): přes symlink
      // (macOS /var → /private/var) se CLI derive-bundle-consumers tiše přeskočilo
      // a stagingový cold-start vygeneroval PRÁZDNÝ env soubor.
      return (
        /pathToFileURL\s*\(\s*process\.argv\[1\]/.test(s) ||
        /import\.meta\.url\s*===\s*`file:\/\/\$\{process\.argv\[1\]\}`/.test(s) ||
        /process\.argv\[1\][^;\n]*={2,3}[^;\n]*fileURLToPath\s*\(\s*import\.meta\.url\s*\)/.test(s) ||
        /fileURLToPath\s*\(\s*import\.meta\.url\s*\)[^;\n]*={2,3}[^;\n]*process\.argv\[1\]/.test(s)
      );
    });
    expect(
      vlastniKopie,
      "tyhle moduly si strážce vstupu píšou vlastní — použij isDirectRun z lib/cli-entry.mjs",
    ).toEqual([]);
  });
});
