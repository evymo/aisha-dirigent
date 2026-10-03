/**
 * Security tests for the Claude/Zed MCP backend resolver.
 */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveBackend } from "../server/backend.mjs";

function makeRoot({ backendUrl = "https://api.aisha.test", mcpUrl } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "aisha-claude-backend-"));
  mkdirSync(path.join(root, ".aisha"), { recursive: true });
  writeFileSync(
    path.join(root, ".aisha", "dirigent.local.json"),
    JSON.stringify({
      activeProfile: "local",
      profiles: {
        local: {
          aishaUrl: backendUrl,
          anonKey: "anon-token",
        },
      },
    }),
  );
  if (mcpUrl) {
    writeFileSync(
      path.join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          "aisha-knowledge": { url: mcpUrl },
        },
      }),
    );
  }
  return root;
}

function withCleanBackendEnv(fn) {
  const keys = [
    "AISHA_URL",
    "AISHA_GATEWAY_URL",
    "AISHA_TOKEN",
    "AISHA_SERVICE_KEY",
    "AISHA_POSTGREST_SERVICE_KEY",
    "VITE_AISHA_GATEWAY_KEY",
    "AISHA_MCP_URL",
  ];
  const snapshot = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  try {
    return fn();
  } finally {
    for (const key of keys) {
      const value = snapshot.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("workspace MCP URL receives token only when it shares backend origin", () => withCleanBackendEnv(() => {
  const root = makeRoot({
    backendUrl: "https://api.aisha.test",
    mcpUrl: "https://api.aisha.test/functions/v1/mcp-knowledge-server",
  });

  const resolved = resolveBackend(root);
  assert.equal(resolved.url, "https://api.aisha.test");
  assert.equal(resolved.mcpUrl, "https://api.aisha.test/functions/v1/mcp-knowledge-server");
  assert.equal(resolved.mcpToken, "anon-token");
}));

test("workspace MCP URL on another origin does not receive AISHA token", () => withCleanBackendEnv(() => {
  const root = makeRoot({
    backendUrl: "https://api.aisha.test",
    mcpUrl: "https://evil.example.test/collect",
  });

  const resolved = resolveBackend(root);
  assert.equal(resolved.url, "https://api.aisha.test");
  assert.equal(resolved.mcpUrl, "https://evil.example.test/collect");
  assert.equal(resolved.mcpToken, null);
}));

test("explicit AISHA_MCP_URL env is treated as operator-owned and may receive token", () => withCleanBackendEnv(() => {
  process.env.AISHA_MCP_URL = "https://mcp.operator.example/tools";
  const root = makeRoot({
    backendUrl: "https://api.aisha.test",
    mcpUrl: "https://evil.example.test/collect",
  });

  const resolved = resolveBackend(root);
  assert.equal(resolved.mcpUrl, "https://mcp.operator.example/tools");
  assert.equal(resolved.mcpToken, "anon-token");
}));

test("invalid backend URL is ignored instead of being used for RPC", () => withCleanBackendEnv(() => {
  const root = makeRoot({
    backendUrl: 'https://api.aisha.test/" onload="alert(1)',
  });

  const resolved = resolveBackend(root);
  assert.equal(resolved.url, null);
  assert.equal(resolved.mcpUrl, null);
}));

test("a scoped PAT (AISHA_TOKEN) is preferred over a service_role key", () => withCleanBackendEnv(() => {
  process.env.AISHA_TOKEN = "mcp_scoped_pat";
  process.env.AISHA_SERVICE_KEY = "service_role_jwt";
  const root = makeRoot();

  const resolved = resolveBackend(root);
  // Least-privilege: the scoped token wins even when a service_role key is set.
  assert.equal(resolved.token, "mcp_scoped_pat");
}));

test("a service_role key is honored as fallback but warns loudly about RLS bypass (once)", () => withCleanBackendEnv(() => {
  process.env.AISHA_SERVICE_KEY = "service_role_jwt";
  const root = makeRoot();

  const originalWrite = process.stderr.write.bind(process.stderr);
  const lines = [];
  process.stderr.write = (chunk, ...rest) => {
    lines.push(String(chunk));
    return true;
  };
  try {
    const first = resolveBackend(root);
    const second = resolveBackend(root);
    // Behavior preserved: the service_role key is still used when no PAT exists.
    assert.equal(first.token, "service_role_jwt");
    assert.equal(second.token, "service_role_jwt");
  } finally {
    process.stderr.write = originalWrite;
  }

  const warnings = lines.filter((l) => l.includes("service_role"));
  // Fail-loud, but not spammy: at most one warning across repeated resolves
  // (module-level warn-once — earlier tests in this process may have consumed it).
  assert.ok(warnings.length <= 1, `expected <=1 service_role warning, got ${warnings.length}`);
  for (const w of warnings) {
    assert.match(w, /service_role/);
    assert.match(w, /row-level security|RLS/i);
    assert.match(w, /AISHA_TOKEN/);
  }
}));
