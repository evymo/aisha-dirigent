import { randomUUID } from 'node:crypto';
import { createRemoteJWKSet, decodeJwt, jwtVerify, SignJWT, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { config } from '../config.js';
import { isTokenRevoked } from './jwt-revocation.js';
import { KLIENT_MCP } from '../lib/chraneny-zdroj.js';

const JWKS = createRemoteJWKSet(new URL(config.kcJwksUrl));
const textEncoder = new TextEncoder();

/**
 * Hard ceiling on a minted PostgREST token, in seconds.
 *
 * Ported from the parallel svc-token-exchange implementation, which had it and
 * this path did not. The `if (!claims.exp)` default below reads like a 15-minute
 * bound but never fires: buildPostgrestClaims spreads the whole Keycloak payload,
 * which always carries `exp`, so the minted token inherited the IdP's lifetime
 * verbatim. Lengthen the realm's access-token lifespan and every PostgREST token
 * silently lengthened with it. The cap is absolute — whatever the IdP issues, a
 * DB-facing token stops being valid within this window.
 */
const MINTED_TOKEN_MAX_TTL_SECONDS = 900;

export interface PostgrestJwtTranslatorOptions {
  issuer: string;
  allowedClients: readonly string[];
  postgrestJwtSecret: string;
  /**
   * Revocation CHECK, called with the verified token's `jti`. Returns `true`
   * when the token is revoked → translate rejects with 401. Optional so the
   * pure translator stays testable; the shipped instance wires the Redis-backed
   * `isTokenRevoked`. Fail-open contract lives in the callback (never throws /
   * returns false on Redis outage).
   */
  isRevoked?: (jti: string | undefined) => Promise<boolean>;
}

type TranslationResult =
  | { ok: true; authorization: string; translated: boolean }
  | { ok: false; status: number; error: string };

function asStringArray(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  return [];
}

function tokenLooksLikeKeycloak(token: string, issuer: string): boolean {
  try {
    return decodeJwt(token).iss === issuer;
  } catch {
    return false;
  }
}

function isAllowedKeycloakClient(payload: JWTPayload, allowedClients: readonly string[]): boolean {
  // ⛔ Revize Guru 2026-10-07: token klienta MCP (z IDE) patří jen serveru MCP. Sdílený seznam
  // KC_ALLOWED_CLIENTS ho obsahuje kvůli /mcp, tady by z něj byl přístup k celému API přes PostgREST.
  if (payload.azp === KLIENT_MCP) return false;
  const allowed = new Set(allowedClients);
  const azp = typeof payload.azp === 'string' ? payload.azp : '';
  const audiences = asStringArray(payload.aud);
  return allowed.has(azp) || audiences.some((audience) => allowed.has(audience));
}

function claimString(payload: JWTPayload, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function buildPostgrestClaims(payload: JWTPayload): JWTPayload {
  const roles = asStringArray(payload.roles);
  return {
    ...payload,
    role: 'authenticated',
    sub: payload.sub,
    email: claimString(payload, 'email') ?? claimString(payload, 'preferred_username'),
    roles,
    keycloak_iss: payload.iss,
    keycloak_azp: claimString(payload, 'azp'),
  };
}

async function mintPostgrestJwt(payload: JWTPayload, secretValue: string): Promise<string> {
  if (!secretValue) {
    throw new Error('missing_postgrest_jwt_secret');
  }

  const secret = textEncoder.encode(secretValue);
  const claims = buildPostgrestClaims(payload);
  const jwt = new SignJWT(claims).setProtectedHeader({ alg: 'HS256', typ: 'JWT' });

  const nowSec = Math.floor(Date.now() / 1000);
  if (!claims.iat) jwt.setIssuedAt(nowSec);

  // Never outlive the cap, and never outlive the IdP token that authorised it.
  const capExp = nowSec + MINTED_TOKEN_MAX_TTL_SECONDS;
  const inheritedExp = typeof claims.exp === 'number' ? claims.exp : undefined;
  jwt.setExpirationTime(inheritedExp ? Math.min(inheritedExp, capExp) : capExp);

  // Every minted token gets an identity: without a jti there is nothing to write
  // into an audit trail and nothing to revoke. The inbound Keycloak token is
  // already checked against a jti revocation list here, so the token this path
  // hands out should be equally addressable.
  jwt.setJti(randomUUID());

  return jwt.sign(secret);
}

export function createPostgrestJwtTranslator(
  jwks: JWTVerifyGetKey,
  options: PostgrestJwtTranslatorOptions,
): (authorization: string | undefined) => Promise<TranslationResult> {
  return async (authorization: string | undefined): Promise<TranslationResult> => {
    if (!authorization?.startsWith('Bearer ')) {
      return { ok: true, authorization: authorization ?? '', translated: false };
    }

    const token = authorization.slice('Bearer '.length).trim();
    if (!token || !tokenLooksLikeKeycloak(token, options.issuer)) {
      return { ok: true, authorization, translated: false };
    }

    try {
      const { payload } = await jwtVerify(token, jwks, { issuer: options.issuer });
      if (!payload.sub || !isAllowedKeycloakClient(payload, options.allowedClients)) {
        return { ok: false, status: 403, error: 'keycloak_client_not_allowed' };
      }

      // Revocation short-circuit — a token whose jti was explicitly revoked
      // (POST /auth/v1/revoke) must not be honored even though its signature
      // and exp still verify. Fail-open lives in the callback (Redis down →
      // false), so this never locks users out.
      if (options.isRevoked && (await options.isRevoked(claimString(payload, 'jti')))) {
        return { ok: false, status: 401, error: 'token_revoked' };
      }

      const postgrestToken = await mintPostgrestJwt(payload, options.postgrestJwtSecret);
      return { ok: true, authorization: `Bearer ${postgrestToken}`, translated: true };
    } catch (error) {
      if (error instanceof Error && error.message === 'missing_postgrest_jwt_secret') {
        return { ok: false, status: 503, error: 'postgrest_jwt_secret_not_configured' };
      }
      return { ok: false, status: 401, error: 'invalid_keycloak_token' };
    }
  };
}

/**
 * Verify a Keycloak bearer token and return its claims, or `null` when the
 * header is absent, is not a Keycloak token, fails signature/issuer
 * verification, or is from a client that isn't allowed. Used by the revoke
 * route to read the caller's own `jti`/`exp` before adding it to the
 * revocation set (the caller proves ownership by presenting the token).
 */
export async function verifyKeycloakClaims(
  authorization: string | undefined,
): Promise<JWTPayload | null> {
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  if (!token || !tokenLooksLikeKeycloak(token, config.kcIssuer)) return null;
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: config.kcIssuer });
    if (!payload.sub || !isAllowedKeycloakClient(payload, config.kcAllowedClients)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * Converts a verified Keycloak bearer token into a short PostgREST HS256 JWT.
 * Non-Keycloak bearer tokens, including anon/service tokens, pass through.
 * A revoked Keycloak token (jti in the revocation set) is rejected 401.
 */
export const translateAuthorizationForPostgrest = createPostgrestJwtTranslator(JWKS, {
  allowedClients: config.kcAllowedClients,
  issuer: config.kcIssuer,
  postgrestJwtSecret: config.postgrestJwtSecret,
  isRevoked: isTokenRevoked,
});
