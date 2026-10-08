import { createHash } from 'node:crypto';
import { jwtVerify, type JWTPayload } from 'jose';
import { createJwtVerifier, AuthError as SecurityAuthError, verifyServiceRole as sharedVerifyServiceRole } from '@aisha/security';
import { config } from './config.js';
import { rpcService } from './postgrest.js';
import { jeTokenKlientaMcp, maAudienceServeruZnalosti } from './mcp-zdroj.js';

const verifier = createJwtVerifier({
  jwksUrl: config.jwksUrl,
  issuer: config.kcIssuer,
  service: 'svc-mcp-knowledge',
});

export interface VerifiedUser {
  userId: string;
  email?: string;
  roles: string[];
  scopes: string[];
  claims: JWTPayload;
  /** Jen u identity z `mcp_` PAT: nástroje, které token smí (autorizace, ne výběr). */
  pat?: McpPatOpravneni;
}

export interface McpPatOpravneni {
  allowedTools: string[];
  deniedTools: string[];
}

export class AuthError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

function asStringArray(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return [];
}

function collectRoles(payload: JWTPayload): string[] {
  const record = payload as Record<string, unknown>;
  const realmAccess = record.realm_access as { roles?: unknown } | undefined;
  const resourceAccess = record.resource_access as Record<string, { roles?: unknown }> | undefined;
  const roles = new Set<string>([
    ...asStringArray(record.roles),
    ...asStringArray(realmAccess?.roles),
  ]);
  if (resourceAccess && typeof resourceAccess === 'object') {
    for (const access of Object.values(resourceAccess)) {
      for (const role of asStringArray(access.roles)) roles.add(role);
    }
  }
  return [...roles];
}

function collectScopes(payload: JWTPayload): string[] {
  const record = payload as Record<string, unknown>;
  const scopeClaim = typeof record.scope === 'string' ? record.scope.split(/\s+/) : [];
  return [...new Set([...scopeClaim, ...asStringArray(record.scp)])].filter(Boolean);
}

/**
 * Token smí přijít jen od klienta ze seznamu `KC_ALLOWED_CLIENTS` — podle `azp`, nebo `aud`.
 *
 * ⛔ PRÁZDNÝ SEZNAM = NIKDO. Do 2026-10-04 tu stálo „prázdný seznam pustí každého“: stačilo,
 * aby seznam vyšel prázdný, a `/mcp` věřil tokenu kteréhokoli klienta realmu. Chybějící
 * proměnná službu zastaví už při startu (config.ts); tohle je druhá pojistka pro seznam,
 * který dorazil, ale nenese jediné jméno — nevím-li, komu věřit, nevěřím nikomu.
 */
function isAllowedClient(payload: JWTPayload): boolean {
  const allowed = new Set(config.kcAllowedClients);
  const record = payload as Record<string, unknown>;
  const azp = typeof record.azp === 'string' ? record.azp : '';
  return allowed.has(azp) || asStringArray(payload.aud).some((audience) => allowed.has(audience));
}

/**
 * Verify a token MINTED by the Omni mediator (svc-ai-chat) — RFC 8693 on-behalf-of.
 * Short-lived, HS256-signed with the shared POSTGREST_JWT_SECRET; carries the
 * user's identity (sub=user_id) at role=authenticated. Only the mediator holds the
 * HMAC secret, so a Keycloak RS256 JWT never verifies here. Returns null when the
 * token is not a (valid) mediated token so the caller falls through to JWKS.
 */
export async function verifyMediatedToken(token: string): Promise<JWTPayload | null> {
  if (!config.postgrestJwtSecret || !token) return null;
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(config.postgrestJwtSecret),
      { algorithms: ['HS256'] },
    );
    // Accept ONLY the mediator's user-scoped on-behalf-of credential. role MUST be
    // 'authenticated' (never service_role) so tools run under the user's RLS.
    if (
      payload.token_use === 'omni-mcp-mediation' &&
      typeof payload.sub === 'string' &&
      payload.role === 'authenticated'
    ) {
      return payload;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Ověření pro routy MIMO `/mcp` (ragnarok, translate, …): token vydaný klientem MCP sem nepatří
 * — jeho audience je server MCP, ne tato API (mcp-zdroj.ts).
 */
export async function verifyToken(authHeader: string | undefined): Promise<VerifiedUser> {
  const user = await overToken(authHeader);
  if (jeTokenKlientaMcp(user.claims as Record<string, unknown>)) {
    throw new AuthError(403, 'MCP client token is valid only on /mcp');
  }
  return user;
}

async function overToken(authHeader: string | undefined): Promise<VerifiedUser> {
  // RFC 8693: a short-lived USER-scoped token minted by svc-ai-chat carries
  // sub=user_id + role=authenticated, so MCP tools run under the user's identity
  // (DB RLS) — never the service role. Tried before JWKS; a Keycloak JWT can't
  // match (different alg + secret), so this never shadows the KC path.
  const mediated = await verifyMediatedToken((authHeader ?? '').replace(/^Bearer\s+/i, ''));
  if (mediated) {
    return {
      userId: mediated.sub as string,
      roles: ['authenticated'],
      scopes: [],
      claims: mediated,
    };
  }

  let payload: JWTPayload;
  try {
    payload = await verifier.verify(authHeader);
  } catch (err) {
    if (err instanceof SecurityAuthError) {
      throw new AuthError(err.statusCode, err.message);
    }
    throw err;
  }
  if (!isAllowedClient(payload)) throw new AuthError(403, 'Keycloak client not allowed');
  return {
    userId: payload.sub as string,
    email: (payload as Record<string, unknown>).email as string | undefined,
    roles: collectRoles(payload),
    scopes: collectScopes(payload),
    claims: payload,
  };
}

/** Prefix, pod kterým `create_mcp_token` vydává osobní přístupové tokeny. */
export const MCP_PAT_PREFIX = 'mcp_';

/**
 * Ověří `mcp_` PAT a vrátí identitu jeho vlastníka.
 *
 * ⛔ NAMĚŘENO 2026-09-14: `/mcp` přijímal jen Keycloak JWT (žije 300 s) nebo
 * token mediovaný svc-ai-chat — nic, co by mohlo být STATICKÝM credentialem
 * v n8n. Platforma přitom dlouhodobé, odvolatelné tokeny se seznamem nástrojů
 * má (`mcp_auth_tokens`, `validate_mcp_token`, správa v AdminMcpTokens), jen
 * je tahle služba neuměla ověřit.
 *
 * Kódy (dohodnuto s relací aplatform-93):
 *   401 — token neplatný, expirovaný, neověřitelný, nebo bez vlastníka (user_id)
 *   403 — token PLATNÝ, ale bez allowlistu nástrojů. SQL sémantika „prázdný
 *         allowed_tools = bez omezení" slouží Omni /v1; na /mcp by z každého
 *         dosavadního neomezeného tokenu udělala vstup ke všem nástrojům.
 *         403, ne 401: klient MCP by 401 bral jako výzvu k novému přihlášení.
 *
 * Role jsou pevně `authenticated` — admin nástroje PAT nikdy nedosáhne.
 */
export async function verifyMcpPat(token: string): Promise<VerifiedUser> {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  let vysledek: Record<string, unknown> | null;
  try {
    vysledek = await rpcService('validate_mcp_token', {
      p_project_id: null,
      p_token_hash: tokenHash,
      p_tool_name: null,
    }) as Record<string, unknown> | null;
  } catch {
    // Neověřitelný token je NEPLATNÝ token — ne 500 (žádný únik důvodu, žádné čekání).
    throw new AuthError(401, 'Invalid MCP token');
  }
  const userId = vysledek?.user_id;
  if (!vysledek || vysledek.valid !== true || typeof userId !== 'string' || userId === '') {
    throw new AuthError(401, 'Invalid or expired MCP token');
  }
  const allowedTools = asStringArray(vysledek.allowed_tools);
  if (allowedTools.length === 0) {
    throw new AuthError(403, 'MCP token without a tool allowlist is not valid on /mcp');
  }
  const storyId = vysledek.scoped_to_story_id;
  return {
    userId,
    roles: ['authenticated'],
    scopes: [],
    claims: {
      sub: userId,
      role: 'authenticated',
      token_use: 'mcp-pat',
      ...(typeof storyId === 'string' && storyId !== '' ? { story_id: storyId } : {}),
    },
    pat: { allowedTools, deniedTools: asStringArray(vysledek.denied_tools) },
  };
}

/**
 * Ověření pro `/mcp`: `mcp_` PAT, mediovaný token chatu, nebo token Keycloaku s audience serveru MCP.
 * Záměrně SAMOSTATNĚ — ostatní routy služby PAT ani token klienta MCP nepřijímají.
 */
export async function verifyMcpToken(authHeader: string | undefined): Promise<VerifiedUser> {
  const token = /^Bearer\s+(\S+)$/i.exec(authHeader ?? '')?.[1] ?? '';
  if (token.startsWith(MCP_PAT_PREFIX)) return verifyMcpPat(token);
  const user = await overToken(authHeader);
  // Mediovaný token chatu (HS256, jen svc-ai-chat) audience Keycloaku nenese a nemá — ověřený je
  // tajemstvím mediátora. Token Keycloaku musí být vydaný PRO server MCP (mcp-zdroj.ts).
  if (user.claims.token_use !== 'omni-mcp-mediation' && !maAudienceServeruZnalosti(user.claims as Record<string, unknown>)) {
    throw new AuthError(403, 'Keycloak token is not issued for the MCP server (audience)');
  }
  return user;
}

export function isAdminOrStaff(user: VerifiedUser): boolean {
  return user.roles.includes('admin') || user.roles.includes('staff');
}

export function verifyServiceRole(authHeader: string | undefined): void {
  // Delegates to @aisha/security so the secret compare is constant-time
  // (XOR loop instead of `!==`). The previous local implementation used
  // a short-circuit string compare, which leaks token-byte information
  // through response timing. Re-wraps upstream AuthError as the local
  // class so route handlers that check `err instanceof AuthError` keep
  // working. Status code preserved (401 missing, 403 wrong token).
  try {
    sharedVerifyServiceRole(authHeader, config.postgrestServiceToken);
  } catch (err) {
    if (err instanceof SecurityAuthError) {
      throw new AuthError(err.statusCode, err.message);
    }
    throw err;
  }
}
