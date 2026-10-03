import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useSession } from "./useSession";

/**
 * Hook for pages that require authentication but don't use RequireAuth component.
 * Redirects unauthenticated users to /auth with proper return state.
 * 
 * @param options.redirectPath - Path to redirect after login (defaults to current path)
 * @returns { user, isLoading, isAuthenticated }
 * 
 * @example
 * ```tsx
 * function ProtectedPage() {
 *   const { user, isLoading, isAuthenticated } = useRequireAuthWithReturn();
 *   
 *   if (isLoading) return <Loading />;
 *   if (!isAuthenticated) return null; // Redirect in progress
 *   
 *   return <div>Protected content for {user.email}</div>;
 * }
 * ```
 */
export function useRequireAuthWithReturn(options?: { redirectPath?: string }) {
  const { user, isLoading } = useSession();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!isLoading && !user) {
      // Redirect to auth with return state
      navigate("/auth", {
        state: { 
          from: location,
          returnTo: options?.redirectPath || `${location.pathname}${location.search}`,
        },
        replace: true,
      });
    }
  }, [user, isLoading, navigate, location, options?.redirectPath]);

  return {
    user,
    isLoading,
    isAuthenticated: !isLoading && !!user,
  };
}
