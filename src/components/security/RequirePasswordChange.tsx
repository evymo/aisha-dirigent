import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMustChangePassword } from "@/hooks/useMustChangePassword";
import { useRequestPasswordChange } from "@/hooks/useRequestPasswordChange";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ShieldAlert, Mail, Loader2 } from "lucide-react";

/**
 * RequirePasswordChange - Wrapper that enforces password change for flagged users
 * 
 * SECURITY: Users with must_change_password=true are blocked from accessing
 * protected content until they change their password via email verification.
 * 
 * This is used for:
 * - Default admin accounts
 * - Accounts flagged after security incidents
 * - Password rotation enforcement
 */
export function RequirePasswordChange({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const location = useLocation();
  const { mustChangePassword, isLoading } = useMustChangePassword();
  const { requestPasswordChange, isLoading: isRequesting, isSuccess } = useRequestPasswordChange();

  // Allow access to password change pages
  const allowedPaths = ["/change-password", "/auth", "/set-password"];
  const isAllowedPath = allowedPaths.some(path => location.pathname.startsWith(path));

  // If on allowed path, render children
  if (isAllowedPath) {
    return <>{children}</>;
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/30">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-muted-foreground">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  // If password change required, show the enforcement UI
  if (mustChangePassword) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/30 p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <div className="flex items-center gap-2 text-destructive mb-2">
              <ShieldAlert className="h-6 w-6" />
              <CardTitle>{t("security.mustChangePassword.title")}</CardTitle>
            </div>
            <CardDescription>
              {t("security.mustChangePassword.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertDescription>
                {t("security.mustChangePassword.warning")}
              </AlertDescription>
            </Alert>

            {isSuccess ? (
              <Alert>
                <Mail className="h-4 w-4" />
                <AlertDescription>
                  {t("auth.passwordReset.checkEmail")}
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {t("security.mustChangePassword.instructions")}
                </p>
                <Button 
                  onClick={() => requestPasswordChange()} 
                  disabled={isRequesting}
                  className="w-full"
                >
                  {isRequesting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t("common.processing")}
                    </>
                  ) : (
                    <>
                      <Mail className="mr-2 h-4 w-4" />
                      {t("security.mustChangePassword.sendEmail")}
                    </>
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Password change not required, render children
  return <>{children}</>;
}
