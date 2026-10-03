/**
 * Compat shim — minimal PostgREST RPC client interface that matches the
 * surface the legacy archive modules expect from `PostgrestClient`.
 *
 * Use `createRpcAdapter()` to get an object that behaves like the old
 * `pgrest` client (exposing `.rpc(fn, params)` and returning `{ data, error }`)
 * but uses the v2 `rpcService` helper under the hood.
 */
import { rpcService, rpcUser } from '../postgrest.js';

export interface RpcResult<T = unknown> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

export interface PostgrestClient {
  rpc<T = unknown>(fn: string, params?: Record<string, unknown>): Promise<RpcResult<T>>;
}

/** Service-role RPC adapter (for orchestration, governance, tracing). */
export function createServiceRpcAdapter(
  _url?: string,
  _key?: string,
  _opts?: unknown,
): PostgrestClient {
  return {
    async rpc<T = unknown>(fn: string, params: Record<string, unknown> = {}): Promise<RpcResult<T>> {
      try {
        const data = await rpcService<T>(fn, params);
        return { data, error: null };
      } catch (err) {
        return {
          data: null,
          error: { message: err instanceof Error ? err.message : String(err) },
        };
      }
    },
  };
}

/** User-scoped RPC adapter (RLS enforced). */
export function createUserRpcAdapter(userJwt: string): PostgrestClient {
  return {
    async rpc<T = unknown>(fn: string, params: Record<string, unknown> = {}): Promise<RpcResult<T>> {
      try {
        const data = await rpcUser<T>(fn, params, userJwt);
        return { data, error: null };
      } catch (err) {
        return {
          data: null,
          error: { message: err instanceof Error ? err.message : String(err) },
        };
      }
    },
  };
}
