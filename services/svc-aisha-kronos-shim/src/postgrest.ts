/**
 * PostgREST RPC client — thin re-export of the shared @aisha/postgrest-client
 * (SVC-01 / D11). Service-role only — the shim has no per-user JWT (Maestro speaks
 * via a shared X-Api-Key, not user-level auth).
 */
import { createServiceRpc } from '@aisha/postgrest-client';

export const rpcService = createServiceRpc({ accept: true });
