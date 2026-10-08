/**
 * @module backend
 * Minimal, zero-dependency client for the AISHA backend, used by the tools that
 * need server-side data/actions (improvement proposals, spend approvals). Mirrors
 * the transport the VS Code extension uses:
 *   - PostgREST RPC:  POST ${aishaUrl}/rest/v1/rpc/<fn>   (apikey + Bearer)
 *     (extensions/aisha-dirigent/src/backend-rpc.ts, agent-activity-tree.ts)
 *   - MCP tool call:  JSON-RPC tools/call to the mcp-knowledge-server endpoint
 *     (extensions/aisha-dirigent/src/mcp-client.ts → callMcpTool)
 *
 * Config/auth are resolved headlessly (env first, then .aisha/* config), so the
 * server stays usable offline: if no URL/token is configured, backend tools
 * return a clear "not configured" message instead of throwing.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson } from "./lib.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const UNSAFE_URL_CHARS = /[\u0000-\u001F\u007F"'<>`\\]/;

/**
 * Expand `${VAR}` / `${VAR:-default}` the way Claude Code expands them in
 * `.mcp.json` — the tracked file reads
 * `${AISHA_MCP_URL:-http://localhost:3001/functions/v1/mcp-knowledge-server}`,
 * so the plugin must resolve it to the same URL Claude Code connects to.
 * @param {unknown} input
 * @param {Record<string, string|undefined>} [env]
 * @returns {unknown}
 */
export function expandEnvPlaceholders(input, env = process.env) {
  if (typeof input !== "string") return input;
  return input.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, name, fallback) => {
    const value = env[name];
    return value !== undefined && value !== "" ? value : (fallback ?? "");
  });
}

function normalizeHttpUrl(input) {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value || UNSAFE_URL_CHARS.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

// Env vars that carry a PostgREST service_role JWT (full RLS bypass). Honored so
// deliberate admin/local-superuser workflows keep working, but NEVER silently —
// see resolveToken.
const SERVICE_ROLE_TOKEN_ENVS = ["AISHA_SERVICE_KEY", "AISHA_POSTGREST_SERVICE_KEY"];
let warnedServiceRoleToken = false;

/**
 * Resolve the backend auth token in least-privilege order: a scoped personal
 * access token (AISHA_TOKEN) always wins. A service_role key is still honored
 * as a fallback so existing admin/local-superuser setups keep working — but the
 * add-on's PostgREST RPCs would then BYPASS row-level security from the
 * developer's workstation, so we surface that ONCE on stderr (fail-loud, never
 * a silent privilege escalation). Precedence is otherwise unchanged.
 * @param {Record<string,unknown>} tplProfile
 * @param {Record<string,unknown>} localProfile
 * @returns {string|null}
 */
function resolveToken(tplProfile, localProfile) {
  if (process.env.AISHA_TOKEN) return process.env.AISHA_TOKEN;
  for (const name of SERVICE_ROLE_TOKEN_ENVS) {
    const value = process.env[name];
    if (value) {
      if (!warnedServiceRoleToken) {
        warnedServiceRoleToken = true;
        process.stderr.write(
          `[aisha-dirigent] WARNING: backend auth is using ${name} (service_role) — ` +
            `the add-on's RPCs will BYPASS row-level security from this workstation. ` +
            `Prefer a scoped personal access token: set AISHA_TOKEN=mcp_… instead.\n`,
        );
      }
      return value;
    }
  }
  return (
    process.env.VITE_AISHA_GATEWAY_KEY ||
    tplProfile.anonKey ||
    localProfile.anonKey ||
    null
  );
}

/**
 * Resolve backend URL, auth token, and MCP endpoint from env + .aisha config.
 *
 * Profile selection: the developer's .aisha/dirigent.local.json (untracked)
 * picks the ACTIVE profile via its activeProfile; the tracked template supplies
 * shared per-profile data, keyed by that same selection. On a fresh checkout
 * (no local file) the template's own activeProfile is the fallback.
 * @param {string} root workspace root
 * @returns {{ url: string|null, token: string|null, mcpUrl: string|null, mcpToken: string|null }}
 */
export function resolveBackend(root) {
  const isRepoRoot = !root || resolve(root) === resolve(REPO_ROOT);
  const isTest = process.env.NODE_ENV === "test" || process.env.VITEST;
  const local = (isTest && isRepoRoot) ? {} : (readJson(root, ".aisha/dirigent.local.json") || {});
  const tpl = readJson(root, ".aisha/dirigent.template.json") || {};
  const localProfile = local.profiles?.[local.activeProfile] || {};
  const tplProfile = tpl.profiles?.[local.activeProfile || tpl.activeProfile] || {};

  const url = normalizeHttpUrl(
    process.env.AISHA_URL ||
    process.env.AISHA_GATEWAY_URL ||
    localProfile.aishaUrl ||
    tplProfile.aishaUrl ||
    localProfile.bootstrapUrl ||
    null,
  );

  const token = resolveToken(tplProfile, localProfile);

  const mcp = readJson(root, ".mcp.json") || {};
  const envMcpUrl = normalizeHttpUrl(process.env.AISHA_MCP_URL);
  const workspaceMcpUrl = normalizeHttpUrl(
    expandEnvPlaceholders(mcp.mcpServers?.["aisha-knowledge"]?.url),
  );
  const derivedMcpUrl = url ? `${url}/functions/v1/mcp-knowledge-server` : null;

  const mcpUrl = envMcpUrl || workspaceMcpUrl || derivedMcpUrl;
  const mcpToken =
    envMcpUrl || !workspaceMcpUrl || (url && sameOrigin(workspaceMcpUrl, url))
      ? token
      : null;

  return { url, token, mcpUrl, mcpToken };
}

/** Human-readable hint when the backend isn't configured. */
const NOT_CONFIGURED =
  "AISHA backend not configured. Set AISHA_URL + AISHA_TOKEN (or AISHA_SERVICE_KEY) in the environment, or configure .aisha/dirigent.local.json (aishaUrl). This tool needs a reachable backend.";

/**
 * Call a PostgREST RPC. Never throws — returns a structured result.
 * @param {string} root
 * @param {string} fn  RPC function name (e.g. "approve_task_spend_audited")
 * @param {Record<string,unknown>} [params]
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ ok: boolean, status?: number, data?: unknown, error?: string }>}
 */
export async function backendRpc(root, fn, params = {}, opts = {}) {
  const { url, token } = resolveBackend(root);
  if (!url || !token) return { ok: false, error: NOT_CONFIGURED };
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: token,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { ok: res.ok, status: res.status, data, error: res.ok ? undefined : data?.message || `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

/**
 * Call a tool on the AISHA MCP knowledge server (JSON-RPC tools/call).
 * @param {string} root
 * @param {string} name  MCP tool name (e.g. "get_improvement_proposals")
 * @param {Record<string,unknown>} [args]
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ ok: boolean, data?: unknown, error?: string }>}
 */
export async function backendMcpTool(root, name, args = {}, opts = {}) {
  const { mcpUrl, mcpToken } = resolveBackend(root);
  if (!mcpUrl) return { ok: false, error: NOT_CONFIGURED };
  try {
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(mcpToken ? { apikey: mcpToken, Authorization: `Bearer ${mcpToken}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
    const json = await res.json();
    if (json.error) return { ok: false, error: json.error.message || "MCP error" };
    const textContent = json.result?.content?.find?.((c) => c.type === "text")?.text;
    let data;
    try {
      data = textContent ? JSON.parse(textContent) : json.result;
    } catch {
      data = textContent;
    }
    return { ok: !json.result?.isError, data };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}
