/**
 * Minimal HTTP helpers for aisha-connect — zero dependencies, `fetch` only.
 *
 * HTTP status never throws (callers decide what a 401 means — for the
 * "MCP requires auth" check a 401 is the PASS); only an unreachable host does.
 */

const DEFAULT_TIMEOUT_MS = 15_000;

export class NetworkError extends Error {
  constructor(url, cause) {
    super(`cannot reach ${url}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "NetworkError";
    this.url = url;
  }
}

function parseBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string,string>, form?: Record<string,string>,
 *           json?: unknown, timeoutMs?: number, followRedirects?: boolean, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ status: number, ok: boolean, headers: Headers, body: unknown, text: string }>}
 */
export async function request(url, opts = {}) {
  const { method = "GET", headers = {}, form, json, timeoutMs = DEFAULT_TIMEOUT_MS, followRedirects = false, fetchImpl = fetch } = opts;
  // Requests that carry a token never follow a redirect to wherever it points.
  const init = { method, headers: { accept: "application/json", ...headers }, redirect: followRedirects ? "follow" : "manual" };
  if (form) {
    init.headers["content-type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(form).toString();
  } else if (json !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(json);
  }
  let res;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new NetworkError(url, err?.cause ?? err);
  }
  const text = await res.text();
  return { status: res.status, ok: res.ok, headers: res.headers, body: parseBody(text), text };
}

/** Short, single-line description of a response for error messages. */
export function describeResponse(res) {
  const body = res.body;
  const detail =
    body && typeof body === "object"
      ? body.error_description || body.error?.message || body.message || body.error || JSON.stringify(body)
      : String(body ?? "");
  return `HTTP ${res.status}${detail ? ` — ${String(detail).replace(/\s+/g, " ").slice(0, 200)}` : ""}`;
}
