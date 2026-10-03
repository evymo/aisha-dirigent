/**
 * Keycloak OIDC client configuration.
 *
 * Resolves environment variables with sensible local-dev defaults.
 * All KC OIDC settings are derived from the realm discovery URL.
 */

import { safeWarn } from '@/lib/security/safeLogger';

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

const readNonEmpty = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/** KC base URL — env var with local-dev fallback. */
const KC_BASE_URL = readNonEmpty(import.meta.env.VITE_KC_URL) ?? 'http://127.0.0.1:8080';

const origin = () =>
  typeof window !== 'undefined' ? window.location.origin : KC_BASE_URL;

// ---------------------------------------------------------------------------
// Environment variables
// ---------------------------------------------------------------------------

/** KC realm URL — e.g. https://kc.aisha.guru/realms/aisha */
const KC_AUTHORITY = readNonEmpty(import.meta.env.VITE_KC_AUTHORITY);
/** KC public client ID — e.g. aisha-app */
const KC_CLIENT_ID = readNonEmpty(import.meta.env.VITE_KC_CLIENT_ID);
/** Web app OIDC callback URL — e.g. https://web.aisha.guru/auth/callback */
const AUTH_REDIRECT_URI = readNonEmpty(import.meta.env.VITE_AUTH_REDIRECT_URI);
/** Post-logout redirect — e.g. https://web.aisha.guru/ */
const AUTH_POST_LOGOUT_URI = readNonEmpty(import.meta.env.VITE_AUTH_POST_LOGOUT_URI);
/** Silent renew redirect — e.g. https://web.aisha.guru/auth/silent-renew */
const AUTH_SILENT_REDIRECT_URI = readNonEmpty(import.meta.env.VITE_AUTH_SILENT_REDIRECT_URI);

// ---------------------------------------------------------------------------
// Local development defaults
// ---------------------------------------------------------------------------

// Local dev default realm is 'aisha' (brand-default). For tenant-customised
// builds, set VITE_KC_AUTHORITY to override the entire authority URL.
const LOCAL_KC_REALM = (import.meta.env.VITE_KC_REALM as string | undefined) ?? 'aisha';
const LOCAL_KC_AUTHORITY = `${KC_BASE_URL}/realms/${LOCAL_KC_REALM}`;
const LOCAL_KC_CLIENT_ID = 'aisha-app';

// ---------------------------------------------------------------------------
// Validated config
// ---------------------------------------------------------------------------

/**
 * OIDC configuration for oidc-client-ts UserManager.
 *
 * Reads from VITE_KC_* environment variables; falls back to local Keycloak
 * if variables are missing (dev mode only).
 */
export interface OidcConfig {
  /** KC realm authority URL (OIDC discovery base). */
  authority: string;
  /** OIDC public client ID. */
  clientId: string;
  /** Post-login redirect URI (web app callback route). */
  redirectUri: string;
  /** Post-logout redirect URI. */
  postLogoutRedirectUri: string;
  /** Silent renew redirect URI (hidden iframe). */
  silentRedirectUri: string;
  /** OIDC response type — always 'code' (authorization code + PKCE). */
  responseType: 'code';
  /** OIDC scopes. */
  scope: string;
  /** Whether this config was resolved from env or dev-fallback. */
  source: 'env' | 'dev-fallback';
}

/**
 * Resolve and validate the OIDC configuration.
 *
 * @returns Validated OIDC config ready for UserManager.
 */
export function resolveOidcConfig(): OidcConfig {
  const authority = KC_AUTHORITY;
  const clientId = KC_CLIENT_ID;

  if (authority && clientId) {
    return {
      authority,
      clientId,
      redirectUri: AUTH_REDIRECT_URI ?? `${origin()}/auth/callback`,
      postLogoutRedirectUri: AUTH_POST_LOGOUT_URI ?? origin(),
      silentRedirectUri: AUTH_SILENT_REDIRECT_URI ?? `${origin()}/auth/silent-renew`,
      responseType: 'code',
      scope: 'openid profile email',
      source: 'env',
    };
  }

  // Dev-fallback: local KC
  const missing: string[] = [];
  if (!authority) missing.push('VITE_KC_AUTHORITY');
  if (!clientId) missing.push('VITE_KC_CLIENT_ID');

  // NOTE: import.meta.env.MODE must be accessed directly — Vite statically
  // replaces this exact pattern during build. Dynamic access patterns
  // (e.g. casting import.meta) are NOT replaced and would always be undefined.
  const mode: string = import.meta.env.MODE ?? 'development';

  if (mode === 'production') {
    throw new Error(
      `Missing required Keycloak environment variables: ${missing.join(', ')}. ` +
      'Set VITE_KC_AUTHORITY and VITE_KC_CLIENT_ID for production builds.'
    );
  }

  safeWarn(
    'oidc.config.devFallback',
    `Missing KC env vars (${missing.join(', ')}). Falling back to local KC at ${LOCAL_KC_AUTHORITY}.`
  );

  return {
    authority: LOCAL_KC_AUTHORITY,
    clientId: LOCAL_KC_CLIENT_ID,
    redirectUri: AUTH_REDIRECT_URI ?? `${origin()}/auth/callback`,
    postLogoutRedirectUri: AUTH_POST_LOGOUT_URI ?? origin(),
    silentRedirectUri: AUTH_SILENT_REDIRECT_URI ?? `${origin()}/auth/silent-renew`,
    responseType: 'code',
    scope: 'openid profile email',
    source: 'dev-fallback',
  };
}

/** Pre-resolved config singleton. */
export const oidcConfig = resolveOidcConfig();
