/**
 * Stale-publish brána: co JE a co NENÍ důvod k bumpu verze.
 *
 * ⛔ KOMENTÁŘ SLIBOVAL, KÓD NEDĚLAL (naměřeno 2026-09-01).
 * `isSrcPath()` nesla komentář „Reject paths that look like build/test/docs",
 * ale implementace dělala jen kladnou shodu na `packages/<pkg>/src/`. Změna
 * JEDINÉHO souboru `packages/web-canvas/src/index.test.ts` proto vynutila bump
 * 0.2.1 → 0.2.2, tedy publikaci funkčně identického balíčku.
 *
 * Tenhle test hlídá OBA SMĚRY, protože oprava se dá snadno přehnat:
 *   · skutečná změna kódu bez bumpu  → MUSÍ selhat (hlavní účel brány)
 *   · změna jen testu bez bumpu      → NESMÍ selhat (test konzument nedostane)
 *   · `testUtils.ts` NENÍ test        → MUSÍ selhat (hranice podle jména)
 *
 * Orákulum brány SPOUŠTÍ, nesimuluje: staví dočasné repo se skutečnou strukturou
 * balíčku a pouští nad ním pravý skript. Kopie logiky v testu by prošla i tehdy,
 * kdyby se skript rozešel se svým vlastním záměrem — což je přesně vada, kterou
 * tenhle soubor vznikl hlídat.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { envWithoutGitLocation } from "../../../scripts/lib/git-worktree-health.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SKRIPT = path.join(ROOT, "scripts/aisha-packages-version-check.mjs");

// ⛔ ČISTÉ PROSTŘEDÍ. Hook exportuje GIT_DIR/GIT_INDEX_FILE a ty by prosákly do
// dočasného repa, takže by se měřil STROM TOHOHLE REPA místo fixtury.
const CISTE = (() => {
  const e = envWithoutGitLocation();
  delete e.ALLOW_STALE_PACKAGE_VERSION;
  return e;
})();

const uklid: string[] = [];
afterEach(() => {
  for (const d of uklid.splice(0)) rmSync(d, { force: true, recursive: true });
});

// ⛔ FIXTURA MUSÍ POUŽÍT EXISTUJÍCÍ JMÉNO BALÍČKU. Zjištěno tímhle testem:
// skript čte zaindexované soubory z gitu (tedy z dočasného repa), ale
// `isPublishablePackage()` sahá na `packages/<pkg>/package.json` ve SVÉM
// kořeni — ROOT se odvozuje z umístění skriptu. Vymyšlené jméno `pokus` proto
// neprošlo testem publikovatelnosti a brána mlčela na všechno.
//
// Není to vada pro její skutečné použití (pre-commit běží uvnitř repa), ale
// orákulum se tomu musí přizpůsobit: jméno musí existovat a být publikovatelné.
const BALICEK = "web-canvas";

/** Publikovatelný balíček: brána mlčí u `private` a bez `publishConfig`. */
function packageJson(verze: string) {
  return `${JSON.stringify(
    {
      name: "@aisha/web-canvas",
      version: verze,
      publishConfig: { registry: "http://localhost:4873" },
    },
    null,
    2,
  )}\n`;
}

/**
 * Postaví repo s balíčkem na verzi 1.0.0, pak nastaví zadané soubory a
 * ZAINDEXUJE je. Vrátí návratový kód brány.
 */
function branaNad(zmeny: Record<string, string>): { kod: number; vypis: string } {
  const d = mkdtempSync(path.join(tmpdir(), "aisha-stale-publish-"));
  uklid.push(d);
  const git = (...a: string[]) =>
    execFileSync("git", a, { cwd: d, encoding: "utf-8", env: CISTE });

  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  mkdirSync(path.join(d, `packages/${BALICEK}/src`), { recursive: true });
  writeFileSync(path.join(d, `packages/${BALICEK}/package.json`), packageJson("1.0.0"));
  writeFileSync(path.join(d, `packages/${BALICEK}/src/index.ts`), "export const a = 1;\n");
  writeFileSync(path.join(d, `packages/${BALICEK}/src/index.test.ts`), "// test\n");
  writeFileSync(path.join(d, `packages/${BALICEK}/src/testUtils.ts`), "export const u = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "start");

  for (const [rel, obsah] of Object.entries(zmeny)) {
    const abs = path.join(d, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, obsah);
  }
  git("add", "-A");

  // Skript se orientuje podle SVÉHO umístění (ROOT = ..), takže musí běžet
  // s cwd v dočasném repu a s GIT_DIR mířícím tam — jinak by četl index
  // tohohle repozitáře.
  const r = spawnSync("node", [SKRIPT], {
    cwd: d,
    encoding: "utf-8",
    env: { ...CISTE, GIT_DIR: path.join(d, ".git"), GIT_WORK_TREE: d },
  });
  return { kod: r.status ?? -1, vypis: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("stale-publish brána — testy nejsou důvod k bumpu, kód ano", () => {
  it("⛔ ZMĚNA KÓDU BEZ BUMPU SELŽE — to je hlavní účel brány", () => {
    const { kod, vypis } = branaNad({
      [`packages/${BALICEK}/src/index.ts`]: "export const a = 2;\n",
    });
    expect(kod, `brána měla selhat, ale prošla:\n${vypis}`).toBe(1);
    expect(vypis).toContain("Stale-publish guard");
  });

  it("změna kódu S bumpem projde", () => {
    const { kod, vypis } = branaNad({
      [`packages/${BALICEK}/src/index.ts`]: "export const a = 2;\n",
      [`packages/${BALICEK}/package.json`]: packageJson("1.0.1"),
    });
    expect(kod, vypis).toBe(0);
  });

  it("změna JEN testu bez bumpu projde — konzument test nedostane", () => {
    const { kod, vypis } = branaNad({
      [`packages/${BALICEK}/src/index.test.ts`]: "// jiný test\n",
    });
    expect(kod, `test-only změna neměla vynutit bump:\n${vypis}`).toBe(0);
  });

  it("⛔ `testUtils.ts` NENÍ test — hranice vede podle jména, ne podle záměru", () => {
    const { kod } = branaNad({
      [`packages/${BALICEK}/src/testUtils.ts`]: "export const u = 2;\n",
    });
    expect(kod).toBe(1);
  });

  it("test i kód najednou bez bumpu selže — rozhoduje ten kód", () => {
    const { kod } = branaNad({
      [`packages/${BALICEK}/src/index.test.ts`]: "// jiný test\n",
      [`packages/${BALICEK}/src/index.ts`]: "export const a = 3;\n",
    });
    expect(kod).toBe(1);
  });
});
