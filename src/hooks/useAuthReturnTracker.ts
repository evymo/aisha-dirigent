import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const AUTH_RETURN_PATH_KEY = "auth:return-path";

const EXCLUDED_PREFIXES = ["/auth", "/set-password", "/change-password"];

function isExcludedPath(path: string) {
  return EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isSafePath(path: string) {
  return path.startsWith("/") && !path.startsWith("//");
}

/**
 * Persist the last non-auth route for post-login redirects.
 */
export function useAuthReturnTracker() {
  const location = useLocation();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const path = `${location.pathname}${location.search}${location.hash}`;
    if (!isSafePath(path) || isExcludedPath(path)) return;

    window.sessionStorage.setItem(AUTH_RETURN_PATH_KEY, path);
  }, [location.pathname, location.search, location.hash]);
}

/**
 * Get the stored return path from the current browser session.
 */
export function getStoredAuthReturnPath(): string | null {
  if (typeof window === "undefined") return null;
  const value = window.sessionStorage.getItem(AUTH_RETURN_PATH_KEY);
  if (!value || !isSafePath(value) || isExcludedPath(value)) return null;
  return value;
}

/**
 * Clear the stored return path after a successful redirect.
 */
export function clearStoredAuthReturnPath() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(AUTH_RETURN_PATH_KEY);
}
