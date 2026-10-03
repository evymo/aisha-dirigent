import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type SupportedLocale,
  LOCALE_LABELS,
} from "@/hooks/useDynamicTranslations";
import type { ProductAdmin } from "@/hooks/useAdminProducts";
import { LocalizedFieldEditor } from "@/components/admin/LocalizedFieldEditor";
import { MarketingContentEditor } from "@/components/admin/MarketingContentEditor";
import type { LocalizedText, ProductFormData } from "./productFormTypes";

interface ProductMarketingFieldsProps {
  activeLocales: SupportedLocale[];
  editingProduct: ProductAdmin | null;
  formData: Pick<
    ProductFormData,
    | "badge"
    | "base_locale"
    | "benefits_content"
    | "benefits_title"
    | "composition_title"
    | "image_alt"
    | "origin_content"
    | "substances_content"
    | "tagline"
    | "usage_content"
    | "usage_title"
  >;
  jsonKeyTranslations: Record<string, LocalizedText>;
  jsonTranslationKeys: string[];
  localeLabels: Record<SupportedLocale, string>;
  onJsonContentChange: (
    field: "benefits_content" | "origin_content" | "substances_content" | "usage_content",
    value: string,
  ) => void;
  onJsonKeyTranslationsChange: React.Dispatch<
    React.SetStateAction<Record<string, LocalizedText>>
  >;
  onLocalizedChange: (
    field: "badge" | "benefits_title" | "composition_title" | "image_alt" | "tagline" | "usage_title",
    locale: SupportedLocale,
    value: string,
  ) => void;
  primaryLocale: SupportedLocale;
  selectedJsonKey: string | null;
  setSelectedJsonKey: (key: string | null) => void;
}

export function ProductMarketingFields({
  activeLocales,
  editingProduct,
  formData,
  jsonKeyTranslations,
  jsonTranslationKeys,
  localeLabels,
  onJsonContentChange,
  onJsonKeyTranslationsChange,
  onLocalizedChange,
  primaryLocale,
  selectedJsonKey,
  setSelectedJsonKey,
}: ProductMarketingFieldsProps) {
  const { t } = useTranslation();

  return (
    <>
      <div className="border-t pt-6 space-y-6">
        <h3 className="text-lg font-semibold">{t("admin.products.form.marketingContent")}</h3>

        <LocalizedFieldEditor
          label={t("admin.products.form.badge")}
          fieldId="product-badge"
          value={formData.badge}
          onChange={(locale, value) => onLocalizedChange("badge", locale, value)}
          primaryLocale={primaryLocale}
          baseLocale={formData.base_locale}
          locales={activeLocales}
          localeLabels={localeLabels}
        />

        <LocalizedFieldEditor
          label={t("admin.products.form.tagline")}
          fieldId="product-tagline"
          value={formData.tagline}
          onChange={(locale, value) => onLocalizedChange("tagline", locale, value)}
          primaryLocale={primaryLocale}
          baseLocale={formData.base_locale}
          locales={activeLocales}
          localeLabels={localeLabels}
        />

        <LocalizedFieldEditor
          label={t("admin.products.form.imageAlt")}
          fieldId="product-image-alt"
          value={formData.image_alt}
          onChange={(locale, value) => onLocalizedChange("image_alt", locale, value)}
          primaryLocale={primaryLocale}
          baseLocale={formData.base_locale}
          locales={activeLocales}
          localeLabels={localeLabels}
        />

        <div className="grid grid-cols-3 gap-4">
          <LocalizedFieldEditor
            label={t("admin.products.form.benefitsTitle")}
            fieldId="product-benefits-title"
            value={formData.benefits_title}
            onChange={(locale, value) => onLocalizedChange("benefits_title", locale, value)}
            primaryLocale={primaryLocale}
            baseLocale={formData.base_locale}
            locales={activeLocales}
            localeLabels={localeLabels}
          />
          <LocalizedFieldEditor
            label={t("admin.products.form.compositionTitle")}
            fieldId="product-composition-title"
            value={formData.composition_title}
            onChange={(locale, value) => onLocalizedChange("composition_title", locale, value)}
            primaryLocale={primaryLocale}
            baseLocale={formData.base_locale}
            locales={activeLocales}
            localeLabels={localeLabels}
          />
          <LocalizedFieldEditor
            label={t("admin.products.form.usageTitle")}
            fieldId="product-usage-title"
            value={formData.usage_title}
            onChange={(locale, value) => onLocalizedChange("usage_title", locale, value)}
            primaryLocale={primaryLocale}
            baseLocale={formData.base_locale}
            locales={activeLocales}
            localeLabels={localeLabels}
          />
        </div>

        {/* JSONB Content Fields */}
        <div className="space-y-6">
          <h4 className="text-sm font-medium text-muted-foreground">{t("admin.products.form.structuredContent")}</h4>

          <MarketingContentEditor
            label={t("admin.products.form.originContent")}
            value={formData.origin_content}
            onChange={(value) => onJsonContentChange("origin_content", value)}
            primaryLocale={primaryLocale}
            baseLocale={formData.base_locale}
            locales={activeLocales}
            localeLabels={LOCALE_LABELS}
          />

          <MarketingContentEditor
            label={t("admin.products.form.benefitsContent")}
            value={formData.benefits_content}
            onChange={(value) => onJsonContentChange("benefits_content", value)}
            primaryLocale={primaryLocale}
            baseLocale={formData.base_locale}
            locales={activeLocales}
            localeLabels={LOCALE_LABELS}
          />

          <MarketingContentEditor
            label={t("admin.products.form.substancesContent")}
            value={formData.substances_content}
            onChange={(value) => onJsonContentChange("substances_content", value)}
            primaryLocale={primaryLocale}
            baseLocale={formData.base_locale}
            locales={activeLocales}
            localeLabels={LOCALE_LABELS}
          />

          <MarketingContentEditor
            label={t("admin.products.form.usageContent")}
            value={formData.usage_content}
            onChange={(value) => onJsonContentChange("usage_content", value)}
            primaryLocale={primaryLocale}
            baseLocale={formData.base_locale}
            locales={activeLocales}
            localeLabels={LOCALE_LABELS}
          />
        </div>

        {/* JSON translation keys editor */}
        {jsonTranslationKeys.length > 0 && (
          <div className="space-y-4 border rounded-md p-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">
                {t("admin.products.form.jsonTranslations")}
              </h4>
              <span className="text-xs text-muted-foreground">
                {t("admin.products.form.jsonTranslationsCount", { count: jsonTranslationKeys.length })}
              </span>
            </div>

            <div className="space-y-2">
              <Label>{t("admin.products.form.jsonKey")}</Label>
              <Select
                value={selectedJsonKey ?? undefined}
                onValueChange={(value) => setSelectedJsonKey(value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("admin.products.form.jsonKeyPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {jsonTranslationKeys.map((key) => (
                    <SelectItem key={key} value={key}>
                      {key}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedJsonKey && (
              <LocalizedFieldEditor
                label={t("admin.products.form.jsonKeyValue")}
                fieldId={`json-key-${selectedJsonKey}`}
                value={jsonKeyTranslations[selectedJsonKey] ?? {}}
                onChange={(locale, value) =>
                  onJsonKeyTranslationsChange((prev) => ({
                    ...prev,
                    [selectedJsonKey]: {
                      ...(prev[selectedJsonKey] ?? {}),
                      [locale]: value,
                    },
                  }))
                }
                primaryLocale={primaryLocale}
                baseLocale={formData.base_locale}
                locales={activeLocales}
                localeLabels={localeLabels}
                multiline
                rows={3}
              />
            )}

            <p className="text-xs text-muted-foreground">
              {t("admin.products.form.jsonTranslationsHint")}
            </p>
          </div>
        )}
      </div>

      {/* Translation keys info (read-only) */}
      {editingProduct?.name_key && (
        <div className="text-xs text-muted-foreground border-t pt-4">
          <p className="font-medium mb-1">
            {t("admin.products.form.translationKeys")}
          </p>
          <code className="block">base_locale: {formData.base_locale}</code>
          <code className="block">name: {editingProduct.name_key}</code>
          <code className="block">description: {editingProduct.description_key}</code>
          <code className="block">
            short_description: {editingProduct.short_description_key}
          </code>
          <code className="block">badge: {editingProduct.badge_key}</code>
          <code className="block">tagline: {editingProduct.tagline_key}</code>
          <code className="block">image_alt: {editingProduct.image_alt_key}</code>
          <code className="block">benefits_title: {editingProduct.benefits_title_key}</code>
          <code className="block">composition_title: {editingProduct.composition_title_key}</code>
          <code className="block">usage_title: {editingProduct.usage_title_key}</code>
        </div>
      )}
    </>
  );
}
