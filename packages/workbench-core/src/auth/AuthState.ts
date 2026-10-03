/**
 * AuthState — minimum token data shared across adapters and consumers.
 * Platform-agnostic: no vscode or Node.js-specific dependencies.
 *
 * @module
 */

/** Minimum token data needed by API clients and SSE channels. */
export interface AuthState {
  /** Access token (JWT or opaque Bearer). */
  accessToken: string | null;
  /** Refresh token (OIDC) or null for ApiKey adapters. */
  refreshToken: string | null;
  /** Authenticated user UUID or null for ApiKey adapters. */
  userId: string | null;
  /** Authenticated user email or null for ApiKey adapters. */
  email: string | null;
  /** Whether the user is currently authenticated. */
  isAuthenticated: boolean;
}

/** Credentials passed to IAuthAdapter.authenticate(). */
export type AuthCredentials =
  | { type: "email_password"; email: string; password: string }
  | { type: "tokens"; accessToken: string; refreshToken: string; userId: string; email: string }
  | { type: "api_key"; apiKey: string };
