#!/usr/bin/env node
/**
 * @module verify-claude-app-install
 * Pre-flight smoke test for the AISHA Dirigent Claude app: drives the bundled
 * MCP server over stdio exactly as Claude Desktop / Claude Code do when they
 * load it — `initialize` → `tools/list` → a `tools/call` → `resources/list` —
 * and prints a PASS/FAIL checklist. Zero dependencies.
 *
 * This validates the half of "does the install work" that does NOT need Claude
 * itself: the server starts, speaks MCP, lists its tools, and answers a call.
 * The other half (Claude Desktop loads the .mcpb / Claude Code loads the plugin,
 * tools appear in the UI) is the manual checklist in
 * docs/integrations/CLAUDE_APP_SMOKE_TEST.md.
 *
 * Usage:  node scripts/verify-claude-app-install.mjs [workspaceRoot]
 * Exit 0 if all checks pass, 1 otherwise.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = path.join(ROOT, "extensions", "aisha-dirigent-claude", "server", "index.mjs");
const WORKSPACE = process.argv[2] || ROOT;

const results = [];
const record = (name, ok, detail = "") => results.push({ name, ok, detail });

/** Run a single MCP stdio session: send messages, collect id-bearing responses. */
function session(messages, expected, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [SERVER], {
      cwd: ROOT,
      env: { ...process.env, AISHA_WORKSPACE: WORKSPACE },
      stdio: ["pipe", "pipe", "ignore"],
    });
    const responses = [];
    let buf = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timeout: ${responses.length}/${expected} responses`));
    }, timeoutMs);
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch (err) {
          console.warn(`[verify] skipping non-JSON stdout line: ${String(err?.message || err)}`);
          continue;
        }
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

async function main() {
  let responses;
  try {
    responses = await session(
      [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "aisha_health", arguments: {} } },
        { jsonrpc: "2.0", id: 4, method: "resources/list" },
      ],
      4,
    );
  } catch (err) {
    console.error(`[verify] MCP stdio session failed: ${err?.message || err}`);
    record("MCP stdio session", false, String(err?.message || err));
    return report();
  }

  const init = responses.find((r) => r.id === 1);
  record("initialize → serverInfo", init?.result?.serverInfo?.name === "aisha-dirigent", JSON.stringify(init?.result?.serverInfo || {}));
  record("initialize → protocolVersion", Boolean(init?.result?.protocolVersion), init?.result?.protocolVersion);

  const list = responses.find((r) => r.id === 2);
  const toolCount = list?.result?.tools?.length || 0;
  record("tools/list ≥ 1 tool", toolCount >= 1, `${toolCount} tools`);

  const call = responses.find((r) => r.id === 3);
  record("tools/call aisha_health", call?.result?.isError === false && call?.result?.content?.[0]?.type === "text", call?.result?.isError ? "isError" : "ok");

  const res = responses.find((r) => r.id === 4);
  record("resources/list ≥ 1 resource", (res?.result?.resources?.length || 0) >= 1, `${res?.result?.resources?.length || 0} resources`);

  report();
}

function report() {
  process.stdout.write(`AISHA Dirigent Claude app — install pre-flight (workspace: ${WORKSPACE})\n\n`);
  let allOk = true;
  for (const r of results) {
    allOk = allOk && r.ok;
    process.stdout.write(`  ${r.ok ? "✓" : "✗"} ${r.name}${r.detail ? `  (${r.detail})` : ""}\n`);
  }
  process.stdout.write(`\n${allOk ? "PASS — server speaks MCP and answers calls." : "FAIL — see above."}\n`);
  if (allOk) {
    process.stdout.write("\nNext (manual): docs/integrations/CLAUDE_APP_SMOKE_TEST.md\n");
  }
  process.exit(allOk ? 0 : 1);
}

main();
