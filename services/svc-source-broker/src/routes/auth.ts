/**
 * Source-app federation — members log into the aisha stack via their source
 * credentials (passwordless OTP), verified through the source backend.
 *
 * The legitimacy chain (security):
 *   source OTP verifies the member  →  broker (trusted) provisions the aisha
 *   identity  →  a session token is issued (role=authenticated, NEVER admin)
 *   →  PostgREST RLS scopes the member to their own data.
 *
 * Session issuance — least-privilege first (see mintAishaSession):
 *   PRIMARY  the broker asks the aisha GATEWAY's /token-exchange to mint the
 *            session. The gateway holds the PostgREST signing secret and only
 *            mints role=authenticated for an email that already exists in aisha.
 *            The broker never holds the master secret and cannot forge a role.
 *   FALLBACK (dev/local, where the gateway's intranet key isn't wired) the
 *            broker mints the HS256 session itself with the shared secret, so
 *            the federation stays testable end-to-end without the gateway.
 *
 * Real source GraphQL contract (verified against live schema 2026-05-24):
 *   startOnboarding(email)            → { onboarding { token }, success, error }
 *   verifyOnboarding(verificationCode)→ { onboarding { existingUser { id } } }   [hdr X_ONBOARDING_TOKEN]
 *   sourceJwt(authHandshake)                 → { jwtSource { token }, success, error }   [hdr X_ONBOARDING_TOKEN]
 *
 * Routes (stateless — the onboarding token is passed back by the client):
 *   POST /auth/source/start  { email }                → { onboardingToken }
 *   POST /auth/source/login  { onboardingToken, code }→ { aishaToken, member }
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { errMessage } from '../errors.js';
import { GraphQLClient, gql } from 'graphql-request';
import { Client as PgClient } from 'pg';
import { SignJWT } from 'jose';
import type { SourceBrokerConfig } from '../config.js';
import type { SourcePgClient } from '../clients/pg-readonly-driver.js';

interface StartBody { email: string }
interface LoginBody { onboardingToken: string; code: string }

const MUT_START = gql`
  mutation startOnboarding($email: String!) {
    startOnboarding(email: $email) { onboarding { token } success error }
  }
`;
const MUT_VERIFY = gql`
  mutation verifyOnboarding($code: String!) {
    verifyOnboarding(verificationCode: $code) {
      onboarding { existingUser { id email } }
      success error
    }
  }
`;
const MUT_JWT = gql`
  mutation sourceJwt($authHandshake: String!) {
    sourceJwt(authHandshake: $authHandshake) { jwtSource { token authHandshake } success error }
  }
`;

const ONBOARDING_HEADER = (token: string) => ({ Authorization: `X_ONBOARDING_TOKEN ${token}` });

type MintLog = Pick<FastifyRequest['log'], 'info' | 'warn'>;
export interface MintedSession { token: string; via: 'gateway' | 'broker-mint'; sub: string }

/**
 * Issue an aisha PostgREST session for a verified, already-provisioned member.
 *
 * PRIMARY — gateway /token-exchange (least-privilege): the gateway holds the
 * signing secret and only mints role=authenticated for an email that already
 * exists in aisha. The broker proves "this email is a verified member" with the
 * shared intranet key; it never touches the master secret and cannot pick a role
 * or mint for a non-existent user.
 *
 * FALLBACK — local HS256 mint (dev/local only): used when no intranet key is
 * configured or the gateway is unreachable, so the federation stays testable
 * end-to-end without the gateway. Same role=authenticated, same shape.
 *
 * Returns null when neither path is configured (federation effectively off).
 */
export async function mintAishaSession(
  cfg: SourceBrokerConfig,
  email: string,
  provisionedUserId: string,
  log: MintLog
): Promise<MintedSession | null> {
  // PRIMARY: gateway /token-exchange.
  if (cfg.aishaGatewayIntranetKey) {
    try {
      const res = await fetch(`${cfg.aishaGatewayUrl}/token-exchange`, {
        method: 'POST',
        headers: {
          'x-intranet-api-key': cfg.aishaGatewayIntranetKey,
          'x-auth-request-email': email,
          'content-type': 'application/json',
        },
        body: '{}',
      });
      if (res.ok) {
        const data = (await res.json()) as { jwt?: string; user_id?: string };
        if (data.jwt) {
          return { token: data.jwt, via: 'gateway', sub: data.user_id ?? provisionedUserId };
        }
      }
      log.warn({ status: res.status }, 'gateway /token-exchange did not mint a session; trying fallback');
    } catch (err) {
      log.warn({ err: errMessage(err) }, 'gateway /token-exchange unreachable; trying local-mint fallback');
    }
  }

  // FALLBACK: broker mints the HS256 session itself.
  if (cfg.aishaJwtSecret) {
    const secret = new TextEncoder().encode(cfg.aishaJwtSecret);
    const token = await new SignJWT({
      role: cfg.aishaMemberRole,
      sub: provisionedUserId,
      email,
      source_member: true,
      federated_from: 'source-api',
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setExpirationTime(`${cfg.aishaJwtExpSec}s`)
      .setAudience('authenticated')
      .sign(secret);
    return { token, via: 'broker-mint', sub: provisionedUserId };
  }

  return null;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  config: SourceBrokerConfig,
  source: SourcePgClient
): void {
  const gqlUrl = `${config.sourceApiUrl}/graphql/`;
  const sourceClient = new GraphQLClient(gqlUrl);

  // ─── Step 1: start onboarding (source emails the member an OTP code) ──────
  app.post<{ Body: StartBody }>('/auth/source/start', async (req, reply) => {
    const email = req.body?.email;
    if (!email) return reply.code(400).send({ error: 'email_required' });
    try {
      const data = await sourceClient.request<{
        startOnboarding: { onboarding: { token: string } | null; success: boolean; error: string | null };
      }>(MUT_START, { email });
      if (!data.startOnboarding.success || !data.startOnboarding.onboarding) {
        return reply.code(400).send({ error: 'start_failed', message: data.startOnboarding.error });
      }
      return reply.send({ status: 'code_sent', onboardingToken: data.startOnboarding.onboarding.token });
    } catch (err) {
      req.log.warn({ err: errMessage(err) }, 'source start failed');
      return reply.code(502).send({ error: 'source_unreachable', message: errMessage(err) });
    }
  });

  // ─── Step 2: verify code + mint federated aisha session ───────────────────
  app.post<{ Body: LoginBody }>('/auth/source/login', async (req, reply) => {
    const { onboardingToken, code } = req.body ?? ({} as LoginBody);
    if (!onboardingToken || !code) {
      return reply.code(400).send({ error: 'onboarding_token_and_code_required' });
    }

    // 2a. verifyOnboarding(code) — proves the member controls this email.
    let verifiedEmail: string | null = null;
    let verifiedSourceId: string | null = null;
    try {
      const v = await sourceClient.request<{
        verifyOnboarding: {
          onboarding: { existingUser: { id: string; email: string } | null } | null;
          success: boolean; error: string | null;
        };
      }>(MUT_VERIFY, { code }, ONBOARDING_HEADER(onboardingToken));
      if (!v.verifyOnboarding.success) {
        return reply.code(401).send({ error: 'verify_failed', message: v.verifyOnboarding.error });
      }
      verifiedSourceId = v.verifyOnboarding.onboarding?.existingUser?.id ?? null;
      verifiedEmail = v.verifyOnboarding.onboarding?.existingUser?.email ?? null;
    } catch (err) {
      req.log.warn({ err: errMessage(err) }, 'source verify failed');
      return reply.code(401).send({ error: 'verify_failed', message: errMessage(err) });
    }

    // 2b. sourceJwt(authHandshake) — obtain the member's source JWT (proof of session).
    //     The reply authHandshake is validated per CLAUDE.md.
    let sourceToken: string;
    try {
      const j = await sourceClient.request<{
        sourceJwt: {
          jwtSource: { token: string; authHandshake: string } | null;
          success: boolean;
          error: string | null;
        };
      }>(MUT_JWT, { authHandshake: config.sourceAuthHandshakeOutgoing }, ONBOARDING_HEADER(onboardingToken));
      if (!j.sourceJwt.success || !j.sourceJwt.jwtSource) {
        return reply.code(401).send({ error: 'source_jwt_failed', message: j.sourceJwt.error });
      }
      if (j.sourceJwt.jwtSource.authHandshake !== config.sourceAuthHandshakeIncoming) {
        req.log.warn('sourceJwt reply authHandshake mismatch — refusing session');
        return reply.code(401).send({ error: 'source_jwt_failed', message: 'reply authHandshake mismatch' });
      }
      sourceToken = j.sourceJwt.jwtSource.token;
    } catch (err) {
      req.log.warn({ err: errMessage(err) }, 'sourceJwt failed');
      return reply.code(401).send({ error: 'source_jwt_failed', message: errMessage(err) });
    }

    // 2c. Resolve the member's AUTHORITATIVE identity from source-postgres
    //     (NOT from client input) using the verified email.
    let member: { userId: string; email: string | null; displayName: string | null; language: string | null } | null = null;
    try {
      await source.connect();
      // Prefer the email from the verified onboarding; fall back to source lookup.
      const lookupEmail = verifiedEmail;
      if (lookupEmail) member = await source.getMemberByEmail(lookupEmail);
      // If the onboarding gave us the id directly, trust it as the canonical id.
      if (member && verifiedSourceId) member.userId = verifiedSourceId;
    } catch (err) {
      req.log.error({ err: errMessage(err) }, 'member lookup failed');
    }
    if (!member || !member.email) {
      return reply.code(403).send({ error: 'not_a_member', message: 'no active source member for this email' });
    }

    // 2d. Provision the aisha identity (idempotent), then issue the session.
    //     Provisioning must come first: the gateway /token-exchange mints only
    //     for an email that already exists in aisha.
    if (!config.aishaGatewayIntranetKey && !config.aishaJwtSecret) {
      // No mint path configured — federation is effectively off.
      return reply.send({
        sourceToken,
        aishaToken: null,
        _note:
          'no session mint path configured (set AISHA_GATEWAY_INTRANET_KEY for the gateway path, or AISHA_JWT_SECRET for the local fallback)',
      });
    }
    const aishaPg = new PgClient({
      connectionString: config.postgresUrl,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 10_000,
    });
    let aishaUserId: string;
    try {
      await aishaPg.connect();
      // ⛔ NÁROK PŘED ZŘÍZENÍM (naměřeno ze kódu 2026-09-15). Zřízení vytvoří i
      // dvojče člena přes twin_upsert_entity_audited, jehož stráž je
      // `is_service_role() OR is_admin_or_staff()` — obojí čte JWT claims, NE
      // roli spojení (broker je `aisha_admin`). Bez tohoto řádku stráž odmítla,
      // zřízení výjimku SPOLKLO jako WARNING a člen zůstal bez reference
      // `source-federation`: účet vznikl, dvojče ze zdroje ne. Plánovač
      // (scheduler.ts) i živé čtení (source-read.ts) nárok nastavují — tahle
      // cesta byla jediná, která to nedělala.
      await aishaPg.query(`SET request.jwt.claims = '{"role":"service_role"}'`);
      const res = await aishaPg.query<{ audience_provision_federated_member: string }>(
        `SELECT public.audience_provision_federated_member($1::uuid,$2::text,$3::text,$4::text,$5::text)`,
        [member.userId, member.email, member.displayName, member.language ?? 'en', null]
      );
      aishaUserId = res.rows[0].audience_provision_federated_member;
    } catch (err) {
      req.log.error({ err: errMessage(err) }, 'federated provision failed');
      return reply.code(500).send({ error: 'provision_failed', message: errMessage(err) });
    } finally {
      await aishaPg.end().catch(() => undefined);
    }

    // Issue the session — gateway /token-exchange (least-privilege) first, local
    // HS256 mint as the dev/local fallback. role=authenticated either way, so
    // is_admin_or_staff() is false and RLS shows only the member's own data.
    const session = await mintAishaSession(config, member.email, aishaUserId, req.log);
    if (!session) {
      return reply.send({ sourceToken, aishaToken: null, _note: 'session mint failed on all configured paths' });
    }

    req.log.info(
      { aishaUserId: session.sub, email: member.email, via: session.via },
      'source member federated → aisha session issued'
    );
    return reply.send({
      aishaToken: session.token,
      sourceToken,
      member: { id: session.sub, email: member.email, displayName: member.displayName },
      _via: session.via,
    });
  });
}
