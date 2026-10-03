/**
 * Brána: detektor změn musí vědět, že web SPA staví EDGE.
 *
 * PROČ (naměřeno 2026-08-09/10)
 * ----------------------------
 * `scripts/aisha-changed-apps.mjs` mapoval `src/` POUZE na `core` a na `packages/`
 * neměl pravidlo vůbec. Slovo „edge" bylo v celém skriptu jen v komentáři u Rule 8
 * — a ta přidává `core`. Neexistovalo tedy pravidlo, které by na `edge` poslalo
 * cokoli kromě změny jeho vlastního compose souboru.
 *
 * Změřeno na dvou skutečných commitech (původní skript vs. opravený):
 *
 *   #169 barvy `packages/design-language/src/styles.css` → ŽÁDNÁ APPKA → core, edge
 *   #170 razítko revize `vite.config.ts`                 → ŽÁDNÁ APPKA → core, edge
 *
 * Detektor tedy tvrdil „redeploy netřeba" právě u těch dvou změn, jejichž celým
 * smyslem bylo změnit nasazený artefakt.
 *
 * ⭐ TÁŽ MYLNÁ PŘEDSTAVA SEDĚLA NA DVOU MÍSTECH. `ci.yml` posílal signál
 * `INFRA_WEB` (odvozený z `docker-compose.coolify-prebuilt.yml`, tedy z build
 * vstupů edge) do `deploy-core`; opraveno v #174. Tady je stejný omyl podruhé.
 * Následek byl měřitelný: web servíroval bundle starý dva dny.
 *
 * CO JE PRAVDA (naměřeno, ne odhadnuto)
 * -------------------------------------
 * `Dockerfile.web` je JEDINÉ místo v repu, kde běží `vite build`. Používají ho
 * DVA composy — `docker-compose.coolify.yml` (core, služba `web` BEZ `args:`)
 * a `docker-compose.coolify-prebuilt.yml` (edge, s plným `args:`). Živý web
 * servíruje EDGE: v nasazeném bundlu jsou instanční hodnoty (JWT, `api.<tld>`),
 * které se tam dostanou jedině přes build args.
 *
 * JAK SE TO MĚŘÍ
 * --------------
 * Skript se SPUSTÍ nad dočasným gitem, ne aby se v něm hledal text. Hledání
 * řetězce „edge" ve zdrojáku by prošlo i nad komentářem — a přesně takový
 * komentář tam celou dobu byl, zatímco kód dělal něco jiného.
 */
import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { envWithoutGitLocation } from "../../../scripts/lib/git-worktree-health.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const ROOT = process.cwd();
const SKRIPT = join(ROOT, "scripts/aisha-changed-apps.mjs");
const MANIFEST = join(ROOT, "coolify/manifests/aisha.manifest");

let repo: string;

/**
 * Prostředí BEZ zděděných git proměnných.
 *
 * ⛔ NAMĚŘENO 2026-08-10. Brána prošla samostatně, ale v `pre-push` hooku spadla
 * na `git add -A: fatal: this operation must be run in a work tree` — a s ní
 * i tři cizí brány (`anthropic-body-builder`, `dockerignore-vs-dockerfile-copy`,
 * `legacy-domains`), které volají `git grep`.
 *
 * Příčina: **git hookům exportuje `GIT_DIR`** (a `GIT_INDEX_FILE`), a ten zdědí
 * KAŽDÝ `git` spuštěný z hooku — včetně toho, který si tenhle test pouští ve svém
 * dočasném repu. `git init` pak nezaloží nové repo, ale sáhne na to původní, a
 * další příkazy běží proti němu bez work tree.
 *
 * ⚠️ Není to teorie: při ověřování téhle hypotézy jsem `git add -A` se zděděným
 * `GIT_DIR` spustil ručně a zapsal do indexu smazání 11 316 souborů (vráceno
 * `git reset`). Test, který si prostředí nečistí, tedy může cizí repo i ZMĚNIT,
 * ne jen selhat.
 */
const CISTE_PROSTREDI = envWithoutGitLocation();

/** Dočasné repo se skriptem a manifestem — skript si REPO_ROOT odvozuje ze svého umístění. */
beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "detektor-edge-"));
  const git = (...a: string[]) =>
    execFileSync("git", a, { cwd: repo, stdio: "pipe", env: CISTE_PROSTREDI });
  git("init", "-q");
  git("config", "user.email", "gate@test");
  git("config", "user.name", "gate");
  mkdirSync(join(repo, "scripts"), { recursive: true });
  mkdirSync(join(repo, "coolify/manifests"), { recursive: true });
  copyFileSync(SKRIPT, join(repo, "scripts/aisha-changed-apps.mjs"));
  copyFileSync(MANIFEST, join(repo, "coolify/manifests/aisha.manifest"));
  writeFileSync(join(repo, "zaklad.txt"), "x\n");
  git("add", "-A");
  git("commit", "-qm", "zaklad");
});

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

/** Změní `soubor`, zacommituje a vrátí seznam appek, které detektor označil. */
function appkyPro(soubor: string): string[] {
  const git = (...a: string[]) =>
    execFileSync("git", a, { cwd: repo, stdio: "pipe", env: CISTE_PROSTREDI });
  const cesta = join(repo, soubor);
  mkdirSync(dirname(cesta), { recursive: true });
  writeFileSync(cesta, `/* ${soubor} ${Math.random()} */\n`);
  git("add", "-A");
  git("commit", "-qm", `zmena ${soubor}`);
  const out = execFileSync(
    process.execPath,
    [join(repo, "scripts/aisha-changed-apps.mjs"), "--base=HEAD~1", "--head=HEAD", "--json"],
    { cwd: repo, encoding: "utf8", env: CISTE_PROSTREDI }
  );
  return Object.keys(JSON.parse(out).affected_apps).sort();
}

describe("detektor změn zná edge (brána)", () => {
  test("měřidlo funguje — compose edge stacku vede na edge", () => {
    // Rule 1 fungovala vždycky; tenhle test hlídá, že se test HARNESS nerozbil,
    // takže tvrzení níž nejsou vakuová.
    expect(appkyPro("docker-compose.coolify-prebuilt.yml")).toContain("edge");
  });

  test.each([
    ["src/hooks/useBuildInfo.ts", "zdroj SPA"],
    ["packages/design-language/src/styles.css", "designový jazyk — vstup vite buildu"],
    ["vite.config.ts", "konfigurace buildu (define __GIT_SHA__)"],
    ["index.html", "vstupní bod SPA"],
  ])("%s → edge (%s)", (soubor) => {
    const appky = appkyPro(soubor);
    expect(
      appky,
      `změna '${soubor}' se propíše do bundlu, který staví EDGE (Dockerfile.web přes ` +
        `docker-compose.coolify-prebuilt.yml). Když ji detektor na edge nepošle, ` +
        `řekne „redeploy netřeba" a web dál servíruje starý artefakt — přesně tak byl ` +
        `2026-08-09 bundle dva dny starý.`
    ).toContain("edge");
  });

  test("mobil na edge NEVEDE — detektor nesmí nasazovat na potkání", () => {
    // Bez tohohle by šlo tvrzení výš „splnit" tím, že se všechno pošle všude.
    expect(appkyPro("mobile-app/src/app/kroky.tsx")).not.toContain("edge");
  });

  test("gateway zůstává na core, ne na edge", () => {
    const appky = appkyPro("services/gateway/src/routes.ts");
    expect(appky).toContain("core");
    expect(appky).not.toContain("edge");
  });
});


/*
  CO SLUŽBY IMPORTUJÍ, TO MUSÍ SPOUŠTĚT JEJICH ÚLOHU.

  ⛔ NAMĚŘENO 2026-09-05. Filtr `SERVICES_CHANGE` v `ci.yml` zněl
  `^(services/|plugins/|scripts/test/run-service-tests\.mjs)` — bez `packages/`.
  Jenže VŠECH 29 z 29 služeb importuje z `@aisha/*`, tedy z `packages/`.

  Následek: #299 přidalo do `packages/audience-types` povinná pole
  `lineTotal` a `paidDate`, filtr úlohu PŘESKOČIL (skipped = zelená),
  PR se sloučil — a `svc-source-broker` od té chvíle nepřekládá. Vyplavalo
  to až o pět merge později, náhodou, v CI cizího PR.

  ⭐ Filtr měřil, KDE SE EDITOVALO. Vada ale vzniká tam, kam se typ
  PROPAGOVAL. To je táž třída, kterou komentář nad tím filtrem už jednou
  popisuje (2026-07-26, plugin-only PR bez jediného spuštěného testu) —
  jen o patro výš.

  Tenhle test si univerzum HLEDÁ: přečte, z čeho služby doopravdy importují,
  a ověří, že to filtr pokrývá. Přibude-li zítra závislost na dalším
  adresáři, objeví se tu sama.
*/
describe("detektor změn zná, na čem služby stojí (brána)", () => {
  const CI = join(ROOT, "scripts/ci/zmenene-cesty.sh"); // směrování = jeden domov (ci.yml i hook ho volají)

  /** Alternace z filtru SERVICES_CHANGE — čte se ze zmenene-cesty.sh, nepíše se sem. */
  const filtrSluzeb = (): string[] => {
    const zdroj = readFileSync(CI, "utf8");
    const m = zdroj.match(/grep -qE '\^\(([^)]*)\)'[^\n]*SERVICES_CHANGE=true/);
    if (!m) return [];
    return m[1]!.split("|").map((x) => x.trim()).filter(Boolean);
  };

  /** Adresáře, ze kterých služby doopravdy importují (odvozeno ze zdrojů). */
  const zdrojeSluzeb = (): string[] => {
    const dir = join(ROOT, "services");
    const potreba = new Set<string>(["services/"]);
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const src = join(dir, e.name, "src");
      let soubory: string[] = [];
      try {
        soubory = readdirSync(src, { recursive: true } as never) as unknown as string[];
      } catch {
        continue;
      }
      for (const f of soubory) {
        if (!/\.(ts|tsx)$/.test(String(f))) continue;
        let text = "";
        try { text = readFileSync(join(src, String(f)), "utf8"); } catch { continue; }
        if (/@aisha\//.test(text)) potreba.add("packages/");
      }
    }
    return [...potreba];
  };

  test("měřidlo něco najde — jinak je tenhle test slepý", () => {
    // Prázdná množina na kterékoli straně = brána mlčí jako zelená.
    expect(filtrSluzeb().length).toBeGreaterThan(0);
    expect(zdrojeSluzeb().length).toBeGreaterThan(0);
  });

  test("⛔ filtr pokrývá KAŽDÝ adresář, ze kterého služby importují", () => {
    const filtr = filtrSluzeb();
    const chybi = zdrojeSluzeb().filter(
      (dir) => !filtr.some((f) => f === dir || f.startsWith(dir)),
    );
    // ⛔ Zpráva do POROVNÁVANÉ hodnoty, ne do druhého argumentu `expect`.
    expect(chybi).toEqual([]);
    if (chybi.length) {
      throw new Error(
        `Filtr SERVICES_CHANGE nepokrývá: ${chybi.join(", ")}. ` +
          "Změna v takovém adresáři úlohu PŘESKOČÍ (skipped = zelená) a rozbitá " +
          "služba se sloučí — projeví se až při docker build v produkci.",
      );
    }
  });
});
