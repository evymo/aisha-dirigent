#!/usr/bin/env node
/**
 * @module index
 * AISHA Dirigent — MCP server (stdio transport), zero runtime dependencies.
 *
 * Implements the minimal MCP surface needed by Claude Code and Claude Desktop:
 *   initialize · ping · tools/list · tools/call · resources/list · resources/read
 *
 * Transport: newline-delimited JSON-RPC 2.0 over stdio (the MCP stdio spec).
 * stdout carries ONLY protocol messages; all diagnostics go to stderr.
 *
 * Special mode:
 *   node index.mjs --list-tools   → prints the tool/resource surface as JSON and
 *                                    exits. The `claude-app` gen:ide adapter uses
 *                                    this to auto-derive manifest.json + slash
 *                                    commands, so the package can never drift from
 *                                    the server's real capabilities.
 *
 * Workspace root is resolved by lib.resolveWorkspace() (AISHA_WORKSPACE env,
 * first CLI arg, CLAUDE_PROJECT_DIR, then cwd).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logErr, readText, resolveWorkspace } from "./lib.mjs";
import { RESOURCES, TOOLS } from "./tools.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTOCOL_VERSION = "2025-06-18";

/** Resolve the server's own version from the sibling manifest.json / package.json. */
function serverVersion() {
  if (process.env.AISHA_APP_VERSION) return process.env.AISHA_APP_VERSION;
  for (const rel of ["../manifest.json", "../package.json", "./package.json"]) {
    try {
      const j = JSON.parse(readFileSync(path.join(__dirname, rel), "utf-8"));
      if (j.version) return j.version;
    } catch {
      /* keep trying */
    }
  }
  return "0.1.0";
}

const SERVER_INFO = { name: "aisha-dirigent", title: "AISHA Dirigent", version: serverVersion() };

// ───────────────────────────────────────────────────────────────────────────
// --list-tools: emit the surface for the auto-converter, then exit.
// ───────────────────────────────────────────────────────────────────────────
if (process.argv.includes("--list-tools")) {
  const surface = {
    serverInfo: SERVER_INFO,
    tools: TOOLS.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
    resources: RESOURCES.map((r) => ({ uri: r.uri, name: r.name, mimeType: r.mimeType })),
  };
  process.stdout.write(JSON.stringify(surface, null, 2) + "\n");
  process.exit(0);
}

// ───────────────────────────────────────────────────────────────────────────
// MCP stdio server
// ───────────────────────────────────────────────────────────────────────────
const ROOT = resolveWorkspace();
const toolByName = new Map(TOOLS.map((t) => [t.name, t]));
logErr(`started · workspace=${ROOT} · ${TOOLS.length} tools`);

/** Send a JSON-RPC result. */
function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

/** Send a JSON-RPC error. */
function replyError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

/** Dispatch one parsed JSON-RPC message. */
async function dispatch(msg) {
  const { id, method, params } = msg || {};
  // Notifications (no id) require no response.
  const isNotification = id === undefined || id === null;

  try {
    switch (method) {
      case "initialize":
        return reply(id, {
          protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
          serverInfo: SERVER_INFO,
        });

      case "notifications/initialized":
      case "notifications/cancelled":
        return; // no-op notifications

      case "ping":
        return reply(id, {});

      case "tools/list":
        return reply(id, {
          tools: TOOLS.map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        });

      case "tools/call": {
        const tool = toolByName.get(params?.name);
        if (!tool) return replyError(id, -32602, `Unknown tool: ${params?.name}`);
        const result = await tool.handler(params?.arguments || {}, { root: ROOT });
        return reply(id, {
          content: [{ type: "text", text: result.text }],
          isError: Boolean(result.isError),
        });
      }

      case "resources/list":
        return reply(id, {
          resources: RESOURCES.map((r) => ({ uri: r.uri, name: r.name, mimeType: r.mimeType })),
        });

      case "resources/read": {
        const res = RESOURCES.find((r) => r.uri === params?.uri);
        if (!res) return replyError(id, -32602, `Unknown resource: ${params?.uri}`);
        const text = readText(ROOT, res.rel) ?? "";
        return reply(id, { contents: [{ uri: res.uri, mimeType: res.mimeType, text }] });
      }

      default:
        if (isNotification) return;
        return replyError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    logErr(`dispatch(${method}) error: ${err?.stack || err}`);
    if (!isNotification) replyError(id, -32603, `Internal error: ${err?.message || err}`);
  }
}

// Buffered, newline-delimited stdin reader.
let buffer = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      logErr(`parse error: ${err?.message || err}`);
      continue;
    }
    // Fire-and-forget; ordering is preserved by single-threaded event loop writes.
    dispatch(msg);
  }
});
process.stdin.on("end", () => process.exit(0));
