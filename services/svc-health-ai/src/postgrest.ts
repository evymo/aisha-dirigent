/**
 * PostgREST RPC client — thin re-export of the shared @aisha/postgrest-client
 * (SVC-01 / D11). 5s timeout.
 */
import { createServiceRpc, createUserRpc } from '@aisha/postgrest-client';

export const rpcService = createServiceRpc({ timeoutMs: 5_000, accept: false });

export const rpcUser = createUserRpc({ timeoutMs: 5_000, accept: false });
