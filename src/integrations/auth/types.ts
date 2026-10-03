/**
 * Keycloak OIDC authentication types.
 *
 * These types replace the Supabase Session/User types for the
 * pure-PostgreSQL stack migration (KC as sole auth provider).
 */

/**
 * Represents an authenticated Keycloak user profile.
 * Fields mirror the most commonly used properties from the previous
 * Supabase `User` object so that consumer code requires minimal changes.
 */
export interface KcUser {
  /** Keycloak user UUID (sub claim). */
  id: string;
  /** Verified email address. */
  email: string;
  /** Whether the email has been verified in KC. */
  email_verified: boolean;
  /** Display name (preferred_username or full name). */
  display_name: string;
  /** Given name (first name) from KC profile. */
  given_name?: string;
  /** Family name (surname) from KC profile. */
  family_name?: string;
  /** Avatar / picture URL if available. */
  avatar_url?: string;
  /** Raw KC token claims for edge cases. */
  raw_claims: Record<string, unknown>;
}

/**
 * Represents the current authentication session with token information.
 * Replaces the Supabase `Session` object.
 */
export interface KcSession {
  /** JWT access token for PostgREST / API calls. */
  access_token: string;
  /** Refresh token for silent renewal (if available). */
  refresh_token?: string;
  /** ID token (OIDC). */
  id_token?: string;
  /** Token expiration timestamp (unix seconds). */
  expires_at: number;
  /** Token type (always "Bearer"). */
  token_type: 'Bearer';
  /** The authenticated user profile. */
  user: KcUser;
}

/**
 * Authentication state for React context / hooks.
 */
export interface AuthState {
  /** Current user or null if not authenticated. */
  user: KcUser | null;
  /** Current session or null if not authenticated. */
  session: KcSession | null;
  /** Whether the initial auth check is still in progress. */
  loading: boolean;
  /** Whether the user is authenticated (user !== null). */
  isAuthenticated: boolean;
}

/**
 * Supported OAuth identity provider hints for KC login.
 * These map to KC Identity Provider aliases configured in the realm.
 */
export type OAuthProvider = 'google' | 'apple' | 'keycloak';
