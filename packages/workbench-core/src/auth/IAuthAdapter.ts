/**
 * IAuthAdapter — platform-agnostic authentication adapter interface.
 *
 * Implementations: KeycloakTokenAdapter/SupabaseGoTrueAdapter compatibility alias, ApiKeyAdapter.
 * Each implementation handles token lifecycle without vscode/Electron imports.
 *
 * The hosting environment (VS Code extension, Electron shell) is responsible
 * for UI interaction (prompts, notifications) and injects credentials via
 * authenticate(). The adapter handles only the HTTP and token lifecycle.
 *
 * @module
 */

import type { AuthCredentials, AuthState } from "./AuthState.js";

/** Authentication adapter contract. */
export interface IAuthAdapter {
  /**
   * Current auth state (synchronous, from cache).
   * Safe to call frequently — reads from in-memory cache.
   */
  getState(): AuthState;

  /**
   * HTTP headers for authenticated API requests.
   * Returns empty object when not authenticated.
   */
  getAuthHeaders(): Record<string, string>;

  /**
   * Authenticate with the given credentials.
   * Does NOT trigger any UI — caller must collect credentials first.
   *
   * @param credentials - email+password, existing tokens, or api_key
   * @returns resolved AuthState on success
   * @throws Error on authentication failure
   */
  authenticate(credentials: AuthCredentials): Promise<AuthState>;

  /**
   * Silently refresh the access token.
   * Returns false if no refresh token is available or refresh fails.
   */
  refreshToken(): Promise<boolean>;

  /**
   * Clear all stored tokens and reset state to unauthenticated.
   */
  logout(): Promise<void>;

  /**
   * Restore previously persisted state on startup.
   * Should be called once during app initialization.
   */
  restore(): Promise<AuthState>;
}
