import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { handleCallback } from "@/integrations/auth";
import {
  getStoredAuthReturnPath,
  clearStoredAuthReturnPath,
} from "@/hooks/useAuthReturnTracker";
import { safeError } from "@/lib/security/safeLogger";

/**
 * OIDC redirect callback page — handles the authorization code exchange
 * after Keycloak redirects the browser back.
 *
 * Mounted at `/auth/callback`. The oidc-client-ts UserManager reads the
 * `code` and `state` query params, exchanges them for tokens, and stores
 * the resulting session. The component then navigates to the return path
 * encoded in the OIDC state or falls back to `/member`.
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const didHandle = useRef(false);

  useEffect(() => {
    if (didHandle.current) return;
    didHandle.current = true;

    (async () => {
      try {
        await handleCallback();

        // handleCallback() returns a mapped KcSession (no OIDC state); the
        // return path is tracked separately in session storage by
        // useAuthReturnTracker.
        const returnPath = getStoredAuthReturnPath();
        clearStoredAuthReturnPath();

        navigate(
          typeof returnPath === "string" && returnPath.startsWith("/")
            ? returnPath
            : "/member",
          { replace: true },
        );
      } catch (error) {
        safeError("AuthCallback.handleCallback", error);
        navigate("/auth", { replace: true });
      }
    })();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}
