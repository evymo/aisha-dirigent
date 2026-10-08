/**
 * Brána: DRŽENÁ APLIKACE SE NENASADÍ ŽÁDNOU CESTOU MIMO CI — měřeno chováním
 *
 * ⛔ ZMĚŘENO ČTENÍM 2026-10-04 (tři nezávislé soupisy nad týmž mainem): deklaraci
 * držení (overlay instance, `nasazeni-drzene.json`) četlo jen nasazení z CI.
 * Studený start (`aisha-cold-start.sh --skip-create`: krok 3 story-init, krok 4
 * deploy-init + sync env, krok 5 aisha-redeploy po vlnách) ani ruční dispatch
 * (`deploy.yml`) o ní nevěděly — drženou aplikaci by přenasadily (odpojení dat
 * na prázdný svazek, spuštění služby, kterou provozovatel zastavil) a předtím jí
 * doručily proměnné, jejichž nepřítomnost dnes její nasazení zastavuje.
 *
 * Tady se pouštějí SKUTEČNÉ nástroje proti FALEŠNÉMU Coolify (jen loopback) a měří
 * se, co by se v Coolify stalo: každý požadavek, který by měnil stav.
 * Kontrakt (D = případ rady, T = doplněk, vždy s KOTVOU v témže uspořádání):
 *   D1  držená aplikace → nula volání deploy/restart na její UUID, výpis „DRŽENO“
 *   D2  táž aplikace bez deklarace → volání ODEJDE (kotva: test volání vidí)
 *   D3  deklarace nečitelná / overlay nastavený a nedostupný → žádná mutace, kód ≠ 0;
 *       instance bez overlaye nebo bez souboru = nic drženo, řečeno nahlas (zvlášť)
 *   D4  držená + výslovné cílení (--only, --canary, vstup workflow) → ODMÍTNUTO,
 *       žádný přepínač to nepřebije
 *   D5  restart (ne jen deploy) držené se nevolá
 *   D8  zápis prostředí do držené aplikace se NEDĚLÁ (zmrazená celá)
 *   T7  držená ZASTAVENÁ aplikace zůstane zastavená — žádné volání
 *   T8  rozdílový test: cesta CI a cesta studeného startu nad týmž overlayem dají
 *       týž seznam držených, znak po znaku (žádné druhé pravidlo vedle domova)
 *   +   nepřímá cesta (npm run redeploy) stráž dědí: sedí u volání API v domově mutace
 *   +   studený start: wipe drženou nesmaže, rewarmup držené je STOP, nečitelná
 *       deklarace ukončí běh — měřeno na funkcích vyříznutých ze skutečného skriptu
 *
 * Vlastnost „volání mutace žije jen v jednom domově“ a pořadí kroků studeného
 * startu hlídá lehká brána nasazeni-drzene-aplikace; jednotkové testy domova
 * mutace (včetně mutantů MD1–MD7) jsou v scripts/lib/coolify-mutace.test.mjs.
 *
 * Spouští se přes: npm run test:gates (těžká dráha — podprocesy a čekání na zdraví)
 */
import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { jeMutujici, type Pozadavek } from "./_falesny-coolify";
import { nactiDrzeniCestouCI } from "./_drzeni-ci-cteni";
import { KOD_DRZENO, SOUBOR } from "../../../scripts/lib/nasazeni-drzene.mjs";

const ROOT = process.cwd();
const HAS_JQ = spawnSync("jq", ["--version"], { stdio: "ignore" }).status === 0;

/** `deployOdmitne`: Coolify nasazení téhle aplikace odmítne (HTTP 500) — měří, že volající chybu neztratí. */
type Aplikace = { role: string; status?: string; deployOdmitne?: boolean };
const uuid = (role: string) => `uuid${role.replace(/-/g, "")}fixture01`;
const deklarace = (...role: string[]) =>
  role.map((aplikace) => ({ aplikace, duvod: "zkušební důvod držení", rozhodnuti: { kdo: "majitel", datum: "2026-09-28", odkaz: "rozhodnutí 2026-09-28" } }));

// ── Falešné Coolify: odpovídá jako skutečné tam, kde se nástroje ptají, a PAMATUJE si vše ──
let server: http.Server | null = null;
afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = null;
});

async function falesneCoolify(prefix: string, aplikace: Aplikace[]) {
  const pozadavky: Pozadavek[] = [];
  const apps = aplikace.map((a) => ({
    uuid: uuid(a.role),
    name: `${prefix}-${a.role}`,
    status: a.status ?? "running:healthy",
    environment_id: 1,
    destination: { server: { name: "uzel-test" } },
  }));
  let n = 0;
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const path = req.url ?? "/";
      const method = req.method ?? "GET";
      pozadavky.push({ method, path, body });
      const json = (data: unknown, kod = 200) => {
        res.writeHead(kod, { "content-type": "application/json" });
        res.end(JSON.stringify(data));
      };
      const c = path.split("?")[0];
      if (method !== "GET") {
        if (c === "/api/v1/deploy") {
          if (aplikace.some((a) => a.deployOdmitne && path.includes(uuid(a.role)))) return json({ message: "falešné Coolify: nasazení odmítnuto" }, 500);
          return json({ deployments: [{ message: "queued", deployment_uuid: `dep${++n}` }] });
        }
        if (/\/applications\/[^/]+\/(restart|start|stop)$/.test(c)) return json({ message: "queued", deployment_uuid: `dep${++n}` });
        return json([{ uuid: `zapis${++n}` }]);
      }
      if (c === "/api/v1/projects") return json([{ uuid: "projfixture", name: prefix }]);
      if (c === "/api/v1/projects/projfixture") return json({ uuid: "projfixture", name: prefix, environments: [{ id: 1, name: "production" }] });
      if (c === "/api/v1/projects/projfixture/production") return json({ id: 1, name: "production", applications: apps });
      if (c === "/api/v1/applications") return json(apps);
      if (/^\/api\/v1\/applications\/[^/]+\/envs$/.test(c)) return json([]);
      const app = /^\/api\/v1\/applications\/([^/]+)$/.exec(c);
      if (app) return json(apps.find((a) => a.uuid === app[1]) ?? { message: "not found" }, apps.some((a) => a.uuid === app[1]) ? 200 : 404);
      if (/^\/api\/v1\/deployments\/applications\//.test(c)) return json({ deployments: [] });
      if (c === "/api/v1/deployments") return json([]);
      if (/^\/api\/v1\/deployments\/dep\d+$/.test(c)) return json({ status: "finished" });
      json({ message: "falešné Coolify: neznámá cesta" }, 404);
    });
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
  const adresa = server.address();
  const url = `http://127.0.0.1:${typeof adresa === "object" && adresa ? adresa.port : 0}`;
  /** Mutující požadavky na UUID dané role (deploy přes dotaz, restart/start/stop/envs přes cestu). */
  const mutaceNa = (role: string) => pozadavky.filter((p) => jeMutujici(p) && p.path.includes(uuid(role))).map((p) => `${p.method} ${p.path}`);
  const mutace = () => pozadavky.filter(jeMutujici).map((p) => `${p.method} ${p.path}`);
  return { url, pozadavky, mutaceNa, mutace };
}

/** Spustí příkaz, sbírá výstup (bez barev) a nečeká synchronně — falešné Coolify běží v témže procesu. */
function spust(prikaz: string, args: string[], env: Record<string, string>, timeoutMs = 120_000) {
  return new Promise<{ kod: number | null; vystup: string }>((ok) => {
    const p = spawn(prikaz, args, { cwd: ROOT, env });
    let vystup = "";
    p.stdout.on("data", (d) => (vystup += d));
    p.stderr.on("data", (d) => (vystup += d));
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.on("close", (kod) => {
      clearTimeout(t);
      // eslint-disable-next-line no-control-regex
      ok({ kod, vystup: vystup.replace(/\x1b\[[0-9;]*m/g, "") });
    });
  });
}

/** Overlay instance na disku: profil pro redeploy + volitelná deklarace držení (objekt → JSON, řetězec → doslova). */
function overlay(drzeni?: unknown): string {
  const d = mkdtempSync(join(tmpdir(), "drzeni-mimo-ci-overlay-"));
  mkdirSync(join(d, "profiles"), { recursive: true });
  writeFileSync(join(d, "profiles", "fixture-profil.json"), JSON.stringify({ id: "fixture-profil" }));
  if (drzeni !== undefined) writeFileSync(join(d, SOUBOR), typeof drzeni === "string" ? drzeni : JSON.stringify(drzeni));
  return d;
}

const HLASKA_WR = /DRŽENO: web-render — zkušební důvod držení — rozhodnutí majitel 2026-09-28 \(rozhodnutí 2026-09-28\); drženo od 2026-09-28 \(\d+ dní\)/;

// ══ Cesta 2: aisha-redeploy (studený start krok 5, ruční redeploy, npm run redeploy) ══
type BehRedeploye = { drzeni?: unknown; overlayNedostupny?: boolean; aplikace: Aplikace[]; args: string[]; pres?: "node" | "npm" };

async function redeploy(o: BehRedeploye) {
  const cf = await falesneCoolify("fixture", o.aplikace);
  const tmp = mkdtempSync(join(tmpdir(), "drzeni-redeploy-"));
  const manifest = join(tmp, "fixture.manifest");
  const compose: Record<string, string> = { "web-render": "docker-compose.coolify-web-render.yml", edge: "docker-compose.coolify-prebuilt.yml" };
  writeFileSync(manifest, o.aplikace.map((a) => `app: ${a.role}:frontend:${compose[a.role]}\n`).join(""));
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: tmp,
    TMPDIR: process.env.TMPDIR ?? "",
    COOLIFY_BASE_URL: cf.url,
    COOLIFY_URL: cf.url,
    COOLIFY_API_TOKEN: "fixture-token",
    COOLIFY_PROJECT_UUID: "projfixture",
    COOLIFY_ENVIRONMENT: "production",
    APP_NAME_PREFIX: "fixture",
    MANIFEST_FILE: manifest,
    AISHA_PROFILE: "fixture-profil",
    AISHA_SNAPSHOT_DIR: join(tmp, "snap"),
    AISHA_HEALTH_POLL_S: "1",
    AISHA_STABLE_POLLS: "1",
    NO_COLOR: "1",
  };
  if (o.overlayNedostupny) env.AISHA_INSTANCE_DATA_GIT_URL = `file://${join(tmp, "neexistuje.git")}#main`;
  else env.AISHA_INSTANCE_CONFIG_DIR = overlay(o.drzeni);
  const r =
    o.pres === "npm"
      ? await spust("npm", ["run", "--silent", "redeploy", "--", ...o.args], env)
      : await spust(process.execPath, [join(ROOT, "scripts/aisha-redeploy.mjs"), ...o.args], env);
  return { ...r, ...cf };
}

const VLNA_EDGE = [{ role: "web-render" }, { role: "edge" }];

describe("cesta 2 — aisha-redeploy proti falešnému Coolify", { timeout: 180_000 }, () => {
  it("D2 (kotva): bez deklarace restartuje OBĚ aplikace vlny — test volání vidí", async () => {
    const r = await redeploy({ aplikace: VLNA_EDGE, args: ["--restart-validate", "--from=10"] });
    expect(r.mutaceNa("web-render"), r.vystup).toEqual([`POST /api/v1/applications/${uuid("web-render")}/restart`]);
    expect(r.mutaceNa("edge"), r.vystup).toEqual([`POST /api/v1/applications/${uuid("edge")}/restart`]);
    expect(r.vystup).toMatch(/overlay instance nasazeni-drzene\.json nemá — nic drženo/);
    expect(r.vystup).not.toMatch(/DRŽENO/);
  });

  it("⛔ D1 + D5: držená aplikace nedostane restart — nedržená z téže vlny ano; výpis DRŽENO i v souhrnu", async () => {
    const r = await redeploy({ drzeni: deklarace("web-render"), aplikace: VLNA_EDGE, args: ["--restart-validate", "--from=10"] });
    expect(r.mutaceNa("web-render"), r.vystup).toEqual([]);
    expect(r.mutaceNa("edge"), r.vystup).toEqual([`POST /api/v1/applications/${uuid("edge")}/restart`]);
    expect(r.vystup).toMatch(HLASKA_WR);
    expect(r.vystup).toMatch(/Nerestartuji/);
    expect(r.vystup).toMatch(/DRŽENO:\s+1 \(web-render\) — deklarace v overlayi instance; nerestartováno/);
    // držení v běhu po vlnách kód neovlivní (0 čisto / 3 jen proto, že disk uzlu postroj neměří)
    expect([0, 3], r.vystup).toContain(r.kod);
  });

  it("⛔ T7: držená ZASTAVENÁ aplikace zůstane zastavená — běh po vlnách na ni nesáhne a skončí čistě", async () => {
    const r = await redeploy({ drzeni: deklarace("web-render"), aplikace: [{ role: "web-render", status: "exited:unhealthy" }], args: ["--from=10"] });
    expect(r.mutace(), r.vystup).toEqual([]);
    expect(r.kod, r.vystup).toBe(0);
    expect(r.vystup).toMatch(HLASKA_WR);
    expect(r.vystup).toMatch(/Nenasazuji/);
    expect(r.vystup).toMatch(/triggered:\s+0/);
    expect(r.vystup).not.toMatch(/trigger failed:\s+[1-9]/);
  });

  it("⛔ D4: výslovné cílení na drženou (--only, --canary) se ODMÍTNE kódem DRŽENO; přepínač, který by to přebil, neexistuje", async () => {
    expect(KOD_DRZENO).toBe(100);
    const only = await redeploy({ drzeni: deklarace("web-render"), aplikace: VLNA_EDGE, args: ["--only=web-render"] });
    expect(only.mutace(), only.vystup).toEqual([]);
    expect(only.kod, only.vystup).toBe(KOD_DRZENO);
    expect(only.vystup).toMatch(/--only jmenuje drženou aplikaci \(web-render\) — ODMÍTNUTO/);

    const canary = await redeploy({ drzeni: deklarace("web-render"), aplikace: VLNA_EDGE, args: ["--canary=web-render"] });
    expect(canary.mutace(), canary.vystup).toEqual([]);
    expect(canary.kod, canary.vystup).toBe(KOD_DRZENO);
    expect(canary.vystup).toMatch(/Kanárek fixture-web-render ODMÍTNUT/);

    for (const obchvat of ["--force", "--i-drzene", "--ignore-hold"]) {
      const r = await redeploy({ drzeni: deklarace("web-render"), aplikace: VLNA_EDGE, args: ["--only=web-render", obchvat] });
      expect(r.kod, obchvat).toBe(2);
      expect(r.pozadavky, `${obchvat}: neznámý přepínač nesmí dojít ani ke čtení stavu`).toEqual([]);
      expect(r.vystup).toMatch(/neznámý přepínač/);
    }
  });

  it("⛔ D3: nečitelná nebo neplatná deklarace → kód 2 a ŽÁDNÁ mutace (ani pro nedrženou aplikaci)", async () => {
    for (const drzeni of ["{nejde", deklarace("core"), [{ aplikace: "web-render" }]]) {
      const r = await redeploy({ drzeni, aplikace: VLNA_EDGE, args: ["--restart-validate", "--from=10"] });
      expect(r.kod, JSON.stringify(drzeni)).toBe(2);
      expect(r.mutace(), JSON.stringify(drzeni)).toEqual([]);
      expect(r.vystup).toMatch(/deklarace držení (NEČITELNÁ|NEPLATNÁ)/);
    }
  });

  it("⛔ D3/T3: overlay, který instance MÁ nastavený a nejde načíst = STOP (ne „nic drženo“); overlay bez souboru = nic drženo, nahlas", async () => {
    const nedostupny = await redeploy({ overlayNedostupny: true, aplikace: VLNA_EDGE, args: ["--restart-validate", "--from=10"] });
    expect(nedostupny.kod, nedostupny.vystup).toBe(2);
    expect(nedostupny.mutace()).toEqual([]);
    expect(nedostupny.vystup).toMatch(/deklarace držení NEČITELNÁ: .*instance deklaruje vlastní overlay/);
    // overlay dostupný, soubor deklarace v něm není: plán (nic nenasazuje) to řekne a cíle ukáže
    // (instanci ÚPLNĚ bez overlaye měří testy domova — tady by nástroj četl soubory prostředí stroje, kde test běží)
    const bezSouboru = await redeploy({ aplikace: VLNA_EDGE, args: ["--plan", "--from=10"] });
    expect(bezSouboru.kod, bezSouboru.vystup).toBe(0);
    expect(bezSouboru.vystup).toMatch(/Držení aplikací: overlay instance nasazeni-drzene\.json nemá — nic drženo/);
    expect(bezSouboru.vystup).toMatch(/→ fixture-web-render/);
    expect(bezSouboru.mutace()).toEqual([]);
  });

  it("nepřímá cesta (npm run redeploy) stráž DĚDÍ: sedí u volání API, ne ve skriptu, který nástroj spouští", async () => {
    const r = await redeploy({ pres: "npm", drzeni: deklarace("web-render"), aplikace: VLNA_EDGE, args: ["--restart-validate", "--from=10"] });
    expect(r.mutaceNa("web-render"), r.vystup).toEqual([]);
    expect(r.mutaceNa("edge"), r.vystup).toEqual([`POST /api/v1/applications/${uuid("edge")}/restart`]);
    expect(r.vystup).toMatch(HLASKA_WR);
  });
});

// ══ Cesta 4: coolify-sync-envs (krok 4 studeného startu, env-sync před nasazením, REDEPLOY=1) ══
async function syncEnvs(o: { drzeni?: unknown; args?: string[]; env?: Record<string, string>; aplikace?: Aplikace[] }) {
  const cf = await falesneCoolify("inst", o.aplikace ?? [{ role: "web-render" }, { role: "registry" }]);
  const tmp = mkdtempSync(join(tmpdir(), "drzeni-sync-"));
  const envSoubor = join(tmp, "env.fixture");
  writeFileSync(envSoubor, ["APP_NAME_PREFIX=inst", "MESH_ENABLED=false", "REGISTRY_DOMAIN=registry.inst.invalid", "PUBLIC_TLD=inst.invalid", "WEB_RENDER_PORT=3000"].join("\n") + "\n");
  const manifest = join(tmp, "inst.manifest");
  writeFileSync(manifest, "app: web-render:frontend:docker-compose.coolify-web-render.yml\napp: registry:frontend:docker-compose.coolify-registry.yml\n");
  const r = await spust("bash", [join(ROOT, "scripts/coolify-sync-envs.sh"), ...(o.args ?? [])], {
    PATH: process.env.PATH ?? "",
    HOME: tmp,
    TMPDIR: process.env.TMPDIR ?? "",
    ENV_FILE: envSoubor,
    MANIFEST_FILE: manifest,
    COOLIFY_API: `${cf.url}/api/v1`,
    COOLIFY_URL: cf.url,
    COOLIFY_BASE_URL: cf.url,
    COOLIFY_API_TOKEN: "fixture-token",
    COOLIFY_PROJECT_UUID: "projfixture",
    SKIP_ENV_PREFLIGHT: "1",
    SKIP_DELIVERY_CHECK: "1",
    NORMALIZE_BUILDTIME: "0",
    AISHA_PROFILE: "cloud-multi",
    AISHA_INSTANCE_CONFIG_DIR: overlay(o.drzeni),
    ...(o.env ?? {}),
  });
  return { ...r, ...cf };
}

describe.skipIf(!HAS_JQ)("cesta 4 — coolify-sync-envs proti falešnému Coolify", { timeout: 180_000 }, () => {
  it("D2 (kotva): bez deklarace dostanou zápis prostředí OBĚ aplikace", async () => {
    const r = await syncEnvs({});
    expect(r.kod, r.vystup).toBe(0);
    expect(r.mutaceNa("web-render").length, r.vystup).toBeGreaterThan(0);
    expect(r.mutaceNa("registry").length, r.vystup).toBeGreaterThan(0);
    expect(r.mutaceNa("web-render").every((m) => m.startsWith("PATCH ") && m.endsWith("/envs/bulk"))).toBe(true);
  });

  it("⛔ D8: do držené aplikace se prostředí NEZAPISUJE (zmrazená celá) — a řekne se to", async () => {
    const r = await syncEnvs({ drzeni: deklarace("web-render") });
    expect(r.kod, r.vystup).toBe(0);
    expect(r.mutaceNa("web-render"), r.vystup).toEqual([]);
    expect(r.mutaceNa("registry").length, r.vystup).toBeGreaterThan(0);
    expect(r.vystup).toMatch(/inst-web-render\s+SKIP \(DRŽENO: web-render — zkušební důvod držení.*Env se NEDORUČUJE\.\)/);
    expect(r.vystup).toMatch(/DRŽENO \(1\) — env NEDORUČEN: inst-web-render/);
    expect(r.vystup).toMatch(/Všech 1 apps zesynchronizováno/);
  });

  it("⛔ D1: REDEPLOY=1 drženou nenasadí (přes domov mutace); nedrženou ano. Jmenovaná držená = kód DRŽENO", async () => {
    const hromadne = await syncEnvs({ drzeni: deklarace("web-render"), env: { REDEPLOY: "1" } });
    expect(hromadne.mutaceNa("web-render"), hromadne.vystup).toEqual([]);
    expect(hromadne.mutaceNa("registry"), hromadne.vystup).toContain(`POST /api/v1/deploy?uuid=${uuid("registry")}&force=true`);
    expect(hromadne.vystup).toMatch(/inst-web-render\s+NENASAZENO \(DRŽENO: web-render — /);
    expect(hromadne.kod, hromadne.vystup).toBe(0);

    const jmenovana = await syncEnvs({ drzeni: deklarace("web-render"), env: { REDEPLOY: "1" }, args: ["web-render", "registry"] });
    expect(jmenovana.mutaceNa("web-render"), jmenovana.vystup).toEqual([]);
    expect(jmenovana.mutaceNa("registry"), jmenovana.vystup).toContain(`POST /api/v1/deploy?uuid=${uuid("registry")}&force=true`);
    expect(jmenovana.kod, jmenovana.vystup).toBe(KOD_DRZENO);
    expect(jmenovana.vystup).toMatch(/REDEPLOY jmenuje drženou aplikaci \(inst-web-render\) — ODMÍTNUTO/);

    // kotva: bez deklarace REDEPLOY=1 nasadí i ji
    const kotva = await syncEnvs({ env: { REDEPLOY: "1" } });
    expect(kotva.mutaceNa("web-render"), kotva.vystup).toContain(`POST /api/v1/deploy?uuid=${uuid("web-render")}&force=true`);
  });

  it("⛔ REDEPLOY=1: odmítnuté nasazení se neztratí — aplikace jmenovaná, kód ≠ 0 (dřív „?“ a kód 0)", async () => {
    const r = await syncEnvs({ env: { REDEPLOY: "1" }, aplikace: [{ role: "web-render", deployOdmitne: true }, { role: "registry" }] });
    expect(r.mutaceNa("web-render"), r.vystup).toContain(`POST /api/v1/deploy?uuid=${uuid("web-render")}&force=true`);
    expect(r.mutaceNa("registry"), r.vystup).toContain(`POST /api/v1/deploy?uuid=${uuid("registry")}&force=true`);
    expect(r.vystup).toMatch(/inst-web-render\s+NENASAZENO \(kód [1-9]\d*\) [^\n]*HTTP 500/);
    expect(r.vystup).toMatch(/Selhaly: inst-web-render/);
    expect(r.kod, r.vystup).toBe(1);
  });

  it("⛔ D3: nečitelná deklarace → nic se neodešle (ani nedržené aplikaci), kód ≠ 0", async () => {
    const r = await syncEnvs({ drzeni: "{nejde" });
    expect(r.kod, r.vystup).toBe(1);
    expect(r.mutace(), r.vystup).toEqual([]);
    expect(r.vystup).toMatch(/deklarace držení NEČITELNÁ/);
    expect(r.vystup).toMatch(/Nic jsem neodeslal/);
  });
});

// ══ Ruční dispatch: run blok kroku „Execute deployment“ ze SKUTEČNÉHO deploy.yml ══
async function dispatch(o: { stack: string; drzene: string }) {
  const cf = await falesneCoolify("inst", [{ role: "web-render" }, { role: "keycloak" }, { role: "core" }, { role: "web" }, { role: "n8n" }]);
  const tmp = mkdtempSync(join(tmpdir(), "drzeni-dispatch-"));
  const bin = join(tmp, "bin");
  mkdirSync(bin);
  // `sleep` mezi stacky hromadného běhu (30 s) a v čekání na nasazení postroj nečeká
  writeFileSync(join(bin, "sleep"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(bin, "sleep"), 0o755);
  const wf = yaml.load(readFileSync(join(ROOT, ".forgejo/workflows/deploy.yml"), "utf8")) as { jobs: { deploy: { steps: Array<{ name?: string; id?: string; run?: string; env?: Record<string, string> }> } } };
  const kroky = wf.jobs.deploy.steps;
  const krok = kroky.find((k) => k.name === "Execute deployment");
  expect(krok?.run, "krok Execute deployment v deploy.yml chybí").toBeTruthy();
  // Deklaraci čte krok PŘED nasazením týmž skriptem jako ci.yml a předává ji outputem.
  const iDrzeni = kroky.findIndex((k) => k.id === "drzeni");
  expect(iDrzeni, "krok s id drzeni chybí").toBeGreaterThan(-1);
  expect(kroky[iDrzeni].run?.trim()).toBe("bash scripts/ci/drzene-z-overlaye.sh");
  expect(iDrzeni).toBeLessThan(kroky.indexOf(krok!));
  expect(krok!.env?.DRZENE).toBe("${{ steps.drzeni.outputs.drzene }}");
  const skript = join(tmp, "run.sh");
  // dočasný soubor odpovědi míří do adresáře testu, ne do /tmp stroje
  writeFileSync(skript, krok!.run!.split("/tmp/deploy.txt").join(join(tmp, "deploy.txt")));
  const r = await spust("bash", [skript], {
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    HOME: tmp,
    TMPDIR: process.env.TMPDIR ?? "",
    COOLIFY_URL: cf.url,
    COOLIFY_API_TOKEN: "fixture-token",
    APP_NAME_PREFIX: "inst",
    STACK_INPUT: o.stack,
    FORCE_INPUT: "false",
    DRZENE: o.drzene,
  });
  return { ...r, ...cf };
}
const OVERENA = JSON.stringify([
  { aplikace: "web-render", duvod: "zkušební důvod držení", kdo: "majitel", datum: "2026-09-28", odkaz: "rozhodnutí 2026-09-28", vlna: 10, dni: 4 },
  { aplikace: "keycloak", duvod: "jiný důvod držení", kdo: "majitel", datum: "2026-09-28", odkaz: "rozhodnutí 2026-09-28", vlna: 4, dni: 4 },
]);

describe("ruční dispatch (deploy.yml) proti falešnému Coolify", { timeout: 180_000 }, () => {
  it("D2 (kotva): nedržený stack se nasadí — POST /deploy odejde přes domov mutace", async () => {
    const r = await dispatch({ stack: "web-render", drzene: "[]" });
    expect(r.mutace(), r.vystup).toEqual([`POST /api/v1/deploy?uuid=${uuid("web-render")}&force=false`]);
    expect(r.kod, r.vystup).toBe(0);
  });

  it("⛔ D1 + D4: vstup workflow jmenuje drženou aplikaci → ODMÍTNUTO červeně, Coolify nedostane NIC", async () => {
    const r = await dispatch({ stack: "web-render", drzene: OVERENA });
    expect(r.pozadavky, r.vystup).toEqual([]);
    expect(r.kod, r.vystup).toBe(1);
    expect(r.vystup).toMatch(/::error title=DRŽENO: web-render::zkušební důvod držení — rozhodnutí majitel 2026-09-28 .*NENASAZUJI/);
  });

  it("hromadný běh (all): držený stack je vypsaná výjimka, další stacky pokračují", async () => {
    const r = await dispatch({ stack: "all", drzene: OVERENA });
    expect(r.mutaceNa("keycloak"), r.vystup).toEqual([]);
    expect(r.mutaceNa("core"), r.vystup).toEqual([`POST /api/v1/deploy?uuid=${uuid("core")}&force=false`]);
    expect(r.vystup).toMatch(/::warning title=DRŽENO: keycloak::jiný důvod držení .*Nenasazuji, další stacky pokračují/);
  });

  it("⛔ D5: restart jde taky přes domov mutace — a ztracený output deklarace (D3) = žádná mutace", async () => {
    const restart = await dispatch({ stack: "n8n-restart", drzene: "[]" });
    expect(restart.mutace(), restart.vystup).toEqual([`POST /api/v1/applications/${uuid("n8n")}/restart`]);
    for (const drzene of ["", "{nejde"]) {
      const r = await dispatch({ stack: "core", drzene });
      expect(r.mutace(), `DRZENE=${JSON.stringify(drzene)}: ${r.vystup}`).toEqual([]);
      expect(r.kod).toBe(1);
      expect(r.vystup).toMatch(/::error title=deklarace držení::/);
    }
  });
});

// ══ T8: rozdílový test — cesta CI a cesta studeného startu nad TÝMŽ overlayem ══
describe("T8 — cesta CI a cesta studeného startu čtou TÝŽ seznam držených (jeden domov, žádné druhé pravidlo)", { timeout: 180_000 }, () => {
  const repo = "repo.example.test/vlastnik/data-instance";
  const tokeny: [string, string] = ["TAJNY-TOKEN-1", "TAJNY-TOKEN-2"];
  const cisteProstredi = (dir: string) => ({ PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TMPDIR: process.env.TMPDIR ?? "", AISHA_INSTANCE_CONFIG_DIR: dir });
  /** Overlay na disku s týmž obsahem, jaký cesta CI dostane klonem. */
  const overlayNaDisku = (obsah: unknown) => {
    const dir = mkdtempSync(join(tmpdir(), "drzene-t8-"));
    if (obsah !== undefined) writeFileSync(join(dir, SOUBOR), typeof obsah === "string" ? obsah : JSON.stringify(obsah));
    return dir;
  };
  /** Cesta studeného startu: shellový čtenář (lib/drzeni.sh), kterým čte aisha-cold-start.sh i jeho nástroje. */
  const studenyStart = (dir: string) =>
    spawnSync("bash", ["-c", 'set -uo pipefail; . scripts/lib/drzeni.sh; drzeni_nacti aisha-cold-start || exit 7; printf "%s" "$DRZENI_APLIKACE"'], { cwd: ROOT, encoding: "utf8", env: cisteProstredi(dir) });
  /** …a týž domov ve strojovém tvaru (JSON), kterým čte aisha-redeploy a domov mutace. */
  const domov = (dir: string) => spawnSync(process.execPath, ["scripts/lib/nasazeni-drzene.mjs", "--instance", "aisha-cold-start"], { cwd: ROOT, encoding: "utf8", env: cisteProstredi(dir) });

  it("platná deklarace: výstup obou cest je ZNAK PO ZNAKU stejný", () => {
    const dve = deklarace("web-render", "local-ingest");
    for (const obsah of [deklarace("web-render"), dve, [], undefined]) {
      const ci = nactiDrzeniCestouCI({ repo, tokeny, obsah });
      expect(ci.rc, ci.text).toBe(0);
      const dir = overlayNaDisku(obsah);
      const d = domov(dir);
      expect(d.status, d.stderr).toBe(0);
      expect(d.stdout.trim(), `obsah ${JSON.stringify(obsah)}`).toBe(ci.drzene);
      const cs = studenyStart(dir);
      expect(cs.status, cs.stderr).toBe(0);
      expect(cs.stdout, "seznam aplikací, podle kterého studený start vynechává").toBe(
        (JSON.parse(ci.drzene ?? "null") as Array<{ aplikace: string }>).map((p) => p.aplikace).join("\n"),
      );
    }
  });

  it("⛔ neplatná deklarace: OBĚ cesty padnou — žádná z nich neřekne „nic drženo“", () => {
    for (const obsah of [[{ ...deklarace("web-render")[0], duvod: "" }], deklarace("core"), deklarace("pki"), "{nejde"]) {
      const ci = nactiDrzeniCestouCI({ repo, tokeny, obsah });
      expect(ci.rc, JSON.stringify(obsah)).toBe(1);
      expect(ci.drzene).toBeUndefined();
      const dir = overlayNaDisku(obsah);
      const d = domov(dir);
      expect(d.status, JSON.stringify(obsah)).toBe(1);
      expect(d.stdout).toBe("");
      expect(studenyStart(dir).status, JSON.stringify(obsah)).toBe(7);
    }
  });

  it("studený start ani jeho čtenář si deklaraci nevykládají sami (žádné druhé pravidlo vedle domova)", () => {
    const kod = (rel: string) => readFileSync(join(ROOT, rel), "utf8").split("\n").filter((r) => !/^\s*#/.test(r)).join("\n");
    for (const rel of ["scripts/aisha-cold-start.sh", "scripts/lib/drzeni.sh", "scripts/coolify-sync-envs.sh", "scripts/coolify-deploy-init.sh", "scripts/coolify-story-init.sh", "scripts/cold-start-doctor.sh"]) {
      expect(kod(rel), `${rel} čte nasazeni-drzene.json vlastním kódem`).not.toMatch(/(jq|cat|python3?|node -e|grep|sed|awk)[^\n]*nasazeni-drzene\.json/);
    }
    expect(kod("scripts/lib/drzeni.sh")).toMatch(/node "\$domov" --instance "\$nastroj" --tvar tsv/);
  });
});

// ══ Cesta 1: funkce vyříznuté ze SKUTEČNÉHO aisha-cold-start.sh ══
const CS = readFileSync(join(ROOT, "scripts/aisha-cold-start.sh"), "utf8");
/** Text shellové funkce `jmeno() { … }` ze skutečného skriptu (víceřádkové i jednořádkové). */
function funkce(jmeno: string): string {
  const od = CS.indexOf(`\n${jmeno}() {`);
  expect(od, `funkce ${jmeno} ve studeném startu chybí`).toBeGreaterThan(-1);
  const konecRadku = CS.indexOf("\n", od + 1);
  if (CS.slice(od, konecRadku).trimEnd().endsWith("}")) return CS.slice(od + 1, konecRadku);
  return CS.slice(od + 1, CS.indexOf("\n}\n", od) + 2);
}

/**
 * Vyříznuté funkce studeného startu se ptají i na VLASTNICTVÍ (`externi` — wipe sirotků, strážce
 * rewarmupu). Harness ho proto načítá skutečným domovem (lib/vlastnictvi.sh + cs_nacti_vlastnictvi)
 * nad manifestem, kde jsou všechny tři aplikace projektu VLASTNÍ (profil bez external_domain).
 * ⛔ Revize integrátora 2026-10-05 (A-N2): dřív se vlastnictví nenačítalo, `externi` skončilo 127
 * („command not found“) a v podmínce se to tiše četlo jako „není externí“ — testy procházely
 * náhodou. Pojistka níž ukončí běh kódem 97, kdyby funkce domova zase chyběla.
 */
function coldStartFunkce(o: { drzeni?: unknown; telo: string; env?: Record<string, string> }) {
  const tmp = mkdtempSync(join(tmpdir(), "drzeni-coldstart-"));
  const log = join(tmp, "coolify-volani");
  const manifest = join(tmp, "inst.manifest");
  writeFileSync(
    manifest,
    ["story: inst", "app: web-render:backend:docker-compose.coolify-web-render.yml", "app: edge:backend:docker-compose.coolify-edge.yml", "app: registry:backend:docker-compose.coolify-registry.yml", ""].join("\n"),
  );
  const skript = [
    "set -uo pipefail",
    'info() { echo "INFO $*"; }; ok() { echo "OK $*"; }; warn() { echo "WARN $*"; }; err() { echo "ERR $*" >&2; }',
    'GREEN=""; NC=""',
    // Coolify postroje: tři aplikace projektu; každé volání se zapíše
    "cs_over_izolaci_projektu() { :; }",
    "coolify_scoped_apps() { printf 'inst-web-render\\tuuidwr\\ninst-edge\\tuuidedge\\ninst-registry\\tuuidreg\\n'; }",
    `coolify_api() { echo "$1 $2" >> "${log}"; echo '{}'; }`,
    `. "${join(ROOT, "scripts/lib/drzeni.sh")}"`,
    `. "${join(ROOT, "scripts/lib/vlastnictvi.sh")}"`,
    'for _f in externi vlastni vlastnictvi_hlaska; do type "$_f" >/dev/null 2>&1 || { echo "HARNESS: funkce domova vlastnictví $_f chybí" >&2; exit 97; }; done',
    "APP_NAME_PREFIX=inst; APP_NAME_PREFIX_RE='^inst-'; PRESERVED_APPS_REGEX='^(inst-registry)$'",
    `MANIFEST='${manifest}'`,
    'WIPE_VOLUMES=1; DRY_RUN=0; REWARMUP_APPS="${REWARMUP_APPS:-}"',
    funkce("cs_nacti_drzeni"),
    funkce("cs_nacti_vlastnictvi"),
    funkce("cs_role_aplikace"),
    funkce("cs_rewarmup_nesmi_drzenou"),
    funkce("wipe_orphan_apps"),
    "cs_nacti_vlastnictvi",
    o.telo,
  ].join("\n");
  const r = spawnSync("bash", ["-c", skript], {
    cwd: ROOT,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: tmp, TMPDIR: process.env.TMPDIR ?? "", AISHA_INSTANCE_CONFIG_DIR: overlay(o.drzeni), AISHA_PROFILE: "fixture-profil", ...(o.env ?? {}) },
    timeout: 120_000,
  });
  let volani: string[] = [];
  try {
    volani = readFileSync(log, "utf8").split("\n").filter(Boolean);
  } catch {
    /* žádné volání */
  }
  return { rc: r.status, vystup: `${r.stdout}\n${r.stderr}`, volani, mazani: volani.filter((v) => v.startsWith("DELETE ")) };
}

describe.skipIf(!HAS_JQ)("cesta 1 — funkce ze skutečného aisha-cold-start.sh", { timeout: 180_000 }, () => {
  it("⛔ D3: nečitelná nebo neplatná deklarace ukončí běh (kód 1) dřív, než se čehokoli dotkne", () => {
    for (const drzeni of ["{nejde", deklarace("core")]) {
      const r = coldStartFunkce({ drzeni, telo: 'cs_nacti_drzeni\necho "POKRACUJE"\nwipe_orphan_apps' });
      expect(r.rc, JSON.stringify(drzeni)).toBe(1);
      expect(r.vystup).not.toMatch(/POKRACUJE/);
      expect(r.volani).toEqual([]);
      expect(r.vystup).toMatch(/deklarace držení (NEČITELNÁ|NEPLATNÁ)/);
      expect(r.vystup).toMatch(/KONČÍM dřív, než se čehokoli dotknu/);
    }
  });

  it("instance bez deklarace: řekne „nic drženo“ a běží dál; s deklarací vypíše DRŽENO a co kvůli tomu nedělá", () => {
    const bez = coldStartFunkce({ telo: 'cs_nacti_drzeni\necho "POKRACUJE"' });
    expect(bez.rc, bez.vystup).toBe(0);
    expect(bez.vystup).toMatch(/INFO Držení aplikací: overlay instance nasazeni-drzene\.json nemá — nic drženo/);
    expect(bez.vystup).toMatch(/POKRACUJE/);
    const s = coldStartFunkce({ drzeni: deklarace("web-render"), telo: 'cs_nacti_drzeni\necho "POKRACUJE"' });
    expect(s.rc, s.vystup).toBe(0);
    expect(s.vystup).toMatch(new RegExp(`WARN\\s+${HLASKA_WR.source}\\. Běh ji nezakládá, nesrovnává, nedoručuje jí env, nenasazuje, nerestartuje ani nemaže\\.`));
  });

  it("⛔ --wipe drženou aplikaci NESMAŽE (ani svazky); ostatní ano. Kotva: bez deklarace ji smaže", () => {
    const kotva = coldStartFunkce({ telo: "cs_nacti_drzeni >/dev/null\nwipe_orphan_apps" });
    // A-N2: vlastnictví se opravdu načetlo skutečným domovem (dřív `externi` = 127)
    expect(kotva.vystup).toMatch(/INFO Vlastnictví aplikací: profil fixture-profil: vlastní 3, externí 0/);
    expect(kotva.vystup).not.toMatch(/command not found|HARNESS:/);
    expect(kotva.rc, kotva.vystup).toBe(0);
    expect(kotva.mazani.sort()).toEqual([
      "DELETE /applications/uuidedge?delete_volumes=true&delete_configurations=true&delete_connected_networks=true",
      "DELETE /applications/uuidwr?delete_volumes=true&delete_configurations=true&delete_connected_networks=true",
    ]);
    const r = coldStartFunkce({ drzeni: deklarace("web-render"), telo: "cs_nacti_drzeni >/dev/null\nwipe_orphan_apps" });
    expect(r.rc, r.vystup).toBe(0);
    expect(r.mazani).toEqual(["DELETE /applications/uuidedge?delete_volumes=true&delete_configurations=true&delete_connected_networks=true"]);
    expect(r.volani.filter((v) => v.includes("uuidwr")), "na drženou aplikaci wipe nesáhne ani čtením stavu").toEqual([]);
    expect(r.vystup).toMatch(new RegExp(`WARN wipe_orphan_apps: ${HLASKA_WR.source}\\. NEMAŽU ji ani její svazky`));
  });

  it("⛔ --rewarmup držené aplikace je rozpor voleb = STOP (kód 1), ne tiché vynechání; nedržený cíl projde", () => {
    const r = coldStartFunkce({ drzeni: deklarace("web-render"), env: { REWARMUP_APPS: "inst-edge, inst-web-render" }, telo: 'cs_nacti_drzeni >/dev/null\ncs_rewarmup_nesmi_drzenou\necho "POKRACUJE"' });
    expect(r.rc, r.vystup).toBe(1);
    expect(r.vystup).not.toMatch(/POKRACUJE/);
    expect(r.vystup).toMatch(/ERR --rewarmup=inst-web-render: DRŽENO: web-render — /);
    const ok = coldStartFunkce({ drzeni: deklarace("web-render"), env: { REWARMUP_APPS: "inst-edge" }, telo: 'cs_nacti_drzeni >/dev/null\ncs_rewarmup_nesmi_drzenou\necho "POKRACUJE"' });
    expect(ok.rc, ok.vystup).toBe(0);
    expect(ok.vystup).toMatch(/POKRACUJE/);
    // podobné jméno není držené (přesná shoda role)
    const podobne = coldStartFunkce({ drzeni: deklarace("web-render"), env: { REWARMUP_APPS: "inst-web" }, telo: 'cs_nacti_drzeni >/dev/null\ncs_rewarmup_nesmi_drzenou\necho "POKRACUJE"' });
    expect(podobne.rc, podobne.vystup).toBe(0);
  });
});
