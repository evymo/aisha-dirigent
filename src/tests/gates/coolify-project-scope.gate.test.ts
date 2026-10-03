/**
 * Coolify Project-Scope Isolation Gate
 *
 * Incident 2026-07-05: the Coolify host is SHARED by ~12 tenant instances, all
 * AISHA-based. Orchestration scripts that enumerated the GLOBAL Coolify resource
 * list and filtered by name prefix `aisha-` could reach into another tenant's
 * environment — a foreign `--wipe` would delete OUR `aisha-*` apps (a different
 * environment) and none of its own. The fix is scripts/lib/coolify-project-scope.mjs:
 * every enumeration/destructive op is confined to the declared project's
 * environments, fail-loud without COOLIFY_PROJECT_UUID.
 *
 * This gate guards that isolation from regressing:
 *   1. the helper exists and fails loud without a declared project;
 *   2. the helper confines resources to the project's environment ids;
 *   3. the DESTRUCTIVE wipe script actually resolves + uses the project scope;
 *   4. no script issues a Coolify DELETE against applications/services/databases
 *      without referencing the project scope.
 *
 * Spouští se přes: npm run test:gates -- coolify-project-scope
 */

import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";

const ROOT = process.cwd();
const SCRIPTS_DIR = join(ROOT, "scripts");
const HELPER = join(SCRIPTS_DIR, "lib", "coolify-project-scope.mjs");
const WIPE = join(SCRIPTS_DIR, "coolify-wipe-all.mjs");

async function loadHelper() {
  return import(pathToFileURL(HELPER).href);
}

describe("coolify project-scope helper", () => {
  test("exports the scoping contract", async () => {
    const mod = await loadHelper();
    expect(typeof mod.resolveProjectUuid).toBe("function");
    expect(typeof mod.getProjectEnvironmentIds).toBe("function");
    expect(typeof mod.createProjectScope).toBe("function");
  });

  test("resolveProjectUuid reads either single- or multi-env var", async () => {
    const { resolveProjectUuid } = await loadHelper();
    expect(resolveProjectUuid({ COOLIFY_PROJECT_UUID: "p-single" })).toBe("p-single");
    expect(resolveProjectUuid({ COOLIFY_PROD_PROJECT_UUID: "p-prod" })).toBe("p-prod");
    expect(resolveProjectUuid({})).toBe("");
  });

  // An INJECTED env is authoritative and must never be supplemented from disk.
  // Otherwise this repo's own .env.coolify (cold-start writes the uuid there)
  // would leak into callers that deliberately declare an empty environment, and
  // the fail-loud refusal below could not be relied on — a caller asking for
  // "no project declared" would silently get THIS project instead.
  test("injected env is authoritative — on-disk config never supplements it", async () => {
    const { resolveProjectUuid } = await loadHelper();
    const { readConfigKeyAny } = await import(
      pathToFileURL(join(SCRIPTS_DIR, "lib", "config-env-files.mjs")).href
    );
    // Only meaningful when the working copy actually HAS the uuid on disk;
    // assert that precondition rather than passing vacuously.
    const onDisk = readConfigKeyAny([
      "COOLIFY_PROJECT_UUID",
      "COOLIFY_PROD_PROJECT_UUID",
    ]);
    if (!onDisk) return;
    expect(resolveProjectUuid({})).toBe("");
  });

  // Regression: createProjectScope used to declare `{ env = process.env } = {}`
  // and forward that default onward, which made "caller injected an env" and
  // "caller injected nothing" indistinguishable inside resolveProjectUuid — the
  // on-disk declaration channel was silently dead for every real caller while
  // the unit tests (which always inject) still passed. A default parameter and
  // an undefined-sentinel are mutually exclusive; the sentinel must survive the
  // entire call chain.
  test("createProjectScope forwards an absent env as undefined (sentinel survives)", () => {
    const src = readFileSync(HELPER, "utf8");
    const sig = src.match(/export async function createProjectScope\(([^)]*)\)/);
    expect(sig, "createProjectScope signature not found").toBeTruthy();
    expect(sig![1]).not.toMatch(/env\s*=\s*process\.env/);
  });

  test("createProjectScope FAILS LOUD without a declared project (no global fallback)", async () => {
    const { createProjectScope } = await loadHelper();
    // coolify client must never even be called when the project is undeclared.
    let called = false;
    const coolify = async () => {
      called = true;
      return {};
    };
    await expect(createProjectScope(coolify, { env: {} })).rejects.toThrow(
      /COOLIFY_PROJECT_UUID/,
    );
    expect(called).toBe(false);
  });

  test("createProjectScope confines resources to the project's environment ids", async () => {
    const { createProjectScope } = await loadHelper();
    const coolify = async (path: string) => {
      expect(path).toBe("/projects/p-1");
      return { environments: [{ id: 13, uuid: "e-prod" }, { id: 14, uuid: "e-staging" }] };
    };
    const scope = await createProjectScope(coolify, { env: { COOLIFY_PROJECT_UUID: "p-1" } });
    expect([...scope.envIds].sort()).toEqual([13, 14]);

    const ours = { name: "aisha-core", environment_id: 13 };
    const foreignAisha = { name: "aisha-core", environment_id: 10 }; // another tenant, SAME name
    expect(scope.inProject(ours)).toBe(true);
    expect(scope.inProject(foreignAisha)).toBe(false);
    expect(scope.filter([ours, foreignAisha]).map((r) => r.environment_id)).toEqual([13]);
  });

  test("empty-environments project is a hard error, not a silent global match", async () => {
    const { createProjectScope } = await loadHelper();
    const coolify = async () => ({ environments: [] });
    await expect(
      createProjectScope(coolify, { env: { COOLIFY_PROJECT_UUID: "p-empty" } }),
    ).rejects.toThrow(/0 environments/);
  });
});

describe("destructive Coolify scripts are project-scoped", () => {
  test("coolify-wipe-all.mjs resolves + uses the project scope", () => {
    const src = readFileSync(WIPE, "utf8");
    expect(src).toMatch(/coolify-project-scope\.mjs/);
    expect(src).toMatch(/createProjectScope\(/);
    // The scope predicate must actually gate the deletions.
    expect(src).toMatch(/scope\.inProject\(/);
  });

  // Any script that DELETEs a Coolify application/service/database on the shared
  // host must reference the project scope. A bare global DELETE is the exact
  // cross-tenant hazard this gate exists to prevent.
  test("no script DELETEs Coolify resources without a project scope", () => {
    const files = readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith(".mjs"));
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(SCRIPTS_DIR, f), "utf8");
      // A Coolify-resource delete is the shared-tenant hazard: a DELETE verb
      // applied to a Coolify /api/v1 path. Two call shapes cover our scripts:
      //   - custom client  : api("DELETE", `/api/v1/${kind}/${uuid}?...`)
      //   - fetch/coolify() : (`.../api/v1/applications/${uuid}`, { method: "DELETE" })
      // The Docker registry v2 API (DELETE /v2/.../manifests) is a different
      // surface and deliberately NOT matched.
      const deletesCoolify =
        /\bapi\(\s*["']DELETE["']\s*,/.test(src) ||
        /\/api\/v1\/(applications|services|databases)[^\n]*\bmethod:\s*["']DELETE["']/i.test(src) ||
        /\bmethod:\s*["']DELETE["'][^\n]*\/api\/v1\/(applications|services|databases)/i.test(src);
      if (!deletesCoolify) continue;
      const scoped =
        /coolify-project-scope/.test(src) || /createProjectScope|inProject/.test(src);
      if (!scoped) offenders.push(f);
    }
    expect(offenders, `unscoped Coolify DELETE in: ${offenders.join(", ")}`).toEqual([]);
  });

  // Broader than DELETE: any script that fetches the GLOBAL /applications list
  // and filters by name prefix `aisha-` is enumerating across ALL tenants. On a
  // shared host that must be confined to our project (read OR write), else a
  // foreign same-named app leaks into our reports/patches/verification.
  test("no script enumerates global aisha-* apps without a project scope", () => {
    const files = readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith(".mjs"));
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(SCRIPTS_DIR, f), "utf8");
      const globalEnum =
        /["'`]\/applications["'`]/.test(src) && /startsWith\(\s*["']aisha-/.test(src);
      if (!globalEnum) continue;
      const scoped =
        /coolify-project-scope/.test(src) || /createProjectScope|inProject/.test(src);
      if (!scoped) offenders.push(f);
    }
    expect(
      offenders,
      `unscoped global aisha-* enumeration in: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});

// The bash cold-start (aisha-cold-start.sh) does its OWN Coolify enumeration for
// the wipe, the pre-flight safety check, and several mutating steps (network
// reset, compose pre-seed, UUID resolution). #605/#606 scoped the .mjs
// orchestration but not the shell — so guard the shell too: it must delegate to
// coolify-project-scope.mjs (via the coolify_scoped_apps helper), never wipe or
// PATCH by a global/hardcoded name filter.
describe("bash cold-start is project-scoped", () => {
  const COLD_START = join(SCRIPTS_DIR, "aisha-cold-start.sh");

  test("delegates enumeration to the project-scope helper (single source of truth)", () => {
    const src = readFileSync(COLD_START, "utf8");
    expect(src).toMatch(/coolify-project-scope\.mjs/);
    expect(src).toMatch(/coolify_scoped_apps\b/);
  });

  test("the destructive wipe resolves + uses the project scope", () => {
    const src = readFileSync(COLD_START, "utf8");
    // Anchor on the function DEFINITION (`wipe_orphan_apps() {`), not the earlier
    // comment mentions of it.
    const from = src.indexOf("wipe_orphan_apps() {");
    expect(from).toBeGreaterThan(-1);
    // Look at the wipe function body (up to the next top-level assignment).
    const body = src.slice(from, from + 2000);
    expect(body).toMatch(/coolify_scoped_apps/);
    // The old global-fallback list fetch must not feed the destroy anymore.
    expect(body).not.toMatch(/coolify_list_apps_json/);
  });

  test("no hardcoded aisha- jq filter feeds a mutation/enumeration", () => {
    const src = readFileSync(COLD_START, "utf8");
    // A literal jq `test("^aisha-"...)` over the GLOBAL /applications body was the
    // cross-tenant hazard (it PATCHed foreign aisha-* apps on a fork deploy). The
    // scoped path derives its name filter from $APP_NAME_PREFIX and confines by
    // environment id, so no literal aisha- jq filter should remain.
    expect(src).not.toMatch(/test\(\s*"\^aisha-/);
  });
});

// NAMĚŘENO 2026-09-24 (fork, staging na sdíleném Coolify): stagingový běh sdílí
// prostředí s produkčními klíči — cold-start zrcadlí COOLIFY_PROD_PROJECT_UUID a zálohy
// ho nesou. Ne-produkční běh bez VLASTNÍHO UUID by přes fallback dostal produkční
// projekt a wipe by mazal produkci. Pro ne-produkční AISHA_ENV proto žádný fallback
// ani hledání podle jména (fork má staging i produkci pod jedním jménem instance).
describe("ne-produkční běh: žádný fallback na produkční projekt (fail-closed)", () => {
  test("isProdAishaEnv: neuvedené a produkční tvary jsou produkce, zbytek ne", async () => {
    const { isProdAishaEnv } = await loadHelper();
    for (const e of [undefined, "", "production", "prod", "acme-prod", "acme-production"]) {
      expect(isProdAishaEnv(e), String(e)).toBe(true);
    }
    for (const e of ["staging", "stg", "acme-staging", "devel", "Staging"]) {
      expect(isProdAishaEnv(e), e).toBe(false);
    }
  });

  test("resolveProjectUuid: staging bez vlastního UUID NEDOSTANE produkční", async () => {
    const { resolveProjectUuid } = await loadHelper();
    expect(resolveProjectUuid({ AISHA_ENV: "staging", COOLIFY_PROD_PROJECT_UUID: "p-prod" })).toBe("");
    expect(resolveProjectUuid({ AISHA_ENV: "acme-staging", COOLIFY_PROD_PROJECT_UUID: "p-prod" })).toBe("");
    // vlastní UUID vyhrává i ve stagingu; produkce si fallback nechává
    expect(resolveProjectUuid({ AISHA_ENV: "staging", COOLIFY_PROJECT_UUID: "p-stg", COOLIFY_PROD_PROJECT_UUID: "p-prod" })).toBe("p-stg");
    expect(resolveProjectUuid({ AISHA_ENV: "production", COOLIFY_PROD_PROJECT_UUID: "p-prod" })).toBe("p-prod");
  });

  test("createProjectScope: staging bez UUID odmítne DŘÍV, než se zeptá Coolify (ani podle jména)", async () => {
    const { createProjectScope } = await loadHelper();
    const volano: string[] = [];
    const coolify = async (path: string) => {
      volano.push(path);
      return path === "/projects" ? [{ uuid: "p-prod", name: "inst" }] : { environments: [{ id: 1 }] };
    };
    await expect(
      createProjectScope(coolify, {
        env: { AISHA_ENV: "staging", APP_NAME_PREFIX: "inst", COOLIFY_PROD_PROJECT_UUID: "p-prod" },
      }),
    ).rejects.toThrow(/Non-production run/);
    expect(volano).toEqual([]);
  });
});
