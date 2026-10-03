/**
 * Authentication hook for AISHA Dirigent.
 * Handles Keycloak OIDC auth, session persistence, biometric unlock.
 */
import { useCallback, useEffect, useState } from "react";
import { authService } from "@/services/auth";
import { setSentryUser, clearSentryUser } from "@/config/sentry";
import { safeError, safeInfo } from "@/lib/security/safeLogger";
import { unregisterPushSessionForCurrentDevice } from "@/hooks/useNotifications";
import { getSession, zahodMistniRelaci } from "@/config/oidc";

import type { AuthProvider, KcUser } from "@/services/auth";
import { jePrvniBehPoInstalaci, oznacInstalaci } from "@/lib/cerstvaInstalace";

interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: KcUser | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    isLoading: true,
    isAuthenticated: false,
    user: null,
  });

  useEffect(() => {
    /**
     * ⛔ RELACE Z MINULÉ INSTALACE NENÍ PŘIHLÁŠENÍ. `expo-secure-store` píše do
     *    iOS Keychainu a ten smazání aplikace PŘEŽIJE. Bez tohohle kroku se
     *    `isAuthenticated: !!session` rozsvítí po čisté instalaci, `index.tsx`
     *    pošle člověka na předvolby — a tichá cesta ven (ťukání) zůstane na
     *    přihlašovací obrazovce, kam se už nedostane.
     *
     * ⭐ Značka instalace žije v `AsyncStorage`, který se PŘI ODINSTALACI MAŽE.
     *    Rozdíl mezi „mám relaci" a „mám cizí relaci" se z relace poznat nedá.
     */
    const start = async () => {
      if (await jePrvniBehPoInstalaci()) {
        await zahodMistniRelaci();
        await oznacInstalaci();
      }
      return getSession();
    };
    start().then((session) => {
      const user = session?.user ?? null;
      setState({
        isLoading: false,
        isAuthenticated: !!session,
        user,
      });
      if (user?.id) {
        setSentryUser(user.id);
      }
    }).catch((error) => {
      safeError("useAuth.getSession", error);
      setState((prev) => ({ ...prev, isLoading: false }));
    });
  }, []);

  const signInWithOAuth = useCallback(
    async (provider: AuthProvider) => {
      try {
        const tokens = await authService.signInWithOAuth(provider);
        // After login, refresh state
        const session = await getSession();
        setState({
          isLoading: false,
          isAuthenticated: true,
          user: session?.user ?? null,
        });
        if (session?.user?.id) {
          setSentryUser(session.user.id);
        }
        safeInfo("useAuth.oauthSignIn.success", { provider });
        return tokens;
      } catch (error) {
        safeError("useAuth.oauthSignIn.failed", error);
        throw error;
      }
    },
    []
  );

  const signOut = useCallback(async () => {
    try {
      await unregisterPushSessionForCurrentDevice();
      await authService.signOut();
      setState({
        isLoading: false,
        isAuthenticated: false,
        user: null,
      });
      clearSentryUser();
      safeInfo("useAuth.signOut.success");
    } catch (error) {
      safeError("useAuth.signOut.failed", error);
    }
  }, []);

  /** Refresh state after biometric restore or external session change. */
  const refreshAuthState = useCallback(async () => {
    const session = await getSession();
    setState({
      isLoading: false,
      isAuthenticated: !!session,
      user: session?.user ?? null,
    });
    if (session?.user?.id) {
      setSentryUser(session.user.id);
    } else {
      clearSentryUser();
    }
  }, []);

  return {
    ...state,
    signInWithOAuth,
    signOut,
    refreshAuthState,
  };
}
