/**
 * Backend RPC — thin wrapper over `@aisha/api-core`.
 *
 * Uses the shared platform-agnostic API client so the extension,
 * web and mobile all speak the same transport contract (timeout,
 * auth header, gateway URL shape). Extension-specific concerns
 * (latency/byte stats recorded via `resource-tracker`) are
 * preserved in this wrapper.
 *
 * @module
 */

import { createApiCore } from "@aisha/api-core";

import { getAuthState, isTokenExpiringSoon, silentRefresh } from "./auth";
import { getDirigentConfig } from "./config";
import { recordApiCall, type RequestStats } from "./resource-tracker";

/** Default timeout for RPC calls from the extension. */
const RPC_TIMEOUT_MS = 8_000;

/**
 * Call an RPC function through the AISHA API gateway.
 *
 * @param functionName - RPC function name (e.g. "fn_log_dev_signal")
 * @param params - Function parameters as a plain object
 * @returns Parsed JSON response (or null on failure), an `error` message that is
 *   null on success and non-null on any failure (misconfig, no auth, transport,
 *   or a non-2xx PostgREST response), plus request stats. `api.rpc` never throws,
 *   so callers that must fail loud (e.g. the workbench drainer) MUST inspect
 *   `error` — a null `data` alone does not distinguish "no rows" from "failed".
 */
export async function callRpc<T = unknown>(
  functionName: string,
  params: Record<string, unknown>,
): Promise<{ data: T | null; error: string | null; stats: RequestStats | null }> {
  const config = getDirigentConfig();
  const gatewayUrl = config.aishaUrl;
  if (!gatewayUrl) return { data: null, error: "backend_not_configured", stats: null };

  if (getAuthState().accessToken && isTokenExpiringSoon()) {
    await silentRefresh();
  }

  const auth = getAuthState();
  const token = auth.accessToken;
  if (!token) return { data: null, error: "not_authenticated", stats: null };

  const api = createApiCore({
    gatewayUrl,
    getToken: async () => token,
    timeoutMs: RPC_TIMEOUT_MS,
  });

  const t0 = performance.now();
  const result = await api.rpc(functionName, params);
  const latency = performance.now() - t0;
  const failed = result.error !== null;
  const bytes = result.data != null ? JSON.stringify(result.data).length : 0;
  const stats = recordApiCall("rpc", latency, bytes, failed);

  return {
    data: (result.data as T | null) ?? null,
    error: result.error ? result.error.message : null,
    stats,
  };
}
