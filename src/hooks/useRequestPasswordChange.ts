import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { getAccountUrl, getUser as getKcUser } from "@/integrations/auth";
import { safeError } from "@/lib/security/safeLogger";

/**
 * Hook for requesting password change via Keycloak account console.
 *
 * Logged-in users are redirected to the KC account console password section.
 * If no user is signed in the hook shows an error toast — unauthenticated
 * users should use the "Forgot password" link on the KC login page instead.
 */
export function useRequestPasswordChange() {
  const { t } = useTranslation();

  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const requestPasswordChange = async (_email?: string) => {
    setIsLoading(true);
    setIsSuccess(false);

    try {
      const user = await getKcUser();

      if (!user) {
        toast.error(t("auth.errors.noEmail"), {
          description: t("auth.errors.noEmailDesc"),
        });
        return { ok: false };
      }

      // Redirect to Keycloak account console — password section
      window.location.href = getAccountUrl("password");

      setIsSuccess(true);
      return { ok: true };
    } catch (error) {
      safeError("useRequestPasswordChange", error);
      toast.error(t("auth.errors.passwordResetFailed"), {
        description: t("auth.errors.tryAgain"),
      });
      return { ok: false };
    } finally {
      setIsLoading(false);
    }
  };

  return {
    requestPasswordChange,
    isLoading,
    isSuccess,
  };
}
