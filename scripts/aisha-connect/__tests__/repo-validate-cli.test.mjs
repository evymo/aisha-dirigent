import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverInstance } from "../lib/discovery.mjs";
import { parseSseMessage } from "../lib/mcp-client.mjs";
import { toCredential } from "../lib/oauth.mjs";
import {
  dirigentProfileFrom,
  ensureGitignored,
  headersHelperCommand,
  mcpServerEntry,
  registerWithClaude,
  shellQuote,
  writeDirigentLocal,
  writeProjectMcpJson,
} from "../lib/repo-config.mjs";
import { runValidation, summarize } from "../lib/validate.mjs";
import { connectEnv, main, parseArgs } from "../cli.mjs";
import { startFakeInstance } from "./fake-instance.mjs";

let instance;
let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aisha-connect-"));
});
afterEach(async () => {
  await instance?.close();
  instance = undefined;
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const git = (cwd, ...args) => spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

describe("repository wiring", () => {
  const profile = {
    apiBase: "https://api.example.org",
    appConfig: {
      aisha_url: "https://api.example.org",
      mcp_url: "https://api.example.org/functions/v1/mcp-knowledge-server",
      keycloak_url: "https://auth.example.org/realms/aisha",
      anon_key: "anon",
      web_url: "https://web.example.org",
      n8n_trigger_url: "",
    },
  };

  test("dirigent.local.json: profile upserted + activated, everything else kept", () => {
    mkdirSync(join(dir, ".aisha"));
    writeFileSync(
      join(dir, ".aisha/dirigent.local.json"),
      JSON.stringify({ activeProfile: "local", storyId: "s-1", profiles: { local: { aishaUrl: "http://localhost:3001" }, "example.org": { custom: 1 } } }),
    );
    writeDirigentLocal(dir, "example.org", dirigentProfileFrom("example.org", profile));
    const cfg = JSON.parse(readFileSync(join(dir, ".aisha/dirigent.local.json"), "utf8"));
    expect(cfg.activeProfile).toBe("example.org");
    expect(cfg.storyId).toBe("s-1");
    expect(cfg.profiles.local.aishaUrl).toBe("http://localhost:3001");
    expect(cfg.profiles["example.org"]).toMatchObject({
      custom: 1,
      aishaUrl: "https://api.example.org",
      mcpUrl: "https://api.example.org/functions/v1/mcp-knowledge-server",
      keycloakUrl: "https://auth.example.org/realms/aisha",
      connectProfile: "example.org",
    });
    expect(cfg.profiles["example.org"]).not.toHaveProperty("n8nTriggerUrl");
    expect(JSON.stringify(cfg)).not.toMatch(/access_token|refresh_token/);
  });

  test("a malformed dirigent.local.json is refused, not overwritten", () => {
    mkdirSync(join(dir, ".aisha"));
    writeFileSync(join(dir, ".aisha/dirigent.local.json"), "{ broken");
    expect(() => writeDirigentLocal(dir, "p", {})).toThrow(/not valid JSON/);
    expect(readFileSync(join(dir, ".aisha/dirigent.local.json"), "utf8")).toBe("{ broken");
  });

  test(".gitignore gains the local profile once", () => {
    expect(ensureGitignored(dir)).toBe("no-git");
    git(dir, "init", "-q");
    expect(ensureGitignored(dir)).toBe("added");
    expect(ensureGitignored(dir)).toBe("already-ignored");
    expect(readFileSync(join(dir, ".gitignore"), "utf8").match(/dirigent\.local\.json/g)).toHaveLength(1);
  });

  test("headersHelper command quotes paths safely", () => {
    expect(shellQuote("it's", "linux")).toBe(`'it'\\''s'`);
    expect(shellQuote('a"b', "win32")).toBe('"a""b"');
    const cmd = headersHelperCommand("/opt/a b/cli.mjs", "example.org", { nodePath: "/usr/bin/node", platform: "linux" });
    expect(cmd).toBe(`'/usr/bin/node' '/opt/a b/cli.mjs' 'token' '--profile' 'example.org' '--format' 'header'`);
  });

  test("MCP entries: helper (machine-local) vs native OAuth (shareable)", () => {
    const url = profile.appConfig.mcp_url;
    expect(mcpServerEntry({ mcpUrl: url, auth: "helper", helperCommand: "x" })).toEqual({ type: "http", url, headersHelper: "x" });
    expect(mcpServerEntry({ mcpUrl: url, auth: "oauth" })).toEqual({ type: "http", url, oauth: { clientId: "aisha-mcp-client", callbackPort: 59876 } });
    expect(() => mcpServerEntry({ mcpUrl: url, auth: "basic" })).toThrow(/unknown --mcp-auth/);
  });

  test(".mcp.json keeps other servers and never receives a machine path", () => {
    writeFileSync(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    expect(() => writeProjectMcpJson(dir, { type: "http", url: "u", headersHelper: "/home/me/cli" })).toThrow(/local scope/);
    writeProjectMcpJson(dir, mcpServerEntry({ mcpUrl: "https://api.example.org/mcp", auth: "oauth" }));
    const mcp = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf8"));
    expect(Object.keys(mcp.mcpServers).sort()).toEqual(["aisha-knowledge", "other"]);
  });

  test("Claude Code registration: replaces the local entry, or tells you the command", () => {
    const entry = { type: "http", url: "u" };
    const calls = [];
    const ok = registerWithClaude(dir, entry, { run: (cmd, args) => (calls.push(args.join(" ")), { status: 0, stdout: "", stderr: "" }) });
    expect(ok.status).toBe("registered");
    expect(calls).toEqual(["--version", "mcp remove --scope local aisha-knowledge", `mcp add-json --scope local aisha-knowledge ${JSON.stringify(entry)}`]);
    const missing = registerWithClaude(dir, entry, { run: () => ({ error: new Error("ENOENT") }) });
    expect(missing.status).toBe("no-claude");
    expect(missing.command).toContain("claude mcp add-json --scope local aisha-knowledge '");
  });
});

describe("validate", () => {
  async function ctxFor(inst, { loggedIn = true } = {}) {
    const profile = await discoverInstance(inst.base);
    let credential = loggedIn ? toCredential(inst.issueTokens(), { issuer: profile.oidc.issuer, clientId: "aisha-dirigent-device" }) : null;
    return { profileName: "t", profile, credential, persistCredential: (c) => (credential = c), checkMcpOAuth: true };
  }
  const byId = (results) => Object.fromEntries(results.map((r) => [r.id, r]));

  test("a healthy instance + login passes every check", async () => {
    instance = await startFakeInstance();
    const results = await runValidation(await ctxFor(instance));
    const r = byId(results);
    expect(summarize(results)).toMatchObject({ ok: true, failed: 0 });
    expect(r["mcp-requires-auth"].detail).toMatch(/401/);
    expect(r["mcp-tools"].detail).toBe("2 tools");
    expect(r["mcp-oauth-client"].status).toBe("pass");
  });

  test("MCP over SSE responses works the same", async () => {
    instance = await startFakeInstance({ mcpSse: true });
    expect(summarize(await runValidation(await ctxFor(instance))).ok).toBe(true);
  });

  test("an MCP that answers anonymous callers FAILS — the knowledge base would be public", async () => {
    instance = await startFakeInstance({ mcpEnforcesAuth: false });
    const r = byId(await runValidation(await ctxFor(instance)));
    expect(r["mcp-requires-auth"].status).toBe("fail");
  });

  test("without a login: one red line, the dependent checks are skipped", async () => {
    instance = await startFakeInstance();
    const results = await runValidation(await ctxFor(instance, { loggedIn: false }));
    const r = byId(results);
    expect(r.login.status).toBe("fail");
    expect(r.login.detail).toMatch(/aisha-connect login --profile t/);
    for (const id of ["token-claims", "userinfo", "mcp-initialize", "mcp-tools"]) expect(r[id].status).toBe("skip");
    expect(summarize(results).failed).toBe(1);
  });

  test("repo check: the active profile must point at the instance", async () => {
    instance = await startFakeInstance();
    const ctx = await ctxFor(instance);
    expect(byId(await runValidation({ ...ctx, repoDir: dir }))["repo-config"].status).toBe("warn");
    writeDirigentLocal(dir, "t", dirigentProfileFrom("t", ctx.profile));
    expect(byId(await runValidation({ ...ctx, repoDir: dir }))["repo-config"].status).toBe("pass");
  });

  test("parseSseMessage picks the response with the right id", () => {
    const sse = `event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":true}}\n\n`;
    expect(parseSseMessage(sse, 2).result.ok).toBe(true);
    expect(parseSseMessage(sse, 3)).toBeNull();
  });
});

describe("CLI", () => {
  test("parseArgs: flags, --k=v, booleans and the -- passthrough", () => {
    const f = parseArgs(["--profile", "p", "--json", "--format=header", "pos", "--", "node", "--version"]);
    expect(f).toMatchObject({ profile: "p", json: true, format: "header", _: ["pos"], passthrough: ["node", "--version"] });
  });

  test("connectEnv exports the names existing scripts read", () => {
    const env = connectEnv("p", { appConfig: { aisha_url: "a", mcp_url: "m", keycloak_url: "k", anon_key: "n", n8n_trigger_url: "" } });
    expect(env).toMatchObject({ AISHA_URL: "a", AISHA_API_BASE_URL: "a", AISHA_MCP_URL: "m", AISHA_POSTGREST_ANON_KEY: "n", AISHA_PROFILE: "p" });
    expect(env).not.toHaveProperty("AISHA_N8N_TRIGGER_URL");
    expect(env).not.toHaveProperty("AISHA_ACCESS_TOKEN");
  });

  test("login → init → validate → token, end to end against the fake instance", async () => {
    instance = await startFakeInstance({ deviceSequence: ["success"] });
    vi.stubEnv("AISHA_CONFIG_DIR", join(dir, "cfg"));
    const out = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => (out.push(String(s)), true));
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    expect(await main(["login", "--url", instance.base, "--profile", "fake", "--no-open"])).toBe(0);
    expect(out.join("")).toMatch(/logged in as dev@example\.com/);
    expect(existsSync(join(dir, "cfg", "credentials.json"))).toBe(true);

    const repo = join(dir, "repo");
    mkdirSync(repo);
    git(repo, "init", "-q");
    expect(await main(["init", "--repo", repo, "--mcp", "project", "--mcp-auth", "oauth"])).toBe(0);
    expect(JSON.parse(readFileSync(join(repo, ".mcp.json"), "utf8")).mcpServers["aisha-knowledge"].oauth.clientId).toBe("aisha-mcp-client");
    expect(readFileSync(join(repo, ".gitignore"), "utf8")).toMatch(/\.aisha\/dirigent\.local\.json/);

    out.length = 0;
    expect(await main(["validate", "--repo", repo, "--json"])).toBe(0);
    const report = JSON.parse(out.join(""));
    expect(report).toMatchObject({ profile: "fake", ok: true });
    expect(report.checks.find((c) => c.id === "repo-config").status).toBe("pass");

    out.length = 0;
    expect(await main(["token", "--format", "header"])).toBe(0);
    expect(Object.keys(JSON.parse(out.join("")))).toEqual(["Authorization"]);

    expect(await main(["logout"])).toBe(0);
    expect(instance.state.revoked.at(-1)).toMatchObject({ token_type_hint: "refresh_token" });
    await expect(main(["token"])).rejects.toThrow(/not logged in/);
  });
});
