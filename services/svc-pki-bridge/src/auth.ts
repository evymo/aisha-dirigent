import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, decodeJwt, decodeProtectedHeader } from 'jose';
import { createSafeLogger } from '@aisha/security';
import { config } from './config.js';
import { fpJwt, fpKid } from './fp.js';

const log = createSafeLogger('svc-pki-bridge');

export interface VerifiedCaller {
  sub: string;
  clientId: string;
  roles: string[];
}

export class AuthError extends Error {
  statusCode: number;
  /** Optional structured detail surfaced to logs (not to clients). */
  detail?: Record<string, unknown>;
  constructor(message: string, statusCode = 401, detail?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

const jwks = createRemoteJWKSet(new URL(config.jwksUrl));

/**
 * Bootstrap rung: the DELIVERED realm JWKS (see config.bootstrapJwks).
 *
 * Parsed lazily and once — delivery happens between waves, so the env is
 * either present at container start or arrives with a restart; re-reading
 * per-request would buy nothing. Returns null when absent or unparseable
 * (unparseable is LOGGED — a delivered-but-broken bootstrap must not look
 * like "no bootstrap configured").
 */
let bootstrapKeySetCache: ReturnType<typeof createLocalJWKSet> | null | undefined;
function bootstrapKeySet(): ReturnType<typeof createLocalJWKSet> | null {
  if (bootstrapKeySetCache !== undefined) return bootstrapKeySetCache;
  if (!config.bootstrapJwks.trim()) {
    bootstrapKeySetCache = null;
    return null;
  }
  try {
    bootstrapKeySetCache = createLocalJWKSet(JSON.parse(config.bootstrapJwks));
  } catch (err) {
    log.safeError(
      'PKI_BOOTSTRAP_JWKS is set but not a valid JWKS document — the bootstrap rung ' +
        'is unusable and multi-node bootstrap will fail',
      err,
    );
    bootstrapKeySetCache = null;
  }
  return bootstrapKeySetCache;
}

/**
 * Claim-level failures mean the KEYS worked — the token itself is bad
 * (expired, wrong audience, wrong issuer, broken signature). Falling back to
 * the delivered JWKS there would just fail again with the same keys, and —
 * worse — would make every attacker probe cost two verifications.
 */
function keysWorkedButTokenIsBad(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? '';
  return (
    code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' ||
    code === 'ERR_JWT_EXPIRED' ||
    code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' ||
    code === 'ERR_JWS_INVALID' ||
    code === 'ERR_JWT_INVALID'
  );
}

/**
 * Fetch the current JWKS (bypassing jose's cache) and return KID list +
 * reachability status. Used by /diag to let operators verify whether the
 * pki-bridge container can reach the JWKS endpoint (a common silent
 * failure mode — JWKS unreachable from container = signature verification
 * fails = 401 "wrong-audience").
 *
 * The detailed error helper preserves Node's `cause` chain so operators
 * see ENOTFOUND vs ECONNREFUSED vs TLS handshake errors distinctly.
 */
function deepError(err: unknown): string {
  if (!err) return 'unknown';
  const e = err as { code?: string; message?: string; cause?: unknown; errno?: number };
  const parts: string[] = [];
  if (e.code) parts.push(`code=${e.code}`);
  if (e.errno) parts.push(`errno=${e.errno}`);
  if (e.message) parts.push(`msg="${e.message}"`);
  if (e.cause) parts.push(`cause=(${deepError(e.cause)})`);
  return parts.join(' ');
}

export async function getJwksCacheInfo(): Promise<{
  kids: string[];
  reachable: boolean;
  fetched_at?: string;
  error?: string;
  probes?: Record<string, { ok: boolean; status?: number; error?: string; ms?: number }>;
}> {
  // Run multi-path connectivity probes in parallel so /diag pinpoints the
  // exact failure layer (DNS vs TCP vs TLS vs HTTP). Each probe returns
  // its own diagnostic regardless of success — never short-circuits.
  const probes: Record<string, { ok: boolean; status?: number; error?: string; ms?: number }> = {};

  async function probe(name: string, url: string): Promise<void> {
    const start = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      probes[name] = { ok: res.ok, status: res.status, ms: Date.now() - start };
    } catch (err) {
      probes[name] = { ok: false, error: deepError(err), ms: Date.now() - start };
    }
  }

  const probeTasks = [
    probe('jwks_canonical', config.jwksUrl),
    probe('well_known', `${config.keycloakUrl}/realms/${config.keycloakRealm}/.well-known/openid-configuration`),
    // ⛔ OPRAVENO 2026-08-19: sonda mířila natvrdo na `aisha-keycloak`, tedy na
    // jméno CIZÍ instance. Na vyhrazené instanci se takové jméno nerozliší
    // vůbec (ověřeno `getent hosts` — doslovné hodnoty viz commit), takže
    // tahle diagnostika hlásila nedosažitelnost VŽDY a tím mlčky tvrdila
    // něco o Keycloaku, co měřila o cizím jménu. Adresa se bere z prostředí,
    // kde ji deklaruje compose.
    probe('docker_dns_keycloak', `${process.env.KEYCLOAK_INTERNAL_URL ?? ''}/health/ready`),
    // Public DNS sanity check (different host, should always succeed if any egress works)
    probe('public_internet', 'https://www.google.com/'),
  ];
  if (config.keycloakPublicUrl) {
    probeTasks.push(
      probe('jwks_public', `${config.keycloakPublicUrl}/realms/${config.keycloakRealm}/protocol/openid-connect/certs`),
    );
  }
  await Promise.allSettled(probeTasks);

  // Now do the real jwks fetch + parse for the kids list
  try {
    const res = await fetch(config.jwksUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      return { kids: [], reachable: false, error: `HTTP ${res.status}`, probes };
    }
    const body = (await res.json()) as { keys?: Array<{ kid: string; alg?: string; use?: string }> };
    const kids = (body.keys ?? []).map((k) => `${k.kid}/${k.alg ?? '?'}/${k.use ?? '?'}`);
    return { kids, reachable: true, fetched_at: new Date().toISOString(), probes };
  } catch (err) {
    return { kids: [], reachable: false, error: deepError(err), probes };
  }
}

/**
 * Verify a Bearer JWT from Keycloak.
 *
 * Checks:
 *   - Signature against Keycloak JWKS endpoint
 *   - Issuer matches our Keycloak realm
 *   - Audience includes `pki-proxy` (shared audience for all PKI access)
 *   - Token not expired
 *
 * The `pki-proxy` audience was originally the OAuth2 Proxy client_id in front
 * of OpenXPKI WebUI. Its naming was intentionally generic — "proxy" means
 * "access layer" rather than specifically "OAuth2 Proxy". Machine clients
 * (like aisha-pki-bootstrap) get `aud=pki-proxy` via a Keycloak audience
 * mapper, making them valid callers for any PKI access service.
 */
export async function verifyToken(authHeader: string | undefined): Promise<VerifiedCaller> {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthError('Missing or invalid Authorization header');
  }

  const token = authHeader.slice(7);
  // `expectedIssuer` is computed from PUBLIC canonical URL (matches what KC
  // put in the `iss` claim). JWKS fetch goes through INTERNAL Docker DNS —
  // see config.ts for the rationale of the two-URL split.
  const expectedIssuer = config.expectedIssuer;
  const expectedAudience = config.jwtAudience;

  // Pre-decode (no signature verification) so we can surface meaningful
  // diagnostics if verification fails. The token is untrusted at this point;
  // we use the decoded claims ONLY for logging, never for auth decisions.
  let inspectedClaims: Record<string, unknown> = {};
  let inspectedHeader: Record<string, unknown> = {};
  try {
    inspectedClaims = decodeJwt(token) as Record<string, unknown>;
    inspectedHeader = decodeProtectedHeader(token) as Record<string, unknown>;
  } catch {
    /* malformed token — verify call will fail with a clear error */
  }

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: expectedIssuer,
      audience: expectedAudience,
    });

    const roles: string[] = [];
    const realmAccess = payload['realm_access'] as { roles?: string[] } | undefined;
    if (realmAccess?.roles) roles.push(...realmAccess.roles);

    return {
      sub: String(payload.sub ?? ''),
      clientId: String(payload['azp'] ?? payload['client_id'] ?? ''),
      roles,
    };
  } catch (err) {
    // Bootstrap rung: the remote JWKS could not answer (network, DNS, KC not
    // reachable from this node) AND a delivered key set exists → verify against
    // it, LOUDLY. Never on claim/signature failures — there the keys worked and
    // the token is simply bad. This is what breaks the multi-node cycle
    // "token needs JWKS → JWKS needs mesh → mesh needs cert → cert needs token":
    // the delivered keys verify the enrollment token without any network path
    // to Keycloak. Same issuer, same iss+aud checks — only the transport differs.
    const bootstrap = bootstrapKeySet();
    if (bootstrap && !keysWorkedButTokenIsBad(err)) {
      log.safeWarn(
        'live JWKS unreachable — verifying against the DELIVERED bootstrap JWKS ' +
          '(expected during multi-node bootstrap, a defect any other time)',
        { reason: (err as Error)?.message ?? String(err) },
      );
      try {
        const { payload } = await jwtVerify(token, bootstrap, {
          issuer: expectedIssuer,
          audience: expectedAudience,
        });
        const roles: string[] = [];
        const realmAccess = payload['realm_access'] as { roles?: string[] } | undefined;
        if (realmAccess?.roles) roles.push(...realmAccess.roles);
        return {
          sub: String(payload.sub ?? ''),
          clientId: String(payload['azp'] ?? payload['client_id'] ?? ''),
          roles,
        };
      } catch {
        // A bad token stays a 401, not a 500 — fall through to the AuthError
        // below carrying the ORIGINAL error: that one says why the live path
        // failed, which is the diagnostic an operator needs first.
      }
    }

    // jose throws `JWTClaimValidationFailed` (with .claim/.reason),
    // `JWTExpired`, or signature errors. Capture the actual code into the
    // server log via AuthError.detail; clients still get a generic message.
    const cause = err as { code?: string; claim?: string; reason?: string; message?: string };

    // On signature/key errors, fetch current JWKS state from container's
    // POV so the log shows whether the KID is reachable. If KID isn't in
    // current JWKS, the token was signed by a key the container hasn't
    // seen (KC rotated keys, or container can't reach JWKS endpoint).
    let jwks_state: { reachable: boolean; kids: string[]; error?: string } | undefined;
    if (cause?.code?.includes('JWKS') || cause?.code?.includes('Signature')) {
      try {
        const info = await getJwksCacheInfo();
        jwks_state = { reachable: info.reachable, kids: info.kids, error: info.error };
      } catch {
        /* best-effort */
      }
    }

    throw new AuthError('Invalid, expired, or wrong-audience token', 401, {
      jose_code: cause?.code ?? 'unknown',
      jose_claim: cause?.claim,
      jose_reason: cause?.reason,
      jose_message: cause?.message,
      // Echo the claims our verifier compared against (no PII) so operators
      // can see the precise mismatch without decoding the token manually.
      expected_iss: expectedIssuer,
      expected_aud: expectedAudience,
      token_iss: inspectedClaims['iss'],
      token_aud: inspectedClaims['aud'],
      token_azp: inspectedClaims['azp'],
      token_kid: inspectedHeader['kid'],
      token_alg: inspectedHeader['alg'],
      // Fingerprints (compare with cert script side-channel log)
      token_sig_fp: fpJwt(token),
      token_kid_fp: fpKid(inspectedHeader['kid'] as string | undefined),
      // JWKS reachability from container — present only on signature errors
      ...(jwks_state && {
        jwks_reachable_from_container: jwks_state.reachable,
        jwks_current_kids: jwks_state.kids,
        jwks_fetch_error: jwks_state.error,
      }),
    });
  }
}
