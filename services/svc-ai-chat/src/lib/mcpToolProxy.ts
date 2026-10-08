/**
 * MCP tool proxy — bridges the Omni /v1 agentic lane to the existing MCP server
 * (`svc-mcp-knowledge`), reusing its ENTIRE dynamic tool stack (tools/list +
 * tools/call) rather than re-implementing any of it.
 *
 * RFC 8693 token mediation (the security spine of PR-B): the caller's PAT is
 * NEVER forwarded. svc-ai-chat validates the PAT (authenticateOmniIdentity),
 * then {@link mintMcpUserToken} issues a SHORT-LIVED, USER-scoped token
 * (sub=user_id ⇒ auth.uid(); role=authenticated — NEVER service_role; bound
 * story) which is forwarded here. svc-mcp-knowledge validates that token and runs
 * each tool UNDER THE USER'S IDENTITY, so the DB's RLS / per-story RBAC
 * (mcp_search_knowledge_v2) is the authority — no service_role bypass, no
 * cross-tenant leak. A scoped/legacy PAT with no user_id mints nothing ⇒ the turn
 * is tool-less (fail-closed; an unscoped or service credential is never sent).
 *
 * Degradation-safe: an unconfigured/unreachable MCP server yields no tools (the
 * /v1 turn proceeds tool-less) and a failed call surfaces as a tool-result error
 * string the model can react to — never a hard 500 on the chat turn.
 *
 * @module
 */
import { createSafeLogger } from "@aisha/security";

import { config } from "../config.js";
import { mintUserScopedPostgrestToken } from "./userScopedRpc.js";
import type { LlmToolSpec } from "./llmRouter.js";

const log = createSafeLogger("svc-ai-chat");

/**
 * Mint a short-lived (15 min) USER-scoped HS256 JWT for the downstream MCP server
 * (RFC 8693 on-behalf-of). Carries `sub=userId` (→ auth.uid() for RLS),
 * `role=authenticated` (NEVER service_role), and the bound `story_id`. Returns
 * `null` when minting is impossible — no signing secret, or no user identity on
 * the PAT — so the caller FAILS CLOSED (tool-less turn) and never forwards an
 * unscoped or service-role credential downstream.
 *
 * ⛔ PODMÍNKA VOLAJÍCÍHO (K-35/B8): `storyId` MUSÍ být ověřený (can_access_story pod uživatelem,
 * lib/storyAccess.ts) PŘED ražbou. svc-mcp-knowledge hledá v KB identitou uživatele, takže RPC
 * cizí příběh odmítne i tak — ražba neověřeného příběhu je ale chyba volajícího (dvě stráže).
 *
 * The actual mint lives in lib/userScopedRpc.ts (shared with the legacy /chat
 * surface's user-plane RPC adapter) — ONE HMAC implementation, two lanes.
 */
export function mintMcpUserToken(userId: string | null, storyId: string | null): string | null {
  if (!config.postgrestJwtSecret || !userId) return null;
  return mintUserScopedPostgrestToken({ userId, storyId, tokenUse: "omni-mcp-mediation" });
}

function mcpBaseUrl(): string | null {
  return config.svcMcpKnowledgeUrl || null;
}

interface JsonRpcResponse {
  result?: {
    tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

async function jsonRpc(
  userJwt: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<JsonRpcResponse | null> {
  const base = mcpBaseUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/mcp`, {
      method: "POST",
      // RFC 8693: forward the MINTED user-scoped token, NOT the caller's PAT.
      headers: { authorization: `Bearer ${userJwt}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      log.safeWarn("[v1][mcp] non-200 from MCP server", { method, status: res.status });
      return null;
    }
    return (await res.json()) as JsonRpcResponse;
  } catch (err) {
    log.safeWarn("[v1][mcp] MCP server unreachable (degrading tool-less)", {
      method,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * The user's allowed MCP tools as OpenAI function specs (empty if the MCP server is
 * unconfigured/unreachable/denies-all — the turn then proceeds with no tools).
 * `userJwt` is the minted user-scoped token from {@link mintMcpUserToken}.
 */
export async function mcpToolsList(userJwt: string): Promise<LlmToolSpec[]> {
  const rpc = await jsonRpc(userJwt, "tools/list");
  const tools = rpc?.result?.tools;
  if (!Array.isArray(tools)) return [];
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description ?? t.name,
      // MCP inputSchema IS a JSON Schema → OpenAI parameters verbatim.
      parameters: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
    },
  }));
}

/** Result of one MCP tool call: the text for the model AND whether the call really succeeded. */
export interface McpToolInvokeResult {
  ok: boolean;
  text: string;
}

/**
 * Execute one tool via the MCP server under the user's identity (per-tool auth +
 * RLS enforced there). `text` is what the model gets back — including a structured
 * error string when the tool is not allowed or the call fails, so the model can
 * adapt rather than the whole turn 500-ing; `ok` says which of the two it is (the
 * /chat executor records a failed call as failed, not as a result).
 */
export async function mcpToolInvoke(
  userJwt: string,
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolInvokeResult> {
  const rpc = await jsonRpc(userJwt, "tools/call", { name, arguments: args });
  if (!rpc) return { ok: false, text: JSON.stringify({ error: "tool_unavailable", tool: name }) };
  if (rpc.error) {
    return {
      ok: false,
      text: JSON.stringify({ error: "tool_error", tool: name, code: rpc.error.code, message: rpc.error.message }),
    };
  }
  const ok = rpc.result?.isError !== true;
  const content = rpc.result?.content;
  if (Array.isArray(content)) {
    return { ok, text: content.map((c) => (c.type === "text" ? (c.text ?? "") : JSON.stringify(c))).join("\n") };
  }
  return { ok, text: JSON.stringify(rpc.result ?? {}) };
}

/** {@link mcpToolInvoke} for callers that only feed the text back to the model (/v1). */
export async function mcpToolCall(
  userJwt: string,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  return (await mcpToolInvoke(userJwt, name, args)).text;
}
