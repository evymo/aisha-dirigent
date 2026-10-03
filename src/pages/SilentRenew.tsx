import { useEffect } from "react";
import { handleSilentRenewCallback } from "@/integrations/auth";

/**
 * Silent-renew page loaded inside a hidden iframe by oidc-client-ts.
 *
 * Mounted at `/auth/silent-renew`. When the access token is close to
 * expiry, oidc-client-ts opens this URL in an invisible iframe. The page
 * calls `handleSilentRenewCallback()` which reads the new tokens from
 * the redirect URI fragment and passes them to the parent window.
 */
export default function SilentRenew() {
  useEffect(() => {
    handleSilentRenewCallback();
  }, []);

  return null;
}
