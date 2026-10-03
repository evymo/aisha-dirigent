import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "platform_beta_banner_dismissed";

/**
 * Trial/beta overlay that covers the header/navigation area.
 *
 * Positioned as a fixed overlay above the header (z-60 &gt; header z-50),
 * blocking navigation until explicitly dismissed. Page content below the
 * header remains visible and scrollable.
 *
 * Dismissal is persisted in localStorage so the overlay stays hidden
 * across page reloads.
 */
export function BetaBanner() {
  const { t } = useTranslation();

  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore storage errors
    }
  }, []);

  if (dismissed) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[60] bg-amber-500/95 dark:bg-amber-700/95 backdrop-blur-sm text-white shadow-lg"
      style={{ height: "var(--header-height, 4.5rem)" }}
      role="alert"
    >
      <div className="container mx-auto flex h-full items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-3 min-w-0">
          <AlertTriangle className="h-5 w-5 shrink-0 text-white/90" />
          <span className="text-sm sm:text-base font-medium leading-tight">
            {t("betaBanner.message")}
          </span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleDismiss}
          className="shrink-0 h-8 px-3 text-xs font-semibold bg-white/20 hover:bg-white/30 text-white border border-white/30 rounded-full"
          aria-label={t("betaBanner.dismiss")}
        >
          <span className="mr-1">{t("betaBanner.dismiss")}</span>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
