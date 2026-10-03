/**
 * LocalizedFieldEditor — Single-locale editor with translation status badges.
 *
 * Renders a single input/textarea for the selected primary locale.
 * Below the input, compact status badges for all OTHER locales show
 * whether translations are filled, missing, or outdated. Hovering
 * shows a tooltip with the current value; clicking opens a modal
 * to edit ALL locales at once.
 *
 * @example
 * <LocalizedFieldEditor
 *   label="Product Name"
 *   fieldId="product-name"
 *   value={nameValues}
 *   onChange={(locale, val) => handleChange("name", locale, val)}
 *   primaryLocale="en"
 *   locales={activeLocales}
 * />
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SUPPORTED_LOCALES, LOCALE_LABELS, type SupportedLocale } from "@/hooks/useDynamicTranslations";
import { LocaleFlag } from "@/components/common/LocaleFlag";
import { TranslationStatusBadge } from "./TranslationStatusBadge";
import { getTranslationStatus } from "./translationStatusUtils";
import { TranslationEditModal } from "./TranslationEditModal";

interface LocalizedFieldEditorProps {
  /** Field label */
  label: string;
  /** Unique identifier for form elements */
  fieldId: string;
  /** Values for each locale */
  value: Partial<Record<SupportedLocale, string>>;
  /** Callback when any locale value changes */
  onChange: (locale: SupportedLocale, newValue: string) => void;
  /** Currently selected primary (editing) locale */
  primaryLocale: SupportedLocale;
  /** Allowed locales for selection */
  locales?: SupportedLocale[];
  /** Optional labels for locales */
  localeLabels?: Record<SupportedLocale, string>;
  /** Use textarea instead of input */
  multiline?: boolean;
  /** Number of rows for textarea */
  rows?: number;
  /** Whether the field is required */
  required?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** The base/reference locale of the entity (shown as reference in modal) */
  baseLocale?: SupportedLocale;

  // --- Legacy dual-column props (kept for backward compatibility) ---
  /** @deprecated Use primaryLocale instead */
  sourceLocale?: SupportedLocale;
  /** @deprecated Use primaryLocale instead */
  targetLocale?: SupportedLocale;
  /** @deprecated No longer needed */
  onSourceLocaleChange?: (locale: SupportedLocale) => void;
  /** @deprecated No longer needed */
  onTargetLocaleChange?: (locale: SupportedLocale) => void;
}

export function LocalizedFieldEditor({
  label,
  fieldId,
  value,
  onChange,
  primaryLocale,
  locales,
  localeLabels,
  multiline = false,
  rows = 4,
  required = false,
  placeholder,
  baseLocale,
  // Legacy props — primaryLocale takes precedence
  sourceLocale,
  targetLocale: _targetLocale,
  onSourceLocaleChange: _onSourceLocaleChange,
  onTargetLocaleChange: _onTargetLocaleChange,
}: LocalizedFieldEditorProps) {
  const { t } = useTranslation();
  const [modalOpen, setModalOpen] = useState(false);

  // Resolve the effective primary locale (new prop wins over legacy)
  const effectivePrimary = primaryLocale ?? sourceLocale ?? "en";
  const effectiveBase = baseLocale ?? effectivePrimary;

  const availableLocales = locales && locales.length > 0 ? locales : [...SUPPORTED_LOCALES];
  const labels = localeLabels ?? LOCALE_LABELS;

  const primaryValue = value[effectivePrimary] ?? "";
  const otherLocales = availableLocales.filter((l) => l !== effectivePrimary);

  const InputComponent = multiline ? Textarea : Input;

  // Summary counts for the badge row
  const filledCount = otherLocales.filter(
    (l) => getTranslationStatus(value[l]) === "filled",
  ).length;
  const totalOther = otherLocales.length;

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor={`${fieldId}-primary`}>
            {label}
            {required && " *"}
          </Label>
          <LocaleFlag code={effectivePrimary} size="sm" />
          {totalOther > 0 && (
            <span className="text-[10px] text-muted-foreground ml-auto">
              {t("admin.translations.status.summary", {
                filled: filledCount,
                total: totalOther,
              })}
            </span>
          )}
        </div>

        <InputComponent
          id={`${fieldId}-primary`}
          value={primaryValue}
          onChange={(e) => onChange(effectivePrimary, e.target.value)}
          placeholder={placeholder}
          required={required}
          {...(multiline && { rows })}
        />

        {/* Translation status badges for other locales */}
        {otherLocales.length > 0 && (
          <TooltipProvider delayDuration={200}>
            <div className="flex flex-wrap items-center gap-1 pt-0.5">
              {otherLocales.map((locale) => {
                const localeValue = value[locale] ?? "";
                const status = getTranslationStatus(localeValue);

                return (
                  <TranslationStatusBadge
                    key={locale}
                    locale={locale}
                    value={localeValue}
                    status={status}
                    onClick={() => setModalOpen(true)}
                  />
                );
              })}
            </div>
          </TooltipProvider>
        )}
      </div>

      {/* Modal for editing all translations at once */}
      <TranslationEditModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        fieldLabel={label}
        values={value}
        // The modal is keyed by LocaleCode so the page builder can drive it with
        // DB locales; this editor is still union-typed because its callers hold
        // `SupportedLocale` form state. Narrowing back is sound here — the modal
        // only ever emits a locale we handed it in `locales`.
        onChange={(locale, newValue) => onChange(locale as SupportedLocale, newValue)}
        locales={availableLocales}
        localeLabels={labels}
        multiline={multiline}
        rows={rows}
        baseLocale={effectiveBase}
      />
    </>
  );
}
