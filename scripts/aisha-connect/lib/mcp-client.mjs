/**
 * Just enough of the MCP Streamable HTTP transport to prove a connection works:
 * initialize → notifications/initialized → tools/list. Accepts both a JSON and
 * an SSE (text/event-stream) response body.
 */

import { request, describeResponse } from "./http.mjs";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

/** Pull the JSON-RPC message with `id` out of an SSE body. */
export function parseSseMessage(text, id) {
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      const msg = JSON.parse(data);
      if (msg && msg.id === id) return msg;
    } catch {
      // not JSON — keep looking
    }
  }
  return null;
}

/**
 * @returns {Promise<{ status: number, message: object|null, sessionId: string, error: string }>}
 */
export async function mcpCall({ url, token, method, params, id, sessionId, fetchImpl }) {
  const headers = { accept: "application/json, text/event-stream", "mcp-protocol-version": MCP_PROTOCOL_VERSION };
  if (token) headers.authorization = `Bearer ${token}`;
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const body = id === undefined ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params };
  const res = await request(url, { method: "POST", headers, json: body, fetchImpl, timeoutMs: 30_000 });
  const nextSession = res.headers.get("mcp-session-id") || sessionId || "";
  if (id === undefined) return { status: res.status, message: null, sessionId: nextSession, error: res.ok ? "" : describeResponse(res) };

  let message = null;
  if (res.body && typeof res.body === "object") message = res.body;
  else if (typeof res.body === "string") message = parseSseMessage(res.body, id);
  const error = !res.ok
    ? describeResponse(res)
    : !message
      ? "no JSON-RPC response in body"
      : message.error
        ? `JSON-RPC ${message.error.code}: ${message.error.message}`
        : "";
  return { status: res.status, message, sessionId: nextSession, error };
}

export function initializeParams(clientName = "aisha-connect", clientVersion = "1") {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: clientName, version: clientVersion },
  };
}

/** initialize + initialized + tools/list. */
export async function probeMcp({ url, token, fetchImpl }) {
  const init = await mcpCall({ url, token, method: "initialize", params: initializeParams(), id: 1, fetchImpl });
  if (init.error) return { ok: false, stage: "initialize", status: init.status, error: init.error };
  const serverInfo = init.message.result?.serverInfo ?? {};
  const protocolVersion = init.message.result?.protocolVersion ?? "";
  await mcpCall({ url, token, method: "notifications/initialized", params: {}, sessionId: init.sessionId, fetchImpl });
  const list = await mcpCall({ url, token, method: "tools/list", params: {}, id: 2, sessionId: init.sessionId, fetchImpl });
  if (list.error) return { ok: false, stage: "tools/list", status: list.status, error: list.error, serverInfo, protocolVersion };
  const tools = Array.isArray(list.message.result?.tools) ? list.message.result.tools.map((t) => t.name) : [];
  return { ok: true, serverInfo, protocolVersion, tools };
}
