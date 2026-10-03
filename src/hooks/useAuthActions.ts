import { useMutation, useQuery } from "@tanstack/react-query";
import {
  login as oidcLogin,
  logout as oidcLogout,
  getUser,
  getSession,
  getAccountUrl,
} from "@/integrations/auth/oidc-client";
import { safeError } from "@/lib/security/safeLogger";

import type { OAuthProvider } from "@/integrations/auth/types";

interface OAuthLoginOptions {
  provider: OAuthProvider;
  redirectUrl: string;
}

/**
 * Hook to initiate OAuth/OIDC login via Keycloak.
 *
 * Replaces the previous magic-link + password + OAuth hooks.
 * With KC as sole auth provider, all login flows go through KC:
 * - Direct KC login (email/password on KC login page)
 * - Google login (kc_idp_hint=google)
 * - Apple login (kc_idp_hint=apple)
 */
export function useOAuthLogin() {
  return useMutation({
    mutationFn: async ({ provider, redirectUrl }: OAuthLoginOptions) => {
      try {
        await oidcLogin({
          idpHint: provider,
          returnPath: redirectUrl,
        });
      } catch (error) {
        safeError("auth.oauth.loginFailed", error);
        throw error;
      }
    },
  });
}

/**
 * Hook to initiate KC login without a specific IdP hint.
 * Shows the KC login page where user can choose method.
 */
export function useLogin() {
  return useMutation({
    mutationFn: async (returnPath?: string) => {
      try {
        await oidcLogin({ returnPath });
      } catch (error) {
        safeError("auth.login.failed", error);
        throw error;
      }
    },
  });
}

/**
 * Hook to sign out.
 */
export function useSignOut() {
  return useMutation({
    mutationFn: async () => {
      try {
        await oidcLogout();
      } catch (error) {
        safeError("auth.signOut.failed", error);
        throw error;
      }
    },
  });
}

/**
 * Hook to redirect user to KC account management for password change.
 *
 * Password update flow — Keycloak OIDC.
 * KC handles password policy, validation, and notification.
 */
export function useUpdatePassword() {
  return useMutation({
    mutationFn: async () => {
      const url = getAccountUrl("password");
      window.location.href = url;
    },
  });
}

/**
 * Hook to get current auth session.
 */
export function useAuthSession() {
  return useQuery({
    queryKey: ["auth", "session"],
    queryFn: async () => {
      const kcSession = await getSession();
      if (!kcSession) {
        throw new Error("No active session");
      }
      return kcSession;
    },
    staleTime: 1000 * 60, // 1 minute
  });
}

/**
 * Hook to get current user.
 */
export function useCurrentUser() {
  return useQuery({
    queryKey: ["auth", "user"],
    queryFn: async () => {
      const kcUser = await getUser();
      if (!kcUser) {
        throw new Error("No authenticated user");
      }
      return kcUser;
    },
    staleTime: 1000 * 60, // 1 minute
  });
}

// ---------------------------------------------------------------------------
// Deprecated hooks — kept as stubs to avoid import errors during migration.
// These will be removed once all callers are updated.
// ---------------------------------------------------------------------------

/**
 * @deprecated Magic link is not supported with KC. Use `useLogin()` instead.
 */
export function useSendMagicLink() {
  return useMutation({
    mutationFn: async () => {
      throw new Error("Magic link is not supported. Use Keycloak login.");
    },
  });
}

/**
 * @deprecated OTP verification is not supported with KC. Use `useLogin()` instead.
 */
export function useVerifyOtp() {
  return useMutation({
    mutationFn: async () => {
      throw new Error("OTP verification is not supported. Use Keycloak login.");
    },
  });
}

/**
 * @deprecated Password login is handled by KC login page. Use `useLogin()` instead.
 */
export function usePasswordLogin() {
  return useMutation({
    mutationFn: async () => {
      throw new Error("Password login is handled by Keycloak. Use useLogin().");
    },
  });
}
