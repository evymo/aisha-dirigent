/**
 * Gate: preflight opraví `core.bare`, když ho vlastní krok rozbije.
 *
 * PROČ (změřeno 2026-08-04, třikrát po sobě odmítnutý push)
 * ---------------------------------------------------------
 * `git submodule update --init --recursive`, který `scripts/test/stack-smoke.mjs`
 * v čerstvém linked worktree pouští, přepsal `.git/config` NADPROJEKTU na
 * `bare = true`. Od té chvíle `git rev-parse --is-inside-work-tree` vrací `false`
 * a `git grep` končí `fatal: this operation must be run in a work tree` — takže
 * spadly všechny brány, které si univerzum HLEDAJÍ přes git.
 *
 * Výsledek: `pre-push` odmítl push kvůli „regresi", kterou si o dvě fáze výš sám
 * vyrobil. Ruční `npm run test:gates` přitom hlásil 6303/6303 zeleně, protože se
 * pouštěl bez toho kroku — zelená a červená se střídaly podle toho, co běželo
 * předtím, což je nejhorší možný tvar vady v měřidle.
 *
 * Hermetický test: staví vlastní repozitář v tmpdir, rozbije mu `core.bare` a
 * ověří opravu. Tím zůstává platný i poté, co konkrétní stroj, na kterém se to
 * stalo, dávno neexistuje.
 *
 * CO SE ZÁMĚRNĚ NEKONTROLUJE
 * --------------------------
 * Jestli `git submodule update` tu konfiguraci rozbije PRÁVĚ TEĎ — to je chování
 * konkrétní verze gitu a měnilo by se pod námi. Kontroluje se vlastnost:
 * repozitář s pracovním stromem není označený jako bare, a preflight to umí
 * napravit.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  ensureNotBare,
  envWithoutGitLocation,
} from "../../../scripts/lib/git-worktree-health.mjs";

const ROOT = resolve(__dirname, "../../..");

/**
 * Tmpdir repozitáře jsou hermetické jen tehdy, když git neposlouchá `GIT_DIR`
 * ze svého okolí. Pod `pre-push` je nastavený VŽDY, takže bez tohohle by test
 * mířil na skutečný repozitář a hlásil vadu, která v měřeném kódu není.
 */
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    env: envWithoutGitLocation(),
  }).trim();
}

let repo: string;
let bareRepo: string;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "wt-health-"));
  git(repo, ["init", "-q"]);
  // package.json je znak pracovního stromu — helper se ptá SOUBORŮ, ne configu.
  writeFileSync(join(repo, "package.json"), "{}\n");

  bareRepo = mkdtempSync(join(tmpdir(), "wt-health-bare-"));
  git(bareRepo, ["init", "-q", "--bare"]);
});

afterAll(() => {
  for (const d of [repo, bareRepo]) rmSync(d, { recursive: true, force: true });
});

describe("git worktree health", () => {
  it("zdravý repozitář nechá být (idempotence)", () => {
    const r = ensureNotBare(repo);
    expect(r.repaired).toBe(false);
    expect(git(repo, ["rev-parse", "--is-inside-work-tree"])).toBe("true");
  });

  it("core.bare=true nad pracovním stromem opraví a ohlásí", () => {
    git(repo, ["config", "core.bare", "true"]);
    expect(git(repo, ["rev-parse", "--is-inside-work-tree"])).toBe("false");

    const r = ensureNotBare(repo);

    expect(r.repaired).toBe(true);
    expect(git(repo, ["rev-parse", "--is-inside-work-tree"])).toBe("true");
    // A po opravě musí zase fungovat to, kvůli čemu to celé bylo.
    expect(() => git(repo, ["grep", "-l", "nothing"])).not.toThrow(
      /must be run in a work tree/,
    );
  });

  it("SKUTEČNĚ bare repozitář neopravuje — to by nebyla oprava, ale škoda", () => {
    const r = ensureNotBare(bareRepo);
    expect(r.repaired).toBe(false);
  });

  it("preflight kontroluje BEZPODMÍNEČNĚ, ne jen když sám pouštěl submodule", () => {
    // MĚŘENO 2026-08-05: volání bylo schované uvnitř větve „submoduly chybí,
    // doinicializuj je". `core.bare=true` ale běh PŘEŽIJE — nastaví ho jakýkoli
    // dřívější `git submodule update` (minulý push, jiná session). Pak se šlo
    // `else` větví, kontrola se nespustila a repozitář zůstal rozbitý.
    //
    // Sebeudržující smyčka: jednou rozbité ⇒ každý další push padá na bránách,
    // které si univerzum hledají přes git, a preflight to nikdy neopraví,
    // protože submoduly UŽ inicializované jsou. Změřeno: preflight ohlásil
    // „✓ preflight" nad repozitářem, kde core.bare zůstalo true.
    //
    // Vlastnost, ne pravopis: kontrola musí stát PŘED rozcestníkem submodulů,
    // takže se do žádné jeho větve nedá schovat.
    const smoke = readFileSync(resolve(ROOT, "scripts/test/stack-smoke.mjs"), "utf-8");
    const preflight = smoke.slice(smoke.indexOf("function phasePreflight"));
    const call = preflight.indexOf("ensureNotBare(");
    const branch = preflight.indexOf("submoduleInit");

    expect(call, "phasePreflight musí ensureNotBare vůbec volat").toBeGreaterThan(-1);
    expect(branch, "harness hledá rozcestník submodulů — přejmenoval se?").toBeGreaterThan(-1);
    expect(
      call,
      "ensureNotBare se volá až za rozcestníkem submodulů, takže na `else` větvi " +
        "(submoduly už inicializované) neproběhne — a právě tam se rozbitý core.bare " +
        "přenáší z běhu na běh:",
    ).toBeLessThan(branch);
  });

  it("argument je autorita i s exportovaným GIT_DIR — tak ho vidí každý hook", () => {
    // MĚŘENO 2026-08-05: pod `pre-push` je GIT_DIR nastavený vždycky. Dokud se
    // git volal se zděděným prostředím, odpovídal za NĚJ a `root` se ignoroval:
    // helper prohlásil zdravý strom za nepracovní a `core.bare false` zapsal
    // jinam. Push pak nešel odbavit z žádného worktree — a padalo to na bráně,
    // se kterou neměla měřená změna nic společného.
    const previous = process.env.GIT_DIR;
    process.env.GIT_DIR = bareRepo; // cizí repozitář = to, co hook podstrčí
    try {
      expect(ensureNotBare(repo).repaired).toBe(false);
      // A nesmí to odnést ten podstrčený: bare repozitář zůstane bare.
      expect(ensureNotBare(bareRepo).repaired).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = previous;
    }
  });

  it("preflight tu kontrolu opravdu volá i PO submodule kroku", () => {
    // Bez tohohle by helper mohl být dokonalý a nikdy se nespustit.
    //
    // Hledá se výskyt ZA tím krokem, ne první výskyt v souboru: od 2026-08-05
    // se ensureNotBare volá i před rozcestníkem submodulů (viz test výš), takže
    // „první výskyt je až za krokem" by bylo tvrzení o pravopisu, ne o
    // vlastnosti — a shodilo by právě tu opravu, kvůli které vznikl. Vlastnost
    // je: submodulový krok umí core.bare rozbít, takže po něm MUSÍ následovat
    // kontrola.
    const smoke = readFileSync(resolve(ROOT, "scripts/test/stack-smoke.mjs"), "utf-8");
    expect(smoke).toMatch(/import \{ ensureNotBare \}/);
    const submoduleAt = smoke.indexOf("'submodule', 'update', '--init'");
    expect(submoduleAt).toBeGreaterThan(0);
    const repairAfter = smoke.indexOf("ensureNotBare(ROOT)", submoduleAt);
    expect(
      repairAfter,
      "za `git submodule update --init` nenásleduje ensureNotBare — ten krok umí " +
        "core.bare rozbít, takže by si preflight vyrobil regresi a ohlásil ji o fázi níž",
    ).toBeGreaterThan(submoduleAt);
  });
});
