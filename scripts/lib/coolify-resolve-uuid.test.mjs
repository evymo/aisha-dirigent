/**
 * Překladač jméno→UUID aplikace (bash i node) se ptá PROJEKTU instance —
 * měřeno proti falešnému Coolify ve tvaru, který jsme 2026-09-13 naměřili živě.
 *
 * ⛔ NAMĚŘENO 2026-09-13:
 *   - CI běh #3639 (main a89882dfd): každá deploy úloha vypsala
 *     `::warning::coolify-resolve-uuid: COOLIFY_PROJECT_UUID chybí …` a pokračovala
 *     nad GLOBÁLNÍM `/applications`;
 *   - GET /api/v1/applications (227 aplikací): `aisha-registry` nesou dvě aplikace,
 *     cizí (projekt a1sh4, env 10) stojí v odpovědi PŘED naší (projekt aisha, env 13).
 *     `first`/`find` tedy vracel cizí UUID.
 *   - GET /api/v1/projects: právě jeden projekt jménem `aisha` a jeho UUID je to,
 *     které cold-start zapsal do COOLIFY_PROJECT_UUID — odvození jménem instance
 *     dává totéž, co cold-start.
 *
 * Fixtura níž nese TENTÝŽ tvar (identifikátory vymyšlené). Proti ní se pouští
 * SKUTEČNÝ `coolify-resolve-uuid.sh` i SKUTEČNÝ `coolify-project-scope.mjs`
 * (asynchronně — synchronní spawn by zablokoval smyčku, na které falešný server běží).
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveUuid, resolveAllAishaUuids, clearCache } from "./coolify-resolve-uuid.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RESOLVER = join(ROOT, "scripts/lib/coolify-resolve-uuid.sh");
const PRAZDNY_KOREN = mkdtempSync(join(tmpdir(), "resolve-uuid-identita-"));
afterAll(() => rmSync(PRAZDNY_KOREN, { recursive: true, force: true }));

const NASE = "naseregistry0000000000001";
const CIZI = "ciziregistry0000000000001";

/** Stav falešného Coolify; každý test si ho nastaví. */
let stav;
const vychozi = () => ({
  projects: [
    { name: "a1sh4", uuid: "projcizi0000000000000001" },
    { name: "aisha", uuid: "projnase0000000000000001" },
  ],
  envs: { projcizi0000000000000001: [10], projnase0000000000000001: [13] },
  // Pořadí jako v živé odpovědi: cizí jmenovec PŘED naším.
  applications: [
    { name: "aisha-registry", uuid: CIZI, environment_id: 10, status: "running:healthy" },
    { name: "aisha-registry", uuid: NASE, environment_id: 13, status: "running:healthy" },
    { name: "aisha-core", uuid: "nasecore00000000000000001", environment_id: 13, status: "running:healthy" },
  ],
  dotazy: [],
});

let server;
let baseUrl;
beforeAll(async () => {
  server = createServer((req, res) => {
    const cesta = req.url.replace(/^\/api\/v1/, "");
    stav.dotazy.push(cesta);
    const posli = (kod, telo) => {
      res.writeHead(kod, { "Content-Type": "application/json" });
      res.end(JSON.stringify(telo));
    };
    if (cesta === "/projects") return posli(200, stav.projects);
    const p = /^\/projects\/([^/]+)$/.exec(cesta);
    if (p) return posli(200, { uuid: p[1], environments: (stav.envs[p[1]] || []).map((id) => ({ id })) });
    if (cesta === "/applications") return posli(200, stav.applications);
    return posli(404, { message: "not found" });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

/** Pustí skutečný bash resolver s hermetickou identitou (žádný .env z disku). */
function resolver(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn("bash", [RESOLVER, ...args], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        COOLIFY_URL: baseUrl,
        COOLIFY_API_TOKEN: "fixture-token",
        AISHA_IDENTITY_ROOT: PRAZDNY_KOREN,
        AISHA_INSTANCE_ENV: join(PRAZDNY_KOREN, ".env.coolify"),
        _COOLIFY_JSON_RT: "node", // runner node:20-bookworm nemá jq — měř tu cestu
        ...env,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr }));
  });
}

describe("bash resolver: rozsah projektu odvozený jako v cold-startu", () => {
  test("bez COOLIFY_PROJECT_UUID vybere NAŠI aisha-registry (projekt jménem instance), ne cizí první shodu", async () => {
    stav = vychozi();
    const r = await resolver(["aisha-registry"], { APP_NAME_PREFIX: "aisha" });
    expect(r.stderr).not.toMatch(/COOLIFY_PROJECT_UUID chybí/);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe(NASE);
  });

  test("negativní sonda: identita nedeklarovaná ⇒ rc 2, žádná UUID a ŽÁDNÝ globální /applications", async () => {
    stav = vychozi();
    const r = await resolver(["aisha-registry"], {});
    expect(r.code).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/::error::.*rozsah projektu instance se nezjistil/);
    expect(stav.dotazy, "resolver sáhl po seznamu všech nájemníků").not.toContain("/applications");
  });

  test("negativní sonda: dva projekty jménem instance ⇒ rc 2 (nehádá, který je náš)", async () => {
    stav = vychozi();
    stav.projects.push({ name: "AISHA", uuid: "projdruhy000000000000001" });
    const r = await resolver(["aisha-registry"], { APP_NAME_PREFIX: "aisha" });
    expect(r.code).toBe(2);
    expect(r.stdout).toBe("");
  });

  test("připnuté COOLIFY_PROJECT_UUID vyhrává nad odvozením", async () => {
    stav = vychozi();
    const r = await resolver(["aisha-registry"], {
      APP_NAME_PREFIX: "aisha",
      COOLIFY_PROJECT_UUID: "projnase0000000000000001",
    });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe(NASE);
    expect(stav.dotazy).not.toContain("/projects");
  });

  test("negativní sonda: dvě aplikace téhož jména UVNITŘ projektu ⇒ rc 3, nevybírá", async () => {
    stav = vychozi();
    stav.applications.push({ name: "aisha-core", uuid: "nasecore00000000000000002", environment_id: 13 });
    const r = await resolver(["aisha-core"], { APP_NAME_PREFIX: "aisha" });
    expect(r.code).toBe(3);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/VÍC aplikací/);
  });

  test('aplikace mimo projekt je „není“ (rc 1), i když ji cizí nájemník jmenovitě má', async () => {
    stav = vychozi();
    stav.applications.push({ name: "aisha-jen-cizi", uuid: "cizijen000000000000000001", environment_id: 10 });
    const r = await resolver(["aisha-jen-cizi"], { APP_NAME_PREFIX: "aisha" });
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
  });

  test("--all-aisha: duplicita v projektu se pozná i bez jq (node runtime) ⇒ rc 3", async () => {
    stav = vychozi();
    stav.applications.push({ name: "aisha-core", uuid: "nasecore00000000000000002", environment_id: 13 });
    const r = await resolver(["--all-aisha"], { APP_NAME_PREFIX: "aisha" });
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/DVĚ aplikace téhož jména/);
  });

  test("--all-aisha: mapa nese jen aplikace projektu", async () => {
    stav = vychozi();
    const r = await resolver(["--all-aisha"], { APP_NAME_PREFIX: "aisha" });
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ "aisha-registry": NASE, "aisha-core": "nasecore00000000000000001" });
  });
});

describe("node resolver: týž rozsah, vstříknutý klient", () => {
  const klient = () => async (cesta) => {
    if (cesta === "/projects") return stav.projects;
    const p = /^\/projects\/([^/]+)$/.exec(cesta);
    if (p) return { environments: (stav.envs[p[1]] || []).map((id) => ({ id })) };
    if (cesta === "/applications") return stav.applications;
    return null;
  };

  test("resolveUuid vrací naši aplikaci, ne první shodu napříč nájemníky", async () => {
    stav = vychozi();
    clearCache();
    expect(await resolveUuid("aisha-registry", { coolify: klient(), env: { APP_NAME_PREFIX: "aisha" } })).toBe(NASE);
  });

  test("negativní sonda: bez identity HÁZE (žádný globální seznam)", async () => {
    stav = vychozi();
    await expect(resolveUuid("aisha-registry", { coolify: klient(), env: {} })).rejects.toThrow(/No target project/);
  });

  test("negativní sonda: duplicita v projektu HÁZE v resolveUuid i resolveAllAishaUuids", async () => {
    stav = vychozi();
    stav.applications.push({ name: "aisha-core", uuid: "nasecore00000000000000002", environment_id: 13 });
    const opts = { coolify: klient(), env: { APP_NAME_PREFIX: "aisha" } };
    await expect(resolveUuid("aisha-core", opts)).rejects.toThrow(/dvojznačný/);
    await expect(resolveAllAishaUuids(opts)).rejects.toThrow(/duplicitní jména/);
  });
});
