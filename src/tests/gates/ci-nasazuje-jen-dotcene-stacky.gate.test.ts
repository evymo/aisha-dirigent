/**
 * Core, Edge a Extranet se po merge nasazují PRÁVĚ tehdy, když se jich změna týká
 * — podle detektoru, ne podle hrubých příznaků.
 *
 * ⛔ NAMĚŘENO 2026-09-17: merge #1001 (změna jen docker-compose.coolify-integration.yml
 * + skripty a brány; detektor → `nasadit: {integration}`) spustil v main CI (run 3750)
 * i `Deploy: Core`, `Deploy: Edge` a `Deploy: Extranet`. Jejich podmínky se ptaly
 * na `app == 'true'`, a `app` je pravda pro KAŽDÝ docker-compose*.yml, scripts/,
 * config/… Core se kvůli změně integration znovu nasadil (restart db a gateway),
 * a Edge navíc spadl na „nasazená revize nesedí".
 *
 * ⭐ Brána SPOUŠTÍ skutečný detektor (scripts/aisha-changed-apps.mjs) v dočasném
 * repu se skutečným manifestem a compose soubory, jeho `deploy_apps` dosadí do
 * SKUTEČNÝCH podmínek úloh z .github/workflows/ci.yml a vyhodnotí je
 * (lib/ci-vyraz). Hrubé příznaky nastaví na NEJHORŠÍ případ (`true`), takže
 * relevance na nich záviset nesmí; testovací úlohy jsou zelené.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import yaml from "js-yaml";
import { SVET_S_INSTANCI, vyhodnotit, type Hodnota } from "./lib/ci-vyraz";

const ROOT = process.cwd();
const WF = yaml.load(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
  jobs: Record<string, { if?: string }>;
};
const CISTE_PROSTREDI = { PATH: process.env.PATH ?? "", HOME: tmpdir(), GIT_CONFIG_NOSYSTEM: "1" };
const ULOHY = ["deploy-core", "deploy-edge", "deploy-extranet"] as const;

let repo: string;
const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, stdio: "pipe", env: CISTE_PROSTREDI });

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "ci-dotcene-stacky-"));
  git("init", "-q");
  git("config", "user.email", "gate@test");
  git("config", "user.name", "gate");
  mkdirSync(join(repo, "scripts"), { recursive: true });
  mkdirSync(join(repo, "coolify/manifests"), { recursive: true });
  copyFileSync(join(ROOT, "scripts/aisha-changed-apps.mjs"), join(repo, "scripts/aisha-changed-apps.mjs"));
  copyFileSync(join(ROOT, "coolify/manifests/aisha.manifest"), join(repo, "coolify/manifests/aisha.manifest"));
  for (const f of readdirSync(ROOT).filter((x) => /^docker-compose\.coolify.*\.ya?ml$/.test(x))) {
    copyFileSync(join(ROOT, f), join(repo, f));
  }
  // Dockerfily v kořeni: detektor z nich čte zdroje COPY (i `COPY --from=` z
  // celorepového stupně). Bez nich by brána měřila detektor slepý k obrazům.
  for (const f of readdirSync(ROOT).filter((x) => /^Dockerfile(\..+)?$/.test(x))) {
    copyFileSync(join(ROOT, f), join(repo, f));
  }
  writeFileSync(join(repo, "zaklad.txt"), "x\n");
  git("add", "-A");
  git("commit", "-qm", "zaklad");
});

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

/** Změní soubory jedním commitem a vrátí `deploy_apps` tak, jak ho vydá krok v ci.yml (`,a,b,`). */
function deployApps(soubory: string[]): string {
  for (const soubor of soubory) {
    mkdirSync(dirname(join(repo, soubor)), { recursive: true });
    writeFileSync(join(repo, soubor), `// ${soubor} ${process.hrtime.bigint()}\n`);
  }
  git("add", "-A");
  git("commit", "-qm", `zmena ${soubory.join(" ")}`);
  const out = execFileSync(
    process.execPath,
    [join(repo, "scripts/aisha-changed-apps.mjs"), "--base=HEAD~1", "--head=HEAD", "--json"],
    { cwd: repo, encoding: "utf8", env: CISTE_PROSTREDI },
  );
  return `,${Object.keys(JSON.parse(out).nasadit).sort().join(",")},`;
}

/** Vyhodnotí podmínku úlohy: deploy_apps z detektoru, hrubé příznaky `true`, závislosti zelené. */
function spusti(uloha: string, deployAppsHodnota: string): boolean {
  const vyraz = String(WF.jobs[uloha]?.if ?? "");
  if (!vyraz) throw new Error(`úloha ${uloha} nemá podmínku — brána ztratila předmět`);
  const svet: Record<string, Hodnota> = { ...SVET_S_INSTANCI, "github.event_name": "push", "github.ref": "refs/heads/main" };
  for (const m of vyraz.matchAll(/needs\.([A-Za-z0-9_-]+)\.result/g)) svet[m[0]] = "success";
  for (const m of vyraz.matchAll(/needs\.detect\.outputs\.([A-Za-z0-9_]+)/g)) svet[m[0]] = "true";
  svet["needs.detect.outputs.already_verified"] = "false";
  svet["needs.detect.outputs.deploy_apps"] = deployAppsHodnota;
  return vyhodnotit(vyraz, svet);
}

const SCENARE: Array<{ popis: string; soubory: string[]; ocekavano: Record<(typeof ULOHY)[number], boolean> }> = [
  {
    popis: "⛔ jen compose integration (#1001)",
    soubory: ["docker-compose.coolify-integration.yml"],
    ocekavano: { "deploy-core": false, "deploy-edge": false, "deploy-extranet": false },
  },
  {
    popis: "zdroj webu (src/pages)",
    soubory: ["src/pages/Index.tsx"],
    ocekavano: { "deploy-core": true, "deploy-edge": true, "deploy-extranet": false },
  },
  {
    popis: "shell extranetu (apps/workbench-shell)",
    soubory: ["apps/workbench-shell/src/App.tsx"],
    ocekavano: { "deploy-core": false, "deploy-edge": false, "deploy-extranet": true },
  },
  {
    popis: "SQL funkce (migrace běží z obrazu migrate v core)",
    soubory: ["aisha/db/sql/functions/sonda.sql"],
    ocekavano: { "deploy-core": true, "deploy-edge": false, "deploy-extranet": false },
  },
  {
    popis: "⛔ zdroj plugin-system (#1010 se po merge nenasadil — detektor vydal 0 appek)",
    soubory: ["services/svc-plugin-system/src/server.ts"],
    ocekavano: { "deploy-core": true, "deploy-edge": false, "deploy-extranet": false },
  },
  {
    popis: "⛔ jen skript orchestrace",
    soubory: ["scripts/aisha-cold-start.sh"],
    ocekavano: { "deploy-core": false, "deploy-edge": false, "deploy-extranet": false },
  },
];

describe("CI nasazuje jen dotčené stacky (brána)", () => {
  test("univerzum: úlohy existují a detektor pro změnu integration vydá právě integration", () => {
    for (const u of ULOHY) expect(WF.jobs[u], `úloha ${u} ve workflow není`).toBeTruthy();
    expect(deployApps(["docker-compose.coolify-integration.yml"])).toBe(",integration,");
  });

  test.each(SCENARE)("$popis", ({ soubory, ocekavano }) => {
    const apps = deployApps(soubory);
    const skutecnost = Object.fromEntries(ULOHY.map((u) => [u, spusti(u, apps)]));
    expect(skutecnost, `deploy_apps=${apps}`).toEqual(ocekavano);
  });

  // ⛔ NAMĚŘENO 2026-09-18: sedm Dockerfilů v kořeni (kontext `.`) kopíruje v build
  // stupni celé repo a do finálního obrazu bere `COPY --from=<stupeň>
  // /app/services/<x>/…`. Detektor celorepovou kopii záměrně nesleduje, takže změna
  // kódu těch služeb nenasadila NIC — oprava #1010 zůstala v mainu a nenasadila se.
  // Vlastnost se měří nad VŠEMI takovými Dockerfily, ne nad jedním příkladem:
  // změna ve `services/<x>/src` musí nasadit každou appku, jejíž compose ten
  // Dockerfile staví.
  test("⛔ změna zdroje služby z `COPY --from=<celorepový stupeň>` nasadí appku, která obraz staví", () => {
    const manifest = readFileSync(join(ROOT, "coolify/manifests/aisha.manifest"), "utf8");
    const appPodleCompose = new Map<string, string>();
    for (const m of manifest.matchAll(/^app:\s*([a-z0-9-]+):[a-z-]+:(\S+)/gm)) appPodleCompose.set(m[2], m[1]);

    const ocekavane: Array<{ app: string; sluzba: string; dockerfile: string }> = [];
    for (const [compose, app] of appPodleCompose) {
      let dok: { services?: Record<string, { build?: { context?: string; dockerfile?: string } }> };
      try {
        dok = yaml.load(readFileSync(join(ROOT, compose), "utf8")) as typeof dok;
      } catch {
        continue;
      }
      for (const s of Object.values(dok?.services ?? {})) {
        const b = s?.build;
        if (!b || typeof b !== "object" || (b.context ?? ".") !== "." || !b.dockerfile || b.dockerfile.includes("/")) continue;
        const text = readFileSync(join(ROOT, b.dockerfile), "utf8");
        if (!/^\s*COPY\s+\.\s+\.\s*$/m.test(text)) continue;
        for (const m of text.matchAll(/^\s*COPY\s+--from=\S+\s+.*?\/app\/services\/([a-z0-9-]+)\//gm)) {
          ocekavane.push({ app, sluzba: m[1], dockerfile: b.dockerfile });
        }
      }
    }
    const unikatni = [...new Map(ocekavane.map((o) => [`${o.app}|${o.sluzba}`, o])).values()];
    expect(unikatni.length, "měřidlo nenašlo žádný celorepový Dockerfile — přestalo vidět").toBeGreaterThanOrEqual(4);
    expect(unikatni.map((o) => o.sluzba), "plugin-system (incident #1010) musí být v universu").toContain("svc-plugin-system");

    const vady: string[] = [];
    for (const { app, sluzba, dockerfile } of unikatni) {
      const apps = deployApps([`services/${sluzba}/src/sonda-${sluzba}.ts`]);
      if (!apps.includes(`,${app},`)) vady.push(`services/${sluzba}/src → ${apps} (čekáno ${app}, staví ${dockerfile})`);
    }
    expect(vady, vady.join("\n")).toEqual([]);
  });
});
