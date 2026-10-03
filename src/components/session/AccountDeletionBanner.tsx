import { useTranslation } from "react-i18next";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { AlertTriangle, X } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { useSession } from "@/hooks/useSession";
import { useAccountDeletion } from "@/hooks/useAccountDeletion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * Global banner displayed when user has a pending account deletion request.
 * Shows scheduled deletion date, days remaining, and one-click cancel button.
 *
 * Placed in RootLayout alongside TermsConsentGate.
 */
export function AccountDeletionBanner() {
  const { user } = useSession();
  const { t, i18n } = useTranslation();
  const {
    pendingRequest,
    isLoading,
    cancelDeletion,
    isCancelling,
  } = useAccountDeletion();

  // Only show for authenticated users with pending request
  if (!user || isLoading || !pendingRequest) {
    return null;
  }

  const scheduledDate = new Date(pendingRequest.scheduled_deletion_at);
  const daysLeft = Math.max(0, differenceInDays(scheduledDate, new Date()));
  const locale = getDateFnsLocale(i18n.language);
  const formattedDate = format(scheduledDate, "PPP", { locale });

  const handleCancel = async () => {
    try {
      await cancelDeletion();
    } catch {
      // Error handled by hook toast
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 pointer-events-none">
      <Alert
        variant="destructive"
        className="max-w-2xl mx-auto shadow-lg border-2 pointer-events-auto"
      >
        <AlertTriangle className="h-5 w-5" />
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 w-full">
          <div className="flex-1">
            <AlertTitle className="text-base font-semibold">
              {t("legal.accountDeletion.banner.title")}
            </AlertTitle>
            <AlertDescription className="mt-1">
              {t("legal.accountDeletion.banner.message", { date: formattedDate })}
              {" "}
              <span className="font-semibold">
                {t("legal.accountDeletion.banner.daysRemaining", { count: daysLeft })}
              </span>
            </AlertDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCancel}
            disabled={isCancelling}
            className="shrink-0 border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
          >
            {isCancelling
              ? t("legal.accountDeletion.banner.cancelling")
              : t("legal.accountDeletion.banner.cancelRequest")}
          </Button>
        </div>
      </Alert>
    </div>
  );
}
