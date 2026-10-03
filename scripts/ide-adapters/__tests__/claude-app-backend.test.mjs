/**
 * @module claude-app-backend.test (vitest)
 * Thorough coverage for the parity layer: the zero-dep backend client
 * (server/backend.mjs config/auth resolution + fail-soft) and the parity tools
 * (server/parity.mjs) — local (compliance/estimate/onboard) and backend
 * (proposals/spend) — without hitting the network.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const SERVER_DIR = path.join(REPO_ROOT, "extensions", "aisha-dirigent-claude", "server");

const BACKEND_ENV = ["AISHA_URL", "AISHA_GATEWAY_URL", "AISHA_TOKEN", "AISHA_SERVICE_KEY", "AISHA_POSTGREST_SERVICE_KEY", "VITE_AISHA_GATEWAY_KEY", "AISHA_MCP_URL"];

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
});

/** Temp workspace with optional .aisha config files. */
function workspace(files = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "aisha-be-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content));
  }
  return dir;
}

const importBackend = () => import(path.join(SERVER_DIR, "backend.mjs"));
const tool = async (name) => (await import(path.join(SERVER_DIR, "tools.mjs"))).TOOLS.find((t) => t.name === name);

describe("backend.mjs — resolveBackend precedence", () => {
  test("env wins over config; mcpUrl derived from url", async () => {
    const { resolveBackend } = await importBackend();
    const root = workspace({ ".aisha/dirigent.local.json": { activeProfile: "local", profiles: { local: { aishaUrl: "http://cfg:1" } } } });
    process.env.AISHA_URL = "http://env:9";
    process.env.AISHA_TOKEN = "tok-env";
    const r = resolveBackend(root);
    expect(r.url).toBe("http://env:9");
    expect(r.token).toBe("tok-env");
    expect(r.mcpUrl).toMatch(/http:\/\/env:9\/functions\/v1\/mcp-knowledge-server/);
  });

  test("falls back to .aisha config when env is empty", async () => {
    const { resolveBackend } = await importBackend();
    const root = workspace({
      ".aisha/dirigent.local.json": { activeProfile: "local", profiles: { local: { aishaUrl: "http://cfg:2" } } },
      ".aisha/dirigent.template.json": { activeProfile: "local", profiles: { local: { anonKey: "anon-xyz" } } },
    });
    const r = resolveBackend(root);
    expect(r.url).toBe("http://cfg:2");
    expect(r.token).toBe("anon-xyz");
  });

  test(".mcp.json aisha-knowledge url is preferred for mcpUrl", async () => {
    const { resolveBackend } = await importBackend();
    const root = workspace({ ".mcp.json": { mcpServers: { "aisha-knowledge": { url: "https://mcp.example/x" } } } });
    expect(resolveBackend(root).mcpUrl).toBe("https://mcp.example/x");
  });

  test("local activeProfile keys the TEMPLATE profile too (aishaUrl from template)", async () => {
    const { resolveBackend } = await importBackend();
    // Developer selects "aisha" locally without duplicating the shared URL;
    // the tracked template carries profiles.aisha.aishaUrl.
    const root = workspace({
      ".aisha/dirigent.local.json": { activeProfile: "aisha", profiles: { aisha: {} } },
      ".aisha/dirigent.template.json": {
        activeProfile: "local",
        profiles: { local: { anonKey: "anon-local" }, aisha: { aishaUrl: "https://api.example/aisha" } },
      },
    });
    const r = resolveBackend(root);
    expect(r.url).toBe("https://api.example/aisha");
    expect(r.mcpUrl).toBe("https://api.example/aisha/functions/v1/mcp-knowledge-server");
  });

  test("fresh checkout (no local.json) falls back to the template's own activeProfile", async () => {
    const { resolveBackend } = await importBackend();
    // Mirrors the committed template: activeProfile "local" has no aishaUrl,
    // so the aisha profile's URL must NOT leak in and url stays null.
    const root = workspace({
      ".aisha/dirigent.template.json": {
        activeProfile: "local",
        profiles: { local: { anonKey: "anon-local" }, aisha: { aishaUrl: "https://api.example/aisha" } },
      },
    });
    const r = resolveBackend(root);
    expect(r.url).toBe(null);
    expect(r.token).toBe("anon-local");
    expect(r.mcpUrl).toBe(null);
  });
});

describe("backend.mjs — fail soft without creds", () => {
  test("backendRpc returns not-configured (no network) when url/token missing", async () => {
    const { backendRpc } = await importBackend();
    const root = workspace({}); // no config, no env
    const r = await backendRpc(root, "any_rpc", {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not configured|backend/i);
  });

  test("backendMcpTool returns not-configured when no mcpUrl", async () => {
    const { backendMcpTool } = await importBackend();
    const r = await backendMcpTool(workspace({}), "get_improvement_proposals", {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not configured|backend/i);
  });
});

describe("parity tools — local", () => {
  test("aisha_compliance summary lists gates + onboarding mandate (no run)", async () => {
    const res = await (await tool("aisha_compliance")).handler({}, { root: REPO_ROOT });
    expect(res.isError).toBeFalsy();
    expect(res.text).toMatch(/complianceGates/);
    expect(res.text).toMatch(/gate:|test:gates/);
  });

  test("aisha_compliance rejects an unknown gate when run=true", async () => {
    const res = await (await tool("aisha_compliance")).handler({ run: true, gate: "no:such:gate" }, { root: REPO_ROOT });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/No such npm script/);
  });

  test("aisha_estimate prices known models and yields null for unknown", async () => {
    const root = workspace({
      ".aisha/dirigent.template.json": {
        routerCoach: { slotProfile: "balanced", slotProfiles: { known: { default: "claude-sonnet-4-20250514" }, unknown: { default: "some-exotic-model" } } },
      },
    });
    const res = await (await tool("aisha_estimate")).handler({ tokens: 1_000_000, slot: "default" }, { root });
    const data = JSON.parse(res.text.replace(/^```json\n/, "").replace(/\n```$/, ""));
    const byName = Object.fromEntries(data.estimates.map((e) => [e.profile, e.usd]));
    expect(byName.known).toBe(6); // 1M tokens * $6/Mtok
    expect(byName.unknown).toBe(null);
  });

  test("aisha_onboard returns the mandate + doc sections", async () => {
    const res = await (await tool("aisha_onboard")).handler({}, { root: REPO_ROOT });
    expect(res.isError).toBeFalsy();
    expect(res.text).toMatch(/classification|consent|onboarding/i);
  });
});

describe("parity tools — backend (no network)", () => {
  test("aisha_proposals fails soft when backend unconfigured", async () => {
    const res = await (await tool("aisha_proposals")).handler({}, { root: workspace({}) });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/not configured|backend/i);
  });

  test("aisha_spend_reject requires runId and previews without apply", async () => {
    const t = await tool("aisha_spend_reject");
    const noId = await t.handler({}, { root: REPO_ROOT });
    expect(noId.isError).toBe(true);
    const preview = await t.handler({ runId: "r-9", reason: "too costly" }, { root: REPO_ROOT });
    expect(preview.isError).toBeFalsy();
    expect(preview.text).toMatch(/Preview/);
    expect(preview.text).toMatch(/reject_task_spend_audited/);
    expect(preview.text).toMatch(/too costly/);
  });

  test("aisha_spend_approve preview includes raised budget when provided", async () => {
    const preview = await (await tool("aisha_spend_approve")).handler({ runId: "r-1", raiseBudgetUsd: 5 }, { root: REPO_ROOT });
    expect(preview.isError).toBeFalsy();
    expect(preview.text).toMatch(/p_raise_budget_usd/);
  });
});
