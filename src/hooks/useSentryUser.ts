import { useEffect } from "react";
import * as Sentry from "@sentry/react";
import { useSession } from "./useSession";

/**
 * Synchronizes Sentry user context with the currently authenticated user.
 * 
 * IMPORTANT: For sensitive data/PII safety, we do NOT send email or name.
 * Only an anonymized user ID hash and non-sensitive role information is sent.
 * This allows correlating errors to users without exposing sensitive data.
 */
export function useSentryUser(): void {
  const { user, roles, isAdmin } = useSession();

  useEffect(() => {
    if (user) {
      // Set anonymized user context
      Sentry.setUser({
        // Anonymized hash ID instead of actual UUID
        id: hashUserId(user.id),
        // Roles are non-sensitive - safe to include for debugging
        roles: roles,
        isAdmin: isAdmin,
      });
    } else {
      // Clear user context when logged out
      Sentry.setUser(null);
    }
  }, [user, roles, isAdmin]);
}

/**
 * Creates an anonymized hash of the user ID.
 * Uses a prefix + truncated ID to allow correlation without exposing the full UUID.
 */
function hashUserId(id: string): string {
  return `u_${id.substring(0, 8)}`;
}
