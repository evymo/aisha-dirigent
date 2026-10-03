/* eslint-disable react-refresh/only-export-components -- getLocaleLabel utility intentionally co-located */
/**
 * LocaleFlag — Accessible locale indicator component.
 *
 * Replaces emoji flags (GB CZ DE FR RU TH) with clean text-based
 * locale tags. Works consistently across all platforms and screen readers.
 *
 * @example
 * <LocaleFlag code="cs" />           // renders "CS" badge
 * <LocaleFlag code="en" size="lg" /> // renders larger "EN" badge
 */

import { cn } from "@/lib/utils";

const LOCALE_DISPLAY: Record<string, string> = {
  en: "EN",
  cs: "CS",
  de: "DE",
  fr: "FR",
  ru: "RU",
  th: "TH",
};

interface LocaleFlagProps {
  /** ISO 639-1 language code */
  code: string;
  /** Visual size variant */
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function LocaleFlag({ code, size = "md", className }: LocaleFlagProps) {
  const label = LOCALE_DISPLAY[code] ?? code.toUpperCase();

  const sizeClasses = {
    sm: "text-[10px] px-1 py-0.5 min-w-[22px]",
    md: "text-xs px-1.5 py-0.5 min-w-[26px]",
    lg: "text-sm px-2 py-1 min-w-[30px]",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded font-semibold leading-none",
        "bg-muted text-muted-foreground border border-border/50",
        sizeClasses[size],
        className,
      )}
      aria-label={code}
    >
      {label}
    </span>
  );
}

/**
 * Get text label for a locale code (replaces emoji flag maps).
 */
export function getLocaleLabel(code: string): string {
  return LOCALE_DISPLAY[code] ?? code.toUpperCase();
}
