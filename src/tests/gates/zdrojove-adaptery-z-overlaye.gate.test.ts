/**
 * Brána: zdrojové adaptéry brokeru přicházejí z instančního overlaye, ne z jádra forku
 *
 * ⛔ NAMĚŘENO 2026-09-14 na nasazeném forku. Model „fork si adaptér přidá jako
 * workspace a doplní si build krok do Dockerfile.svc-source-broker" nutil fork
 * nést v jádře jméno instance — plugin, workspace, řádky Dockerfilu. Brána
 * stack-nesmi-znat-jmeno-instance tam našla 62 výskytů a push forku neprošel.
 *
 * Adaptér teď žije v instančním repu v `source-adapters/<jméno>/` a build brokeru
 * ho klonuje — táž dráha jako téma Keycloaku. Tahle brána drží celou cestu:
 *
 *   1. stage `source-adapters` (SPUŠTĚNÍM jeho shellu nad lokálním git repem):
 *      bez URL přeskočí; URL bez cachebustu SPADNE; selhaný klon SPADNE;
 *      overlay bez `source-adapters/` = instance adaptéry nedeklaruje (projde,
 *      prázdné); s adaptéry je zkopíruje
 *   2. build smyčka (SPUŠTĚNÍM): adaptér bez package-lock.json build ZASTAVÍ;
 *      s ním proběhne ci → build → prune a vznikne dist/
 *   3. token: jen BuildKit secretem, nikdy ARG; sync ho doručí (compose-env-refs
 *      vidí `secrets: … environment:`) — naměřeno 2026-09-14, že dosud NEVIDĚL
 *   4. URL a ref odvozuje env-doktor z deklarace overlaye BEZ přihlašovacích údajů
 *   5. cachebust: overlay-cachebust.sh doplní token do URL bez něj; redeploy ho
 *      počítá AŽ ZA env-doktorem (jinak první nasazení najde URL prázdnou a build
 *      na fail-closed kontrole spadne); CI cesta a cold-start ho znají
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { envWithoutGitLocation } from "../../../scripts/lib/git-worktree-health.mjs";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { referenceCompose, jmenaReferenci } from "../../../scripts/lib/compose-env-refs.mjs";
import { RESOLVER_ENV_INPUTS } from "../../../scripts/lib/derive-domains.mjs";
import { DECLARATION_ENV, OVERLAY_ENV, REQUIRED_ENV } from "../../../scripts/lib/instance-overlay.mjs";

const ROOT = process.cwd();
const DOCKERFILE = readFileSync(join(ROOT, "Dockerfile.svc-source-broker"), "utf8");
const COMPOSE = join(ROOT, "docker-compose.coolify-source-broker.yml");
const REDEPLOY = readFileSync(join(ROOT, "scripts/aisha-redeploy.mjs"), "utf8");

const HESLO = "NEVYPISOVAT-heslo-z-url";

/**
 * Tělo `RUN` instrukce, která začíná daným prefixem, jako shellový skript —
 * pokračovací řádky spojené přesně jako je spojí Docker (`\` + nový řádek).
 */
function runSkript(zacatek: string): string {
  const i = DOCKERFILE.indexOf(zacatek);
  expect(i, `instrukce „${zacatek}" v Dockerfile.svc-source-broker není`).toBeGreaterThan(-1);
  const radky: string[] = [];
  for (const radek of DOCKERFILE.slice(i).split("\n")) {
    radky.push(radek.replace(/\\$/, ""));
    if (!radek.endsWith("\\")) break;
  }
  // Docker `\` + nový řádek ZAHODÍ (spojí do jednoho logického řádku) — spojit
  // novým řádkem by z `|| {` na začátku řádku udělalo syntaktickou chybu.
  return radky.join("").replace(/^RUN (--mount=\S+\s*)?/, "");
}

/** Absolutní cesty obrazu → temp strom (na hostiteli do / psát nejde). */
const doTempu = (skript: string, koren: string) =>
  skript
    .split("/run/secrets/").join(`${koren}/secrets/`)
    .split("/tmp/overlay").join(`${koren}/overlay`)
    .split("/app/source-adapters").join(`${koren}/app-adapters`)
    .split("/adapters").join(`${koren}/adapters`);

/**
 * Git v dočasném repu běží s `envWithoutGitLocation()` (sdílený helper).
 *
 * ⛔ NAMĚŘENO 2026-09-14 na TÉHLE bráně: husky v pre-push exportuje GIT_DIR,
 * git ho upřednostní před `cwd`, a `git init/add -A/commit` „dočasného" repa
 * tak vytvořil commit „overlay" se dvěma soubory PŘÍMO na větvi, ze které se
 * pushovalo. Push byl zastaven dřív, než cokoli odeslal; test níž to drží.
 * Třídu hlídá brána git-v-testech-bez-prostredi.
 */

function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", ["-c", "user.email=brana@example.invalid", "-c", "user.name=brana", ...args], { cwd, encoding: "utf8", env: envWithoutGitLocation() });
  expect(r.status, r.stderr).toBe(0);
}

/** Lokální overlay repo (volitelně s adaptérem) — klon jde přes file://, bez sítě. */
function overlayRepo(sAdapterem: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "aisha-adapter-overlay-"));
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "README.md"), "overlay\n");
  if (sAdapterem) {
    mkdirSync(join(dir, "source-adapters/zkusebni-zdroj"), { recursive: true });
    writeFileSync(join(dir, "source-adapters/zkusebni-zdroj/package.json"), '{"name":"zkusebni-zdroj"}\n');
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "overlay");
  return dir;
}

describe("zdrojové adaptéry z instančního overlaye", () => {
  test("dočasné repo brány nesáhne na repo, které má v prostředí git hook (GIT_DIR)", () => {
    const navnada = mkdtempSync(join(tmpdir(), "aisha-adapter-navnada-"));
    git(navnada, "init", "-q", "-b", "main");
    writeFileSync(join(navnada, "soubor"), "navnada\n");
    git(navnada, "add", "-A");
    git(navnada, "commit", "-q", "-m", "navnada");
    const head = () => spawnSync("git", ["rev-parse", "HEAD"], { cwd: navnada, encoding: "utf8", env: envWithoutGitLocation() }).stdout.trim();
    const pred = head();
    const puvodni = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
    process.env.GIT_DIR = join(navnada, ".git");
    process.env.GIT_WORK_TREE = navnada;
    try {
      overlayRepo(true);
    } finally {
      for (const [k, v] of Object.entries(puvodni)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    expect(head(), "overlayRepo() commitnul do repa z GIT_DIR — přesně to se stalo v pre-push 2026-09-14").toBe(pred);
  });

  describe("stage source-adapters (spuštěním)", () => {
    function stage(args: Record<string, string>) {
      const koren = mkdtempSync(join(tmpdir(), "aisha-adapter-stage-"));
      const skript = doTempu(runSkript("RUN --mount=type=secret,id=forgejo_token"), koren);
      const r = spawnSync("sh", ["-c", `apk() { return 0; }\n${skript}`], {
        encoding: "utf8",
        env: { PATH: process.env.PATH, HOME: process.env.HOME, SOURCE_ADAPTER_OVERLAY_PATH: "source-adapters", ...args },
      });
      const adaptery = existsSync(join(koren, "adapters")) ? readdirSync(join(koren, "adapters")) : null;
      return { r, adaptery, vystup: `${r.stdout}${r.stderr}` };
    }

    test("bez URL přeskočí a obraz adaptéry nenese", () => {
      const { r, adaptery } = stage({});
      expect(r.status, r.stderr).toBe(0);
      expect(adaptery).toEqual([]);
    });

    test("URL bez cachebustu build ZASTAVÍ (klon by se zakešoval z prvního buildu)", () => {
      const { r } = stage({ SOURCE_ADAPTER_OVERLAY_GIT_URL: `file://${overlayRepo(true)}` });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/CACHEBUST prázdné/);
    });

    test("selhaný klon build ZASTAVÍ", () => {
      const { r } = stage({ SOURCE_ADAPTER_OVERLAY_GIT_URL: "file:///neexistuje/repo.git", SOURCE_ADAPTER_OVERLAY_CACHEBUST: "x" });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/klon instančního repa selhal/);
    });

    test("overlay s adaptérem → zkopírován; bez adresáře → instance nedeklaruje, projde prázdné", () => {
      const s = stage({ SOURCE_ADAPTER_OVERLAY_GIT_URL: `file://${overlayRepo(true)}`, SOURCE_ADAPTER_OVERLAY_CACHEBUST: "sha1" });
      expect(s.r.status, s.vystup).toBe(0);
      expect(s.adaptery).toEqual(["zkusebni-zdroj"]);

      const bez = stage({ SOURCE_ADAPTER_OVERLAY_GIT_URL: `file://${overlayRepo(false)}`, SOURCE_ADAPTER_OVERLAY_CACHEBUST: "sha1" });
      expect(bez.r.status, bez.vystup).toBe(0);
      expect(bez.adaptery).toEqual([]);
      expect(bez.r.stdout).toMatch(/adaptéry nedeklaruje/);
    });
  });

  describe("build smyčka adaptérů (spuštěním, npm podvržen)", () => {
    function smycka(sLockfilem: boolean) {
      const koren = mkdtempSync(join(tmpdir(), "aisha-adapter-build-"));
      const adapter = join(koren, "app-adapters/zkusebni-zdroj");
      mkdirSync(adapter, { recursive: true });
      writeFileSync(join(adapter, "package.json"), "{}\n");
      if (sLockfilem) writeFileSync(join(adapter, "package-lock.json"), "{}\n");
      const skript = doTempu(runSkript("RUN for d in /app/source-adapters/*/"), koren);
      // npm = záznam volání; `run build` vyrobí dist/ jako skutečný tsc.
      const npm = `npm() { echo "npm $*" >> "${koren}/npm.log"; [ "$1 $2" = "run build" ] && mkdir -p dist; return 0; }`;
      const r = spawnSync("sh", ["-c", `${npm}\n${skript}`], { encoding: "utf8" });
      const log = existsSync(join(koren, "npm.log")) ? readFileSync(join(koren, "npm.log"), "utf8") : "";
      return { r, log, dist: existsSync(join(adapter, "dist")) };
    }

    test("adaptér bez package-lock.json build ZASTAVÍ", () => {
      const { r, log } = smycka(false);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/package-lock\.json/);
      expect(log, "npm se nesmí ani spustit — `npm install` by vyrobil strom, který nikdo nezkontroloval").toBe("");
    });

    test("s lockfilem: ci → build → prune, a vznikne dist/", () => {
      const { r, log, dist } = smycka(true);
      expect(r.status, r.stderr).toBe(0);
      expect(log.trim().split("\n").map((l) => l.split(" ").slice(0, 3).join(" "))).toEqual(["npm ci --include=dev", "npm run build", "npm prune --omit=dev"]);
      expect(dist).toBe(true);
      expect(
        log,
        "kontrakt (@aisha/audience-types) je peer — adaptér se má překládat proti tomu z obrazu brokeru,\n" +
          "ne proti kopii z registru zamčené v jeho lockfilu",
      ).toMatch(/^npm ci .*--omit=peer/m);
    });
  });

  describe("token a doručení", () => {
    test("FORGEJO_TOKEN nikdy jako ARG — jen BuildKit secret", () => {
      expect(DOCKERFILE).not.toMatch(/^ARG\s+FORGEJO_TOKEN/m);
      expect(DOCKERFILE).toMatch(/RUN --mount=type=secret,id=forgejo_token,required=false/);
      expect(readFileSync(COMPOSE, "utf8")).toMatch(/secrets:\n\s+- forgejo_token/);
    });

    test("compose-env-refs vidí `secrets: … environment:` — jinak sync token nedoručí", () => {
      const reference = referenceCompose(readFileSync(COMPOSE, "utf8"), "source-broker");
      expect(
        jmenaReferenci(reference),
        "Naměřeno 2026-09-14: FORGEJO_TOKEN neměla v Coolify appka brokeru ani Keycloaku —\n" +
          "sync doručuje jen klíče, které compose-env-refs vrátí. Klon soukromého overlaye pak selže.",
      ).toContain("FORGEJO_TOKEN");
      expect(jmenaReferenci(reference, "bez-defaultu"), "token je volitelný (required=false), povinný být nesmí").not.toContain("FORGEJO_TOKEN");
    });

    test("compose předává build ARGy bez vnořené interpolace (Coolify ji neumí)", () => {
      const text = readFileSync(COMPOSE, "utf8");
      for (const k of ["SOURCE_ADAPTER_OVERLAY_GIT_URL", "SOURCE_ADAPTER_OVERLAY_REF", "SOURCE_ADAPTER_OVERLAY_CACHEBUST"]) {
        expect(text).toMatch(new RegExp(`${k}: \\$\\{${k}:-\\}\\n`));
      }
    });
  });

  describe("URL a ref odvozuje env-doktor z deklarace overlaye", () => {
    test("bez přihlašovacích údajů, ref z fragmentu", () => {
      const overlay = mkdtempSync(join(tmpdir(), "aisha-adapter-idata-"));
      mkdirSync(join(overlay, "profiles"));
      mkdirSync(join(overlay, "keycloak"));
      writeFileSync(join(overlay, "profiles/cloud-multi.json"), readFileSync(join(ROOT, "config/profiles/cloud-multi.json")));
      const soubor = join(mkdtempSync(join(tmpdir(), "aisha-adapter-doktor-")), "env.coolify");
      writeFileSync(soubor, `AISHA_PROFILE=cloud-multi\n${DECLARATION_ENV}=https://robot:${HESLO}@repo.example.invalid/org/instance-data.git#main\n`);
      const env: NodeJS.ProcessEnv = { ...process.env };
      for (const k of [...RESOLVER_ENV_INPUTS, OVERLAY_ENV, REQUIRED_ENV, DECLARATION_ENV, "ENV_FILE", "AISHA_STORY"]) delete env[k];
      const r = spawnSync("node", [join(ROOT, "scripts/aisha-env-doctor.mjs"), "--no-external"], {
        cwd: ROOT,
        env: { ...env, ENV_FILE: soubor, APP_NAME_PREFIX: "testfork", [OVERLAY_ENV]: overlay },
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(r.status, r.stderr.slice(-600)).toBe(0);
      const po = readFileSync(soubor, "utf8");
      expect(po).toMatch(/^SOURCE_ADAPTER_OVERLAY_GIT_URL=https:\/\/repo\.example\.invalid\/org\/instance-data\.git$/m);
      expect(po).toMatch(/^SOURCE_ADAPTER_OVERLAY_REF=main$/m);
      expect(
        po.split("\n").filter((l) => l.startsWith("SOURCE_ADAPTER_")).join("\n"),
        "heslo z deklarace nesmí do odvozené URL — ta jde do build ARGu a tedy do metadat obrazu",
      ).not.toContain(HESLO);
    });
  });

  describe("cachebust", () => {
    test("overlay-cachebust.sh doplní token do https URL bez něj — a do jiných ne", () => {
      const bin = mkdtempSync(join(tmpdir(), "aisha-adapter-git-"));
      writeFileSync(join(bin, "git"), `#!/bin/sh\necho "$@" >> "${bin}/volano"\nprintf 'abc123\\tHEAD\\n'\n`);
      chmodSync(join(bin, "git"), 0o755);
      const zavolej = (url: string) => {
        spawnSync("sh", [join(ROOT, "scripts/deploy/overlay-cachebust.sh"), url, ""], {
          encoding: "utf8",
          env: { PATH: `${bin}:${process.env.PATH}`, FORGEJO_TOKEN: "tok123" },
        });
        const volano = readFileSync(join(bin, "volano"), "utf8").trim().split("\n").pop() ?? "";
        return volano;
      };
      expect(zavolej("https://repo.example.invalid/org/x.git")).toContain("https://tok123@repo.example.invalid/org/x.git");
      expect(zavolej("https://jiny@repo.example.invalid/org/x.git")).not.toContain("tok123");
      expect(zavolej("file:///srv/x.git")).not.toContain("tok123");
    });

    test("redeploy zná rodinu a počítá ji AŽ ZA env-doktorem", () => {
      expect(REDEPLOY).toMatch(/bustKey: "SOURCE_ADAPTER_OVERLAY_CACHEBUST",\s*\n\s*urlKey: "SOURCE_ADAPTER_OVERLAY_GIT_URL"/);
      const telo = REDEPLOY.slice(REDEPLOY.indexOf("async function triggerDeploy("));
      const doktor = telo.indexOf("await srovnejOdvozeneKlice()");
      const bust = telo.indexOf("await refreshOverlayCachebusts(");
      const sync = telo.indexOf("scripts/coolify-sync-envs.sh");
      expect(doktor, "srovnání odvozených klíčů v triggerDeploy nenalezeno").toBeGreaterThan(-1);
      expect(
        [doktor < bust, bust < sync],
        "Pořadí musí být doktor → cachebust → sync. Cachebust před doktorem najde odvozenou URL\n" +
          "na PRVNÍM nasazení prázdnou, vynechá se, sync pak doručí URL bez cachebustu\n" +
          "a fail-closed build spadne. Druhý běh by prošel — první ne.",
      ).toEqual([true, true]);
    });

    test("CI cesta i cold-start rodinu znají", () => {
      expect(readFileSync(join(ROOT, "scripts/deploy/refresh-overlay-cachebust.sh"), "utf8")).toMatch(
        /^source-broker\|SOURCE_ADAPTER_OVERLAY_CACHEBUST\|SOURCE_ADAPTER_OVERLAY_GIT_URL\|SOURCE_ADAPTER_OVERLAY_REF\|/m,
      );
      expect(readFileSync(join(ROOT, "scripts/aisha-cold-start.sh"), "utf8")).toMatch(/^SOURCE_ADAPTER_OVERLAY_CACHEBUST=\$\{SOURCE_ADAPTER_OVERLAY_CACHEBUST:-\}$/m);
    });
  });

  test("běhový obraz nese adaptéry tam, kde je SOURCE_ADAPTER_PLUGIN_ENTRY hledá", () => {
    expect(DOCKERFILE).toMatch(/^COPY --from=build \/app\/source-adapters \/app\/plugins$/m);
  });
});
