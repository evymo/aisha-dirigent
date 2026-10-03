import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

const CONSENT_KEY = "platform_data_consent_accepted";
const REDIRECT_URL = "https://cs.wikipedia.org/wiki/RTN";

/**
 * Banner informing users that the platform collects anonymized data
 * for internal analysis only — no data is sent to third parties.
 *
 * - **Accept**: stores consent in localStorage, banner disappears.
 * - **Decline**: redirects to an external informational page.
 *
 * Renders as a fixed overlay at the bottom of the viewport so it
 * does not shift layout and stays visible until the user decides.
 */
export function DataConsentBanner() {
  const { t } = useTranslation();

  const [accepted, setAccepted] = useState(() => {
    try {
      return localStorage.getItem(CONSENT_KEY) === "1";
    } catch {
      return false;
    }
  });

  const handleAccept = useCallback(() => {
    setAccepted(true);
    try {
      localStorage.setItem(CONSENT_KEY, "1");
    } catch {
      // ignore storage errors (private mode, quota, etc.)
    }
  }, []);

  const handleDecline = useCallback(() => {
    // external redirect — intentional full page navigation
    window.location.href = REDIRECT_URL; // external
  }, []);

  if (accepted) return null;

  return (
    <div
      role="dialog"
      aria-label={t("dataConsent.accept")}
      className="fixed inset-x-0 bottom-0 z-[70] border-t border-primary/20 bg-background/95 backdrop-blur-sm shadow-lg"
    >
      <div className="container mx-auto flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        {/* Message section */}
        <div className="flex items-start gap-3 min-w-0">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="space-y-1 text-sm">
            <p>{t("dataConsent.message")}</p>
            <p className="text-xs text-muted-foreground">
              {t("dataConsent.privacyNote")}
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDecline}
            className="text-xs text-muted-foreground hover:text-destructive"
          >
            <ExternalLink className="mr-1 h-3.5 w-3.5" />
            {t("dataConsent.decline")}
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleAccept}
          >
            {t("dataConsent.accept")}
          </Button>
        </div>
      </div>
    </div>
  );
}
