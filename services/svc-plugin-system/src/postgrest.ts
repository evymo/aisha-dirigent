/**
 * PostgREST RPC client — thin re-export of the shared @aisha/postgrest-client
 * (SVC-01 / D11). 5s timeout; service-role. `rpcSandboxed` layers a per-plugin
 * whitelist check on top of the shared client (no direct HTTP here).
 */
import { createNullableServiceRpc, createServiceRpc } from '@aisha/postgrest-client';
import { config } from './config.js';

export const rpcService = createServiceRpc({ timeoutMs: 5_000, accept: false });

/**
 * Service-role RPC pro funkce RETURNS void (plugin_kv_set, plugin_kv_delete).
 *
 * ⛔ NAMĚŘENO 2026-10-04 (čtení mainu ab87c8a7a, hlášení Tyreis): PostgREST na
 * funkci RETURNS void odpoví 204 BEZ TĚLA (týž tvar naměřen na riq 2026-09-29 u
 * update_agent_run_status, viz svc-agent-runner db.unit.test.ts). `rpcService`
 * (strictRpc) na každé 2xx volá `res.json()` → SyntaxError AŽ PO zápisu → trasa
 * /sandbox/kv/set vrátila 500 a plugin dostal výjimku, kurzory se „neuložily".
 *
 * PROČ samostatný klient a ne změna SQL: návratový typ je kontrakt v DB (heals +
 * baseline); místo, které má tvar odpovědi snést, je klient. Chyba PostgRESTu
 * (non-2xx) dál HÁZÍ (PostgRESTError) — tiché 204 by bylo horší než výjimka.
 */
export const rpcServiceVoid = createNullableServiceRpc({ timeoutMs: 5_000, accept: false });

/**
 * RPC mimo PLUGIN_RPC_WHITELIST — odmítnutí pravidlem, ne porucha DB. Broker podle
 * třídy pozná důvod `fn_mimo_whitelist` (jinak `rpc_selhalo`); pravidlo zůstává tady.
 */
export class RpcMimoWhitelistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RpcMimoWhitelistError';
  }
}

/** Sandboxed RPC — only allow whitelisted functions. */
export async function rpcSandboxed<T = unknown>(
  functionName: string,
  params: Record<string, unknown>,
): Promise<T> {
  if (config.rpcWhitelist.length === 0) {
    throw new RpcMimoWhitelistError('No RPC functions are allowed for this plugin');
  }
  if (!config.rpcWhitelist.includes(functionName)) {
    throw new RpcMimoWhitelistError(`Plugin RPC call to '${functionName}' is not whitelisted`);
  }
  return rpcService<T>(functionName, params);
}
