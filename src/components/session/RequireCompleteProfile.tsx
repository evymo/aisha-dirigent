import { Navigate, useLocation } from "react-router-dom";
import { useProfileCompleteness } from "@/hooks/useProfileCompleteness";
import { useSession } from "@/hooks/useSession";
import { Loader2 } from "lucide-react";

interface RequireCompleteProfileProps {
  children: React.ReactNode;
  /**
   * If true, allows incomplete profiles to pass through.
   * Useful for pages that should be accessible during onboarding.
   */
  allowIncomplete?: boolean;
}

/**
 * Wrapper component that ensures user has a complete profile.
 * 
 * Redirects to onboarding/registration if:
 * - User doesn't have password set
 * - User doesn't have profile info
 * - User isn't enrolled in umbrella study
 * 
 * @example
 * <RequireCompleteProfile>
 *   <MemberPortal />
 * </RequireCompleteProfile>
 */
export function RequireCompleteProfile({ 
  children, 
  allowIncomplete = false 
}: RequireCompleteProfileProps) {
  const location = useLocation();
  const { user, isLoading: sessionLoading } = useSession();
  const { isComplete, isLoading, redirectTo } = useProfileCompleteness();

  // Still loading
  if (sessionLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Not logged in - let RequireAuth handle this
  if (!user) {
    return <>{children}</>;
  }

  // Allow incomplete if specified
  if (allowIncomplete) {
    return <>{children}</>;
  }

  // Profile incomplete - redirect to onboarding
  if (!isComplete && redirectTo) {
    // Don't redirect if already on the target page
    if (location.pathname === redirectTo) {
      return <>{children}</>;
    }

    // Also allow certain paths during onboarding
    const allowedPaths = [
      "/study-registration",
      "/qualification-test",
      "/informed-consent",
      "/onboarding",
      "/set-password",
      "/auth",
    ];
    
    if (allowedPaths.some(path => location.pathname.startsWith(path))) {
      return <>{children}</>;
    }

    return <Navigate to={redirectTo} state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
