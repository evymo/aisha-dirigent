/**
 * OWASP A07 — Identification & Authentication Failures.
 *
 * JWT verification with Keycloak/JWKS, plus MFA & session-age enforcement.
 *
 * Why we re-implement instead of using @fastify/jwt:
 *   - We need ISS-pinned JWKS (Keycloak rotates keys).
 *   - We need an `mfaRequired` policy hook for sensitive routes (`acr` claim).
 *   - We need session-age enforcement (`auth_time` claim) decoupled from
 *     token TTL — refresh-token re-issuance keeps a short-TTL access token
 *     alive but the original auth event may be 12h old.
 *
 * Reference: Keycloak issues `acr=2` (or higher) when MFA was satisfied during
 * the originating authentication. We check `acr` AND a 30-min `auth_time`
 * window for sensitive RPCs (`requireMfa: true, maxAuthAgeSec: 1800`).
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { createSafeLogger } from './logger.js';

export interface VerifyJwtOptions {
  /** Full URL to the JWKS endpoint, e.g. https://kc.example.com/realms/aisha/protocol/openid-connect/certs */
  jwksUrl: string;
  /** Expected `iss` claim, e.g. https://kc.example.com/realms/aisha */
  issuer: string;
  /** Expected `aud` claim. When omitted, audience is not checked (PostgREST realm pattern). */
  audience?: string;
  /** Service name for log tagging. */
  service: string;
}

export interface VerifiedUser extends JWTPayload {
  sub: string;
  email?: string;
  /** Keycloak realm-level role claims (tvar `realm_access.roles`). */
  realm_access?: { roles: string[] };
  /**
   * PLOCHÝ nárok `roles` — tvar, který vydává NÁŠ realm.
   * ⛔ NAMĚŘENO 2026-09-21: token z `aisha-app` nese role zde, NE v
   * `realm_access`. Kdo četl jen `realm_access.roles`, viděl prázdno.
   */
  roles?: string[];
  /** Per-client role claims. */
  resource_access?: Record<string, { roles: string[] }>;
  /** Authentication Context Class Reference — '2' = MFA was used. */
  acr?: string;
  /** Unix epoch seconds when the original authentication happened. */
  auth_time?: number;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number = 401,
    public reason: 'missing' | 'invalid' | 'expired' | 'mfa_required' | 'session_too_old' | 'unconfigured' = 'invalid',
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Issuer, který se OČEKÁVÁ v tokenu z prohlížeče.
 *
 * ⛔ NAMĚŘENO 2026-09-21 (RIQ): dvanáct služeb si issuer skládalo z VNITŘNÍ
 * adresy Keycloaku, jenže token vydaný uživateli nese adresu VEŘEJNOU.
 * `jwtVerify` na neshodě issueru vyhodí výjimku a ověřovatel ji sjednotí na
 * hlášku „Invalid token" — takže platný token admina vypadal jako neplatný
 * a celé to působilo jako problém s oprávněními.
 *
 * Vada ležela měsíce neviditelná, protože všechno chodilo PŘES GATEWAY, která
 * to má správně. Projevila se teprve tam, kde prohlížeč mluví se službou
 * napřímo.
 *
 * `||` (ne `??`) je ZÁMĚR: prázdná hodnota (compose přeposílá nenastavený
 * KC_ISSUER jako "") musí spadnout na vnitřní zálohu, ne vyrobit `new URL('')`.
 * Týž tvar používá gateway (services/gateway/src/config.ts).
 */
export function ocekavanyIssuer(keycloakUrl: string, realm: string): string {
  return issuerZProstredi(`${keycloakUrl}/realms/${realm}`);
}

/** Dostane ODVOZENÝ issuer a dá přednost `KC_ISSUER`. */
function issuerZProstredi(odvozeny: string): string {
  return process.env.KC_ISSUER?.trim() || odvozeny;
}

/**
 * Srovná nárok o rolích do JEDNOHO tvaru.
 *
 * ⛔ Konzumenti čtou `realm_access.roles`, ale náš realm vydává PLOCHÝ nárok
 * `roles`. Místo aby se patnáct služeb učilo obojí, srovná to ověřovatel hned
 * po ověření — pak je jedno, který mapper je v realmu zrovna nastavený.
 */
function normalizujRole(user: VerifiedUser): VerifiedUser {
  const sjednocene = roleUzivatele(user);
  if (sjednocene.length === 0) return user;
  return { ...user, roles: sjednocene, realm_access: { roles: sjednocene } };
}

/**
 * Role volajícího — z OBOU tvarů, které Keycloak umí vydat.
 *
 * ⛔ Náš realm vydává PLOCHÝ nárok `roles`; `realm_access.roles` je tvar
 * výchozího mapperu. Gateway čte plochý (`postgrest-jwt.ts`), služby četly
 * jen `realm_access` — a viděly prázdno i u admina. Čteme sjednocení, aby
 * odpověď nezávisela na tom, který mapper je zrovna nastavený.
 */
export function roleUzivatele(user: VerifiedUser): string[] {
  const ploche = Array.isArray(user.roles) ? user.roles : [];
  const realmove = user.realm_access?.roles ?? [];
  return [...new Set([...ploche, ...realmove])];
}

export interface JwtVerifier {
  verify(authHeader: string | undefined): Promise<VerifiedUser>;
  /** Throws AuthError when MFA was not satisfied or session is too old. */
  enforcePolicy(user: VerifiedUser, policy: AuthPolicy): void;
}

export interface AuthPolicy {
  /** Require ACR=2+ (MFA satisfied). */
  requireMfa?: boolean;
  /** Maximum age of the original authentication in seconds. */
  maxAuthAgeSec?: number;
  /** Required realm roles — user must have at least one of them. */
  requireRealmRoles?: string[];
}

export function createJwtVerifier(opts: VerifyJwtOptions): JwtVerifier {
  const jwks = createRemoteJWKSet(new URL(opts.jwksUrl));
  const log = createSafeLogger(`jwt:${opts.service}`);
  // ⭐ Issuer rozhoduje OVĚŘOVATEL, ne volající. Kdyby se to řešilo na patnácti
  // místech, patnáctkrát by se to dalo splést — a šestnáctá služba by vzorec opsala
  // znovu. Tady to nejde obejít ani omylem.
  const ocekavany = issuerZProstredi(opts.issuer);

  return {
    async verify(authHeader): Promise<VerifiedUser> {
      if (!authHeader) throw new AuthError('Missing Authorization header', 401, 'missing');
      const token = authHeader.replace(/^Bearer\s+/i, '');
      if (!token) throw new AuthError('Empty bearer token', 401, 'missing');

      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer: ocekavany,
          audience: opts.audience,
        });
        if (!payload.sub) throw new AuthError('Token missing sub claim', 401, 'invalid');
        return normalizujRole(payload as VerifiedUser);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/expired/i.test(msg)) throw new AuthError('Token expired', 401, 'expired');
        log.safeWarn('jwt.verify_failed', { reason: msg });
        throw new AuthError('Invalid token', 401, 'invalid');
      }
    },
    enforcePolicy(user, policy): void {
      if (policy.requireMfa) {
        const acr = user.acr;
        // Keycloak uses string ACR values; OIDC core lists '0'/'1'/'2' where 2 = MFA.
        const acrNum = acr ? Number.parseInt(acr, 10) : 0;
        if (!acr || Number.isNaN(acrNum) || acrNum < 2) {
          throw new AuthError('Multi-factor authentication required', 403, 'mfa_required');
        }
      }
      if (policy.maxAuthAgeSec) {
        const authTime = user.auth_time;
        if (typeof authTime !== 'number') {
          throw new AuthError('auth_time claim missing — re-authenticate', 401, 'session_too_old');
        }
        const ageSec = Math.floor(Date.now() / 1000) - authTime;
        if (ageSec > policy.maxAuthAgeSec) {
          throw new AuthError('Session too old — re-authenticate', 401, 'session_too_old');
        }
      }
      if (policy.requireRealmRoles && policy.requireRealmRoles.length > 0) {
        const roles = roleUzivatele(user);
        const ok = policy.requireRealmRoles.some((r) => roles.includes(r));
        if (!ok) {
          throw new AuthError('Insufficient role', 403, 'invalid');
        }
      }
    },
  };
}

/**
 * Fastify preHandler factory — attaches verified user to `req.user`.
 *
 * Usage:
 * ```ts
 * app.addHook('onRequest', requireAuth(verifier));
 * app.post('/api/sensitive', { preHandler: requirePolicy(verifier, { requireMfa: true }) }, handler);
 * ```
 */
export function requireAuth(verifier: JwtVerifier) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const user = await verifier.verify(req.headers.authorization);
      (req as { user?: VerifiedUser }).user = user;
    } catch (err) {
      if (err instanceof AuthError) {
        await reply.code(err.statusCode).send({ error: err.reason, message: err.message });
        return;
      }
      await reply.code(401).send({ error: 'invalid', message: 'Authentication failed' });
    }
  };
}

export function requirePolicy(verifier: JwtVerifier, policy: AuthPolicy) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = (req as { user?: VerifiedUser }).user;
    if (!user) {
      await reply.code(401).send({ error: 'missing', message: 'Authentication required' });
      return;
    }
    try {
      verifier.enforcePolicy(user, policy);
    } catch (err) {
      if (err instanceof AuthError) {
        await reply.code(err.statusCode).send({ error: err.reason, message: err.message });
        return;
      }
      throw err;
    }
  };
}

/**
 * Canonical "admin route" gate — requires MFA satisfied during original
 * auth (`acr >= 2`) AND auth event happened within the last 30 minutes.
 *
 * Use as a Fastify preHandler on every route that mutates security-relevant
 * state (admin RPC, automation control, payload approval, etc.). The
 * AITG-INF-04 + capability-misuse discovery gate flags routes that LOOK
 * admin-scoped but DON'T use this helper.
 *
 * Maxes out user trust at 30 minutes since the last MFA event — matches
 * the existing AISHA sensitive-data policy.
 */
export const ADMIN_MFA_POLICY: AuthPolicy = {
  requireMfa: true,
  maxAuthAgeSec: 1800,
};

export function requireAdminMfa(verifier: JwtVerifier) {
  return requirePolicy(verifier, ADMIN_MFA_POLICY);
}

/**
 * Constant-time string compare to prevent secret-token timing-attack leakage.
 *
 * Why not `a === b`? JavaScript's `===` short-circuits on the first mismatched
 * byte, leaking byte-position information through response timing. An attacker
 * can iterate `aaa…a` → `baa…a` → … and measure response time to recover
 * the secret byte by byte. The XOR-accumulator pattern below performs the
 * same number of operations regardless of which byte differs.
 *
 * Always length-checks first: a 1-byte secret vs. a 1MB candidate must NOT
 * take 1MB-of-time to reject (DoS protection). The length check itself
 * leaks length, but that's an intentional trade-off vs. amplification risk.
 *
 * Returns `true` iff both inputs are exactly equal byte-for-byte.
 *
 * @example
 *   if (!constantTimeStringCompare(provided, expected)) {
 *     throw new AuthError('Invalid token', 403, 'invalid');
 *   }
 */
export function constantTimeStringCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Verify a constant service-role token (used for internal service-to-service). */
export function verifyServiceRole(authHeader: string | undefined, expectedToken: string): void {
  if (!authHeader) throw new AuthError('Missing Authorization header', 401, 'missing');
  // Fail-closed on misconfiguration: an empty expected token must NEVER
  // authenticate a caller. constantTimeStringCompare('', '') is true, so
  // without this guard an unset service token (callers default it to '') plus
  // an empty bearer ("Bearer ") would be accepted as service_role in EVERY
  // consumer of this helper. Reject before the compare — the service-role path
  // is simply unavailable until a token is configured (JWT auth is unaffected).
  if (!expectedToken) {
    throw new AuthError('Service role authentication is not configured', 503, 'unconfigured');
  }
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!constantTimeStringCompare(token, expectedToken)) {
    throw new AuthError('Invalid service role token', 403, 'invalid');
  }
}
