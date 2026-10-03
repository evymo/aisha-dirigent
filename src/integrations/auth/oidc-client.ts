/**
 * Keycloak OIDC client — singleton UserManager + token management.
 *
 * Replaces supabase.auth.* for the pure-PostgreSQL stack.
 * Uses oidc-client-ts for standards-compliant OIDC/PKCE flow.
 *
 * Key features preserved from the Supabase auth client:
 * - sessionStorage persistence (not localStorage for security)
 * - Proactive token refresh on tab visibility change
 * - BroadcastChannel multi-tab signout sync
 * - E2E test support
 * - Dev-fallback to local Keycloak
 */

import { UserManager, WebStorageStateStore, User as OidcUser } from 'oidc-client-ts';

import { oidcConfig } from './oidc-config';
import { safeError, safeWarn } from '@/lib/security/safeLogger';

import type { KcUser, KcSession, OAuthProvider } from './types';

// ---------------------------------------------------------------------------
// E2E detection
// ---------------------------------------------------------------------------

const isE2E = import.meta.env.VITE_E2E === 'true' || import.meta.env.MODE === 'e2e';

/**
 * Storage backend: sessionStorage by default, localStorage for E2E
 * (Playwright storageState persistence).
 */
const storageBackend =
  typeof window !== 'undefined'
    ? isE2E
      ? window.localStorage
      : window.sessionStorage
    : undefined;

// ---------------------------------------------------------------------------
// UserManager singleton
// ---------------------------------------------------------------------------

let _userManager: UserManager | undefined;

/**
 * Get or create the oidc-client-ts UserManager singleton.
 *
 * @returns Configured UserManager instance.
 */
export function getUserManager(): UserManager {
  if (_userManager) return _userManager;

  _userManager = new UserManager({
    authority: oidcConfig.authority,
    client_id: oidcConfig.clientId,
    redirect_uri: oidcConfig.redirectUri,
    post_logout_redirect_uri: oidcConfig.postLogoutRedirectUri,
    silent_redirect_uri: oidcConfig.silentRedirectUri,
    response_type: oidcConfig.responseType,
    scope: oidcConfig.scope,

    // Token / session management
    automaticSilentRenew: true,
    accessTokenExpiringNotificationTimeInSeconds: 120,
    includeIdTokenInSilentRenew: true,

    // Storage — sessionStorage by default (security), localStorage for E2E
    userStore: storageBackend
      ? new WebStorageStateStore({ store: storageBackend })
      : undefined,

    // PKCE is default in oidc-client-ts for authorization code flow
  });

  // Log silent renew errors
  _userManager.events.addSilentRenewError((error) => {
    safeError('oidc.silentRenew.failed', error);
  });

  return _userManager;
}

// ---------------------------------------------------------------------------
// User mapping: OidcUser → KcUser
// ---------------------------------------------------------------------------

/**
 * Map oidc-client-ts User to our KcUser interface.
 *
 * @param oidcUser - Raw OIDC user object.
 * @returns Mapped KcUser.
 */
export function mapOidcUser(oidcUser: OidcUser): KcUser {
  const profile = oidcUser.profile;
  return {
    id: profile.sub,
    email: (profile.email as string) ?? '',
    email_verified: (profile.email_verified as boolean) ?? false,
    display_name:
      (profile.preferred_username as string) ??
      (profile.name as string) ??
      (profile.email as string) ??
      profile.sub,
    given_name: profile.given_name as string | undefined,
    family_name: profile.family_name as string | undefined,
    avatar_url: profile.picture as string | undefined,
    raw_claims: profile as unknown as Record<string, unknown>,
  };
}

/**
 * Map oidc-client-ts User to our KcSession interface.
 *
 * @param oidcUser - Raw OIDC user object.
 * @returns Mapped KcSession.
 */
export function mapOidcSession(oidcUser: OidcUser): KcSession {
  return {
    access_token: oidcUser.access_token,
    refresh_token: oidcUser.refresh_token,
    id_token: oidcUser.id_token,
    expires_at: oidcUser.expires_at ?? Math.floor(Date.now() / 1000) + 300,
    token_type: 'Bearer',
    user: mapOidcUser(oidcUser),
  };
}

// ---------------------------------------------------------------------------
// Auth actions
// ---------------------------------------------------------------------------

/**
 * Redirect the browser to the Keycloak login page.
 *
 * @param options - Optional login configuration.
 * @param options.idpHint - Identity provider hint (e.g. 'google', 'apple')
 *   to skip the KC login page and go directly to the social provider.
 * @param options.returnPath - Path to return to after successful login.
 *   Stored in state and recovered in the callback handler.
 */
export async function login(options?: {
  idpHint?: OAuthProvider;
  returnPath?: string;
}): Promise<void> {
  const mgr = getUserManager();
  const extraQueryParams: Record<string, string> = {};

  if (options?.idpHint && options.idpHint !== 'keycloak') {
    extraQueryParams.kc_idp_hint = options.idpHint;
  }

  await mgr.signinRedirect({
    extraQueryParams,
    state: options?.returnPath ? { returnPath: options.returnPath } : undefined,
  });
}

/**
 * Process the OIDC callback after KC redirects back to the app.
 * Must be called on the `/auth/callback` route.
 *
 * @returns Mapped KcSession with tokens and user profile.
 */
export async function handleCallback(): Promise<KcSession> {
  const mgr = getUserManager();
  const oidcUser = await mgr.signinRedirectCallback();
  return mapOidcSession(oidcUser);
}

/**
 * Process the silent renew callback (hidden iframe).
 * Must be called on the `/auth/silent-renew` route.
 */
export async function handleSilentRenewCallback(): Promise<void> {
  const mgr = getUserManager();
  await mgr.signinSilentCallback();
}

/**
 * Sign out the current user.
 * Redirects to KC end-session endpoint which clears KC SSO session,
 * then redirects back to the app (post_logout_redirect_uri).
 */
export async function logout(): Promise<void> {
  const mgr = getUserManager();
  try {
    await mgr.signoutRedirect();
  } catch (error) {
    // If redirect fails (e.g. KC unreachable), clear local state anyway
    safeWarn('oidc.logout.redirectFailed', error);
    await mgr.removeUser();
  }
}

/**
 * Get the current authenticated user, or null if not logged in.
 *
 * @returns KcUser or null.
 */
export async function getUser(): Promise<KcUser | null> {
  const mgr = getUserManager();
  const oidcUser = await mgr.getUser();
  if (!oidcUser || oidcUser.expired) return null;
  return mapOidcUser(oidcUser);
}

/**
 * Get the current session with tokens, or null if not logged in.
 *
 * @returns KcSession or null.
 */
export async function getSession(): Promise<KcSession | null> {
  const mgr = getUserManager();
  const oidcUser = await mgr.getUser();
  if (!oidcUser || oidcUser.expired) return null;
  return mapOidcSession(oidcUser);
}

/**
 * Get the current valid access token for API calls.
 * Returns null if the user is not authenticated.
 *
 * Used by the PostgREST client as `accessToken()` provider.
 *
 * @returns JWT access token string, or null.
 */
export async function getAccessToken(): Promise<string | null> {
  const mgr = getUserManager();
  const oidcUser = await mgr.getUser();

  if (!oidcUser) return null;

  // If token is expired or about to expire, try silent renew
  if (oidcUser.expired) {
    try {
      const renewed = await mgr.signinSilent();
      return renewed?.access_token ?? null;
    } catch (error) {
      safeError('oidc.getAccessToken.silentRenewFailed', error);
      return null;
    }
  }

  return oidcUser.access_token;
}

/**
 * Force a token refresh via silent renew.
 * Used by authRetry.ts when PostgREST returns 42501 (permission denied).
 *
 * @returns New KcSession or null if refresh fails.
 */
export async function refreshSession(): Promise<KcSession | null> {
  const mgr = getUserManager();
  try {
    const oidcUser = await mgr.signinSilent();
    if (!oidcUser) return null;
    return mapOidcSession(oidcUser);
  } catch (error) {
    safeError('oidc.refreshSession.failed', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Proactive tab-visibility refresh (preserved from Supabase client)
// ---------------------------------------------------------------------------

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const REFRESH_THRESHOLD_MS = 120_000; // 2 minutes before expiry

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;

    const mgr = getUserManager();
    void mgr.getUser().then((oidcUser) => {
      if (!oidcUser?.expires_at) return;

      const expiresAtMs = oidcUser.expires_at * 1_000;
      const remainingMs = expiresAtMs - Date.now();

      if (remainingMs < REFRESH_THRESHOLD_MS) {
        void mgr.signinSilent().catch((error) => {
          safeWarn('oidc.visibilityRefresh.failed', error);
        });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// BroadcastChannel multi-tab signout sync (preserved from useAuth)
// ---------------------------------------------------------------------------

const AUTH_CHANNEL_NAME = 'platform:auth';

let _authChannel: BroadcastChannel | undefined;

/**
 * Get or create the BroadcastChannel for multi-tab auth sync.
 * Returns undefined in environments without BroadcastChannel support.
 */
export function getAuthChannel(): BroadcastChannel | undefined {
  if (typeof BroadcastChannel === 'undefined') return undefined;
  if (_authChannel) return _authChannel;
  _authChannel = new BroadcastChannel(AUTH_CHANNEL_NAME);
  return _authChannel;
}

/**
 * Broadcast a signout event to other tabs.
 */
export function broadcastSignOut(): void {
  const channel = getAuthChannel();
  channel?.postMessage({ type: 'SIGNED_OUT', timestamp: Date.now() });
}

// Listen for cross-tab signout and clear local state
if (typeof BroadcastChannel !== 'undefined') {
  const channel = getAuthChannel();
  channel?.addEventListener('message', (event: MessageEvent) => {
    if (event.data?.type === 'SIGNED_OUT') {
      const mgr = getUserManager();
      void mgr.removeUser();
    }
  });
}

// ---------------------------------------------------------------------------
// Keycloak account management URLs
// ---------------------------------------------------------------------------

/**
 * Get the URL for the KC account management console.
 * Used for password change, profile editing, linked accounts, etc.
 *
 * @param section - Optional section of the account console (e.g. 'password', 'applications').
 * @returns Full URL to the KC account console section.
 */
export function getAccountUrl(section?: string): string {
  const base = `${oidcConfig.authority}/account`;
  return section ? `${base}/#/${section}` : base;
}
