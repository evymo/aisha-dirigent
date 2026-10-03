import type { SupportedLocale } from "@/hooks/useDynamicTranslations";

export type LocalizedText = Partial<Record<SupportedLocale, string>>;

export interface ProductFormData {
  name: LocalizedText;
  description: LocalizedText;
  short_description: LocalizedText;
  base_locale: SupportedLocale;
  slug: string;
  price: string;
  compare_at_price: string;
  category: string;
  image_url: string;
  in_stock: boolean;
  stock_quantity: string;
  doses_per_package: string;
  // Marketing content - simple texts
  badge: LocalizedText;
  tagline: LocalizedText;
  image_alt: LocalizedText;
  benefits_title: LocalizedText;
  composition_title: LocalizedText;
  usage_title: LocalizedText;
  // Marketing content - JSONB (stored as JSON string for editing)
  origin_content: string;
  benefits_content: string;
  substances_content: string;
  usage_content: string;
}

export const createEmptyLocalized = (locales: SupportedLocale[]): LocalizedText =>
  locales.reduce<LocalizedText>((acc, locale) => {
    acc[locale] = "";
    return acc;
  }, {});

export const createEmptyFormData = (
  locales: SupportedLocale[],
  baseLocale: SupportedLocale
): ProductFormData => ({
  name: createEmptyLocalized(locales),
  description: createEmptyLocalized(locales),
  short_description: createEmptyLocalized(locales),
  base_locale: baseLocale,
  slug: "",
  price: "",
  compare_at_price: "",
  category: "",
  image_url: "",
  in_stock: true,
  stock_quantity: "0",
  doses_per_package: "30",
  // Marketing content - simple texts
  badge: createEmptyLocalized(locales),
  tagline: createEmptyLocalized(locales),
  image_alt: createEmptyLocalized(locales),
  benefits_title: createEmptyLocalized(locales),
  composition_title: createEmptyLocalized(locales),
  usage_title: createEmptyLocalized(locales),
  // Marketing content - JSONB as string
  origin_content: "",
  benefits_content: "",
  substances_content: "",
  usage_content: "",
});

export const ensureLocalizedLocales = (
  values: LocalizedText,
  locales: SupportedLocale[]
): LocalizedText => {
  const next = { ...values };
  locales.forEach((locale) => {
    if (next[locale] === undefined) next[locale] = "";
  });
  return next;
};

export const KEY_PATTERN = /^[a-z0-9_.:-]+$/i;

export const looksLikeTranslationKey = (value: string) =>
  value.startsWith("products.") && KEY_PATTERN.test(value);

export const collectTranslationKeys = (value: unknown, keys: Set<string>) => {
  if (typeof value === "string") {
    if (looksLikeTranslationKey(value)) {
      keys.add(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectTranslationKeys(item, keys));
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) =>
      collectTranslationKeys(item, keys)
    );
  }
};

export const safeParseJson = (raw: string): unknown | null => {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};
