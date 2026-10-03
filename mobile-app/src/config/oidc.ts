/**
 * Keycloak OIDC configuration for mobile app.
 *
 * Uses expo-auth-session for PKCE flow with system browser
 * and expo-secure-store for secure token persistence.
 */
import * as AuthSession from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { safeError, safeInfo, safeWarn } from "@/lib/security/safeLogger";
import type { CilPrihlaseni } from "@/lib/prihlaseniWebView";

// ── Constants ────────────────────────────────────────────────

const STORE_KEY_ACCESS = "kc_access_token";
const STORE_KEY_REFRESH = "kc_refresh_token";
const STORE_KEY_ID = "kc_id_token";
const STORE_KEY_EXPIRY = "kc_token_expiry";
const STORE_KEY_USER = "kc_user_json";

/** Buffer before expiry (seconds) to trigger refresh early. */
const REFRESH_BUFFER_SEC = 60;

// ── Types ────────────────────────────────────────────────────

export interface KcTokens {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  expiresAt: number; // unix epoch seconds
}

export interface KcUser {
  id: string; // KC sub
  email: string;
  fullName?: string;
  roles: string[];
}

export type OAuthProvider = "google" | "apple" | "keycloak";

// ── Config Resolution ────────────────────────────────────────

function getExpoExtra(key: string): string | undefined {
  const extra = Constants.expoConfig?.extra?.[key];
  if (typeof extra === "string" && extra.length > 0) return extra;
  const env = process.env[key];
  if (typeof env === "string" && env.length > 0) return env;
  return undefined;
}

const isDev = typeof __DEV__ !== "undefined" && __DEV__ === true;

function resolveKcAuthority(): string {
  // Brand-default realm name; tenant builds set EXPO_PUBLIC_KC_REALM or
  // override the entire authority via EXPO_PUBLIC_KC_AUTHORITY.
  const realm = getExpoExtra("EXPO_PUBLIC_KC_REALM") ?? "aisha";
  const tld = getExpoExtra("EXPO_PUBLIC_PUBLIC_TLD");

  /*
    Configuration wins over the development default.

    This used to read `isDev ? localhost : configured`, which meant a build with
    a real TLD baked in STILL talked to 127.0.0.1:8080 whenever it ran under the
    dev server. Nobody running the app locally ever exercised the real login, so
    an authentication defect could only ever be discovered by a tester on
    TestFlight — measured 2026-08-03, the simulator's consent sheet offered to
    sign in to "127.0.0.1" on a build whose deployment host was configured.

    Localhost is now the fallback for a build that has NO instance configured,
    which is what a platform developer without a deployment actually has. Point a
    dev build somewhere else by setting EXPO_PUBLIC_KC_AUTHORITY explicitly.
  */
  const authority =
    getExpoExtra("EXPO_PUBLIC_KC_AUTHORITY") ??
    (tld
      ? `https://auth.${tld}/realms/${realm}`
      : isDev
      ? `http://127.0.0.1:8080/realms/${realm}`
      : "");

  // An empty authority silently degrades every OIDC call to a relative URL, so a
  // release build would ship an unusable login. Fail loud instead.
  if (!authority) {
    throw new Error(
      "Keycloak authority is not configured — set EXPO_PUBLIC_KC_AUTHORITY or EXPO_PUBLIC_PUBLIC_TLD (both must be forwarded via app.config.ts `extra`).",
    );
  }

  return authority;
}

function resolveKcClientId(): string {
  return getExpoExtra("EXPO_PUBLIC_KC_CLIENT_ID") ?? "aisha-app";
}

// Deep link scheme for OAuth callbacks
const REDIRECT_URI =
  getExpoExtra("EXPO_PUBLIC_REDIRECT_URL") ??
  Linking.createURL("oauth-callback");

const POST_LOGOUT_URI = Linking.createURL("");

// ── OIDC Discovery ───────────────────────────────────────────

interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint: string;
  userinfo_endpoint: string;
}

let _discovery: OidcDiscovery | null = null;

async function getDiscovery(): Promise<OidcDiscovery> {
  if (_discovery) return _discovery;

  const authority = resolveKcAuthority();
  const wellKnown = `${authority}/.well-known/openid-configuration`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(wellKnown, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
    const data = (await res.json()) as OidcDiscovery;
    _discovery = data;
    safeInfo("oidc.discovery.loaded", { authority });
    return data;
  } catch (error) {
    clearTimeout(timeout);
    safeWarn("oidc.discovery.failed", error);
    // Fallback to well-known KC paths
    _discovery = {
      authorization_endpoint: `${authority}/protocol/openid-connect/auth`,
      token_endpoint: `${authority}/protocol/openid-connect/token`,
      end_session_endpoint: `${authority}/protocol/openid-connect/logout`,
      userinfo_endpoint: `${authority}/protocol/openid-connect/userinfo`,
    };
    return _discovery;
  }
}

// ── Token Persistence (SecureStore) ──────────────────────────

async function storeTokens(tokens: KcTokens): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(STORE_KEY_ACCESS, tokens.accessToken),
    SecureStore.setItemAsync(STORE_KEY_REFRESH, tokens.refreshToken),
    SecureStore.setItemAsync(STORE_KEY_ID, tokens.idToken ?? ""),
    SecureStore.setItemAsync(STORE_KEY_EXPIRY, String(tokens.expiresAt)),
  ]);
}

async function loadTokens(): Promise<KcTokens | null> {
  try {
    const [accessToken, refreshToken, idToken, expiryStr] = await Promise.all([
      SecureStore.getItemAsync(STORE_KEY_ACCESS),
      SecureStore.getItemAsync(STORE_KEY_REFRESH),
      SecureStore.getItemAsync(STORE_KEY_ID),
      SecureStore.getItemAsync(STORE_KEY_EXPIRY),
    ]);
    if (!accessToken || !refreshToken) return null;
    return {
      accessToken,
      refreshToken,
      idToken: idToken || undefined,
      expiresAt: Number(expiryStr) || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Zahodí uloženou relaci LOKÁLNĚ — bez sítě, bez prohlížeče.
 *
 * ⭐ Proč vedle `logout()`: ten volá discovery a otevírá `WebBrowser`, takže na
 *    čerstvé instalaci BEZ dosažitelného backendu by visel nebo spadl. Úklid
 *    relace po přeinstalaci musí projít i za zavřenými dveřmi.
 */
export async function zahodMistniRelaci(): Promise<void> {
  await clearTokens();
}

async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(STORE_KEY_ACCESS),
    SecureStore.deleteItemAsync(STORE_KEY_REFRESH),
    SecureStore.deleteItemAsync(STORE_KEY_ID),
    SecureStore.deleteItemAsync(STORE_KEY_EXPIRY),
    SecureStore.deleteItemAsync(STORE_KEY_USER),
  ]);
}

async function storeUser(user: KcUser): Promise<void> {
  await SecureStore.setItemAsync(STORE_KEY_USER, JSON.stringify(user));
}

async function loadUser(): Promise<KcUser | null> {
  try {
    const json = await SecureStore.getItemAsync(STORE_KEY_USER);
    if (!json) return null;
    return JSON.parse(json) as KcUser;
  } catch {
    return null;
  }
}

// ── JWT Decode (minimal, no crypto verification — server verifies) ───

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length < 2) return {};
  const payload = parts[1]!
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  // Pad to multiple of 4
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
  try {
    const decoded = atob(padded);
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function extractUserFromToken(accessToken: string): KcUser {
  const payload = decodeJwtPayload(accessToken);
  const realmRoles =
    (payload.realm_access as { roles?: string[] } | undefined)?.roles ?? [];
  return {
    id: String(payload.sub ?? ""),
    email: String(payload.email ?? ""),
    fullName: (payload.name as string) || undefined,
    roles: realmRoles,
  };
}

// ── Token Exchange & Refresh ─────────────────────────────────

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  expires_in: number;
}

async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
): Promise<KcTokens> {
  const disc = await getDiscovery();
  const clientId = resolveKcClientId();

  const body = new URLSearchParams({
    client_id: clientId,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI,
  });

  const res = await fetch(disc.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} — ${text}`);
  }

  const data = (await res.json()) as TokenResponse;
  const now = Math.floor(Date.now() / 1000);

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    idToken: data.id_token,
    expiresAt: now + data.expires_in,
  };
}

async function refreshTokens(refreshToken: string): Promise<KcTokens> {
  const disc = await getDiscovery();
  const clientId = resolveKcClientId();

  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const res = await fetch(disc.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status}`);
  }

  const data = (await res.json()) as TokenResponse;
  const now = Math.floor(Date.now() / 1000);

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    idToken: data.id_token,
    expiresAt: now + data.expires_in,
  };
}

// ── Public API ───────────────────────────────────────────────

/** Ensure browser auth session completes properly on iOS. */
WebBrowser.maybeCompleteAuthSession();

/**
 * Start KC OIDC login flow via system browser.
 * @param idpHint — optional Identity Provider hint ("google" | "apple")
 */
/**
 * What this build is actually talking to — safe to show on screen.
 *
 * A tester holding a phone cannot read a log, so when sign-in fails they can
 * only report "it says something went wrong". These four values answer the
 * questions that come first every time: which Keycloak, which realm, which
 * client, and which redirect. All of them are already visible to anyone who
 * watches the authorization request leave the device, so showing them reveals
 * nothing new — unlike the anon key or any token, which are deliberately absent.
 */
export function describeOidcConfig(): Record<string, string> {
  const safe = (fn: () => string) => {
    try {
      return fn();
    } catch (error) {
      return `unavailable (${(error as Error)?.message ?? "unknown"})`;
    }
  };
  return {
    authority: safe(() => resolveKcAuthority()),
    realm: getExpoExtra("EXPO_PUBLIC_KC_REALM") ?? "(default) aisha",
    clientId: safe(() => resolveKcClientId()),
    redirectUri: REDIRECT_URI,
  };
}

export async function login(idpHint?: OAuthProvider): Promise<KcTokens> {
  const disc = await getDiscovery();
  const clientId = resolveKcClientId();

  const request = new AuthSession.AuthRequest({
    clientId,
    redirectUri: REDIRECT_URI,
    /*
      `offline_access` buys the refresh token its independence.

      Without it Keycloak issues a refresh token bound to the SSO session, which
      this realm ends after 30 minutes idle or 10 hours absolute. Biometric
      unlock would then succeed and still have nothing to restore — measured
      2026-08-03, that is exactly what trapped a driver in an endless Face ID
      loop. An offline token outlives the SSO session, so the convenience the
      feature promises ("do not make me go through federation again") is real.

      ⚠️ An optional scope the client does NOT hold is not politely ignored —
      Keycloak refuses the whole authorization request with `invalid_scope`,
      exactly the way `profile` and `email` failed here this morning. Asking for
      it therefore REQUIRES the client to carry it. Verified live before this
      change: the request already renders the login form, because Keycloak
      assigns `offline_access` from its own optional defaults at client
      creation. The instance now declares it explicitly anyway
      (instanční overlay `keycloak/10-<instance>-app-client.json`), so a client rebuilt from the seed
      cannot lose it — and how long the session may live is the instance's call
      too (`keycloak/00-realm-sessions.json`, applied by instance-rollout).
    */
    scopes: ["openid", "profile", "email", "offline_access"],
    usePKCE: true,
    extraParams: idpHint && idpHint !== "keycloak"
      ? { kc_idp_hint: idpHint }
      : undefined,
  });

  await request.makeAuthUrlAsync({
    authorizationEndpoint: disc.authorization_endpoint,
  } as AuthSession.DiscoveryDocument);

  const result = await request.promptAsync({
    authorizationEndpoint: disc.authorization_endpoint,
  } as AuthSession.DiscoveryDocument);

  if (result.type !== "success" || !result.params.code) {
    if (result.type === "cancel" || result.type === "dismiss") {
      throw new Error("Login cancelled");
    }
    /*
      Carry the authorization server's own answer.

      This used to throw `Login failed: ${result.type}` — literally "error" —
      while the reason sat untouched in `result.params`. The provider tells us
      exactly what it refused (`invalid_scope`, `unauthorized_client`,
      `invalid_redirect_uri`, …) and that string is protocol-level, not user
      data, so it is safe to keep. Without it the whole chain is blind: the
      screen shows a generic message BECAUSE nothing specific ever reached it.

      A `success` with no `code` is a different fault (a redirect that came back
      malformed) and must not be reported as the provider refusing anything.
    */
    const params = (result as { params?: Record<string, string> }).params ?? {};
    const authError = (result as { error?: { code?: string; message?: string } }).error;
    const detail =
      [params.error, params.error_description, authError?.code, authError?.message]
        .filter(Boolean)
        .join(" — ") ||
      (result.type === "success" ? "redirect carried no authorization code" : result.type);
    throw new Error(`Login failed: ${detail}`);
  }

  const tokens = await exchangeCodeForTokens(
    result.params.code,
    request.codeVerifier!,
  );

  const user = extractUserFromToken(tokens.accessToken);
  await Promise.all([storeTokens(tokens), storeUser(user)]);

  safeInfo("oidc.login.success", { provider: idpHint ?? "keycloak" });
  return tokens;
}

/**
 * Přihlášení ve VLOŽENÉM WebView (Android) — první půlka: žádost.
 *
 * ⭐ ROZHODNUTÍ MAJITELE (2026-09-28): Řidič na Androidu se přihlašuje jen jménem
 * a heslem RIQ ID; tablety nemají prohlížeč, takže Custom Tab (`promptAsync`)
 * nemá kde běžet. Žádost je TÁŽ jako v `login()` (PKCE, tytéž scopes včetně
 * offline_access), jen bez `kc_idp_hint` — cizí poskytovatel se nenabízí.
 * Co WebView smí načíst a jak se čte návrat: src/lib/prihlaseniWebView.ts.
 */
export async function pripravPrihlaseniWebView(): Promise<{
  url: string;
  state: string;
  codeVerifier: string;
  cil: CilPrihlaseni;
}> {
  const disc = await getDiscovery();
  const request = new AuthSession.AuthRequest({
    clientId: resolveKcClientId(),
    redirectUri: REDIRECT_URI,
    scopes: ["openid", "profile", "email", "offline_access"],
    usePKCE: true,
  });
  const url = await request.makeAuthUrlAsync({
    authorizationEndpoint: disc.authorization_endpoint,
  } as AuthSession.DiscoveryDocument);
  if (!request.state || !request.codeVerifier) {
    throw new Error("Login failed: authorization request has no state or PKCE verifier");
  }
  return {
    url,
    state: request.state,
    codeVerifier: request.codeVerifier,
    cil: { authority: resolveKcAuthority(), redirectUri: REDIRECT_URI },
  };
}

/** Přihlášení ve WebView — druhá půlka: kód → tokeny, uložení relace. */
export async function dokonciPrihlaseniWebView(code: string, codeVerifier: string): Promise<KcTokens> {
  const tokens = await exchangeCodeForTokens(code, codeVerifier);
  const user = extractUserFromToken(tokens.accessToken);
  await Promise.all([storeTokens(tokens), storeUser(user)]);
  safeInfo("oidc.login.success", { provider: "keycloak-webview" });
  return tokens;
}

/**
 * Get the current valid access token, refreshing if needed.
 * Returns null if not logged in.
 */
export async function getAccessToken(): Promise<string | null> {
  const tokens = await loadTokens();
  if (!tokens) return null;

  const now = Math.floor(Date.now() / 1000);
  if (tokens.expiresAt - now > REFRESH_BUFFER_SEC) {
    return tokens.accessToken;
  }

  // Token expired or about to — refresh
  try {
    const refreshed = await refreshTokens(tokens.refreshToken);
    const user = extractUserFromToken(refreshed.accessToken);
    await Promise.all([storeTokens(refreshed), storeUser(user)]);
    safeInfo("oidc.token.refreshed");
    return refreshed.accessToken;
  } catch (error) {
    safeError("oidc.token.refresh_failed", error);
    await clearTokens();
    return null;
  }
}

/**
 * Get current session (tokens + user) if logged in.
 */
export async function getSession(): Promise<{
  tokens: KcTokens;
  user: KcUser;
} | null> {
  const token = await getAccessToken();
  if (!token) return null;

  const tokens = await loadTokens();
  const user = await loadUser();
  if (!tokens || !user) return null;

  return { tokens, user };
}

/**
 * Get the stored user (without refreshing tokens).
 * Useful for quick UI checks.
 */
export async function getUser(): Promise<KcUser | null> {
  return loadUser();
}

/**
 * Logout — end KC session and clear local tokens.
 */
export async function logout(): Promise<void> {
  try {
    const tokens = await loadTokens();
    if (tokens?.idToken) {
      const disc = await getDiscovery();
      const logoutUrl =
        `${disc.end_session_endpoint}?` +
        `id_token_hint=${encodeURIComponent(tokens.idToken)}` +
        `&post_logout_redirect_uri=${encodeURIComponent(POST_LOGOUT_URI)}`;

      if (Platform.OS === "web") {
        (globalThis as unknown as { location: { href: string } }).location.href = logoutUrl;
      } else if (Platform.OS === "android") {
        // ⛔ BEZ PROHLÍŽEČE (2026-09-28): tablety ho nemají, Custom Tab by spadl.
        //    Relaci v Keycloaku ukončí POST s refresh tokenem (veřejný klient to
        //    smí); WebView přihlášení běží anonymně, takže cookies nezůstávají.
        await fetch(disc.end_session_endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: resolveKcClientId(),
            refresh_token: tokens.refreshToken,
          }).toString(),
        });
      } else {
        // Open logout in browser briefly then close
        await WebBrowser.openAuthSessionAsync(logoutUrl, POST_LOGOUT_URI);
      }
    }
  } catch (error) {
    safeWarn("oidc.logout.session_end_failed", error);
  }

  await clearTokens();
  safeInfo("oidc.logout.complete");
}

/**
 * Check if user is currently logged in (has valid tokens).
 */
export async function isLoggedIn(): Promise<boolean> {
  const token = await getAccessToken();
  return token !== null;
}

/**
 * Get the KC account console URL for a specific section.
 */
export function getAccountUrl(section: "password" | "personal-info" | "" = ""): string {
  const authority = resolveKcAuthority();
  // e.g. https://auth.${PUBLIC_TLD}/realms/aisha → https://auth.${PUBLIC_TLD}/realms/aisha/account
  const suffix = section ? `/#/${section}` : "";
  return `${authority}/account${suffix}`;
}

/**
 * Get the biometric-compatible refresh token for persistent login.
 * Used by biometric auth to store/retrieve session secret.
 */
export async function getRefreshToken(): Promise<string | null> {
  const tokens = await loadTokens();
  return tokens?.refreshToken ?? null;
}

/**
 * Restore session from a stored refresh token (biometric unlock).
 */
export async function restoreFromRefreshToken(
  refreshToken: string,
): Promise<KcTokens | null> {
  try {
    const tokens = await refreshTokens(refreshToken);
    const user = extractUserFromToken(tokens.accessToken);
    await Promise.all([storeTokens(tokens), storeUser(user)]);
    safeInfo("oidc.biometric.restored");
    return tokens;
  } catch (error) {
    safeError("oidc.biometric.restore_failed", error);
    await clearTokens();
    return null;
  }
}
