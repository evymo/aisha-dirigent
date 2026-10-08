import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { translateAuthorizationForPostgrest, verifyKeycloakClaims } from '../auth/postgrest-jwt.js';
import { revokeToken } from '../auth/jwt-revocation.js';
import { zavriNajem } from '../lib/najem-adresy.js';

type OAuthCallbackTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
};

/**
 * Auth routes — backward-compatible proxy from GoTrue URL structure to Keycloak OIDC.
 *
 * External services (Google, Apple) have hardcoded:
 *   https://api.aisha.guru/auth/v1/callback
 *
 * This plugin intercepts those requests and completes the OIDC flow with Keycloak.
 *
 * Routes:
 *   GET /auth/v1/callback  — OAuth2 callback (code exchange with KC)
 *   GET /auth/v1/authorize — Redirect to KC authorize endpoint
 *   GET /auth/v1/verify    — Email verification link handler
 */
export const authRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {

  /**
   * GET /auth/v1/callback?code=...&state=...
   *
   * Google/Apple/KC redirect here after user consents.
   * We exchange the code with Keycloak's token endpoint,
   * then redirect the user to the frontend with the tokens.
   */
  app.get('/callback', async (req: FastifyRequest, reply: FastifyReply) => {
    const nenastaveno = prihlaseniNenastaveno(reply);
    if (nenastaveno) return nenastaveno;
    const { code, state, error, error_description } = req.query as Record<string, string | undefined>;

    if (error) {
      req.log.warn({ error, error_description }, 'OAuth callback error');
      return reply.redirect(`${config.frontendUrl}/auth/error?error=${encodeURIComponent(error)}`);
    }

    if (!code) {
      return reply.status(400).send({ error: 'missing_code', message: 'Authorization code is required' });
    }

    try {
      // Exchange authorization code for tokens with Keycloak
      const tokenRes = await fetch(config.oidcTokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: config.oidcClientId,
          client_secret: config.oidcClientSecret,
          redirect_uri: `${config.publicUrl}/auth/v1/callback`,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!tokenRes.ok) {
        const detail = await tokenRes.text();
        req.log.error({ status: tokenRes.status, detail }, 'KC token exchange failed');
        return reply.redirect(`${config.frontendUrl}/auth/error?error=token_exchange_failed`);
      }

      const tokens = await tokenRes.json() as OAuthCallbackTokens & { id_token?: string };

      // Determine redirect target from state (contains the original redirect URI)
      let redirectTarget = config.frontendUrl;
      if (state) {
        try {
          const stateData = JSON.parse(atob(state)) as { redirect_to?: string };
          if (stateData.redirect_to && isAllowedRedirect(stateData.redirect_to)) {
            redirectTarget = stateData.redirect_to;
          }
        } catch {
          // State might be opaque — use default redirect
        }
      }

      return reply.redirect(buildTokenRedirectUrl(redirectTarget, tokens));
    } catch (err) {
      req.log.error({ err }, 'OAuth callback processing failed');
      return reply.redirect(`${config.frontendUrl}/auth/error?error=internal_error`);
    }
  });

  /**
   * GET /auth/v1/authorize?provider=google|apple|keycloak&redirect_to=...
   *
   * Initiates OAuth flow by redirecting to Keycloak.
   * For social login (Google/Apple), KC handles the IdP redirect internally.
   */
  app.get('/authorize', async (req: FastifyRequest, reply: FastifyReply) => {
    const nenastaveno = prihlaseniNenastaveno(reply);
    if (nenastaveno) return nenastaveno;
    const { provider, redirect_to, scopes } = req.query as Record<string, string | undefined>;

    // Build state with redirect info
    const state = btoa(JSON.stringify({
      redirect_to: redirect_to && isAllowedRedirect(redirect_to) ? redirect_to : config.frontendUrl,
      provider,
    }));

    // Build Keycloak authorize URL
    const params = new URLSearchParams({
      client_id: config.oidcClientId,
      response_type: 'code',
      redirect_uri: `${config.publicUrl}/auth/v1/callback`,
      scope: scopes ?? 'openid email profile',
      state,
    });

    // If provider is google/apple, hint Keycloak to use that IdP
    if (provider === 'google') {
      params.set('kc_idp_hint', 'google');
    } else if (provider === 'apple') {
      params.set('kc_idp_hint', 'apple');
    }

    return reply.redirect(`${config.oidcAuthUrl}?${params.toString()}`);
  });

  /**
   * GET /auth/v1/verify?token=...&type=...&redirect_to=...
   *
   * Email verification links (magic link, recovery, confirmation, invite).
   * In Keycloak, these are handled differently — redirect to KC action URL
   * or handle directly if we manage email verification ourselves.
   */
  app.get('/verify', async (req: FastifyRequest, reply: FastifyReply) => {
    const nenastaveno = prihlaseniNenastaveno(reply);
    if (nenastaveno) return nenastaveno;
    const { token, type, redirect_to } = req.query as Record<string, string | undefined>;

    if (!token || !type) {
      return reply.status(400).send({ error: 'missing_params', message: 'token and type are required' });
    }

    // For now, redirect to frontend which handles verification
    const target = redirect_to && isAllowedRedirect(redirect_to) ? redirect_to : config.frontendUrl;
    return reply.redirect(`${target}/auth/verify?token=${encodeURIComponent(token)}&type=${encodeURIComponent(type)}`);
  });

  /**
   * POST /auth/v1/token?grant_type=password   → KC ROPC (username + password)
   * POST /auth/v1/token?grant_type=refresh_token → KC refresh
   *
   * Backward-compat proxy for clients that still call the GoTrue URL shape.
   * Response shape mimics Supabase GoTrue: { access_token, refresh_token, expires_in, user: { id, email } }.
   */
  app.post('/token', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as Record<string, string | undefined>;
    const body = (req.body ?? {}) as Record<string, string | undefined>;
    const grantType = query.grant_type ?? body.grant_type;

    let kcParams: URLSearchParams;
    if (grantType === 'password') {
      const email = body.email ?? body.username;
      const password = body.password;
      if (!email || !password) {
        return reply.status(400).send({ error: 'invalid_request', message: 'email and password required' });
      }
      kcParams = new URLSearchParams({
        grant_type: 'password',
        client_id: config.oidcClientId,
        username: email,
        password,
        scope: 'openid email profile',
      });
      if (config.oidcClientSecret) {
        kcParams.set('client_secret', config.oidcClientSecret);
      }
    } else if (grantType === 'refresh_token') {
      const refreshToken = body.refresh_token;
      if (!refreshToken) {
        return reply.status(400).send({ error: 'invalid_request', message: 'grant_type=refresh_token and refresh_token required' });
      }
      kcParams = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: config.oidcClientId,
        refresh_token: refreshToken,
      });
      if (config.oidcClientSecret) {
        kcParams.set('client_secret', config.oidcClientSecret);
      }
    } else {
      return reply.status(400).send({ error: 'unsupported_grant_type', message: 'grant_type must be password or refresh_token' });
    }

    let tokenRes: Response;
    try {
      tokenRes = await fetch(config.oidcTokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: kcParams,
        signal: AbortSignal.timeout(10000),
      });
    } catch (err) {
      req.log.error({ err }, 'KC token endpoint unreachable');
      return reply.status(502).send({
        error: 'keycloak_unreachable',
        message: 'Keycloak token endpoint is unreachable',
      });
    }

    const data = await tokenRes.json().catch(() => ({ error: 'invalid_response' })) as {
      access_token?: string;
      refresh_token?: string;
      id_token?: string;
      expires_in?: number;
      token_type?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenRes.ok || !data.access_token) {
      return reply.status(tokenRes.status).send({
        error: data.error ?? 'invalid_grant',
        message: data.error_description ?? 'Authentication failed',
      });
    }

    // Decode id_token (preferred) or access_token to surface user fields
    const tokenToDecode = data.id_token ?? data.access_token;
    const claims = decodeJwtPayload(tokenToDecode);
    const userId = typeof claims?.sub === 'string' ? claims.sub : '';
    const email = typeof claims?.email === 'string'
      ? claims.email
      : (typeof claims?.preferred_username === 'string' ? claims.preferred_username : '');

    // Return KC's RS256 token as-is. The gateway verifies it on /rest/v1/*
    // and mints a short PostgREST HS256 JWT with the same user/role claims.
    // The `role: authenticated` claim is also injected by a Keycloak client
    // protocol mapper on `aisha-app` for downstream consumers.
    return reply.send({
      access_token: data.access_token,
      token_type: data.token_type ?? 'bearer',
      expires_in: data.expires_in ?? 3600,
      refresh_token: data.refresh_token ?? '',
      user: { id: userId, email },
    });
  });

  /**
   * POST /auth/v1/pats — self-service Personal Access Token minting for the Omni /v1 model endpoint.
   *
   * A KC-authenticated developer mints a PAT bound to THEIR OWN identity, scoped to a story they can
   * access, then points any editor at ask.aisha.guru/v1 (ANTHROPIC_BASE_URL + the mcp_ token). The
   * caller's KC RS256 bearer is exchanged to a PostgREST HS256 JWT (identical to /rest/v1), so
   * create_mcp_token sees auth.uid() = the caller and its least-privilege self-service gate applies
   * (story-access checked, caps enforced, no identity/scope escalation).
   *
   * Body: { story_id (required), scope?, expires_in_days?, rate_limit_rpm?, rate_limit_daily?, allowed_tools? }
   * → 200 { token_id, raw_token, scope, scoped_to_story_id, expires_at, warning, mcp_warning? }
   *
   * ⛔ NAMĚŘENO 2026-10-03 (mapa mezer, nález G21): trasa seznam nástrojů do create_mcp_token
   * neposílala, takže samoobslužně vydaný token měl `allowed_tools` prázdné — a koncový bod
   * MCP (svc-mcp-knowledge `/mcp`) token bez seznamu odmítá 403. Funkční token pro klienta MCP
   * šel vyrobit jen přímým voláním RPC.
   *
   * `allowed_tools` (nepovinné) = nástroje MCP, které token smí volat. Je to AUTORIZACE vlastníka
   * tokenu, ne zvýšení práv: role tokenu zůstává `authenticated` (určuje ji `/mcp`, ne tahle
   * trasa), takže nástroj pro správce nezpřístupní ani jeho jméno v seznamu.
   * Token bez seznamu vzniknout smí — slouží Omni /v1 — ale odpověď to řekne v `mcp_warning`.
   */
  app.post('/pats', async (req: FastifyRequest, reply: FastifyReply) => {
    const translated = await translateAuthorizationForPostgrest(req.headers.authorization);
    if (!translated.ok) {
      return reply.status(translated.status).send({ error: translated.error });
    }
    if (!translated.translated) {
      return reply.status(401).send({ error: 'unauthorized', message: 'A Keycloak bearer token is required to mint a PAT' });
    }

    const body = (req.body ?? {}) as {
      story_id?: string; scope?: string; expires_in_days?: number; rate_limit_rpm?: number; rate_limit_daily?: number;
      allowed_tools?: unknown;
    };
    if (!body.story_id) {
      return reply.status(400).send({ error: 'invalid_request', message: 'story_id is required — self-service tokens are story-scoped (§8.5)' });
    }
    const nastroje = overSeznamNastroju(body.allowed_tools);
    if (!nastroje.ok) {
      return reply.status(400).send({ error: 'invalid_request', message: nastroje.duvod });
    }

    const rpcRes = await fetch(`${config.postgrestUrl}/rpc/create_mcp_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: translated.authorization },
      body: JSON.stringify({
        p_scope: body.scope ?? 'story',
        p_scoped_to_story_id: body.story_id,
        p_expires_in_days: body.expires_in_days ?? 90,
        p_rate_limit_rpm: body.rate_limit_rpm ?? 60,
        p_rate_limit_daily: body.rate_limit_daily ?? 1000,
        // Bez seznamu se parametr neposílá vůbec — platí výchozí hodnota funkce (prázdné pole).
        ...(nastroje.seznam.length > 0 ? { p_allowed_tools: nastroje.seznam } : {}),
      }),
      signal: AbortSignal.timeout(15000),
    }).catch((err: unknown) => {
      req.log.error({ err }, 'create_mcp_token rpc failed');
      return null;
    });

    if (!rpcRes) {
      return reply.status(502).send({ error: 'upstream_unreachable', message: 'PostgREST rpc/create_mcp_token unreachable' });
    }
    const data: unknown = await rpcRes.json().catch(() => null);
    if (!rpcRes.ok) {
      return reply.status(rpcRes.status).send(data ?? { error: 'mint_failed' });
    }
    if (nastroje.seznam.length > 0) return reply.send(data);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      // create_mcp_token vrací objekt; jiný tvar by upozornění neměl kam nést. Token už vznikl,
      // takže odpověď se předá beze změny — ale ne potichu.
      req.log.warn('PAT bez seznamu nástrojů: odpověď create_mcp_token není objekt, upozornění mcp_warning nešlo připojit');
      return reply.send(data);
    }
    return reply.send({ ...data, mcp_warning: UPOZORNENI_TOKEN_BEZ_NASTROJU });
  });

  /**
   * POST /auth/v1/revoke — logout / token revocation.
   *
   * The caller presents their OWN Keycloak bearer token; we verify it (proving
   * ownership — no admin escalation, least privilege) and read `jti` + `exp`
   * from the VERIFIED claims. The jti is added to the shared revocation set
   * (Redis DB 2, key `aisha:revoked:<jti>`) with a TTL equal to the token's
   * remaining lifetime (capped at 86400s in revokeJwt), so every subsequent
   * /rest/v1 request short-circuits with 401 via the translate-path check.
   *
   * FAIL-OPEN: when Redis is disabled/unreachable, revokeToken is a no-op and
   * we still return 200 — logout is best-effort, an outage never 500s the user.
   */
  app.post('/revoke', async (req: FastifyRequest, reply: FastifyReply) => {
    const claims = await verifyKeycloakClaims(req.headers.authorization);
    if (!claims) {
      return reply.status(401).send({
        error: 'unauthorized',
        message: 'A valid Keycloak bearer token is required to revoke it',
      });
    }

    const jti = typeof claims.jti === 'string' ? claims.jti : '';
    if (!jti) {
      return reply.status(400).send({
        error: 'invalid_token',
        message: 'token has no jti claim — cannot be revoked',
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const ttlSec = typeof claims.exp === 'number' ? claims.exp - now : 0;
    await revokeToken(jti, ttlSec);
    // Odhlášení ZAVÍRÁ dveře té adrese. Bez toho by odvolání znamenalo jen
    // „tenhle token už neplatí" — otvor by zůstal otevřený až do konce nájmu
    // a kdokoli za toutéž adresou by se dál dostal na plochu.
    //
    // ⭐ Vědomé omezení (potvrzeno majitelem 2026-09-01): dveře drží ADRESU,
    // ne osobu. Odhlášení jednoho tedy zavře plochu všem za toutéž veřejnou
    // adresou — k datům se ale nikdo nedostane tak jako tak, tam platí
    // přihlášení a RLS.
    zavriNajem(config.knockUrl, req.headers['x-forwarded-for'] as string | undefined);

    return reply.send({ revoked: true });
  });
};

/** Jméno nástroje MCP: začíná písmenem, dál písmena, číslice, `_`, `-`, `.`; nejvýš 64 znaků. */
const VZOR_JMENA_NASTROJE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

/** Strop počtu nástrojů v jednom tokenu — seznam je výčet, ne skladiště. */
const NEJVYSE_NASTROJU_V_TOKENU = 64;

const UPOZORNENI_TOKEN_BEZ_NASTROJU =
  'Token nemá seznam povolených nástrojů (allowed_tools). Koncový bod MCP (/functions/v1/mcp-knowledge-server) ' +
  'takový token odmítne s 403. Pro klienta MCP vydej token s polem allowed_tools.';

type SeznamNastroju = { ok: true; seznam: string[] } | { ok: false; duvod: string };

/**
 * Ověří `allowed_tools` z těla požadavku. Chybějící pole a prázdné pole znamenají totéž:
 * token bez seznamu. Cokoli jiného musí být pole jmen nástrojů — neplatný tvar se ODMÍTNE
 * s důvodem. Tiché zahození by vydalo token bez seznamu, který `/mcp` odmítne, a volající
 * by se nedozvěděl proč.
 */
export function overSeznamNastroju(hodnota: unknown): SeznamNastroju {
  if (hodnota === undefined) return { ok: true, seznam: [] };
  if (!Array.isArray(hodnota)) {
    return { ok: false, duvod: 'allowed_tools musí být pole jmen nástrojů (řetězců)' };
  }
  if (hodnota.length > NEJVYSE_NASTROJU_V_TOKENU) {
    return { ok: false, duvod: `allowed_tools smí mít nejvýše ${NEJVYSE_NASTROJU_V_TOKENU} položek, přišlo ${hodnota.length}` };
  }
  const seznam: string[] = [];
  for (const [poradi, polozka] of hodnota.entries()) {
    if (typeof polozka !== 'string' || !VZOR_JMENA_NASTROJE.test(polozka)) {
      return {
        ok: false,
        duvod: `allowed_tools[${poradi}] není jméno nástroje — čeká se neprázdný řetězec podle ${VZOR_JMENA_NASTROJE.source}`,
      };
    }
    if (seznam.includes(polozka)) {
      return { ok: false, duvod: `allowed_tools obsahuje „${polozka}“ víckrát — každý nástroj jen jednou` };
    }
    seznam.push(polozka);
  }
  return { ok: true, seznam };
}

/** Decode a JWT payload without verification. Returns null on parse error. */
function decodeJwtPayload(token: string | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const padded = parts[1] + '='.repeat((4 - (parts[1].length % 4)) % 4);
    const json = Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * V produkci bez odvoditelné adresy frontendu nebo gatewaye přihlášení NEPOKRAČUJE (503).
 * Jinak by callback poslal tokeny na relativní cestu gatewaye (do access logů) nebo by
 * redirect_uri u Keycloaku mířil jinam. Pravidla v auth/presmerovani.ts.
 */
function prihlaseniNenastaveno(reply: FastifyReply): FastifyReply | null {
  if (config.frontendUrl && config.publicUrl) return null;
  return reply.status(503).send({
    error: 'auth_not_configured',
    message: 'Gateway nezná adresu frontendu nebo svou veřejnou adresu (APP_DOMAIN / API_DOMAIN_PUBLIC).',
  });
}

/**
 * Validates redirect URI against allowlist to prevent open redirect attacks.
 */
export function isAllowedRedirect(uri: string): boolean {
  const candidate = parseRedirectUrl(uri);
  if (!candidate) return false;

  return config.allowedRedirectUris.some((allowed) => {
    const normalized = allowed.trim();
    if (!normalized) return false;
    return matchesAllowedRedirect(candidate, uri, normalized);
  });
}

export function buildTokenRedirectUrl(redirectTarget: string, tokens: OAuthCallbackTokens): string {
  const tokenParams = new URLSearchParams({
    access_token: tokens.access_token,
    token_type: tokens.token_type,
    expires_in: String(tokens.expires_in),
  });

  if (tokens.refresh_token) {
    tokenParams.set('refresh_token', tokens.refresh_token);
  }

  if (isHttpRedirect(redirectTarget)) {
    const url = new URL(redirectTarget);
    const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
    for (const [key, value] of tokenParams.entries()) {
      hashParams.set(key, value);
    }
    url.hash = hashParams.toString();
    return url.toString();
  }

  const hashIndex = redirectTarget.indexOf('#');
  const targetWithoutHash = hashIndex >= 0 ? redirectTarget.slice(0, hashIndex) : redirectTarget;
  const existingHash = hashIndex >= 0 ? redirectTarget.slice(hashIndex) : '';
  const separator = targetWithoutHash.includes('?') ? '&' : '?';
  return `${targetWithoutHash}${separator}${tokenParams.toString()}${existingHash}`;
}

function parseRedirectUrl(uri: string): URL | null {
  try {
    return new URL(uri);
  } catch {
    return null;
  }
}

function isHttpRedirect(uri: string): boolean {
  const parsed = parseRedirectUrl(uri);
  return parsed?.protocol === 'http:' || parsed?.protocol === 'https:';
}

function matchesAllowedRedirect(candidate: URL, originalUri: string, allowed: string): boolean {
  const isPathTreeWildcard = allowed.endsWith('/**');
  // ⛔ Předponový zástupný znak (`…*`, i přes query) se NEPŘIJÍMÁ: `https://vscode.dev/redirect*`
  // pustil přesměrovač s libovolným `?url=` — a k cíli jdou tokeny. Položka s ním nepustí nic.
  // `/**` (strom cest na TÉMŽE originu) zůstává.
  if (!isPathTreeWildcard && allowed.endsWith('*')) return false;
  const pattern = isPathTreeWildcard ? allowed.slice(0, -2) : allowed;
  const allowedUrl = parseRedirectUrl(pattern);

  if (!allowedUrl) return false;

  if (candidate.protocol === 'http:' || candidate.protocol === 'https:') {
    if (allowedUrl.protocol !== candidate.protocol || allowedUrl.host !== candidate.host) {
      return false;
    }

    if (isPathTreeWildcard) {
      return candidate.pathname.startsWith(allowedUrl.pathname);
    }

    if (allowedUrl.pathname === '/' && !allowedUrl.search && !allowedUrl.hash) {
      return true;
    }

    return candidate.pathname === allowedUrl.pathname &&
      (!allowedUrl.search || candidate.search === allowedUrl.search);
  }

  return originalUri === allowed;
}
