/**
 * Brána: posun submodulu nasazuje KONZUMENTA submodulu, ne core a edge.
 *
 * ⛔ NAMĚŘENO 2026-09-14
 * ---------------------
 * Merge #347 posunul jen gitlink `packages/local-ingest` (Python engine ingestu).
 * Detektor ho podle pravidla „`packages/` = vstup vite buildu" poslal na CORE a EDGE
 * a hrubý příznak `app` v ci.yml spustil `Deploy: Core` — tedy přestavbu databáze.
 * Appka, která se skutečně měnila (`local-ingest`), v seznamu nebyla vůbec.
 * Rozdílové přehrání 250 mergů na main: stejně dopadly právě dva commity, oba bumpy
 * ingestu (#343, #347); ostatních 248 rozhodnutí se nezměnilo.
 *
 * ⭐ CO JE PRAVDA
 * Submodul (`.gitmodules`) je cizí repo. Do obrazu ho kopíruje konkrétní Dockerfile
 * (`COPY packages/local-ingest/src/ src/`) — to je zapsaný vlastník, čte se.
 *
 * ⛔ NAMĚŘENO 2026-09-27
 * ---------------------
 * Posun `packages/local-ingest` (4e0044392, engine #110) šel do `affected_apps`, ale ne
 * do `nasadit` — CI nasazuje podle `nasadit` (od 16. 9.), takže konzument skončil
 * v `jen_kontrakt` („dorovná cold-start") a po merge se NENASADIL. Brána hlídala jen
 * `affected_apps`; teď měří i seznam, podle kterého CI opravdu nasazuje.
 *
 * JAK SE TO MĚŘÍ
 * Obě poloviny se SPOUŠTĚJÍ: detektor nad dočasným gitem se skutečným manifestem,
 * composy a Dockerfily; směrovač `app` z ci.yml se vyřízne a pustí v bashi.
 * Kontrolní vzorky hlídají, že oprava neudělala z „všechno všude" „nic nikde".
 */
import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { envWithoutGitLocation } from "../../../scripts/lib/git-worktree-health.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { vzoryWorkspaces, workspaceAdresare } from "./lib/workspaces";

const ROOT = process.cwd();
// git hooky exportují GIT_DIR — dočasné repo by jinak sáhlo na to skutečné (viz detektor-zna-edge)
const CISTE_PROSTREDI = envWithoutGitLocation();

const submoduly = (): string[] =>
  [...readFileSync(join(ROOT, ".gitmodules"), "utf8").matchAll(/^\s*path\s*=\s*(\S+)\s*$/gm)].map((m) => m[1]);

let repo: string;
const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, stdio: "pipe", env: CISTE_PROSTREDI, encoding: "utf8" });

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "submodul-detektor-"));
  git("init", "-q");
  git("config", "user.email", "gate@test");
  git("config", "user.name", "gate");
  const kopie = ["scripts/aisha-changed-apps.mjs", "coolify/manifests/aisha.manifest", ".gitmodules",
    ...readdirSync(ROOT).filter((f) => /^docker-compose\.coolify.*\.ya?ml$/.test(f) || /^Dockerfile/.test(f))];
  for (const f of kopie) {
    mkdirSync(dirname(join(repo, f)), { recursive: true });
    copyFileSync(join(ROOT, f), join(repo, f));
  }
  // `git add -A` až PŘED gitlinky: adresáře submodulů ve worktree nejsou, takže by je
  // add -A ze základu vyhodil jako smazané a posun by pak nebylo z čeho měřit.
  git("add", "-A");
  for (const s of submoduly()) git("update-index", "--add", "--cacheinfo", `160000,${"a".repeat(40)},${s}`);
  git("commit", "-qm", "zaklad");
});

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

function detektor(): { affected: string[]; nasadit: string[]; jenKontrakt: string[]; bezKonzumenta: string[] } {
  const out = execFileSync(process.execPath,
    [join(repo, "scripts/aisha-changed-apps.mjs"), "--base=HEAD~1", "--head=HEAD", "--json"],
    { cwd: repo, encoding: "utf8", env: CISTE_PROSTREDI });
  const d = JSON.parse(out);
  return {
    affected: Object.keys(d.affected_apps).sort(),
    // `nasadit` čte ci.yml (krok deploy_apps) — to, co CI po merge OPRAVDU nasadí.
    nasadit: Object.keys(d.nasadit).sort(),
    jenKontrakt: Object.keys(d.jen_kontrakt).sort(),
    bezKonzumenta: d.unowned_submodules,
  };
}

function posunSubmodul(cesta: string, znak: string): void {
  git("update-index", "--add", "--cacheinfo", `160000,${znak.repeat(40)},${cesta}`);
  git("commit", "-qm", `posun ${cesta}`);
}

function zmenSoubor(cesta: string): void {
  mkdirSync(dirname(join(repo, cesta)), { recursive: true });
  writeFileSync(join(repo, cesta), `/* ${Math.random()} */\n`);
  git("add", "--", cesta);   // ne -A: smazal by gitlinky submodulů
  git("commit", "-qm", `zmena ${cesta}`);
}

describe("detektor: posun submodulu → konzument, ne core/edge", () => {
  test("měřidlo funguje — univerzum submodulů není prázdné a obsahuje ingest", () => {
    expect(submoduly()).toContain("packages/local-ingest");
  });

  test("posun packages/local-ingest → jen local-ingest, a CI ho NASADÍ (stavba, ne kontrakt)", () => {
    posunSubmodul("packages/local-ingest", "b");
    const { affected, nasadit, jenKontrakt, bezKonzumenta } = detektor();
    expect(affected).toEqual(["local-ingest"]);
    expect({ nasadit, jenKontrakt }).toEqual({ nasadit: ["local-ingest"], jenKontrakt: [] });
    expect(bezKonzumenta).toEqual([]);
  });

  test("každý submodul má v manifestu konzumenta a nevede na core ani edge", () => {
    let znak = "c";
    for (const s of submoduly()) {
      posunSubmodul(s, znak);
      znak = String.fromCharCode(znak.charCodeAt(0) + 1);
      const { affected, nasadit, bezKonzumenta } = detektor();
      expect(bezKonzumenta, `${s}: detektor nenašel Dockerfile, který ho kopíruje`).toEqual([]);
      expect(affected.length, `${s}: posun nevede nikam`).toBeGreaterThan(0);
      expect(nasadit, `${s}: konzument se musí po merge NASADIT, ne čekat na cold-start`).toEqual(affected);
      expect(affected, `${s}: submodul není vstup vite buildu`).not.toContain("core");
      expect(affected).not.toContain("edge");
    }
  });

  test("kontrolní vzorek: npm balík webu dál vede na edge i core", () => {
    zmenSoubor("packages/design-language/src/styles.css");
    const { affected } = detektor();
    expect(affected).toContain("edge");
    expect(affected).toContain("core");
  });
});

/**
 * Směrovač `app` = scripts/ci/zmenene-cesty.sh (JEDEN DOMOV od 2026-09-25: volá ho
 * ci.yml i pre-push hook, dřív se sem vyřezával z ci.yml). Vrací příznak `app` a to,
 * zda sebekontrola směrování souhlasila (skript končí 1 při rozporu).
 */
function smerovacApp(changed: string): { APP: string; souhlasi: boolean } {
  const r = spawnSync("bash", [join(ROOT, "scripts/ci/zmenene-cesty.sh")], {
    cwd: ROOT, encoding: "utf8", input: changed,
  });
  const m = (r.stdout ?? "").match(/^app=(true|false)$/m);
  if (r.status !== 0) return { APP: m?.[1] ?? "?", souhlasi: false };
  if (!m) throw new Error(`směrovač nic nevypsal: ${r.stdout}\n${r.stderr}`);
  return { APP: m[1]!, souhlasi: true };
}

describe("směrování: posun submodulu nerozsvítí app (testy webu + Deploy Core/Edge)", () => {
  // Submodul, který je ZDROJEM npm workspaces (extranet SDK), vstupem buildu JE —
  // jeho posun app rozsvítit musí. Pozná se z deklarace workspaces, ne ze seznamu.
  const zdrojeWorkspaces = (): string[] => {
    const workspacy = workspaceAdresare(vzoryWorkspaces(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))), ROOT);
    return submoduly().filter((s) => workspacy.some((w) => w.startsWith(`${s}/`)));
  };

  test.skipIf(!existsSync(join(ROOT, ".gitmodules")))("posun samotného submodulu: app=false a sebekontrola souhlasí", () => {
    const zdroje = zdrojeWorkspaces();
    for (const s of submoduly().filter((s) => !zdroje.includes(s))) {
      expect(smerovacApp(s), s).toEqual({ APP: "false", souhlasi: true });
    }
  });

  test.skipIf(!existsSync(join(ROOT, ".gitmodules")))("posun submodulu, který je zdrojem workspaces: app=true", () => {
    for (const s of zdrojeWorkspaces()) expect(smerovacApp(s), s).toEqual({ APP: "true", souhlasi: true });
  });

  test("submodul spolu se zdrojem webu: app=true", () => {
    expect(smerovacApp("packages/local-ingest\nsrc/App.tsx")).toEqual({ APP: "true", souhlasi: true });
  });

  test("kontrolní vzorek: npm balík i podobně pojmenovaný adresář dál rozsvítí app", () => {
    expect(smerovacApp("packages/design-tokens/build.mjs")).toEqual({ APP: "true", souhlasi: true });
    expect(smerovacApp("packages/local-ingest-kopie/x.ts")).toEqual({ APP: "true", souhlasi: true });
  });
});
