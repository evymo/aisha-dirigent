/**
 * PostgREST RPC client — thin re-export of the shared @aisha/postgrest-client
 * (SVC-01 / D11: one client contract for all services).
 *
 * svc-ai-chat keeps the NULLABLE variant (a 2xx with a non-JSON body ⇒ null, for
 * void-returning RPCs) with a 30s ceiling; callers may pass an RpcOpts budget
 * signal that aborts the request early.
 */
import { createNullableServiceRpc, createNullableUserRpc } from '@aisha/postgrest-client';

export type { RpcOpts } from '@aisha/postgrest-client';

export const rpcService = createNullableServiceRpc({ timeoutMs: 30_000, accept: true });

export const rpcUser = createNullableUserRpc({ timeoutMs: 30_000, accept: true });
