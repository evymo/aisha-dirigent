/**
 * Brána: test, který pouští git MIMO kořen repa, nedědí git lokaci volajícího.
 *
 * Git hooky (husky pre-commit / pre-push) exportují `GIT_DIR`, `GIT_INDEX_FILE`,
 * `GIT_WORK_TREE` … a ty zdědí KAŽDÝ potomek. Git je upřednostní před `cwd`,
 * takže `git init/config/add/commit` v „dočasném" repu sáhne na repo, ze kterého
 * se hook spustil. Test tím neměří sebe — a může skutečné repo ZMĚNIT.
 *
 * ⛔ NAMĚŘENO, čtyřikrát, pokaždé jinou škodou:
 *   - 2026-08-05 `scripts/lib/git-worktree-health.mjs`: `rev-parse` se zděděným
 *     `GIT_DIR` zapsal `core.bare false` do configu NADPROJEKTU — push nešel
 *     odbavit z žádného worktree. Odtud sdílený `envWithoutGitLocation()`.
 *   - `detektor-zna-edge`: `git add -A` se zděděným `GIT_DIR` zapsal do indexu
 *     smazání 11 316 souborů (vráceno `git reset`).
 *   - 2026-09-14 `zdrojove-adaptery-z-overlaye`: `git init/add/commit` fixtury
 *     vytvořil commit „overlay" PŘÍMO na větvi, ze které se pushovalo.
 *   - 2026-09-20 `overlay-si-nastroj-obstara-sam` (45bd62a1a, 13:32) přišla bez
 *     ochrany a `git config user.email gate@local` / `user.name gate` zapsala do
 *     SDÍLENÉHO `.git/config` (linked worktrees ho mají společný). Ochrana přišla
 *     ve 23:27 (7b0975fb7); commity všech relací ale nesly autora `gate`, dokud
 *     majitel 2026-09-23 identitu nevrátil.
 * Každý incident se opravil v JEDNOM souboru ručně psanou kopií — a další test
 * na ni zapomněl. Proto brána nad TŘÍDOU, ne nad případem.
 *
 * VLASTNOST: volání gitu, jehož repozitář NENÍ kořen tohohle repa (`cwd` jinam,
 * `git -C <adresář>`, shell s `cd`), musí dostat výslovné `env`, které git lokaci
 * volajícího nenese:
 *   - `envWithoutGitLocation(…)` ze `scripts/lib/git-worktree-health.mjs` (sdílený
 *     helper — žádná další kopie), nebo jméno/IIFE, které z něj vzniká;
 *   - nebo objekt, který `process.env` NEROZBALUJE (minimální prostředí,
 *     výslovně dosazený `GIT_DIR` fixtury je v pořádku — ten nezdědil nic).
 * Volání v kořeni repa (`cwd` z `process.cwd()` / `__dirname`+`..`) se neřeší:
 * zděděný `GIT_DIR` tam ukazuje na totéž repo.
 *
 * UNIVERZUM se hledá chůzí stromem: všechny `.ts` pod `src/tests` a `*.test.ts`
 * pod `services/<služba>/src`. Komentáře a řetězce se vynechají (tokenizérem),
 * aby citace v dokumentaci ani fixtury téhle brány nebyly nálezy.
 *
 * HRANICE: git, který spouští TESTOVANÝ SKRIPT, tahle brána nevidí — to je věc
 * skriptu (viz `git-worktree-health`). Nerozřešitelné výrazy (parametr, cizí
 * funkce) se hodnotí PŘÍSNĚ: bez dokazatelně čistého `env` je to nález.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { envWithoutGitLocation } from "../../../scripts/lib/git-worktree-health.mjs";
import { analyzuj, univerzum } from "./lib/git-v-testech";

const ROOT = process.cwd();

describe("git v testech mimo kořen repa nedědí git lokaci volajícího", () => {
  it("strom: žádné volání gitu mimo kořen bez čistého env (univerzum ze stromu)", () => {
    const vse = univerzum(ROOT);
    expect(vse.length, "univerzum testů je podezřele malé — chůze stromem je slepá").toBeGreaterThan(500);
    let celkem = 0;
    const sGitem = new Set<string>();
    const vady: string[] = [];
    for (const f of vse) {
      const { volani, nalezy } = analyzuj(readFileSync(f, "utf8"), f);
      celkem += volani;
      if (volani) sGitem.add(relative(ROOT, f));
      for (const n of nalezy) vady.push(`${relative(ROOT, f)}:${n.radek} ${n.duvod}`);
    }
    // Prázdné univerzum = brána by prošla tím, že nic nenašla.
    expect(celkem, "nenašlo se skoro žádné volání gitu — detektor je slepý").toBeGreaterThan(50);
    for (const nutny of [
      "src/tests/gates/detektor-zna-edge.gate.test.ts",
      "src/tests/gates/overlay-si-nastroj-obstara-sam.gate.test.ts",
      "src/tests/gates/insight-patches.gate.test.ts",
    ]) {
      expect(sGitem, `${nutny} pouští git v dočasném/cizím repu — musí být v univerzu`).toContain(nutny);
    }
    expect(vady, "git mimo kořen repa dědí GIT_DIR z hooku — dej mu env: envWithoutGitLocation()").toEqual([]);
  });

  describe("negativní sondy: tvar, který git lokaci dědí, MUSÍ být nález", () => {
    const sondy: Array<[string, string]> = [
      ["cwd do dočasného adresáře bez env", `const tmp = mkdtempSync("x"); execFileSync("git", ["init"], { cwd: tmp });`],
      ["env rozbaluje process.env", `execFileSync("git", ["config", "user.name", "gate"], { cwd: tmp, env: { ...process.env } });`],
      ["env je přímo process.env", `spawnSync("git", ["status"], { cwd: dir, env: process.env });`],
      ["git -C z kořene", `const ROOT = process.cwd(); execFileSync("git", ["-C", tmp, "init"], { cwd: ROOT });`],
      ["shell s cd", "execSync(`cd ${tmp} && git init`);"],
      ["bash -c s gitem v cizím cwd", `spawnSync("bash", ["-c", "git init && git add -A"], { cwd: tmp });`],
      ["process.env rozbalené PŘED helperem", `execFileSync("git", ["init"], { cwd: repo, env: { ...process.env, ...envWithoutGitLocation() } });`],
      ["helper s cwd parametrem", `function g(cwd: string, a: string[]) { return execFileSync("git", a, { cwd }); }`],
      ["volby jako nerozřešitelný parametr", `function g(a: string[], o: object) { return execFileSync("git", a, o); }`],
      ["jméno inicializované z process.env", `const E = { ...process.env }; execFileSync("git", ["init"], { cwd: tmp, env: E });`],
      ["alias importu", `import { execFileSync as run } from "node:child_process"; run("git", ["init"], { cwd: tmp });`],
      ["promisify", `const pexec = promisify(execFile); await pexec("git", ["init"], { cwd: tmp });`],
      ["git přes konstantu", `const GIT = "git"; spawnSync(GIT, ["add", "-A"], { cwd: fixtura });`],
      ["git config --global bez vlastního HOME (i v kořeni)", `execFileSync("git", ["config", "--global", "user.name", "x"]);`],
      ["kořen + podadresář není kořen", `const ROOT = process.cwd(); execFileSync("git", ["init"], { cwd: join(ROOT, "fixtures/repo") });`],
    ];
    it.each(sondy)("%s → nález", (_popis, zdroj) => {
      const v = analyzuj(zdroj);
      expect(v.volani, "sonda musí být rozpoznaná jako volání gitu").toBeGreaterThan(0);
      expect(v.nalezy.length).toBeGreaterThan(0);
    });
  });

  describe("pozitivní kontroly: správný tvar nález NENÍ (jinak by šlo bránu splnit zákazem gitu)", () => {
    const kontroly: Array<[string, string, number]> = [
      ["kořen z process.cwd()", `const ROOT = process.cwd(); execFileSync("git", ["ls-files"], { cwd: ROOT });`, 1],
      ["kořen z __dirname + ..", `const KOREN = join(__dirname, "..", "..", ".."); execFileSync("git", ["ls-files"], { cwd: KOREN });`, 1],
      ["bez cwd (kořen procesu)", `execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });`, 1],
      ["dočasné repo s helperem", `execFileSync("git", ["init"], { cwd: tmp, env: envWithoutGitLocation() });`, 1],
      ["jméno z helperu + výslovný GIT_DIR fixtury", `const CISTE = envWithoutGitLocation(); execFileSync("git", ["init"], { cwd: tmp, env: { ...CISTE, GIT_DIR: join(tmp, ".git") } });`, 1],
      ["helper dostane process.env a vyčistí ho", `spawnSync("git", ["status"], { cwd: b, env: envWithoutGitLocation({ ...process.env, GIT_DIR: a }) });`, 1],
      ["minimální prostředí bez rozbalení", `const MIN = { PATH: process.env.PATH ?? "", HOME: tmpdir() }; spawnSync("git", ["init"], { cwd: tmp, env: MIN });`, 1],
      ["IIFE nad helperem", `const C = (() => { const e = envWithoutGitLocation(); delete e.X; return e; })(); execFileSync("git", ["init"], { cwd: d, env: C });`, 1],
      ["jen v komentáři", `// execFileSync("git", ["init"], { cwd: tmp })\n/* spawnSync("git", ["add"], { cwd: tmp }) */`, 0],
      ["jen v řetězci", `const s = 'execFileSync("git", ["init"], { cwd: tmp })'; const t = \`spawnSync("git", [], { cwd: tmp })\`;`, 0],
      ["regex s uvozovkou před voláním", `const R = /["'\`]git/; execFileSync("git", ["init"], { cwd: tmp, env: envWithoutGitLocation() });`, 1],
      ["git config --global s vlastním HOME", `execFileSync("git", ["config", "--global", "user.name", "x"], { cwd: tmp, env: { ...envWithoutGitLocation(), HOME: tmp } });`, 1],
      ["alias s čistým env", `import { spawnSync as s } from "node:child_process"; s("git", ["init"], { cwd: tmp, env: envWithoutGitLocation() });`, 1],
    ];
    it.each(kontroly)("%s → bez nálezu", (_popis, zdroj, ocekavanaVolani) => {
      const v = analyzuj(zdroj);
      expect(v.volani, "počet rozpoznaných volání gitu").toBe(ocekavanaVolani);
      expect(v.nalezy).toEqual([]);
    });
  });

  it("kořen importovaný z relativního modulu se rozřeší (jinak falešný nález)", () => {
    // Tvar ze stromu: `import { ROOT } from "./lib/jmena-instanci"`, kde
    // `export const ROOT = join(__dirname, "../../../..")`. Bez rozřešení importu
    // by `cwd: ROOT` vypadal jako cizí adresář.
    const d = mkdtempSync(join(tmpdir(), "git-import-"));
    try {
      writeFileSync(join(d, "koren.ts"), `export const ROOT = join(__dirname, "..", "..");\nexport const CIZI = join(__dirname, "fixtura");\n`);
      const test = join(d, "brana.test.ts");
      writeFileSync(test, `import { ROOT } from "./koren";\nexecFileSync("git", ["ls-files"], { cwd: ROOT });\n`);
      const ok = analyzuj(readFileSync(test, "utf8"), test);
      expect(ok.volani).toBe(1);
      expect(ok.nalezy, "importovaný kořen musí být kořen").toEqual([]);
      // Kontrolní vzorek: importované jméno, které kořen NENÍ, nález dát musí.
      writeFileSync(test, `import { CIZI } from "./koren";\nexecFileSync("git", ["init"], { cwd: CIZI });\n`);
      expect(analyzuj(readFileSync(test, "utf8"), test).nalezy.length).toBe(1);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("git o úroveň níž (node/bash/npx v cizím cwd se zděděnou git lokací) nepřibývá (ráčna)", () => {
    // Co skript v podprocesu udělá, odtud vidět není — může si git pustit sám
    // (revize cheers, RIQi, RIQ Driver). Proto ráčna, ne zákaz: 10 výskytů
    // změřeno 2026-09-23; nový se má spouštět s env: envWithoutGitLocation(…).
    // 2026-09-26, sync <fork> → upstream: 10 → 9. Z forku přišly 3 výskyty
    // (ci-nasazuje-podle-vln, kid-appky-plyne-ze-slugu 2×), všechny převedeny na
    // envWithoutGitLocation; změřeno nad sloučeným stromem: 9.
    const RACNA = 9;
    const vse = univerzum(ROOT);
    const tranz: string[] = [];
    for (const f of vse) for (const t of analyzuj(readFileSync(f, "utf8"), f).tranzitivni) tranz.push(`${relative(ROOT, f)}:${t.radek} ${t.duvod}`);
    // Sonda: detektor tranzitivních tvarů není slepý.
    expect(analyzuj(`spawnSync("node", ["skript.mjs"], { cwd: tmp });`).tranzitivni.length).toBe(1);
    expect(analyzuj(`spawnSync("node", ["skript.mjs"], { cwd: tmp, env: envWithoutGitLocation() });`).tranzitivni.length).toBe(0);
    expect(tranz.length, `podprocesů v cizím cwd se zděděnou git lokací: ${tranz.length}, ráčna ${RACNA}. Nový spusť s env: envWithoutGitLocation(…); ubylo-li, sniž RACNA.\n${tranz.join("\n")}`).toBeLessThanOrEqual(RACNA);
  });

  it("CHOVÁNÍ: zděděný GIT_DIR zapíše do cizího repa; envWithoutGitLocation to zastaví", () => {
    // Dvě dočasná repa: A hraje „repo, ze kterého se hook spustil", B fixturu.
    const a = mkdtempSync(join(tmpdir(), "git-lokace-a-"));
    const b = mkdtempSync(join(tmpdir(), "git-lokace-b-"));
    try {
      for (const d of [a, b]) execFileSync("git", ["init", "--quiet"], { cwd: d, env: envWithoutGitLocation() });
      const config = (d: string) => readFileSync(join(d, ".git", "config"), "utf8");

      // Tvar incidentu: cwd míří na B, ale v prostředí je GIT_DIR z A.
      execFileSync("git", ["config", "user.name", "zdedene-prostredi"], {
        cwd: b,
        env: { ...envWithoutGitLocation(), GIT_DIR: join(a, ".git") },
      });
      expect(config(a), "zděděný GIT_DIR musí zapsat do A — jinak sonda nic nedokazuje").toContain("zdedene-prostredi");
      expect(config(b)).not.toContain("zdedene-prostredi");

      // Oprava: helper dostane totéž prostředí a git lokaci z něj odstraní.
      execFileSync("git", ["config", "user.name", "ciste-prostredi"], {
        cwd: b,
        env: envWithoutGitLocation({ ...process.env, GIT_DIR: join(a, ".git") }),
      });
      expect(config(b), "s helperem musí git zapsat do repa v cwd").toContain("ciste-prostredi");
      expect(config(a), "s helperem nesmí git sáhnout na A").not.toContain("ciste-prostredi");
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });
});
