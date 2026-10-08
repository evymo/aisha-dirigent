/**
 * Keycloak Auth — User authentication for AISHA Dirigent extension.
 *
 * Each user logs in through AISHA ID (Keycloak OIDC).
 * The JWT is stored in VS Code SecretStorage (encrypted, per-machine).
 * Push channel and context sync use the real user identity.
 *
 * @module
 */

import * as vscode from "vscode";
import { randomBytes, createHash } from "crypto";
import { getDirigentConfig, onConfigChanged } from "./config";
import { persistStoryId, setSessionStoryId } from "./story-context";
import { recordApiCall } from "./resource-tracker";
import { fetchWorkspaceConfig, persistWorkspaceConfig } from "./bootstrap";

// Re-export JWT helper from authenticated-fetch for external consumers
export { isTokenExpiringSoon } from "./authenticated-fetch";
import { authenticatedFetch, getBaseUrl } from "./authenticated-fetch";

const SECRET_KEY_ACCESS = "aisha.dirigent.accessToken";
const SECRET_KEY_REFRESH = "aisha.dirigent.refreshToken";
const SECRET_KEY_USER_ID = "aisha.dirigent.userId";
const SECRET_KEY_EMAIL = "aisha.dirigent.userEmail";
/** Device code client ID — must match keycloak/aisha-realm.json. */
const AISHA_ID_CLIENT_ID = "aisha-dirigent-device";
/** PKCE OAuth client ID — aisha-app has pkce.code.challenge.method=S256. */
const PKCE_CLIENT_ID = "aisha-app";
/** SecretStorage key to persist which KC client was used (for token refresh). */
const SECRET_KEY_CLIENT_ID = "aisha.dirigent.clientId";

/** Minimum token data needed by other modules. */
export interface AuthState {
  /** Keycloak access token (JWT). */
  accessToken: string | null;
  /** Keycloak refresh token. */
  refreshToken: string | null;
  /** Authenticated user UUID. */
  userId: string | null;
  /** Authenticated user email. */
  email: string | null;
  /** Whether the user is currently logged in. */
  isAuthenticated: boolean;
}

let secrets: vscode.SecretStorage | null = null;
let extensionContext: vscode.ExtensionContext | null = null;
let cachedState: AuthState = {
  accessToken: null,
  refreshToken: null,
  userId: null,
  email: null,
  isAuthenticated: false,
};
/** KC client_id used for the current session — needed for token refresh. */
let cachedClientId: string = AISHA_ID_CLIENT_ID;

const authChangeEmitter = new vscode.EventEmitter<AuthState>();
/** Fires when auth state changes (login / logout / token refresh). */
export const onAuthStateChanged = authChangeEmitter.event;

// ──────────────────────────────────────────
// Lifecycle
// ──────────────────────────────────────────

/**
 * Initialize auth module with VS Code SecretStorage.
 * Call from extension activate().
 */
export async function initAuth(context: vscode.ExtensionContext): Promise<AuthState> {
  secrets = context.secrets;
  extensionContext = context;

  // Restore persisted tokens
  const [accessToken, refreshToken, userId, email, storedClientId] = await Promise.all([
    secrets.get(SECRET_KEY_ACCESS),
    secrets.get(SECRET_KEY_REFRESH),
    secrets.get(SECRET_KEY_USER_ID),
    secrets.get(SECRET_KEY_EMAIL),
    secrets.get(SECRET_KEY_CLIENT_ID),
  ]);
  cachedClientId = storedClientId ?? AISHA_ID_CLIENT_ID;

  cachedState = {
    accessToken: accessToken ?? null,
    refreshToken: refreshToken ?? null,
    userId: userId ?? null,
    email: email ?? null,
    isAuthenticated: !!accessToken && !!userId,
  };

  // If we have tokens, try to refresh them silently
  if (cachedState.refreshToken) {
    await silentRefresh();
  }

  return cachedState;
}

/**
 * Get current auth state (synchronous, from cache).
 */
export function getAuthState(): AuthState {
  return { ...cachedState };
}

// ──────────────────────────────────────────
// Login / Logout
// ──────────────────────────────────────────

/** Options for login/signup when called from Connect Wizard. */
export interface AuthFlowOptions {
  /** Skip the built-in story picker after login (wizard handles it). */
  skipStoryPick?: boolean;
}

/**
 * Interactive login — uses Authorization Code + PKCE flow (RFC 7636).
 * Falls back to device-code via aisha.dirigent.loginWithAishaId command.
 */
export async function login(options?: AuthFlowOptions): Promise<boolean> {
  return loginWithPkce(options);
}

/**
 * Logout — clear stored tokens.
 */
export async function logout(): Promise<void> {
  if (!secrets) return;

  await Promise.all([
    secrets.delete(SECRET_KEY_ACCESS),
    secrets.delete(SECRET_KEY_REFRESH),
    secrets.delete(SECRET_KEY_USER_ID),
    secrets.delete(SECRET_KEY_EMAIL),
    secrets.delete(SECRET_KEY_CLIENT_ID),
  ]);
  cachedClientId = AISHA_ID_CLIENT_ID;

  cachedState = {
    accessToken: null,
    refreshToken: null,
    userId: null,
    email: null,
    isAuthenticated: false,
  };

  authChangeEmitter.fire(cachedState);
  void vscode.window.showInformationMessage(vscode.l10n.t("AISHA Dirigent: Logged out."));
}

// ──────────────────────────────────────────
// Signup
// ──────────────────────────────────────────

/**
 * Open Keycloak registration in the browser.
 * Login still completes through the device-code flow after account creation.
 */
export async function signup(options?: AuthFlowOptions): Promise<boolean> {
  const config = getDirigentConfig();
  const kcUrl = config.keycloakUrl;

  if (!kcUrl) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t("AISHA ID: Keycloak URL not configured. Set keycloakUrl in profile or AISHA_KEYCLOAK_URL env var."),
    );
    return false;
  }

  const redirectUri = config.aishaUrl
    ? `${config.aishaUrl}/auth/v1/callback`
    : config.webUrl
      ? `${config.webUrl}/auth/callback`
      : "";
  const params = new URLSearchParams({
    client_id: "aisha-app",
    response_type: "code",
    scope: "openid email profile",
    redirect_uri: redirectUri,
  });

  void vscode.env.openExternal(
    vscode.Uri.parse(`${kcUrl}/protocol/openid-connect/registrations?${params.toString()}`),
  );
  void vscode.window.showInformationMessage(
    vscode.l10n.t("AISHA Dirigent: Complete registration in the browser, then sign in with AISHA ID."),
  );

  if (options?.skipStoryPick) {
    return false;
  }

  return false;
}

// ──────────────────────────────────────────
// AISHA ID — OIDC device code flow (RFC 8628)
// ──────────────────────────────────────────

/** Keycloak device authorization response. */
interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

/** Keycloak token response. */
interface KcTokenResponse {
  access_token: string;
  id_token: string;
  refresh_token: string;
  expires_in?: number;
}

function decodeJwtClaims(token: string): Record<string, unknown> {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return {};
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function stringClaim(claims: Record<string, unknown>, key: string): string | undefined {
  const value = claims[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Login via AISHA ID (Keycloak OIDC device code flow).
 *
 * 1. Request device code from KC
 * 2. Open browser for user to authenticate
 * 3. Poll KC for token (with user-visible progress)
 * 4. Store the Keycloak access/refresh tokens directly
 */
export async function loginWithAishaId(options?: AuthFlowOptions): Promise<boolean> {
  const config = getDirigentConfig();
  const kcUrl = config.keycloakUrl;

  if (!kcUrl) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t("AISHA ID: Keycloak URL not configured. Set keycloakUrl in profile or AISHA_KEYCLOAK_URL env var."),
    );
    return false;
  }

  const aishaUrl = config.aishaUrl;
  if (!aishaUrl) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t("AISHA Dirigent: aishaUrl not configured. Use .aisha/dirigent.local.json, AISHA_POSTGREST_URL, or legacy settings."),
    );
    return false;
  }

  // Step 1: Request device authorization
  let deviceData: DeviceAuthResponse;
  try {
    const t0 = performance.now();
    const deviceRes = await fetch(`${kcUrl}/protocol/openid-connect/auth/device`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: AISHA_ID_CLIENT_ID,
        scope: "openid email profile",
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!deviceRes.ok) {
      recordApiCall("auth", performance.now() - t0, 0, true);
      void vscode.window.showErrorMessage(
        vscode.l10n.t("AISHA ID: Failed to start device authorization ({0}).", String(deviceRes.status)),
      );
      return false;
    }

    deviceData = (await deviceRes.json()) as DeviceAuthResponse;
    recordApiCall("auth", performance.now() - t0, 0, false);
  } catch {
    void vscode.window.showErrorMessage(
      vscode.l10n.t("AISHA ID: Could not reach Keycloak. Check keycloakUrl configuration."),
    );
    return false;
  }

  // Step 2: Open browser for user login + show code
  void vscode.env.openExternal(vscode.Uri.parse(deviceData.verification_uri_complete));

  // Step 3: Poll for token with progress indicator
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t("AISHA ID: Authenticate in browser. Code: {0}", deviceData.user_code),
      cancellable: true,
    },
    async (_progress, cancellation) => {
      const pollInterval = Math.max((deviceData.interval || 5) * 1000, 5000);
      const deadline = Date.now() + deviceData.expires_in * 1000;

      while (Date.now() < deadline && !cancellation.isCancellationRequested) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, pollInterval);
          cancellation.onCancellationRequested(() => {
            clearTimeout(timer);
            resolve();
          });
        });

        if (cancellation.isCancellationRequested) return false;

        try {
          const tokenRes = await fetch(`${kcUrl}/protocol/openid-connect/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "urn:ietf:params:oauth:grant-type:device_code",
              client_id: AISHA_ID_CLIENT_ID,
              device_code: deviceData.device_code,
            }),
            signal: AbortSignal.timeout(10_000),
          });

          if (tokenRes.ok) {
            const kcTokens = (await tokenRes.json()) as KcTokenResponse;
            return await storeKeycloakSession(kcTokens, options, aishaUrl, config.anonKey ?? "");
          }

          const errorBody = (await tokenRes.json()) as { error?: string };
          if (errorBody.error === "authorization_pending") {
            continue;
          }
          if (errorBody.error === "slow_down") {
            await new Promise((r) => setTimeout(r, pollInterval));
            continue;
          }

          // access_denied, expired_token, etc.
          void vscode.window.showWarningMessage(
            vscode.l10n.t("AISHA ID: Authentication failed ({0}).", errorBody.error ?? "unknown"),
          );
          return false;
        } catch {
          // Network error during polling — continue
          continue;
        }
      }

      if (!cancellation.isCancellationRequested) {
        void vscode.window.showWarningMessage(
          vscode.l10n.t("AISHA ID: Device code expired. Please try again."),
        );
      }
      return false;
    },
  );

  return result ?? false;
}

// ──────────────────────────────────────────
// AISHA ID — Authorization Code + PKCE flow (RFC 7636)
// ──────────────────────────────────────────

/** Resolvers waiting for the OAuth browser redirect to complete (keyed by CSRF state). */
const pendingOAuthCallbacks = new Map<string, (params: URLSearchParams) => void>();

/**
 * Resolve a pending PKCE login by dispatching the OAuth callback URI.
 * Called from extension.ts registerUriHandler when path === "/did-authenticate".
 */
export function resolvePendingOAuthCallback(uri: vscode.Uri): void {
  const params = new URLSearchParams(uri.query);
  const state = params.get("state");
  if (!state) return;
  const resolver = pendingOAuthCallbacks.get(state);
  if (resolver) {
    pendingOAuthCallbacks.delete(state);
    resolver(params);
  }
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest().toString("base64url");
  return { verifier, challenge };
}

async function resolveOAuthCallbackUri(): Promise<vscode.Uri> {
  if (!extensionContext) {
    throw new Error("Authentication module has not been initialized");
  }
  const rawCallbackUri = vscode.Uri.parse(
    `${vscode.env.uriScheme}://${extensionContext.extension.id}/did-authenticate`,
  );
  if (vscode.env.uiKind === vscode.UIKind.Desktop) {
    return rawCallbackUri;
  }

  return vscode.env.asExternalUri(rawCallbackUri);
}

/**
 * Login via Authorization Code + PKCE flow (RFC 7636).
 *
 * 1. Generate PKCE verifier + challenge and random CSRF state
 * 2. Open browser to Keycloak authorization endpoint
 * 3. VS Code URI handler fires when browser redirects to vscode://<extension.id>/did-authenticate
 * 4. Validate CSRF state, exchange code for tokens
 */
export async function loginWithPkce(options?: AuthFlowOptions): Promise<boolean> {
  const config = getDirigentConfig();
  const kcUrl = config.keycloakUrl;

  if (!kcUrl) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t("AISHA ID: Keycloak URL not configured. Set keycloakUrl in profile or AISHA_KEYCLOAK_URL env var."),
    );
    return false;
  }

  const aishaUrl = config.aishaUrl;
  if (!aishaUrl) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t("AISHA Dirigent: aishaUrl not configured. Use .aisha/dirigent.local.json, AISHA_POSTGREST_URL, or legacy settings."),
    );
    return false;
  }

  // Build callback URI — VS Code routes vscode://publisher.extensionId/path to registerUriHandler.
  // Web/remote environments use vscode.dev redirect via asExternalUri.
  const callbackUri = await resolveOAuthCallbackUri();

  const { verifier, challenge } = generatePkce();
  const state = randomBytes(16).toString("hex");

  const authParams = new URLSearchParams({
    client_id: PKCE_CLIENT_ID,
    response_type: "code",
    redirect_uri: callbackUri.toString(),
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  void vscode.env.openExternal(
    vscode.Uri.parse(`${kcUrl}/protocol/openid-connect/auth?${authParams.toString()}`),
  );

  // Wait for the browser redirect callback, with progress indicator + cancellation
  const callbackParams = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t("AISHA ID: Complete login in the browser..."),
      cancellable: true,
    },
    (_progress, cancellation) =>
      new Promise<URLSearchParams | null>((resolve) => {
        const timer = setTimeout(() => {
          pendingOAuthCallbacks.delete(state);
          resolve(null);
        }, 5 * 60_000);

        pendingOAuthCallbacks.set(state, (params) => {
          clearTimeout(timer);
          resolve(params);
        });

        cancellation.onCancellationRequested(() => {
          clearTimeout(timer);
          pendingOAuthCallbacks.delete(state);
          resolve(null);
        });
      }),
  );

  if (!callbackParams) return false;

  const code = callbackParams.get("code");
  const returnedState = callbackParams.get("state");

  if (!code || returnedState !== state) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t("AISHA ID: OAuth callback invalid or tampered. Please try again."),
    );
    return false;
  }

  // Exchange authorization code for tokens
  try {
    const t0 = performance.now();
    const tokenRes = await fetch(`${kcUrl}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: PKCE_CLIENT_ID,
        code,
        redirect_uri: callbackUri.toString(),
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!tokenRes.ok) {
      recordApiCall("auth", performance.now() - t0, 0, true);
      void vscode.window.showErrorMessage(
        vscode.l10n.t("AISHA ID: Token exchange failed ({0}).", String(tokenRes.status)),
      );
      return false;
    }

    const tokens = (await tokenRes.json()) as KcTokenResponse;
    recordApiCall("auth", performance.now() - t0, 0, false);
    return await storeKeycloakSession(tokens, options, aishaUrl, config.anonKey ?? "", PKCE_CLIENT_ID);
  } catch {
    void vscode.window.showErrorMessage(
      vscode.l10n.t("AISHA ID: Could not reach Keycloak. Check keycloakUrl configuration."),
    );
    return false;
  }
}

async function storeKeycloakSession(
  tokens: KcTokenResponse,
  options: AuthFlowOptions | undefined,
  aishaUrl: string,
  anonKey: string,
  clientId: string = AISHA_ID_CLIENT_ID,
): Promise<boolean> {
  const claims = decodeJwtClaims(tokens.id_token || tokens.access_token);
  const userId = stringClaim(claims, "sub");
  const email = stringClaim(claims, "email") ?? stringClaim(claims, "preferred_username") ?? userId;

  if (!userId || !email) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t("AISHA ID: Identity token does not contain a usable user profile."),
    );
    return false;
  }

  await storeTokens(tokens.access_token, tokens.refresh_token, userId, email, clientId);

  void vscode.window.showInformationMessage(
    `AISHA ID: ${vscode.l10n.t("Logged in as {0}", email)}`,
  );

  void fetchAndPersistWorkspaceConfig(aishaUrl, tokens.access_token, anonKey);

  if (!options?.skipStoryPick) {
    void pickStoryAfterLogin(aishaUrl, tokens.access_token, anonKey);
  }

  return true;
}

// ──────────────────────────────────────────
// Token refresh
// ──────────────────────────────────────────

/**
 * Silently refresh the access token using the stored refresh token.
 * Called on startup and periodically.
 */
export async function silentRefresh(): Promise<boolean> {
  if (!cachedState.refreshToken) return false;

  const config = getDirigentConfig();
  if (!config.keycloakUrl) return false;

  try {
    const t0 = performance.now();
    const response = await fetch(`${config.keycloakUrl}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: cachedClientId,
        refresh_token: cachedState.refreshToken,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      recordApiCall("auth", performance.now() - t0, 0, true);
      // Only logout on auth errors (4xx) — server/network issues should not discard tokens
      if (response.status >= 400 && response.status < 500) {
        await logout();
        void vscode.window.showWarningMessage(
          vscode.l10n.t("AISHA Dirigent: Session expired, please log in again."),
        );
      }
      return false;
    }

    const tokens = (await response.json()) as KcTokenResponse;
    const claims = decodeJwtClaims(tokens.id_token || tokens.access_token);
    const userId = stringClaim(claims, "sub") ?? cachedState.userId;
    const email = stringClaim(claims, "email") ?? stringClaim(claims, "preferred_username") ?? cachedState.email;

    if (!tokens.access_token || !userId || !email) {
      recordApiCall("auth", performance.now() - t0, 0, true);
      return false;
    }

    recordApiCall("auth", performance.now() - t0, 0, false);
    await storeTokens(tokens.access_token, tokens.refresh_token || cachedState.refreshToken, userId, email);
    return true;
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────
// Post-auth workspace config
// ──────────────────────────────────────────

/**
 * Fetch workspace config from backend and persist to profile.
 * Called after successful login/signup — runs async, non-blocking.
 */
async function fetchAndPersistWorkspaceConfig(
  aishaUrl: string,
  accessToken: string,
  anonKey: string,
): Promise<void> {
  try {
    const wsConfig = await fetchWorkspaceConfig(aishaUrl, accessToken, anonKey);
    if (wsConfig) {
      const config = getDirigentConfig();
      persistWorkspaceConfig(config.activeProfile, wsConfig);
    }
  } catch {
    // Best-effort — dashboard URL can be configured manually
  }
}

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

/**
 * Persist a set of tokens obtained elsewhere (e.g. SetupPanel webview form)
 * and fire the auth-state event. Avoids a second interactive prompt from `login()`.
 */
export async function completeLoginWithTokens(
  accessToken: string,
  email: string,
  refreshToken: string,
  userId: string,
): Promise<void> {
  await storeTokens(accessToken, refreshToken, userId, email);
}

async function storeTokens(
  accessToken: string,
  refreshToken: string,
  userId: string,
  email: string,
  clientId?: string,
): Promise<void> {
  if (!secrets) return;

  const stores = [
    secrets.store(SECRET_KEY_ACCESS, accessToken),
    secrets.store(SECRET_KEY_REFRESH, refreshToken),
    secrets.store(SECRET_KEY_USER_ID, userId),
    secrets.store(SECRET_KEY_EMAIL, email),
  ];
  if (clientId) {
    stores.push(secrets.store(SECRET_KEY_CLIENT_ID, clientId));
    cachedClientId = clientId;
  }
  await Promise.all(stores);

  cachedState = {
    accessToken,
    refreshToken,
    userId,
    email,
    isAuthenticated: true,
  };

  authChangeEmitter.fire(cachedState);
}

/**
 * After login, fetch user's stories and let them pick which one to work on.
 * Uses the user JWT to call `get_my_stories_audited` RPC.
 */
async function pickStoryAfterLogin(
  aishaUrl: string,
  accessToken: string,
  anonKey: string,
): Promise<void> {
  try {
    const stories = await fetchUserStories(aishaUrl, accessToken, anonKey);

    if (!stories.length) return;

    const items = stories.map((s) => ({
      label: s.title,
      description: s.status,
      detail: s.id,
    }));

    const pick = await vscode.window.showQuickPick(items, {
      title: vscode.l10n.t("Select a story/project for this session"),
      placeHolder: vscode.l10n.t("Which project are you working on?"),
      ignoreFocusOut: true,
    });

    if (pick?.detail) {
      setSessionStoryId(pick.detail);
      await persistStoryId(pick.detail);
      void vscode.window.showInformationMessage(
        `AISHA story: ${pick.label}`,
      );
    }
  } catch {
    // Best-effort — story can be set later via setStory command
  }
}

/** Story item returned from the backend. */
export interface StoryItem {
  id: string;
  title: string;
  status: string;
  is_shared?: boolean;
  participation_role?: string;
}

/**
 * Fetch authenticated user's stories from backend.
 * Can be called from other modules (e.g. setStory command).
 */
export async function fetchUserStories(
  _aishaUrl?: string,
  _accessToken?: string,
  _anonKey?: string,
): Promise<StoryItem[]> {
  const result = await authenticatedFetch<StoryItem[]>(
    `${getBaseUrl()}/rest/v1/rpc/get_my_stories_audited`,
    { body: { p_limit: 20 } },
  );

  if (!result.ok) {
    return [];
  }

  return result.data;
}
