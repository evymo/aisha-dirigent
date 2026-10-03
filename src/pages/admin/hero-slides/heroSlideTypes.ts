import type { SupportedLocale } from "@/hooks/useDynamicTranslations";
import { SUPPORTED_LOCALES } from "@/hooks/useDynamicTranslations";

export const TARGET_AUDIENCES = ["all", "kids", "athletes", "midlife", "seniors"];

export type LocalizedText = Partial<Record<SupportedLocale, string>>;

export const createEmptyLocalized = (
  locales: SupportedLocale[],
  defaultValue = ""
): LocalizedText =>
  locales.reduce<LocalizedText>((acc, locale) => {
    acc[locale] = defaultValue;
    return acc;
  }, {});

export const ensureLocalizedLocales = (
  values: LocalizedText,
  locales: SupportedLocale[],
  fallback = ""
): LocalizedText => {
  const next = { ...values };
  locales.forEach((locale) => {
    if (next[locale] === undefined) next[locale] = fallback;
  });
  return next;
};

export interface HeroSlideFormData {
  title: LocalizedText;
  subtitle: LocalizedText;
  badge: LocalizedText;
  cta_text: LocalizedText;
  circle_icon: LocalizedText;
  circle_text: LocalizedText;
  base_locale: SupportedLocale;
  target_audience: string;
  background_image_url: string;
  background_gradient: string;
  cta_url: string;
  linked_product_id: string | null;
  is_active: boolean;
  sort_order: number;
}

export const createEmptyFormData = (
  locales: SupportedLocale[],
  baseLocale: SupportedLocale
): HeroSlideFormData => ({
  title: createEmptyLocalized(locales),
  subtitle: createEmptyLocalized(locales),
  badge: createEmptyLocalized(locales),
  cta_text: createEmptyLocalized(locales),
  circle_icon: createEmptyLocalized(locales, "Sparkles"),
  circle_text: createEmptyLocalized(locales),
  base_locale: baseLocale,
  target_audience: "all",
  background_image_url: "",
  background_gradient: "",
  cta_url: "",
  linked_product_id: null,
  is_active: true,
  sort_order: 0,
});

export const isSupportedLocale = (code: string): code is SupportedLocale =>
  (SUPPORTED_LOCALES as readonly string[]).includes(code);
