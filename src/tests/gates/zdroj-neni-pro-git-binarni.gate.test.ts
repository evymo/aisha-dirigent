/**
 * Brána: zdrojový text nenese doslovný bajt NUL — a co má git za binární, je
 * deklarovaný binární typ.
 *
 * Doslovný NUL v řetězci nebo regexu (místo escape `\0`) dělá ze zdroje pro
 * nástroje binární soubor. Leží-li v prvních 8000 bajtech, má ho za binární
 * i git: `git diff` a diff PR ukážou jen „Binary files differ" (revize je
 * slepá) a `git grep -I` soubor přeskočí. Leží-li dál, git ho ještě čte jako
 * text, ale běžný `grep` už hlásí „Binary file matches" — a stačí přidat pár
 * řádků nad něj nebo je ubrat a soubor mezi oběma stavy přeskočí.
 *
 * ⛔ NAMĚŘENO 2026-09-25 a znovu 2026-10-03 (oprava mezitím ležela necommitnutá):
 * `scripts/test/brany-dotcene.mjs` (výběr bran pro dráhy, 2× NUL) a
 * `packages/security/src/__tests__/cors.test.ts` (1×) měl git za binární —
 * každá změna výběru bran šla revizí naslepo. `scripts/audit-instance-identity.mjs`
 * nesl NUL na bajtu 9558, tedy ZA oknem gitu: pohled gitu ho neviděl. Proto se
 * měří OBSAH, ne jen to, co si o souboru myslí git.
 *
 * Měří VLASTNOST, ne výčet: univerzum = všechny sledované regulární soubory.
 * Výjimkou je jen deklarovaný binární typ (obrázek, ikona, font, zvuk, binární
 * lockfile). Druhá kontrola drží pohled gitu: binární může být soubor i bez
 * NUL (atribut `binary` / `-diff`), a i tam by byl diff slepý.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envWithoutGitLocation } from "../../../scripts/lib/git-worktree-health.mjs";

const ROOT = process.cwd();

/** Typy, u kterých je binární obsah záměr: obrázky, ikony, fonty, zvuk, binární lockfile. */
const BINARNI_TYPY = /\.(png|ico|icns|woff2|wav|lockb)$/i;

/** Git rozhoduje „binární / text" jen podle začátku souboru (prvních 8000 bajtů). */
const OKNO_GITU = 8000;

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"], env: envWithoutGitLocation(),
    });
  } catch (e) {
    // `git grep` bez jediného nálezu končí 1 — to je prázdný výsledek, ne chyba.
    const chyba = e as { status?: number; stdout?: string };
    if (chyba.status === 1 && args[0] === "grep") return chyba.stdout ?? "";
    throw e;
  }
}

/** Sledované REGULÁRNÍ soubory (bez symlinků a submodulů — ty nemají obsah k revizi). */
function regularni(cwd: string): string[] {
  return git(cwd, ["ls-files", "-s", "-z"]).split("\0").filter(Boolean).flatMap((r) => {
    const tab = r.indexOf("\t");
    const mode = r.slice(0, r.indexOf(" "));
    return mode === "100644" || mode === "100755" ? [r.slice(tab + 1)] : [];
  });
}

/** Obsah sledovaného souboru; `null` = v pracovní kopii smazaný (nemá co měřit). */
function obsah(cwd: string, soubor: string): Buffer | null {
  try { return readFileSync(join(cwd, soubor)); } catch { return null; }
}

/** Soubory z `soubory`, které nesou bajt NUL — s pozicí prvního výskytu. */
function sNulem(cwd: string, soubory: string[]): { soubor: string; bajt: number }[] {
  return soubory.flatMap((soubor) => {
    const bajt = obsah(cwd, soubor)?.indexOf(0) ?? -1;
    return bajt === -1 ? [] : [{ soubor, bajt }];
  });
}

/** Neprázdné sledované soubory, které git nevypíše jako text. */
function binarniPodleGitu(cwd: string): string[] {
  const textove = new Set(git(cwd, ["grep", "-I", "-l", "-z", "-e", ""]).split("\0").filter(Boolean));
  return regularni(cwd).filter((f) => !textove.has(f) && (obsah(cwd, f)?.length ?? 0) > 0);
}

describe("zdrojový text nenese NUL a není pro git binární (revize nesmí být slepá)", () => {
  it("měřidlo: obsah najde NUL kdekoli, git jen ten na začátku souboru", () => {
    const repo = mkdtempSync(join(tmpdir(), "binarni-"));
    try {
      git(repo, ["init", "-q"]);
      writeFileSync(join(repo, "s-nul.mjs"), 'const a = "x\0y";\n');
      writeFileSync(join(repo, "s-nul-pozde.mjs"), `// ${"x".repeat(OKNO_GITU + 500)}\nconst a = "x\0y";\n`);
      writeFileSync(join(repo, "s-escape.mjs"), 'const a = "x\\0y";\n');
      writeFileSync(join(repo, "prazdny.mjs"), "");
      writeFileSync(join(repo, "obrazek.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
      git(repo, ["add", "-A"]);
      const zdroje = regularni(repo).filter((f) => !BINARNI_TYPY.test(f));
      expect(sNulem(repo, zdroje).map((v) => v.soubor).sort()).toEqual(["s-nul-pozde.mjs", "s-nul.mjs"]);
      // NUL za oknem git nevidí — proto strom níž měří obsah, ne jen pohled gitu.
      expect(binarniPodleGitu(repo).sort()).toEqual(["obrazek.png", "s-nul.mjs"]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("strom: zdrojový soubor mimo deklarované binární typy nenese bajt NUL", () => {
    const vse = regularni(ROOT);
    expect(vse.length, "univerzum sledovaných souborů je podezřele malé — měřidlo je slepé").toBeGreaterThan(5000);
    // Kotva: v deklarovaném binárním souboru měřidlo NUL NAJDE. Bez ní by brána
    // zelenala i tehdy, kdyby čtení obsahu nevidělo nic.
    const deklarovane = vse.filter((f) => BINARNI_TYPY.test(f));
    expect(sNulem(ROOT, deklarovane).length, "měřidlo nenašlo NUL ani v jednom obrázku/fontu — je slepé").toBeGreaterThan(0);
    const vady = sNulem(ROOT, vse.filter((f) => !BINARNI_TYPY.test(f)))
      .map((v) => `${v.soubor} (bajt ${v.bajt}${v.bajt < OKNO_GITU ? ", git ho má za binární" : ""})`);
    expect(vady, "zdroj nese doslovný NUL → nahraď ho escape \\0 (v řetězci i v regexu znamená totéž)").toEqual([]);
  });

  it("strom: každý pro git binární soubor je deklarovaný binární typ", () => {
    const binarni = binarniPodleGitu(ROOT);
    // Bez jediného deklarovaného binárního souboru by brána zelenala i tehdy,
    // kdyby `git grep` vypsal všechno (třeba bez -I) — pak neměří nic.
    expect(binarni.some((f) => BINARNI_TYPY.test(f)), "měřidlo nevidí ani jeden obrázek/font — je slepé").toBe(true);
    const vady = binarni.filter((f) => !BINARNI_TYPY.test(f));
    expect(vady, "git tyto soubory vidí jako binární (NUL na začátku nebo atribut binary/-diff) → diff PR je slepý").toEqual([]);
  });
});
