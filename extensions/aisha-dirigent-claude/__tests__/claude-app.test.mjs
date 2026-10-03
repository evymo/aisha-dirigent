/**
 * @module claude-app.test
 * Tests for the AISHA Dirigent Claude app: the gen:ide adapter, the MCP server
 * (surface + stdio protocol), and the zero-dep zip packer. Uses node:test only
 * (no extra dependencies), runnable via `npm run test:claude-app`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SERVER = path.join(APP_DIR, "server", "index.mjs");

// ───────────────────────────────────────────────────────────────────────────
// Adapter
// ───────────────────────────────────────────────────────────────────────────

test("adapter emits a valid MCPB manifest + plugin + commands", async () => {
  const { generate, meta } = await import(
    "../../../scripts/ide-adapters/adapter-claude-app.mjs"
  );
  assert.equal(meta.id, "claude-app");
  assert.equal(meta.multiFile, true);

  const out = await generate({ ruleset: { fingerprint: "fp-test" }, generated_at: "2026-01-01T00:00:00Z" });
  const byRel = new Map(
    out.files.map((f) => [f.path.replace("extensions/aisha-dirigent-claude/", ""), f.content]),
  );

  // MCPB manifest
  const manifest = JSON.parse(byRel.get("manifest.json"));
  assert.equal(manifest.manifest_version, "0.3");
  for (const field of ["name", "version", "description", "author", "server"]) {
    assert.ok(manifest[field] != null, `manifest missing ${field}`);
  }
  assert.equal(manifest.server.type, "node");
  assert.equal(manifest.server.entry_point, "server/index.mjs");
  assert.ok(Array.isArray(manifest.tools) && manifest.tools.length >= 15, "expected >=15 tools");
  assert.ok(manifest.user_config.workspace_root, "expected workspace_root user_config");

  // Claude Code plugin
  const plugin = JSON.parse(byRel.get(".claude-plugin/plugin.json"));
  assert.equal(plugin.name, "aisha-dirigent");
  const mcp = JSON.parse(byRel.get(".mcp.json"));
  assert.ok(mcp.mcpServers["aisha-dirigent"], "expected aisha-dirigent mcp server entry");

  // Every declared tool has a slash command
  for (const t of manifest.tools) {
    const slug = t.name.replace(/^aisha_/, "").replace(/_/g, "-");
    assert.ok(byRel.has(`commands/${slug}.md`), `missing command for ${t.name}`);
  }

  // Generated markdown carries the regeneration marker
  assert.match(byRel.get("skills/aisha-dirigent/SKILL.md"), /Auto-generated from AISHA Expert Overlay ruleset\./);
});

// ───────────────────────────────────────────────────────────────────────────
// Server — surface
// ───────────────────────────────────────────────────────────────────────────

test("server --list-tools exposes the full surface", () => {
  const out = runSync("node", [SERVER, "--list-tools"], REPO_ROOT);
  const surface = JSON.parse(out);
  assert.ok(surface.tools.length >= 15);
  for (const t of surface.tools) {
    assert.ok(t.name && t.description && t.inputSchema, `tool ${t.name} incomplete`);
  }
  const names = surface.tools.map((t) => t.name);
  for (const expected of ["aisha_seed_status", "aisha_merge_status", "aisha_route", "aisha_cost_usage", "aisha_sync_instructions"]) {
    assert.ok(names.includes(expected), `missing tool ${expected}`);
  }
  assert.ok(surface.resources.length >= 1);
});

// ───────────────────────────────────────────────────────────────────────────
// Server — stdio JSON-RPC
// ───────────────────────────────────────────────────────────────────────────

test("server answers MCP stdio: initialize, tools/list, tools/call", async () => {
  const responses = await mcpSession(
    [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "aisha_health", arguments: {} } },
    ],
    3,
  );
  const init = responses.find((r) => r.id === 1);
  assert.ok(init.result.serverInfo.name === "aisha-dirigent");
  assert.ok(init.result.protocolVersion);

  const list = responses.find((r) => r.id === 2);
  assert.ok(list.result.tools.length >= 15);

  const call = responses.find((r) => r.id === 3);
  assert.equal(call.result.isError, false);
  assert.equal(call.result.content[0].type, "text");
  assert.match(call.result.content[0].text, /node|platform|tools/);
});

test("server returns a JSON-RPC error for an unknown tool", async () => {
  const responses = await mcpSession(
    [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "does_not_exist", arguments: {} } },
    ],
    2,
  );
  const err = responses.find((r) => r.id === 2);
  assert.ok(err.error, "expected an error object");
  assert.equal(err.error.code, -32602);
});

// ───────────────────────────────────────────────────────────────────────────
// Packer (mini-zip)
// ───────────────────────────────────────────────────────────────────────────

test("mini-zip produces a valid, inflatable archive", async () => {
  const { collectFiles, writeZip } = await import("../../../scripts/lib/mini-zip.mjs");
  const dir = mkdtempSync(path.join(os.tmpdir(), "aisha-zip-"));
  writeFileSync(path.join(dir, "a.txt"), "hello aisha");
  writeFileSync(path.join(dir, "b.json"), JSON.stringify({ ok: true }));
  const outFile = path.join(dir, "out.mcpb");

  const files = collectFiles(dir, ["a.txt", "b.json"]);
  const size = writeZip(outFile, files);
  assert.ok(size > 0);

  const buf = readFileSync(outFile);
  assert.equal(buf.slice(0, 4).toString("hex"), "504b0304", "zip local-header magic");
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.equal(buf.readUInt16LE(eocd + 10), 2, "two entries in central directory");

  // Inflate first local entry and confirm round-trip.
  const nlen = buf.readUInt16LE(26);
  const csize = buf.readUInt32LE(18);
  const start = 30 + nlen + buf.readUInt16LE(28);
  const inflated = inflateRawSync(buf.slice(start, start + csize)).toString();
  assert.ok(inflated === "hello aisha" || inflated === JSON.stringify({ ok: true }));
});

test("packaged bundle exists after --check or build (smoke)", () => {
  // Non-fatal: only assert the entry point referenced by the manifest exists.
  assert.ok(existsSync(SERVER), "server entry point must exist");
});

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

/** Run a command synchronously, returning stdout (throws on failure). */
function runSync(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf-8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

/**
 * Spawn the server, send messages, and resolve once `expected` id-bearing
 * responses have arrived (or on timeout).
 * @param {object[]} messages
 * @param {number} expected
 * @returns {Promise<object[]>}
 */
function mcpSession(messages, expected) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [SERVER], {
      cwd: REPO_ROOT,
      env: { ...process.env, AISHA_WORKSPACE: REPO_ROOT },
      stdio: ["pipe", "pipe", "ignore"],
    });
    const responses = [];
    let buffer = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timeout: got ${responses.length}/${expected} responses`));
    }, 15_000);

    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.id !== undefined && msg.id !== null) responses.push(msg);
        if (responses.length >= expected) {
          clearTimeout(timer);
          child.kill();
          resolve(responses);
        }
      }
    });
    child.on("error", reject);
    for (const m of messages) child.stdin.write(JSON.stringify(m) + "\n");
  });
}
