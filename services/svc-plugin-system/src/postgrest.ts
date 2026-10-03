/**
 * PostgREST RPC client — thin re-export of the shared @aisha/postgrest-client
 * (SVC-01 / D11). 5s timeout; service-role. `rpcSandboxed` layers a per-plugin
 * whitelist check on top of the shared client (no direct HTTP here).
 */
import { createServiceRpc } from '@aisha/postgrest-client';
import { config } from './config.js';

export const rpcService = createServiceRpc({ timeoutMs: 5_000, accept: false });

/** Sandboxed RPC — only allow whitelisted functions. */
export async function rpcSandboxed<T = unknown>(
  functionName: string,
  params: Record<string, unknown>,
): Promise<T> {
  if (config.rpcWhitelist.length === 0) {
    throw new Error('No RPC functions are allowed for this plugin');
  }
  if (!config.rpcWhitelist.includes(functionName)) {
    throw new Error(`Plugin RPC call to '${functionName}' is not whitelisted`);
  }
  return rpcService<T>(functionName, params);
}
