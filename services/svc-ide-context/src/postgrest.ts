/**
 * PostgREST RPC adapters — thin re-export of the shared @aisha/postgrest-client
 * (SVC-01 / D11). Two flavors:
 *   - rpcService(fn, params): service_role JWT (bypasses RLS — use sparingly).
 *   - rpcUserClaims(fn, params, claims): mints a PostgREST JWT from verified
 *     Keycloak claims (HS256, 15-min ttl) and calls as the user (respects RLS).
 */
import { createServiceRpc, createUserClaimsRpc } from '@aisha/postgrest-client';

export const rpcService = createServiceRpc({ accept: true, preferRepresentation: true });

export const rpcUserClaims = createUserClaimsRpc({ accept: true, preferRepresentation: true });
