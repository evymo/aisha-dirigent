/**
 * Utility helpers for determining translation status.
 *
 * Extracted from TranslationStatusBadge to satisfy `react-refresh/only-export-components`.
 */

/** Translation completeness status. */
export type TranslationStatus = "filled" | "missing" | "outdated";

/**
 * Determine translation status from a value string.
 *
 * @param value - Translation text (may be empty/undefined)
 * @returns TranslationStatus
 */
export function getTranslationStatus(value: string | undefined | null): TranslationStatus {
  if (!value || value.trim().length === 0) return "missing";
  return "filled";
}
