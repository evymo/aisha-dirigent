import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "./useSession";
import { useHasPassword } from "./useHasPassword";
import { safeError } from "@/lib/security/safeLogger";

/**
 * Checks if a user's profile is complete for platform usage.
 * 
 * A complete profile requires:
 * 1. Password set (for sensitive data access)
 * 2. Basic profile info (display_name)
 * 3. Enrolled in umbrella study (RII)
 * 
 * Uses RPC-only access pattern - no direct table queries.
 * 
 * @returns Profile completeness status and what's missing
 */
export function useProfileCompleteness() {
  const { user } = useSession();
  const { hasPassword, isLoading: passwordLoading } = useHasPassword();

  // Check profile completeness using RPC
  const profileQuery = useQuery({
    queryKey: ["profile-completeness", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;

      try {
        // RPC-only: use get_profile_completeness function
        const { data, error } = await aisha.rpc("get_profile_completeness");
        
        if (error) {
          safeError("useProfileCompleteness.rpc", error);
          return null;
        }

        // RPC returns array with single row
        const result = Array.isArray(data) && data.length > 0 ? data[0] : null;
        
        return result ? {
          has_display_name: result.has_display_name ?? false,
          has_umbrella_registration: result.has_umbrella_registration ?? false,
          is_new_user: result.is_new_user ?? false,
        } : null;
      } catch (err) {
        safeError("useProfileCompleteness.fetch", err);
        return null;
      }
    },
    enabled: Boolean(user?.id),
    staleTime: 60 * 1000, // 1 minute
  });

  const profileData = profileQuery.data;
  const isLoading = passwordLoading || profileQuery.isLoading;

  // Determine what's missing
  const needsPassword = !hasPassword;
  const needsProfileInfo = !profileData?.has_display_name;
  const needsUmbrellaRegistration = !profileData?.has_umbrella_registration;
  const isNewUser = profileData?.is_new_user ?? false;

  // Profile is complete when user has password, profile info, and umbrella registration
  const isComplete = hasPassword && profileData?.has_display_name && profileData?.has_umbrella_registration;

  // Determine redirect target
  let redirectTo: string | null = null;
  if (!isComplete && user) {
    if (needsPassword || needsProfileInfo) {
      // New user or user without password → full onboarding
      redirectTo = "/study-registration";
    } else if (needsUmbrellaRegistration) {
      // Has profile but not enrolled → just registration
      redirectTo = "/study-registration";
    }
  }

  return {
    isComplete: Boolean(isComplete),
    isLoading,
    isNewUser,
    needsPassword,
    needsProfileInfo,
    needsUmbrellaRegistration,
    redirectTo,
  };
}
