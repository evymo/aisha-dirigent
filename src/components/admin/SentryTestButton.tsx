import * as Sentry from "@sentry/react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/useSession";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertTriangle, SendHorizontal } from "lucide-react";

/**
 * Admin-only component for testing Sentry integration.
 * Allows sending test events and triggering test errors to verify Sentry is working.
 * 
 * Only visible in development mode OR to admin users.
 */
export function SentryTestButton() {
  const { t } = useTranslation();
  const { isAdmin } = useSession();
  const isDevelopment = import.meta.env.DEV;
  
  // Only show for admins or in development
  if (!isAdmin && !isDevelopment) return null;

  const sendTestEvent = () => {
    Sentry.captureMessage("Sentry Test Event - manual trigger from SentryTestButton", {
      level: "info",
      extra: { 
        source: "SentryTestButton",
        timestamp: new Date().toISOString(),
      },
    });
    
    toast.success(t("admin.sentryTest.eventSent"), {
      description: t("admin.sentryTest.eventSentDescription"),
    });
  };

  const triggerTestError = () => {
    // This error will be caught by the error boundary and reported to Sentry
    throw new Error("Sentry Test Error - intentional error from SentryTestButton");
  };

  return (
    <div className="flex flex-col sm:flex-row gap-2 p-4 border rounded-lg bg-muted/30">
      <div className="flex-1 text-sm text-muted-foreground mb-2 sm:mb-0">
        <p className="font-medium text-foreground">
          {t("admin.sentryTest.title")}
        </p>
        <p className="text-xs">
          {t("admin.sentryTest.description")}
        </p>
      </div>
      <div className="flex gap-2">
        <Button 
          variant="outline" 
          size="sm"
          onClick={sendTestEvent}
          className="gap-1"
        >
          <SendHorizontal className="h-4 w-4" />
          {t("admin.sentryTest.sendEvent")}
        </Button>
        <Button 
          variant="destructive" 
          size="sm"
          onClick={triggerTestError}
          className="gap-1"
        >
          <AlertTriangle className="h-4 w-4" />
          {t("admin.sentryTest.triggerError")}
        </Button>
      </div>
    </div>
  );
}

export default SentryTestButton;
