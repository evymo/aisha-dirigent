/**
 * AuthService for AISHA Dirigent.
 *
 * Keycloak OIDC auth via expo-auth-session.
 * All auth operations delegate to @/config/oidc module.
 */
import { Sentry } from "@/config/sentry";
import {
  getAccessToken,
  getAccountUrl,
  pripravPrihlaseniWebView,
  dokonciPrihlaseniWebView,
  getRefreshToken,
  getSession,
  getUser,
  isLoggedIn,
  login,
  logout,
  restoreFromRefreshToken,
} from "@/config/oidc";
import { safeInfo } from "@/lib/security/safeLogger";

import type { KcTokens, KcUser, OAuthProvider } from "@/config/oidc";

export type AuthProvider = OAuthProvider;
export type { KcTokens, KcUser };

function captureAuthEvent(name: string, extra?: Record<string, unknown>) {
  Sentry.addBreadcrumb({
    category: "auth",
    message: name,
    data: extra,
    level: "info",
  });
}

function captureAuthError(name: string, error: unknown, extra?: Record<string, unknown>) {
  Sentry.addBreadcrumb({
    category: "auth",
    message: name,
    data: { ...extra, error: error instanceof Error ? error.message : String(error) },
    level: "error",
  });
}

class AuthService {
  /** Sign in via KC OIDC (opens system browser). */
  async signInWithOAuth(provider: AuthProvider): Promise<KcTokens> {
    captureAuthEvent("oauth_signin_attempt", { provider });
    try {
      const tokens = await login(provider === "keycloak" ? undefined : provider);
      captureAuthEvent("oauth_signin_success", { provider });
      return tokens;
    } catch (error) {
      captureAuthError("oauth_signin_failed", error, { provider });
      throw error;
    }
  }

  /**
   * Přihlášení ve vloženém WebView (Android, jen jméno a heslo RIQ ID).
   * Žádost připraví oidc; co WebView smí a jak se čte návrat řeší
   * src/lib/prihlaseniWebView.ts; tady se jen zaznamená výsledek jako u OAuth.
   */
  async pripravPrihlaseniWebView() {
    captureAuthEvent("oauth_signin_attempt", { provider: "keycloak-webview" });
    return pripravPrihlaseniWebView();
  }

  async dokonciPrihlaseniWebView(code: string, codeVerifier: string): Promise<KcTokens> {
    try {
      const tokens = await dokonciPrihlaseniWebView(code, codeVerifier);
      captureAuthEvent("oauth_signin_success", { provider: "keycloak-webview" });
      return tokens;
    } catch (error) {
      captureAuthError("oauth_signin_failed", error, { provider: "keycloak-webview" });
      throw error;
    }
  }

  /** Get current access token (auto-refreshes if needed). */
  async getAccessToken(): Promise<string | null> {
    return getAccessToken();
  }

  /** Get current session with user info. */
  async getSession() {
    return getSession();
  }

  /** Get stored user without refreshing tokens. */
  async getUser(): Promise<KcUser | null> {
    return getUser();
  }

  /** Check if user is logged in. */
  async isLoggedIn(): Promise<boolean> {
    return isLoggedIn();
  }

  /** Sign out — end KC session and clear local tokens. */
  async signOut(): Promise<void> {
    captureAuthEvent("signout_attempt");
    await logout();
    captureAuthEvent("signout_success");
  }

  /** Get KC account console URL. */
  getAccountUrl(section?: "password" | "personal-info" | ""): string {
    return getAccountUrl(section);
  }

  /** Get refresh token for biometric storage. */
  async getRefreshToken(): Promise<string | null> {
    return getRefreshToken();
  }

  /** Restore session from biometric-stored refresh token. */
  async restoreFromRefreshToken(refreshToken: string): Promise<KcTokens | null> {
    captureAuthEvent("biometric_restore_attempt");
    try {
      const tokens = await restoreFromRefreshToken(refreshToken);
      if (tokens) {
        captureAuthEvent("biometric_restore_success");
      }
      return tokens;
    } catch (error) {
      captureAuthError("biometric_restore_failed", error);
      throw error;
    }
  }

  /**
   * @deprecated KC manages passwords. Redirect to KC account console.
   */
  async resetPassword(_email: string): Promise<void> {
    safeInfo("authService.resetPassword.deprecated", { redirect: "kc_account_console" });
    throw new Error("Password reset is managed by Keycloak. Use getAccountUrl('password').");
  }

  /**
   * @deprecated KC manages passwords.
   */
  async updatePassword(_newPassword: string): Promise<void> {
    safeInfo("authService.updatePassword.deprecated");
    throw new Error("Password changes are managed by Keycloak. Use getAccountUrl('password').");
  }

  /**
   * @deprecated Magic links are no longer supported. Use signInWithOAuth().
   */
  async sendMagicLink(_email: string): Promise<void> {
    throw new Error("Magic links are no longer supported. Use KC OIDC login.");
  }

  /**
   * @deprecated OTP verification is no longer supported. Use signInWithOAuth().
   */
  async verifyOtp(_email: string, _token: string): Promise<never> {
    throw new Error("OTP is no longer supported. Use KC OIDC login.");
  }

  /**
   * @deprecated Email/password login is no longer supported. Use signInWithOAuth().
   */
  async signInWithEmail(_creds: { email: string; password: string }): Promise<never> {
    throw new Error("Email/password login is no longer supported. Use KC OIDC login.");
  }

  /**
   * @deprecated Email/password signup is no longer supported. KC manages registration.
   */
  async signUpWithEmail(_creds: { email: string; fullName?: string; password: string }): Promise<never> {
    throw new Error("Signup is no longer supported. Use KC OIDC login.");
  }
}

export const authService = new AuthService();
