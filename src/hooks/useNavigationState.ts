import { useCallback, useMemo } from "react";
import { useLocation, useNavigate, type Location } from "react-router-dom";

/**
 * Navigation state from location.state
 */
interface NavigationLocationState {
  /** Full Location object for return navigation (set by RequireAuth) */
  from?: Location;
  /** Simple path string for return navigation */
  returnTo?: string;
}

/**
 * Hook for managing navigation state across the application.
 * Provides consistent patterns for:
 * - Return URL after login (via location.state.from or returnTo)
 * - Back navigation with fallback
 * - Navigating while preserving current location for return
 */
export function useNavigationState() {
  const location = useLocation();
  const navigate = useNavigate();

  /**
   * Extract return path from location.state
   * Priority: state.from (Location object) > state.returnTo (string)
   */
  const returnPath = useMemo(() => {
    const state = location.state as NavigationLocationState | null;

    // Priority 1: state.from (full Location object from RequireAuth)
    if (state?.from?.pathname) {
      const pathname = state.from.pathname;
      const search = state.from.search || "";
      const hash = state.from.hash || "";
      const combined = `${pathname}${search}${hash}`;
      
      // Security: only allow internal paths
      if (combined.startsWith("/")) {
        return combined;
      }
    }

    // Priority 2: state.returnTo (simple string path)
    if (state?.returnTo && typeof state.returnTo === "string" && state.returnTo.startsWith("/")) {
      return state.returnTo;
    }

    return null;
  }, [location.state]);

  /**
   * Navigate to a path while preserving current location for return navigation
   */
  const navigateWithReturn = useCallback(
    (to: string, options?: { returnTo?: string; replace?: boolean }) => {
      navigate(to, {
        state: {
          from: location,
          returnTo: options?.returnTo || `${location.pathname}${location.search}`,
        },
        replace: options?.replace,
      });
    },
    [navigate, location]
  );

  /**
   * Go back to the return path, or use browser history, or fallback to specified path
   */
  const goBack = useCallback(
    (fallback = "/") => {
      if (returnPath) {
        // We have a stored return path
        navigate(returnPath, { replace: true });
      } else if (window.history.length > 2) {
        // Use browser history (length > 2 means there's a previous page to go to)
        navigate(-1);
      } else {
        // Fallback to specified path
        navigate(fallback, { replace: true });
      }
    },
    [navigate, returnPath]
  );

  /**
   * Create state object for auth redirect
   * Use this when redirecting to /auth for consistent return behavior
   */
  const createAuthState = useCallback(() => {
    return { from: location };
  }, [location]);

  /**
   * Current path including search params
   */
  const currentPath = `${location.pathname}${location.search}`;

  return {
    /** Path to return to after completing an action (login, etc.) */
    returnPath,
    /** Current path including search params */
    currentPath,
    /** Navigate while preserving current location for return */
    navigateWithReturn,
    /** Go back using return path, browser history, or fallback */
    goBack,
    /** Create state object for redirecting to auth */
    createAuthState,
    /** Raw location object */
    location,
  };
}
