/**
 * Auth module barrel export.
 *
 * Central re-export for all Keycloak OIDC auth functionality.
 * Consumer code should import from '@/integrations/auth'.
 */

// Types
export type { KcUser, KcSession, AuthState, OAuthProvider } from './types';

// Config
export { oidcConfig, resolveOidcConfig } from './oidc-config';
export type { OidcConfig } from './oidc-config';

// OIDC client — auth actions
export {
  getUserManager,
  login,
  handleCallback,
  handleSilentRenewCallback,
  logout,
  getUser,
  getSession,
  getAccessToken,
  refreshSession,
  getAccountUrl,
  broadcastSignOut,
  getAuthChannel,
  mapOidcUser,
  mapOidcSession,
} from './oidc-client';
