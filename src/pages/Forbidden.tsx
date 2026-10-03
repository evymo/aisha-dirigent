import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ShieldX } from "lucide-react";

/**
 * SOC 2 Compliant Access Denied Page
 * - Consistent error messaging
 * - No sensitive information exposure
 * - Clear next steps for user
 */
export default function Forbidden() {
  const { t } = useTranslation();
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="text-center space-y-4 max-w-md">
        <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
          <ShieldX className="w-8 h-8 text-destructive" />
        </div>
        <p className="text-sm font-semibold text-destructive">{t("errors.forbiddenCode")}</p>
        <h1 className="text-3xl font-bold text-foreground">
          {t('errors.accessDenied')}
        </h1>
        <p className="text-muted-foreground">
          {t('errors.accessDeniedDescription')}
        </p>
        <div className="flex items-center justify-center gap-3">
          <Button asChild variant="outline">
            <Link to="/">{t('common.backToHome')}</Link>
          </Button>
          <Button asChild>
            <Link to="/auth">{t('common.signIn')}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
