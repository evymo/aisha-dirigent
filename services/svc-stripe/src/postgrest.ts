/**
 * PostgREST RPC client — thin re-export of the shared @aisha/postgrest-client
 * (SVC-01 / D11).
 */
import { createServiceRpc, createUserRpc } from '@aisha/postgrest-client';

export const rpcService = createServiceRpc({ accept: true, preferRepresentation: true });

export const rpcUser = createUserRpc({ accept: true, preferRepresentation: true });
