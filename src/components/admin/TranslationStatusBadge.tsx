/**
 * TranslationStatusBadge — Inline locale badge showing translation status.
 *
 * Displays a colored locale code (CS, EN, DE…) indicating whether the
 * translation for that locale is filled, missing, or outdated. Shows a
 * tooltip with the current value on hover. Clicking opens the full
 * translation edit modal.
 *
 * @example
 * <TranslationStatusBadge
 *   locale="cs"
 *   value="Český překlad"
 *   status="filled"
 *   onClick={() => setModalOpen(true)}
 * />
 */

import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Check, AlertTriangle, X } from "lucide-react";
import type { LocaleCode } from "@/hooks/useDynamicTranslations";
import { LOCALE_LABELS } from "@/hooks/useDynamicTranslations";
import type { TranslationStatus } from "./translationStatusUtils";

export type { TranslationStatus };

interface TranslationStatusBadgeProps {
  /** ISO 639-1 locale code */
  locale: LocaleCode;
  /** Current translation value (shown in tooltip) */
  value: string;
  /** Computed status */
  status: TranslationStatus;
  /** Click handler (opens edit modal) */
  onClick?: () => void;
  /** Optional className override */
  className?: string;
}

const STATUS_STYLES: Record<TranslationStatus, string> = {
  filled: "border-green-500/60 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400 dark:border-green-500/40",
  missing: "border-red-500/60 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400 dark:border-red-500/40",
  outdated: "border-yellow-500/60 bg-yellow-50 text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-400 dark:border-yellow-500/40",
};

const STATUS_ICON_MAP: Record<TranslationStatus, typeof Check> = {
  filled: Check,
  missing: X,
  outdated: AlertTriangle,
};

export function TranslationStatusBadge({
  locale,
  value,
  status,
  onClick,
  className,
}: TranslationStatusBadgeProps) {
  const { t } = useTranslation();

  const StatusIcon = STATUS_ICON_MAP[status];
  const localeName = LOCALE_LABELS[locale] ?? locale.toUpperCase();

  const tooltipLabel =
    status === "missing"
      ? t("admin.translations.status.missingTooltip", { locale: localeName })
      : status === "outdated"
        ? t("admin.translations.status.outdatedTooltip", { locale: localeName })
        : value;

  // Truncate long values for tooltip display
  const displayValue =
    value.length > 120 ? `${value.slice(0, 120)}…` : value;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={cn(
            "inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5",
            "text-[10px] font-semibold leading-none cursor-pointer",
            "transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            STATUS_STYLES[status],
            className,
          )}
          aria-label={`${localeName}: ${status === "missing" ? t("admin.translations.status.missing") : status === "outdated" ? t("admin.translations.status.outdated") : t("admin.translations.status.filled")}`}
        >
          <StatusIcon className="h-2.5 w-2.5" />
          <span>{locale.toUpperCase()}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <p className="text-xs font-medium">{localeName}</p>
        {status === "missing" ? (
          <p className="text-xs text-muted-foreground italic">{tooltipLabel}</p>
        ) : (
          <p className="text-xs">{displayValue}</p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
