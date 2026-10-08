import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync, FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SignJWT, type JWTPayload } from 'jose';
import { config } from '../config.js';
import { verifyKeycloakClaims } from '../auth/postgrest-jwt.js';
import { isTokenRevoked } from '../auth/jwt-revocation.js';

/**
 * /intranet/* — Intranet API proxy routes
 *
 * Provides user-scoped backend access for Appsmith intranet apps.
 *
 * Auth model (S2 remediation — verify-OIDC primary):
 *   Identity comes ONLY from a VERIFIED Keycloak access token — the caller
 *   presents it as `Authorization: Bearer` or via the oauth2-proxy-injected
 *   `X-Auth-Request-Access-Token` header. The token is verified (signature +
 *   issuer + intranet client), checked for revocation, and its email is
 *   resolved to a DB user id. The `X-Intranet-Api-Key` shared secret is kept
 *   only as a coarse defense-in-depth pre-filter — it is NEVER sufficient
 *   alone. The `X-Auth-Request-Email` / `X-Appsmith-User-Email` headers are
 *   NEVER trusted as identity (they are browser-spoofable on a public listener).
 *
 * Routes:
 *   POST /intranet/token-exchange — Mint a short-lived PostgREST JWT for a user
 *   POST /intranet/rpc/:fn_name   — Execute a PostgREST RPC on behalf of a user
 *   POST /intranet/mcp            — Proxy a JSON-RPC call to MCP server (allowlisted tools)
 */

const textEncoder = new TextEncoder();

// ── Config ──────────────────────────────────────────────────────────────────

const INTRANET_API_KEY = process.env.INTRANET_API_KEY ?? '';
const POSTGREST_JWT_SECRET = config.postgrestJwtSecret;
const POSTGREST_URL = config.postgrestUrl;
const MCP_UPSTREAM = process.env.MCP_UPSTREAM_URL ?? 'http://svc-mcp-knowledge:3010';

// JSON-RPC methods allowed for intranet users (restrict MCP surface)
const MCP_METHOD_ALLOWLIST = new Set([
  'tools/call',   // Tool invocation — individual tools validated via MCP_TOOL_ALLOWLIST
  'tools/list',   // List available tools — safe, returns filtered list
]);

// MCP tools that intranet users may invoke (read-only, no admin/deploy operations)
// Every name here MUST resolve to a tool implemented in svc-mcp-knowledge's
// TOOL_DEFINITIONS (mcp.ts) — otherwise the proxy advertises a capability the
// backend rejects with "Unknown MCP tool" at call time (dangling contract,
// enforced by the mcp-allowlist-subset gate).
// Dropped: 'search_ragnarok' and 'get_project_context' — no backing RPC / tool
// exists for either, so they are not part of the live MCP surface.
const MCP_TOOL_ALLOWLIST = new Set([
  'search_knowledge',
  'search_knowledge_v2',
  'get_knowledge_item',
  'get_expertise_areas',
  'match_experts',
  'get_story_context',
  'get_knowledge_stats',
  'get_knowledge_topics_localized',
  'get_public_chat_channel_config',
  'list_public_chat_channels',
  'get_design_profile',
  'get_model_registry',
]);

// RPC functions explicitly exposed to Appsmith intranet datasources.
// Keep this narrow: every addition should correspond to a user-scoped intranet
// workflow and an RLS/SECURITY DEFINER review of the target function.
const RPC_ALLOWLIST = new Set([
  'create_intranet_channel',
  'get_intranet_channels',
  'get_intranet_messages',
  'get_my_stories',
  'join_intranet_channel',
  'send_intranet_message',
]);

// ── Helpers ─────────────────────────────────────────────────────────────────

function validateApiKey(req: FastifyRequest): boolean {
  if (!INTRANET_API_KEY) return false;
  const key = req.headers['x-intranet-api-key'];
  return typeof key === 'string' && key === INTRANET_API_KEY;
}

/**
 * Extract a bearer credential from the request: an explicit `Authorization:
 * Bearer` header, else the oauth2-proxy-injected `X-Auth-Request-Access-Token`
 * (normalised into `Bearer <token>` so verifyKeycloakClaims can consume it).
 * The spoofable `X-Auth-Request-Email` / `X-Appsmith-User-Email` headers are
 * intentionally NOT read here — they are never a source of identity (S2).
 */
function extractBearer(req: FastifyRequest): string | undefined {
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader;
  }
  const injected = req.headers['x-auth-request-access-token'];
  if (typeof injected === 'string' && injected.trim()) {
    return `Bearer ${injected.trim()}`;
  }
  return undefined;
}

/**
 * S2 R2 — restrict acceptance to the dedicated intranet OIDC client, NOT the
 * whole kcAllowedClients set. A token minted for the SPA / a device client is
 * rejected here even though verifyKeycloakClaims (broad allow-list) accepted it.
 */
function isIntranetClient(claims: JWTPayload): boolean {
  const allowed = new Set(config.kcIntranetAllowedClients);
  if (allowed.size === 0) return false;
  const azp = typeof claims.azp === 'string' ? claims.azp : '';
  const audiences = Array.isArray(claims.aud)
    ? claims.aud
    : typeof claims.aud === 'string'
      ? [claims.aud]
      : [];
  return allowed.has(azp) || audiences.some((a) => typeof a === 'string' && allowed.has(a));
}

/** The verified token's email claim (email, else preferred_username). */
function verifiedEmail(claims: JWTPayload): string | undefined {
  for (const key of ['email', 'preferred_username'] as const) {
    const value = claims[key];
    if (typeof value === 'string' && value.includes('@')) return value;
  }
  return undefined;
}

type VerifiedIdentity =
  | { ok: true; user: { id: string; email: string; roles: string[] } }
  | { ok: false; status: number; error: string };

/**
 * The single S2 identity gate shared by /token-exchange, /rpc and /mcp:
 *   1. require a bearer token (R1) — no token → 401
 *   2. verify it against Keycloak (R1)
 *   3. accept ONLY the intranet client (R2)
 *   4. reject revoked tokens by jti (R3 — verifyKeycloakClaims omits this)
 *   5. resolve the VERIFIED email to a DB user id (R4) — unknown user → 401
 * Identity NEVER derives from a request header; fail-loud 401 at every step (R6).
 */
async function resolveVerifiedIdentity(req: FastifyRequest): Promise<VerifiedIdentity> {
  const authorization = extractBearer(req);
  if (!authorization) {
    return { ok: false, status: 401, error: 'invalid_token' };
  }

  const claims = await verifyKeycloakClaims(authorization);
  if (!claims) {
    return { ok: false, status: 401, error: 'invalid_token' };
  }

  if (!isIntranetClient(claims)) {
    return { ok: false, status: 401, error: 'client_not_allowed' };
  }

  // Fail-loud: a token carrying no jti cannot be revocation-checked, so we
  // refuse to mint from it rather than silently treating it as non-revoked
  // (isTokenRevoked(undefined) === false). Keycloak access tokens always
  // carry a jti, so this rejects only malformed / non-KC bearers (R3/R6).
  const jti = typeof claims.jti === 'string' ? claims.jti : undefined;
  if (!jti) {
    return { ok: false, status: 401, error: 'invalid_token' };
  }
  if (await isTokenRevoked(jti)) {
    return { ok: false, status: 401, error: 'token_revoked' };
  }

  const email = verifiedEmail(claims);
  if (!email) {
    return { ok: false, status: 401, error: 'invalid_token' };
  }

  const user = await lookupUserByEmail(email);
  if (!user) {
    // Fail-loud: the fail-open synthesising fallback is intentionally gone (R4/R6).
    return { ok: false, status: 401, error: 'user_not_found' };
  }

  return { ok: true, user };
}

async function lookupUserByEmail(email: string): Promise<{ id: string; email: string; roles: string[] } | null> {
  const url = `${POSTGREST_URL}/rpc/get_user_by_email`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${await mintServiceJwt()}`,
    },
    body: JSON.stringify({ p_email: email }),
    signal: AbortSignal.timeout(5_000),
  });

  // No fail-open fallback: an unresolved user is a hard 401 upstream (R4/R6).
  if (!res.ok) return null;

  const data = (await res.json()) as Record<string, unknown>;
  if (!data?.id) return null;
  return {
    id: String(data.id),
    email: typeof data.email === 'string' ? data.email : email,
    roles: Array.isArray(data.roles) ? (data.roles as string[]) : ['authenticated'],
  };
}

async function mintServiceJwt(): Promise<string> {
  const secret = textEncoder.encode(POSTGREST_JWT_SECRET);
  return new SignJWT({ role: 'service_role', iss: 'aisha-gateway' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('1m')
    .sign(secret);
}

async function mintUserJwt(userId: string, email: string, roles: string[]): Promise<string> {
  const secret = textEncoder.encode(POSTGREST_JWT_SECRET);
  return new SignJWT({
    role: 'authenticated',
    sub: userId,
    email,
    roles,
    iss: 'aisha-intranet-proxy',
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    // Own jti so the minted 15m PostgREST token is itself revocation-addressable (R3).
    .setJti(randomUUID())
    .setExpirationTime('15m')
    .sign(secret);
}

function sendError(reply: FastifyReply, status: number, error: string): FastifyReply {
  return reply.code(status).send({ error });
}

// ── Route plugin ────────────────────────────────────────────────────────────

export const intranetRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // ── POST /token-exchange ────────────────────────────────────────────────
  // Returns a short-lived PostgREST JWT for the identified user.
  // Appsmith captures this on page load and uses it in subsequent API calls.
  app.post('/token-exchange', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!validateApiKey(req)) {
      return sendError(reply, 401, 'invalid_api_key');
    }

    const identity = await resolveVerifiedIdentity(req);
    if (!identity.ok) {
      return sendError(reply, identity.status, identity.error);
    }
    const { user } = identity;

    const jwt = await mintUserJwt(user.id, user.email, user.roles);
    // Kdo: userId (DB id). E-mail je PII — logger z továrny ho stejně skryje.
    req.log.info({ userId: user.id }, 'intranet token exchange');

    return reply.send({ jwt, expires_in: 900, user_id: user.id });
  });

  // ── POST /rpc/:fn_name ────────────────────────────────────────────────
  // Executes an allowlisted PostgREST RPC call on behalf of the identified user.
  // Non-allowlisted functions return 403.
  app.post<{ Params: { fn_name: string } }>('/rpc/:fn_name', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!validateApiKey(req)) {
      return sendError(reply, 401, 'invalid_api_key');
    }

    const { fn_name } = req.params as { fn_name: string };
    if (!RPC_ALLOWLIST.has(fn_name)) {
      req.log.warn({ fn_name }, 'intranet RPC blocked');
      return sendError(reply, 403, 'rpc_not_allowed');
    }

    const identity = await resolveVerifiedIdentity(req);
    if (!identity.ok) {
      return sendError(reply, identity.status, identity.error);
    }
    const { user } = identity;

    const userJwt = await mintUserJwt(user.id, user.email, user.roles);

    // Forward to PostgREST
    const url = `${POSTGREST_URL}/rpc/${fn_name}`;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userJwt}`,
      },
      body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}),
      signal: AbortSignal.timeout(30_000),
    });

    req.log.info({ fn_name, userId: user.id, status: upstream.status }, 'intranet RPC proxy');

    const contentType = upstream.headers.get('content-type') ?? 'application/json';
    reply.code(upstream.status).header('content-type', contentType);
    return reply.send(await upstream.text());
  });

  // ── POST /mcp ─────────────────────────────────────────────────────────
  // Proxy a JSON-RPC call to the MCP knowledge server.
  // Only allowlisted (read-only) tools are permitted.
  app.post('/mcp', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!validateApiKey(req)) {
      return sendError(reply, 401, 'invalid_api_key');
    }

    const identity = await resolveVerifiedIdentity(req);
    if (!identity.ok) {
      return sendError(reply, identity.status, identity.error);
    }
    const email = identity.user.email;
    // Do logu jde userId: e-mail je PII a logger ho redaktuje, takže by u
    // zablokovaného nástroje chybělo, kdo to byl.
    const userId = identity.user.id;

    // Parse JSON-RPC body
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
      return sendError(reply, 400, 'invalid_jsonrpc_request');
    }

    // Only allowlisted JSON-RPC methods may pass through
    if (!MCP_METHOD_ALLOWLIST.has(body.method)) {
      req.log.warn({ method: body.method, userId }, 'intranet MCP method blocked');
      return sendError(reply, 403, `mcp_method_not_allowed: ${body.method}`);
    }

    // For tools/call method, validate the tool name against allowlist
    if (body.method === 'tools/call') {
      const params = body.params as Record<string, unknown> | undefined;
      const toolName = params?.name;
      if (typeof toolName !== 'string' || !MCP_TOOL_ALLOWLIST.has(toolName)) {
        req.log.warn({ tool: toolName, userId }, 'intranet MCP tool blocked');
        return sendError(reply, 403, `mcp_tool_not_allowed: ${toolName}`);
      }
    }

    // Forward to MCP server with service credentials
    const serviceJwt = await mintServiceJwt();
    const upstream = await fetch(`${MCP_UPSTREAM}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceJwt}`,
        'X-Intranet-User-Email': email,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    req.log.info({ method: body.method, userId, status: upstream.status }, 'intranet MCP proxy');

    const contentType = upstream.headers.get('content-type') ?? 'application/json';
    reply.code(upstream.status).header('content-type', contentType);
    return reply.send(await upstream.text());
  });
};
