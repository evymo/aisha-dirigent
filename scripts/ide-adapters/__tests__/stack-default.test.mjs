/**
 * @module stack-default.test (vitest)
 * Coverage for the --stack-default story resolution (replica twin pattern):
 *   - fetchStackDefaultStoryId() unit behavior (happy path, empty rows,
 *     non-ok response, resolveBackend precedence) with global fetch stubbed
 *     at the module boundary — no network.
 *   - generate-ide-instructions.mjs CLI guard paths, spawned against a
 *     temp-dir copy of scripts/ so no tracked file is read or mutated:
 *     offline conflict, lookup failure, null result, and flag priority
 *     (--story-id / .aisha/story.json win over --stack-default).
 */

import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fetchStackDefaultStoryId } from "../payload.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");

const STORY_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

// Every env key that can feed resolveBackend()/resolveDirigentConfig() —
// stripped per test so results never depend on the developer's shell.
const BACKEND_ENV = [
  "AISHA_POSTGREST_SERVICE_KEY",
  "VITE_AISHA_GATEWAY_KEY",
  "AISHA_POSTGREST_ANON_KEY",
  "VITE_AISHA_POSTGREST_PUBLISHABLE_KEY",
  "AISHA_POSTGREST_URL",
  "VITE_AISHA_GATEWAY_URL",
  "API_DOMAIN",
  "AISHA_MCP_URL",
];

let savedEnv;
beforeEach(() => {
  savedEnv = {};
  for (const k of BACKEND_ENV) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of BACKEND_ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
});

/** Stub global fetch, recording calls; returns the call log. */
function stubFetch(response) {
  const calls = [];
  vi.stubGlobal("fetch", async (url, init) => {
    calls.push({ url: String(url), init });
    return response;
  });
  return calls;
}

const okJson = (rows) => ({ ok: true, json: async () => rows });

describe("fetchStackDefaultStoryId — unit (fetch stubbed)", () => {
  test("happy path: returns rows[0].id and queries partner_stories with is_stack_default filter + auth headers", async () => {
    const calls = stubFetch(okJson([{ id: STORY_UUID }]));

    const id = await fetchStackDefaultStoryId({
      aishaUrl: "http://backend.test:3001",
      serviceKey: "opt-key",
    });

    expect(id).toBe(STORY_UUID);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "http://backend.test:3001/rest/v1/partner_stories?is_stack_default=eq.true&select=id&limit=1",
    );
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.headers.apikey).toBe("opt-key");
    expect(calls[0].init.headers.Authorization).toBe("Bearer opt-key");
    // The lookup must be time-bounded, not open-ended.
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  test("empty rows → returns null (no throw)", async () => {
    stubFetch(okJson([]));
    await expect(
      fetchStackDefaultStoryId({ aishaUrl: "http://backend.test:3001", serviceKey: "k" }),
    ).resolves.toBeNull();
  });

  test("!response.ok → throws loudly with status + body (no silent fallback)", async () => {
    stubFetch({ ok: false, status: 500, text: async () => "pg says no" });
    await expect(
      fetchStackDefaultStoryId({ aishaUrl: "http://backend.test:3001", serviceKey: "k" }),
    ).rejects.toThrow(/Stack-default story lookup failed \(500\): pg says no/);
  });

  test("resolveBackend precedence: options.serviceKey and options.aishaUrl win over env", async () => {
    process.env.AISHA_POSTGREST_SERVICE_KEY = "env-key";
    process.env.AISHA_POSTGREST_URL = "http://env-host:1111";
    const calls = stubFetch(okJson([{ id: STORY_UUID }]));

    await fetchStackDefaultStoryId({ aishaUrl: "http://opt-host:2222", serviceKey: "opt-key" });

    expect(calls[0].url).toMatch(/^http:\/\/opt-host:2222\//);
    expect(calls[0].init.headers.apikey).toBe("opt-key");
    expect(calls[0].init.headers.Authorization).toBe("Bearer opt-key");
  });

  test("resolveBackend precedence: AISHA_POSTGREST_SERVICE_KEY beats VITE_AISHA_GATEWAY_KEY; env URL used when no option", async () => {
    process.env.AISHA_POSTGREST_SERVICE_KEY = "service-key-env";
    process.env.VITE_AISHA_GATEWAY_KEY = "gateway-key-env";
    process.env.AISHA_POSTGREST_URL = "http://env-host:1111";
    const calls = stubFetch(okJson([{ id: STORY_UUID }]));

    await fetchStackDefaultStoryId();

    expect(calls[0].url).toBe(
      "http://env-host:1111/rest/v1/partner_stories?is_stack_default=eq.true&select=id&limit=1",
    );
    expect(calls[0].init.headers.apikey).toBe("service-key-env");
    expect(calls[0].init.headers.Authorization).toBe("Bearer service-key-env");
  });

  test("no key anywhere → throws before any network call", async () => {
    const calls = stubFetch(okJson([{ id: STORY_UUID }]));
    await expect(fetchStackDefaultStoryId({ aishaUrl: "http://backend.test:3001" })).rejects.toThrow(
      /No AISHA backend key found/,
    );
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// CLI guard paths — spawn the real generate-ide-instructions.mjs against a
// temp-dir copy of scripts/ (the CLI resolves ROOT relative to its own file,
// so the temp dir is the repo root it sees: no .env, no .aisha state, and no
// way to touch tracked files in this worktree).
// ---------------------------------------------------------------------------

describe("generate-ide-instructions --stack-default — CLI guard paths", () => {
  const tempRoots = [];

  /** Fresh fake repo root with a copy of scripts/ + config/ and optional extra files. */
  function makeCliRoot(files = {}) {
    const root = mkdtempSync(path.join(os.tmpdir(), "aisha-genide-"));
    tempRoots.push(root);
    cpSync(path.join(REPO_ROOT, "scripts"), path.join(root, "scripts"), { recursive: true });
    // payload.mjs derives its local-gateway default from the topology SoT
    // (config/local-presets.mjs), so the fake repo needs config/ too.
    cpSync(path.join(REPO_ROOT, "config"), path.join(root, "config"), { recursive: true });
    // The topology SoT also reads coolify/servers.json (buildTopology →
    // loadServers). Without it the derivation dies on ENOENT and — now that
    // identity is fail-loud instead of defaulting to "local" — the CLI stops
    // before reaching any guard under test. The sandbox models a repo root
    // that satisfies the SoT's declared inputs, not a partial one.
    mkdirSync(path.join(root, "coolify"), { recursive: true });
    cpSync(path.join(REPO_ROOT, "coolify", "servers.json"), path.join(root, "coolify", "servers.json"));
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(root, rel);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content));
    }
    return root;
  }

  /** process.env without any AISHA/gateway keys, plus explicit extras. */
  function cliEnv(extra = {}) {
    const env = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k.startsWith("AISHA_") || k.startsWith("VITE_AISHA_") || k === "API_DOMAIN") continue;
      env[k] = v;
    }
    return { ...env, ...extra };
  }

  function runCli(root, args, extraEnv = {}) {
    return spawnSync(process.execPath, [path.join(root, "scripts", "generate-ide-instructions.mjs"), ...args], {
      cwd: root,
      env: cliEnv(extraEnv),
      encoding: "utf8",
      timeout: 30_000,
    });
  }

  // Fetch stubs injected via NODE_OPTIONS --import so the "online" CLI paths
  // (lookup null / lookup resolved) run without any real network.
  let stubEmptyRows;
  let stubStoryRow;
  beforeAll(() => {
    const stubDir = mkdtempSync(path.join(os.tmpdir(), "aisha-genide-stubs-"));
    tempRoots.push(stubDir);
    stubEmptyRows = path.join(stubDir, "fetch-empty.mjs");
    writeFileSync(
      stubEmptyRows,
      `globalThis.fetch = async () => new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });\n`,
    );
    stubStoryRow = path.join(stubDir, "fetch-story.mjs");
    writeFileSync(
      stubStoryRow,
      [
        `globalThis.fetch = async (url) => {`,
        `  if (String(url).includes("/rest/v1/partner_stories")) {`,
        `    return new Response(JSON.stringify([{ id: "${STORY_UUID}" }]), { status: 200, headers: { "Content-Type": "application/json" } });`,
        `  }`,
        `  return new Response("stub: unexpected call", { status: 500 });`,
        `};`,
        ``,
      ].join("\n"),
    );
  });

  afterAll(() => {
    for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
  });

  test("--stack-default --offline (no story configured) → exit 1 with conflict message, before any lookup", () => {
    const res = runCli(makeCliRoot(), ["--stack-default", "--offline"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/--stack-default requires an online lookup and cannot be combined with --offline/);
    // The guard must fire before fetchStackDefaultStoryId — a lookup attempt
    // with stripped env would have failed loudly with a different message.
    expect(res.stderr).not.toMatch(/Stack-default story lookup failed/);
  });

  test("lookup failure (no backend key) → exit 1 with the lookup error, no fallback", () => {
    const res = runCli(makeCliRoot(), ["--stack-default"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/Stack-default story lookup failed: No AISHA backend key found/);
  });

  test("no stack-default story on the instance (empty rows) → exit 1 with actionable adopt message", () => {
    const res = runCli(makeCliRoot(), ["--stack-default"], {
      AISHA_POSTGREST_SERVICE_KEY: "test-key",
      NODE_OPTIONS: `--import ${stubEmptyRows}`,
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/no stack-default story exists on this instance/);
    expect(res.stderr).toMatch(/adopt_story_as_stack_default/);
  });

  test("stack-default resolved → announces the story id and feeds it into payload fetch", () => {
    const res = runCli(makeCliRoot(), ["--stack-default"], {
      AISHA_POSTGREST_SERVICE_KEY: "test-key",
      NODE_OPTIONS: `--import ${stubStoryRow}`,
    });
    expect(res.stdout).toMatch(/Resolved stack-default story: aaaaaaaa\.\.\./);
    // Payload RPC is stubbed to 500 and there is no cache in the temp root,
    // so the run still exits 1 — for the payload reason, not the lookup.
    expect(res.status).toBe(1);
    expect(res.stdout).toMatch(/Fetching payload .*\(story: aaaaaaaa\.\.\.\)/);
    expect(res.stderr).toMatch(/No cached payload available/);
  });

  test("flag priority: --story-id wins over --stack-default (stack-default branch never entered)", () => {
    // With --offline, entering the stack-default branch would exit with the
    // conflict message. A resolved --story-id must skip the branch entirely,
    // so the run proceeds to the offline payload stage instead.
    const res = runCli(makeCliRoot(), [`--story-id=${STORY_UUID}`, "--stack-default", "--offline"]);
    expect(res.status).toBe(1);
    expect(res.stderr).not.toMatch(/cannot be combined with --offline/);
    expect(res.stderr).toMatch(/No cached payload found at \.aisha\/instruction-payload\.json/);
  });

  test("flag priority: .aisha/story.json wins over --stack-default", () => {
    const root = makeCliRoot({ ".aisha/story.json": { story_id: STORY_UUID } });
    const res = runCli(root, ["--stack-default", "--offline"]);
    expect(res.status).toBe(1);
    expect(res.stderr).not.toMatch(/cannot be combined with --offline/);
    expect(res.stderr).toMatch(/No cached payload found at \.aisha\/instruction-payload\.json/);
  });

  // Diagnóza musí říkat pravdu o příčině: když spadne DERIVACE topologie
  // (chybějící vstup), nesmí chyba obviňovat deklaraci identity v profilu —
  // ta může být v pořádku, jen se k ní derivace nedostala. Bez tohoto testu
  // by poctivá větev diagnózy byla mrtvý kód a regrese by ji tiše vrátila
  // k vymyšlené příčině.
  test("chybějící vstup topologie → diagnóza jmenuje derivaci, ne profil", () => {
    const root = makeCliRoot();
    rmSync(path.join(root, "coolify", "servers.json"));
    const res = runCli(root, ["--stack-default"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/derive-domains\(local-dev\) selhal dřív, než mohl identitu doručit/);
    expect(res.stderr).not.toMatch(/profil `local-dev` nenese `app_name_prefix`/);
  });
});
