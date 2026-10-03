/**
 * PostgREST RPC adapters — thin re-export of the shared @aisha/postgrest-client
 * (SVC-01 / D11). Three flavors:
 *   - rpcService(fn, params): service_role JWT (bypasses RLS — use sparingly).
 *   - rpcUser(fn, params, jwt): forwards an already-minted user JWT.
 *   - rpcUserClaims(fn, params, claims): mints a PostgREST JWT from verified
 *     Keycloak claims (HS256, 15-min ttl) and calls as the user (respects RLS +
 *     SECURITY DEFINER auth.uid() binding).
 */
import { createServiceRpc, createUserRpc, createUserClaimsRpc } from '@aisha/postgrest-client';

export const rpcService = createServiceRpc({ accept: true, preferRepresentation: true });

export const rpcUser = createUserRpc({ accept: true, preferRepresentation: true });

export const rpcUserClaims = createUserClaimsRpc({ accept: true, preferRepresentation: true });
