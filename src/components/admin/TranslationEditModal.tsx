/**
 * TranslationEditModal — Dialog for editing all locale translations of a single field.
 *
 * Opens a modal with one input/textarea per supported locale. Shows locale
 * flags, labels, and current values. Allows batch editing and saving all
 * translations at once.
 *
 * @example
 * <TranslationEditModal
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   fieldLabel="Product Name"
 *   values={nameValues}
 *   onChange={handleChange}
 *   locales={activeLocales}
 * />
 */

import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { LocaleFlag } from "@/components/common/LocaleFlag";
import { getTranslationStatus, type TranslationStatus } from "./translationStatusUtils";
import { Check, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LocaleCode } from "@/hooks/useDynamicTranslations";
import { LOCALE_LABELS } from "@/hooks/useDynamicTranslations";
import { useState, useCallback, useEffect } from "react";

interface TranslationEditModalProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback to toggle open state */
  onOpenChange: (open: boolean) => void;
  /** Human-readable label for the field being edited */
  fieldLabel: string;
  /** Current values per locale */
  values: Partial<Record<LocaleCode, string>>;
  /** Callback when values change — receives locale + new value */
  onChange: (locale: LocaleCode, value: string) => void;
  /** Available locales to show */
  locales: LocaleCode[];
  /** Optional locale display labels */
  localeLabels?: Record<LocaleCode, string>;
  /** Use textarea instead of input */
  multiline?: boolean;
  /** Number of rows for textarea */
  rows?: number;
  /** The base/reference locale (shown first with a visual indicator) */
  baseLocale?: LocaleCode;
}

const STATUS_ICON_MAP: Record<TranslationStatus, typeof Check> = {
  filled: Check,
  missing: X,
  outdated: AlertTriangle,
};

const STATUS_DOT: Record<TranslationStatus, string> = {
  filled: "text-green-500",
  missing: "text-red-500",
  outdated: "text-yellow-500",
};

export function TranslationEditModal({
  open,
  onOpenChange,
  fieldLabel,
  values,
  onChange,
  locales,
  localeLabels,
  multiline = false,
  rows = 3,
  baseLocale,
}: TranslationEditModalProps) {
  const { t } = useTranslation();
  const labels = localeLabels ?? LOCALE_LABELS;

  // Local draft state to allow batch editing before confirming
  const [draft, setDraft] = useState<Partial<Record<LocaleCode, string>>>({});

  // Sync draft from parent values when modal opens
  useEffect(() => {
    if (open) {
      setDraft({ ...values });
    }
  }, [open, values]);

  const handleDraftChange = useCallback(
    (locale: LocaleCode, value: string) => {
      setDraft((prev) => ({ ...prev, [locale]: value }));
    },
    [],
  );

  const handleSave = useCallback(() => {
    // Push all draft changes to parent
    for (const locale of locales) {
      const draftVal = draft[locale] ?? "";
      const currentVal = values[locale] ?? "";
      if (draftVal !== currentVal) {
        onChange(locale, draftVal);
      }
    }
    onOpenChange(false);
  }, [draft, values, locales, onChange, onOpenChange]);

  const handleCancel = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  // Sort locales: baseLocale first, then rest alphabetically
  const sortedLocales = [...locales].sort((a, b) => {
    if (a === baseLocale) return -1;
    if (b === baseLocale) return 1;
    return a.localeCompare(b);
  });

  const InputComponent = multiline ? Textarea : Input;

  const filledCount = locales.filter(
    (l) => getTranslationStatus(draft[l]) === "filled",
  ).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t("admin.translations.editModal.title")}
            <span className="text-sm font-normal text-muted-foreground">
              — {fieldLabel}
            </span>
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            {t("admin.translations.editModal.subtitle", {
              filled: filledCount,
              total: locales.length,
            })}
          </p>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {sortedLocales.map((locale) => {
            const val = draft[locale] ?? "";
            const status = getTranslationStatus(val);
            const StatusIcon = STATUS_ICON_MAP[status];
            const isBase = locale === baseLocale;

            return (
              <div key={locale} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <LocaleFlag code={locale} size="sm" />
                  <Label
                    htmlFor={`modal-${locale}`}
                    className={cn(
                      "text-sm",
                      isBase && "font-semibold",
                    )}
                  >
                    {labels[locale] ?? locale.toUpperCase()}
                    {isBase && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({t("admin.translations.editModal.baseLocale")})
                      </span>
                    )}
                  </Label>
                  <StatusIcon
                    className={cn("h-3.5 w-3.5 ml-auto", STATUS_DOT[status])}
                  />
                </div>
                <InputComponent
                  id={`modal-${locale}`}
                  value={val}
                  onChange={(e) => handleDraftChange(locale, e.target.value)}
                  className={cn(
                    "text-sm",
                    isBase && "ring-1 ring-primary/30",
                  )}
                  {...(multiline && { rows })}
                />
              </div>
            );
          })}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={handleCancel}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={handleSave}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
