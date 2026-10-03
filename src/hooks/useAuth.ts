import { useCallback, useEffect, useRef, useState } from "react";
import {
  getUserManager,
  getUser,
  getSession,
  logout as oidcLogout,
  broadcastSignOut,
  getAuthChannel,
  mapOidcUser,
  mapOidcSession,
} from "@/integrations/auth/oidc-client";
import { useIsMountedRef } from "./useIsMountedRef";
import { safeError, safeWarn } from "@/lib/security/safeLogger";

import type { KcUser, KcSession } from "@/integrations/auth/types";

/**
 * Hook for managing authentication state and multi-tab synchronization.
 *
 * Uses Keycloak OIDC via oidc-client-ts. Replaces the previous Supabase auth
 * state hook. Manages user/session state, OIDC event subscriptions,
 * BroadcastChannel multi-tab signout sync, and token lifecycle events.
 *
 * @returns An object containing:
 * - `user`: The current KC user or null.
 * - `session`: The current KC session or null.
 * - `loading`: Boolean indicating if the initial session check is in progress.
 * - `signOut`: Function to sign out the user and notify other tabs.
 * - `isAuthenticated`: Boolean helper derived from user existence.
 *
 * @example
 * ```tsx
 * const { user, loading, signOut } = useAuth();
 *
 * if (loading) return <Spinner />;
 * if (!user) return <Redirect to="/login" />;
 * ```
 */
export function useAuth() {
  const [user, setUser] = useState<KcUser | null>(null);
  const [session, setSession] = useState<KcSession | null>(null);
  const [loading, setLoading] = useState(true);
  const isMountedRef = useIsMountedRef();

  const lastSignedOutBroadcastAtRef = useRef<number>(0);
  const suppressSignedOutBroadcastRef = useRef(false);

  // -------------------------------------------------------------------
  // Sign out
  // -------------------------------------------------------------------

  const signOut = useCallback(async () => {
    suppressSignedOutBroadcastRef.current = true;
    try {
      broadcastSignOut();
      setUser(null);
      setSession(null);
      await oidcLogout();
    } catch (error) {
      safeError("useAuth.signOut.failed", error);
    } finally {
      suppressSignedOutBroadcastRef.current = false;
    }
  }, []);

  // -------------------------------------------------------------------
  // Initialize: load user from oidc-client-ts store + subscribe to events
  // -------------------------------------------------------------------

  useEffect(() => {
    const mgr = getUserManager();

    // OIDC event handlers
    const handleUserLoaded = (oidcUser: import("oidc-client-ts").User) => {
      if (isMountedRef.current) {
        setUser(mapOidcUser(oidcUser));
        setSession(mapOidcSession(oidcUser));
        setLoading(false);
      }
    };

    const handleUserUnloaded = () => {
      if (isMountedRef.current) {
        setUser(null);
        setSession(null);
      }
      if (!suppressSignedOutBroadcastRef.current) {
        broadcastSignOut();
      }
    };

    const handleSilentRenewError = (error: Error) => {
      safeError("useAuth.silentRenew.failed", error);
    };

    const handleAccessTokenExpired = () => {
      safeWarn("useAuth.tokenExpired", "Access token expired, clearing session.");
      if (isMountedRef.current) {
        setUser(null);
        setSession(null);
      }
    };

    mgr.events.addUserLoaded(handleUserLoaded);
    mgr.events.addUserUnloaded(handleUserUnloaded);
    mgr.events.addSilentRenewError(handleSilentRenewError);
    mgr.events.addAccessTokenExpired(handleAccessTokenExpired);

    // BroadcastChannel: multi-tab signout sync
    const channel = getAuthChannel();
    const handleBroadcast = (event: MessageEvent) => {
      const msg = event?.data as { type?: string; timestamp?: number } | null;
      if (!msg || msg.type !== "SIGNED_OUT") return;

      const now = Date.now();
      if (now - lastSignedOutBroadcastAtRef.current < 500) return;
      lastSignedOutBroadcastAtRef.current = now;

      suppressSignedOutBroadcastRef.current = true;
      void mgr.removeUser().finally(() => {
        suppressSignedOutBroadcastRef.current = false;
      });
    };

    channel?.addEventListener("message", handleBroadcast);

    // Load existing session from store
    void (async () => {
      try {
        const kcUser = await getUser();
        const kcSession = await getSession();

        if (isMountedRef.current) {
          setUser(kcUser);
          setSession(kcSession);
        }
      } catch (error) {
        safeWarn("useAuth.initialize.failed", error);
        if (isMountedRef.current) {
          setUser(null);
          setSession(null);
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    })();

    return () => {
      mgr.events.removeUserLoaded(handleUserLoaded);
      mgr.events.removeUserUnloaded(handleUserUnloaded);
      mgr.events.removeSilentRenewError(handleSilentRenewError);
      mgr.events.removeAccessTokenExpired(handleAccessTokenExpired);
      channel?.removeEventListener("message", handleBroadcast);
    };
  }, [isMountedRef]);

  return {
    user,
    session,
    loading,
    signOut,
    isAuthenticated: !!user,
  };
}
