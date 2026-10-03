/**
 * AISHA-side route auth for the source broker.
 *
 * SECURITY (OWASP A07 / A01): admin-scoped broker routes (`POST /sync/run`,
 * `GET /sync/probe`) must NEVER authorize off a client-supplied identity header
 * such as `X-Aisha-User-Role`. Any caller able to reach the broker port could
 * spoof it (`X-Aisha-User-Role: admin`) → full auth bypass. Internal-only is no
 * defense: the broker sits on the shared mesh/coolify network alongside other
 * tenants and is a classic SSRF/lateral-movement target.
 *
 * Trust anchors (both cryptographically verified, mirroring the canonical
 * svc-ai-chat / @aisha/security pattern):
 *   1. Human admin via the gateway → a Keycloak access token (Bearer). Verified
 *      against the realm JWKS (ISS-pinned), role read from `realm_access.roles`.
 *   2. Gateway / cron service-to-service → the shared INTRANET_API_KEY (the same
 *      secret the broker already holds to call the gateway `/token-exchange`),
 *      constant-time compared.
 *
 * Dev/CI escape hatch stays explicit: config.devAllowUnauthedSync — ONLY for the
 * admin/service routes. `requireUser` has NO escape hatch (see below).
 *
 * `requireUser` (federace „za uživatele", ADR-004 bod 4; plán PR B, B1) je třetí,
 * oddělená kotva: BĚŽNÝ uživatel aishy, identifikovaný VÝHRADNĚ ověřeným tokenem
 * Keycloaku — nikdy tělem, hlavičkou ani servisním klíčem (ten uživatele nenese).
 * Token musí být vydaný klientu webu INSTANCE: `aud` i `azp` = `OIDC_APP_CLIENT_ID`.
 * Bez toho by prošel token kteréhokoli klienta realmu (proxy, zařízení CLI…),
 * protože ISS-only ověřování audience nekontroluje. `sub` je id uživatele aishy
 * (realm mapuje `sub` ← KC user id; `aisha_auth.uid()` ho čte jako uuid).
 *
 * This file is the SINGLE place AISHA-side authorization is decided for broker
 * routes — distinct from auth.ts (SourceAuthManager), which authenticates the
 * broker TO the upstream source-api.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { type JWTPayload } from 'jose';
import {
  createJwtVerifier,
  AuthError as SecurityAuthError,
  verifyServiceRole as sharedVerifyServiceRole,
} from '@aisha/security';
import type { SourceBrokerConfig } from './config.js';

export interface VerifiedUser {
  userId: string;
  email?: string;
  roles: string[];
  claims: JWTPayload;
}

export class AuthError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface BrokerAuthGuard {
  /** Verify a Keycloak Bearer token → { userId, roles, … }. Throws AuthError. */
  verifyToken(authHeader: string | undefined): Promise<VerifiedUser>;
  /** True iff the verified user holds the admin or staff realm role. */
  isAdminOrStaff(user: VerifiedUser): boolean;
  /** Verify the gateway/cron shared service token (INTRANET_API_KEY). Throws AuthError. */
  verifyServiceToken(authHeader: string | undefined): void;
  /**
   * Fastify preHandler: allow ONLY (a) a verified admin/staff Keycloak JWT, or
   * (b) the gateway/cron shared service token. Dev bypass: devAllowUnauthedSync.
   * Never trusts client-supplied identity headers.
   */
  requireAdminOrService(req: FastifyRequest, reply: FastifyReply): Promise<void>;
  /**
   * Fastify preHandler pro routy BĚŽNÉHO uživatele: jen ověřený KC token klienta webu
   * instance (`aud` i `azp` = OIDC_APP_CLIENT_ID) se `sub` ve tvaru uuid. Servisní klíč
   * i dev obchvat = 401. Ověřený uživatel → `uzivatelZPozadavku(req)`.
   */
  requireUser(req: FastifyRequest, reply: FastifyReply): Promise<void>;
}

type PozadavekSUzivatelem = FastifyRequest & { aishaUser?: VerifiedUser };

/**
 * Ověřený uživatel, kterého do požadavku vložila stráž. Volá se JEN za `requireUser`
 * (nebo `requireAdminOrService`); bez uživatele je to chyba zapojení routy, ne
 * anonymní přístup — proto výjimka, ne `undefined`.
 */
export function uzivatelZPozadavku(req: FastifyRequest): VerifiedUser {
  const u = (req as PozadavekSUzivatelem).aishaUser;
  if (!u) throw new Error('uzivatelZPozadavku: routa nemá stráž requireUser — ověřený uživatel chybí');
  return u;
}

/** `aisha_auth.uid()` čte `sub` jako uuid; jiný tvar není uživatel aishy. */
const UUID_TVAR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createAuthGuard(config: SourceBrokerConfig): BrokerAuthGuard {
  // Mirror svc-ai-chat: ISS-pinned JWKS verifier built from the realm config.
  const verifier = createJwtVerifier({
    jwksUrl: `${config.keycloakUrl}/realms/${config.keycloakRealm}/protocol/openid-connect/certs`,
    issuer: `${config.keycloakUrl}/realms/${config.keycloakRealm}`,
    service: 'svc-source-broker',
  });

  // Uživatelský ověřovatel: týž realm a issuer, ale s PŘIPNUTÝM audience na klienta webu instance.
  const userVerifier = createJwtVerifier({
    jwksUrl: `${config.keycloakUrl}/realms/${config.keycloakRealm}/protocol/openid-connect/certs`,
    issuer: `${config.keycloakUrl}/realms/${config.keycloakRealm}`,
    audience: config.oidcAppClientId,
    service: 'svc-source-broker',
  });

  async function verifyToken(authHeader: string | undefined): Promise<VerifiedUser> {
    try {
      const user = await verifier.verify(authHeader);
      return {
        userId: user.sub,
        email: user.email,
        roles: user.realm_access?.roles ?? [],
        claims: user,
      };
    } catch (err) {
      if (err instanceof SecurityAuthError) throw new AuthError(err.statusCode, err.message);
      throw err;
    }
  }

  function isAdminOrStaff(user: VerifiedUser): boolean {
    return user.roles.includes('admin') || user.roles.includes('staff');
  }

  function verifyServiceToken(authHeader: string | undefined): void {
    if (!config.aishaGatewayIntranetKey) {
      // No shared secret configured → the service-token path is disabled.
      throw new AuthError(401, 'service-token auth not configured');
    }
    try {
      sharedVerifyServiceRole(authHeader, config.aishaGatewayIntranetKey);
    } catch (err) {
      if (err instanceof SecurityAuthError) throw new AuthError(err.statusCode, err.message);
      throw err;
    }
  }

  async function requireAdminOrService(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    // Explicit dev/CI bypass (production MUST leave this unset).
    if (config.devAllowUnauthedSync) return;

    const authHeader = req.headers.authorization;

    // 1) Service-to-service: gateway / cron present the shared INTRANET_API_KEY
    //    as the Bearer token. Constant-time compared (no timing leak).
    if (config.aishaGatewayIntranetKey) {
      try {
        verifyServiceToken(authHeader);
        return;
      } catch {
        // Not the service token — fall through to the human-admin JWT path.
      }
    }

    // 2) Human admin: a verified Keycloak JWT carrying the admin/staff realm role.
    try {
      const user = await verifyToken(authHeader);
      if (!isAdminOrStaff(user)) {
        await reply.code(403).send({
          error: 'forbidden',
          message: 'admin or staff role required',
        });
        return;
      }
      (req as FastifyRequest & { aishaUser?: VerifiedUser }).aishaUser = user;
    } catch (err) {
      const status = err instanceof AuthError ? err.statusCode : 401;
      await reply.code(status).send({
        error: 'unauthorized',
        message:
          'requires an admin/staff Keycloak Bearer token, or the gateway service ' +
          'token (Authorization: Bearer <INTRANET_API_KEY>)',
      });
    }
  }

  async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    // ⛔ ŽÁDNÝ dev obchvat a žádný servisní klíč: uživatele nese jen jeho vlastní token.
    // Bez tokenu tu není „nikdo" — a za nikoho se u zdroje jednat nesmí.
    try {
      const user = await userVerifier.verify(req.headers.authorization);
      if (user.azp !== config.oidcAppClientId) {
        throw new AuthError(401, 'token was not issued to the instance web client');
      }
      if (typeof user.sub !== 'string' || !UUID_TVAR.test(user.sub)) {
        throw new AuthError(401, 'token subject is not an aisha user id');
      }
      (req as PozadavekSUzivatelem).aishaUser = {
        userId: user.sub,
        email: user.email,
        roles: user.realm_access?.roles ?? [],
        claims: user,
      };
    } catch (err) {
      const status = err instanceof AuthError ? err.statusCode : 401;
      await reply.code(status).send({
        error: 'unauthorized',
        message: 'requires the user\'s own Keycloak Bearer token issued to the instance web client',
      });
    }
  }

  return { verifyToken, isAdminOrStaff, verifyServiceToken, requireAdminOrService, requireUser };
}
