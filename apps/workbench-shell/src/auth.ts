import { instance } from './instance.js';

/**
 * OIDC Authorization Code + PKCE (public client) against the instance IdP,
 * then exchange at svc-token-exchange for a short-lived user-scoped PostgREST token.
 * Rules: minted token lives in memory only; IdP refresh token in sessionStorage
 * (cleared with the tab); PGRST secret never exists client-side.
 *
 * Candidate for extraction to a shared
 * @aisha/surface-client package).
 */

interface MintedToken {
  token: string;
  expiresAt: number;
}

let minted: MintedToken | null = null;

const cfg = instance.config;
/** The workbench may use its own OIDC client (distinct redirect URIs) within a shared overlay. */
const CLIENT_ID = cfg.workbench?.client_id ?? cfg.auth.client_id;
const ss = (): Storage | null => {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
};
const K_VERIFIER = `aisha.${cfg.instance_slug}.wb.pkce_verifier`;
const K_REFRESH = `aisha.${cfg.instance_slug}.wb.idp_refresh`;

const oidc = {
  authorize: `${cfg.auth.issuer}/protocol/openid-connect/auth`,
  token: `${cfg.auth.issuer}/protocol/openid-connect/token`,
  logout: `${cfg.auth.issuer}/protocol/openid-connect/logout`
};

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

export async function beginLogin(): Promise<void> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  ss()?.setItem(K_VERIFIER, verifier);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: 'openid',
    redirect_uri: globalThis.location.origin + '/',
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: 'S256'
  });
  globalThis.location.assign(`${oidc.authorize}?${params.toString()}`);
}

async function idpTokenRequest(body: URLSearchParams): Promise<{ access_token: string; refresh_token?: string } | null> {
  const res = await fetch(oidc.token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  }).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json().catch(() => null)) as { access_token: string; refresh_token?: string } | null;
}

/** Read a JWT's `exp` (seconds since epoch) without verifying — for local session TTL only. */
function jwtExpSeconds(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}

async function exchangeAtService(idpAccessToken: string): Promise<boolean> {
  // Every KC access token this shell ever holds passes through here — both the
  // authorization-code landing and the refresh flight. Capturing `idp` at this
  // one point is what makes the chat lane usable straight after login; when the
  // capture lived only in acquireToken(), a freshly logged-in session had
  // `idp === null` for the whole first token lifetime (getToken() returns the
  // cached mint without ever reaching acquireToken), so getIdpToken() answered
  // null and Ask silently skipped the governed chain until the first refresh.
  idp = { token: idpAccessToken, expiresAt: jwtExpMs(idpAccessToken) - 30_000 };

  // Gateway-mints mode (default for the web extranet): no dedicated exchange service.
  // The core gateway (/rest/v1) verifies the Keycloak token against KC JWKS and mints
  // the PostgREST HS256 token itself (services/gateway/src/auth/postgrest-jwt.ts), so the
  // shell sends the KC access token straight through. svc-token-exchange stays a mobile-only
  // path, selected by a non-empty token_exchange_url.
  if (!cfg.api.token_exchange_url) {
    const exp = jwtExpSeconds(idpAccessToken);
    minted = {
      token: idpAccessToken,
      // refresh 30 s before the KC token expires (fallback 55 min if exp is unreadable)
      expiresAt: exp ? exp * 1000 - 30_000 : Date.now() + 55 * 60 * 1000
    };
    return true;
  }
  const res = await fetch(`${cfg.api.token_exchange_url.replace(/\/$/, '')}/token/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ keycloak_access_token: idpAccessToken })
  }).catch(() => null);
  if (!res?.ok) return false;
  const data = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
  if (!data?.access_token || !data.expires_in) return false;
  minted = {
    token: data.access_token,
    // refresh 30 s before expiry
    expiresAt: Date.now() + Math.max(data.expires_in - 30, 30) * 1000
  };
  return true;
}

/**
 * Výsledek návratu z IdP. Tři stavy, ne dva — a ten rozdíl je bezpečnostní.
 *
 * Dřív se vracel `boolean` a „nepřicházím z přihlášení" splývalo s „přišel jsem
 * s kódem a NEPOVEDLO se". Volající pak obojí odbyl přihlašovací kartou. Jenže
 * druhý případ znamená, že u Keycloaku relace ŽIJE (jinak by kód nevydal) —
 * a když si o kód řekneme znovu, KC ho zase mlčky vydá. To je horký kolotoč
 * bez jediného kliknutí uživatele.
 *
 * `failed` proto volajícímu dovolí sáhnout po odhlášení místo dalšího pokusu.
 */
export type LoginLanding = 'none' | 'ok' | 'failed';

/** Handle ?code= redirect if present. */
export async function completeLoginFromRedirect(): Promise<LoginLanding> {
  const url = new URL(globalThis.location.href);
  const code = url.searchParams.get('code');
  if (!code) return 'none';
  url.searchParams.delete('code');
  url.searchParams.delete('session_state');
  url.searchParams.delete('iss');
  globalThis.history.replaceState(null, '', url.toString());

  const verifier = ss()?.getItem(K_VERIFIER);
  ss()?.removeItem(K_VERIFIER);
  // Kód od IdP je, ale nemáme k němu verifier — přihlášení dokončit nelze.
  // Je to `failed`, ne `none`: relace u KC existuje, jen ji tenhle prohlížeč
  // neumí uplatnit.
  if (!verifier) return 'failed';

  const data = await idpTokenRequest(
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      redirect_uri: globalThis.location.origin + '/',
      code_verifier: verifier
    })
  );
  if (!data) return 'failed';
  if (data.refresh_token) ss()?.setItem(K_REFRESH, data.refresh_token);
  return (await exchangeAtService(data.access_token)) ? 'ok' : 'failed';
}

/**
 * Valid minted token, re-exchanging via IdP refresh when expired. Null = must login.
 *
 * ⚠️ SINGLE-FLIGHT, and it is not an optimisation — it is correctness.
 * `minted` lives in memory only, so after the OIDC redirect the first render
 * starts with nothing. A console loads its blocks in PARALLEL, so every one of
 * them called this at once and each fired its own refresh_token request with
 * the SAME refresh token. Keycloak ROTATES refresh tokens: the first exchange
 * wins, the rest come back invalid_grant — and the failure branch below wipes
 * K_REFRESH, so the surviving calls end up unauthenticated.
 *
 * Measured on the live extranet before this fix: four parallel get_block_data
 * calls all finished at ~8.08 s (they were queueing on Keycloak's session
 * lock), against 0.13–0.24 s for the same RPCs called with a ready token. The
 * database was never slow — the token was.
 *
 * One promise is shared by every concurrent caller, so exactly one refresh
 * happens and the rotation has nobody to race with.
 */
let inFlight: Promise<string | null> | null = null;

export async function getToken(): Promise<string | null> {
  if (minted && minted.expiresAt > Date.now()) return minted.token;
  if (inFlight) return inFlight;
  inFlight = acquireToken().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** KC access token cached from the SAME refresh flight as the PostgREST mint.
 * acquireToken already holds it and used to throw it away; a SECOND consumer of
 * the rotating K_REFRESH would resurrect the invalid_grant race the single-flight
 * fix killed, so the chat lane rides along instead of refreshing on its own. */
let idp: { token: string; expiresAt: number } | null = null;

function jwtExpMs(token: string): number {
  try {
    const part = token.split('.')[1] ?? '';
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof payload.exp === 'number') return payload.exp * 1000;
  } catch { /* fall through */ }
  return Date.now() + 240_000;
}

/** KC access token for gateway lanes that authenticate the IdP JWT themselves
 * (/chat, /dirigent). Refreshes via the shared single-flight — never alone. */
export async function getIdpToken(): Promise<string | null> {
  if (idp && idp.expiresAt > Date.now()) return idp.token;
  await getToken();
  return idp && idp.expiresAt > Date.now() ? idp.token : null;
}

async function acquireToken(): Promise<string | null> {
  // Re-check: a caller may have been waiting while the previous flight landed.
  if (minted && minted.expiresAt > Date.now()) return minted.token;
  const refresh = ss()?.getItem(K_REFRESH);
  if (!refresh) return null;
  const data = await idpTokenRequest(
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refresh
    })
  );
  if (!data) {
    ss()?.removeItem(K_REFRESH);
    return null;
  }
  if (data.refresh_token) ss()?.setItem(K_REFRESH, data.refresh_token);
  // `idp` is captured inside exchangeAtService — the single point every KC token
  // passes through, login and refresh alike.
  return (await exchangeAtService(data.access_token)) ? (minted as MintedToken | null)?.token ?? null : null;
}

export function logout(): void {
  minted = null;
  idp = null;
  ss()?.removeItem(K_REFRESH);
  globalThis.location.assign(
    `${oidc.logout}?${new URLSearchParams({
      client_id: CLIENT_ID,
      post_logout_redirect_uri: globalThis.location.origin + '/'
    }).toString()}`
  );
}
