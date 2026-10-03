import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { getAccountUrl, getUser as getKcUser } from "@/integrations/auth";
import { Header } from "@/components/layout/Header";
import { safeError } from "@/lib/security/safeLogger";

/**
 * ChangePassword — redirects to Keycloak account console (password section).
 *
 * With KC as the sole auth provider all credential management (password change,
 * MFA, account linking) happens in the KC account console. This page is kept
 * as a thin redirect so existing /change-password links keep working.
 */
export default function ChangePassword() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const user = await getKcUser();

        if (!user) {
          if (!cancelled) navigate("/auth", { replace: true });
          return;
        }

        // Redirect browser to KC account console → password section
        window.location.href = getAccountUrl("password");
      } catch (error) {
        safeError("ChangePassword.redirect", error);
        if (!cancelled) navigate("/auth", { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="flex items-center justify-center pt-32">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-muted-foreground">{t("common.redirecting")}</p>
        </div>
      </div>
    </div>
  );
}

