import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Upload, X, Loader2 } from "lucide-react";
import {
  useCreateProduct,
  useUpdateProduct,
  type ProductAdmin,
} from "@/hooks/useAdminProducts";
import { useProductImageUpload } from "@/hooks/useProductImageUpload";
import {
  useFetchTranslationsForKeys,
  useUpsertTranslations,
  type TranslationInput,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@/hooks/useDynamicTranslations";
import { LocalizedFieldEditor } from "@/components/admin/LocalizedFieldEditor";
import { safeError } from "@/lib/security/safeLogger";
import type { LocalizedText, ProductFormData } from "./productFormTypes";
import {
  createEmptyFormData,
  ensureLocalizedLocales,
  collectTranslationKeys,
  safeParseJson,
} from "./productFormTypes";
import { ProductMarketingFields } from "./ProductMarketingFields";

interface ProductFormDialogProps {
  activeLocales: SupportedLocale[];
  defaultLocale: SupportedLocale;
  editingProduct: ProductAdmin | null;
  localeLabels: Record<SupportedLocale, string>;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  open: boolean;
}

export function ProductFormDialog({
  activeLocales,
  defaultLocale,
  editingProduct,
  localeLabels,
  onOpenChange,
  onSuccess,
  open,
}: ProductFormDialogProps) {
  const { t } = useTranslation();

  const [formData, setFormData] = useState<ProductFormData>(
    createEmptyFormData([...SUPPORTED_LOCALES], "en")
  );
  const [primaryLocale, setPrimaryLocale] = useState<SupportedLocale>("en");
  const [jsonKeyTranslations, setJsonKeyTranslations] = useState<
    Record<string, LocalizedText>
  >({});
  const [selectedJsonKey, setSelectedJsonKey] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct();
  const upsertTranslations = useUpsertTranslations();
  const { mutateAsync: fetchTranslationsForKeys } = useFetchTranslationsForKeys();
  const { uploadImage } = useProductImageUpload();

  const isSupportedLocale = (code: string): code is SupportedLocale =>
    (SUPPORTED_LOCALES as readonly string[]).includes(code);

  const resetForm = () => {
    const baseLocale = activeLocales.includes(defaultLocale)
      ? defaultLocale
      : activeLocales[0] ?? "en";
    setFormData(createEmptyFormData(activeLocales, baseLocale));
    setJsonKeyTranslations({});
    setSelectedJsonKey(null);
  };

  // Sync locales when activeLocales changes
  useEffect(() => {
    if (activeLocales.length === 0) return;

    setFormData((prev) => ({
      ...prev,
      base_locale: activeLocales.includes(prev.base_locale)
        ? prev.base_locale
        : defaultLocale,
      name: ensureLocalizedLocales(prev.name, activeLocales),
      description: ensureLocalizedLocales(prev.description, activeLocales),
      short_description: ensureLocalizedLocales(prev.short_description, activeLocales),
      badge: ensureLocalizedLocales(prev.badge, activeLocales),
      tagline: ensureLocalizedLocales(prev.tagline, activeLocales),
      image_alt: ensureLocalizedLocales(prev.image_alt, activeLocales),
      benefits_title: ensureLocalizedLocales(prev.benefits_title, activeLocales),
      composition_title: ensureLocalizedLocales(prev.composition_title, activeLocales),
      usage_title: ensureLocalizedLocales(prev.usage_title, activeLocales),
    }));

    if (!activeLocales.includes(primaryLocale)) {
      setPrimaryLocale(activeLocales[0]);
    }
  }, [activeLocales, defaultLocale, primaryLocale]);

  // Load translations when editing a product
  useEffect(() => {
    if (!open) return;
    if (!editingProduct) {
      resetForm();
      return;
    }
    void loadProductTranslations(editingProduct);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadProductTranslations is a stable callback
  }, [editingProduct, open]);

  const loadProductTranslations = async (product: ProductAdmin) => {
    const baseLocale = isSupportedLocale(product.base_locale as string)
      ? (product.base_locale as SupportedLocale)
      : defaultLocale;
    const locales = activeLocales.length > 0 ? activeLocales : [...SUPPORTED_LOCALES];
    setPrimaryLocale(baseLocale);

    const newFormData: ProductFormData = {
      ...createEmptyFormData(locales, baseLocale),
      slug: product.slug,
      price: product.price.toString(),
      compare_at_price: product.compare_at_price?.toString() || "",
      category: product.category || "",
      image_url: product.image_url || "",
      in_stock: product.in_stock ?? true,
      stock_quantity: product.stock_quantity?.toString() || "0",
      doses_per_package: product.doses_per_package?.toString() || "30",
      origin_content: product.origin_content ? JSON.stringify(product.origin_content, null, 2) : "",
      benefits_content: product.benefits_content ? JSON.stringify(product.benefits_content, null, 2) : "",
      substances_content: product.substances_content ? JSON.stringify(product.substances_content, null, 2) : "",
      usage_content: product.usage_content ? JSON.stringify(product.usage_content, null, 2) : "",
    };

    const fieldKeys: Record<string, string | null | undefined> = {
      name: product.name_key,
      description: product.description_key,
      short_description: product.short_description_key,
      badge: product.badge_key,
      tagline: product.tagline_key,
      image_alt: product.image_alt_key,
      benefits_title: product.benefits_title_key,
      composition_title: product.composition_title_key,
      usage_title: product.usage_title_key,
    };

    const jsonKeys = new Set<string>();
    [product.origin_content, product.benefits_content, product.substances_content, product.usage_content]
      .filter(Boolean)
      .forEach((content) => collectTranslationKeys(content, jsonKeys));

    const keysToFetch = [
      ...Object.values(fieldKeys).filter((key): key is string => !!key && key.trim().length > 0),
      ...Array.from(jsonKeys),
    ];

    const translationsByKey: Record<string, LocalizedText> = {};

    if (keysToFetch.length > 0) {
      try {
        const rows = await fetchTranslationsForKeys({
          keys: keysToFetch,
          namespace: "products",
        });

        for (const row of rows) {
          if (!translationsByKey[row.key]) {
            translationsByKey[row.key] = {};
          }
          translationsByKey[row.key][row.locale] = row.value;
        }
      } catch (error) {
        safeError("admin.products.loadTranslationsFailed", error);
      }
    }

    locales.forEach((locale) => {
      const keys: Array<{ field: keyof ProductFormData; keyName: string }> = [
        { field: "name", keyName: "name" },
        { field: "description", keyName: "description" },
        { field: "short_description", keyName: "short_description" },
        { field: "badge", keyName: "badge" },
        { field: "tagline", keyName: "tagline" },
        { field: "image_alt", keyName: "image_alt" },
        { field: "benefits_title", keyName: "benefits_title" },
        { field: "composition_title", keyName: "composition_title" },
        { field: "usage_title", keyName: "usage_title" },
      ];
      keys.forEach(({ field, keyName }) => {
        const key = fieldKeys[keyName];
        if (key && translationsByKey[key]?.[locale]) {
          (newFormData[field] as LocalizedText)[locale] = translationsByKey[key][locale] ?? "";
        }
      });
    });

    if (baseLocale && isSupportedLocale(baseLocale)) {
      newFormData.name[baseLocale] ||= product.name;
      newFormData.description[baseLocale] ||= product.description || "";
      newFormData.short_description[baseLocale] ||= product.short_description || "";
    }

    const nextJsonTranslations: Record<string, LocalizedText> = {};
    Array.from(jsonKeys).forEach((key) => {
      nextJsonTranslations[key] = ensureLocalizedLocales(
        translationsByKey[key] ?? {},
        locales
      );
    });

    setJsonKeyTranslations(nextJsonTranslations);
    setSelectedJsonKey(Array.from(jsonKeys)[0] ?? null);
    setFormData(newFormData);
  };

  const handlePrimaryLocaleChange = (locale: SupportedLocale) => {
    setPrimaryLocale(locale);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const url = await uploadImage(file);
      setFormData((prev) => ({ ...prev, image_url: url }));
    } catch {
      // Error already handled by hook
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleRemoveImage = () => {
    setFormData((prev) => ({ ...prev, image_url: "" }));
  };

  const handleLocalizedChange = (
    field: "name" | "description" | "short_description" | "badge" | "tagline" | "image_alt" | "benefits_title" | "composition_title" | "usage_title",
    locale: SupportedLocale,
    value: string
  ) => {
    setFormData((prev) => ({
      ...prev,
      [field]: {
        ...prev[field],
        [locale]: value,
      },
    }));
  };

  const handleJsonContentChange = (
    field: "origin_content" | "benefits_content" | "substances_content" | "usage_content",
    value: string
  ) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const jsonTranslationKeys = useMemo(() => {
    const keys = new Set<string>();
    const origin = safeParseJson(formData.origin_content);
    const benefits = safeParseJson(formData.benefits_content);
    const substances = safeParseJson(formData.substances_content);
    const usage = safeParseJson(formData.usage_content);
    [origin, benefits, substances, usage].forEach((content) =>
      collectTranslationKeys(content, keys)
    );
    return Array.from(keys).sort();
  }, [
    formData.origin_content,
    formData.benefits_content,
    formData.substances_content,
    formData.usage_content,
  ]);

  useEffect(() => {
    if (jsonTranslationKeys.length === 0) {
      setSelectedJsonKey(null);
      return;
    }

    setJsonKeyTranslations((prev) => {
      const next: Record<string, LocalizedText> = {};
      jsonTranslationKeys.forEach((key) => {
        next[key] = ensureLocalizedLocales(prev[key] ?? {}, activeLocales);
      });
      return next;
    });

    if (!selectedJsonKey || !jsonTranslationKeys.includes(selectedJsonKey)) {
      setSelectedJsonKey(jsonTranslationKeys[0]);
    }
  }, [jsonTranslationKeys, activeLocales, selectedJsonKey]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const slug = formData.slug.trim();
    if (!slug) {
      toast.error(t("admin.products.errors.createFailed"));
      return;
    }

    const dosesPerPackage = parseInt(formData.doses_per_package);
    if (!Number.isFinite(dosesPerPackage) || dosesPerPackage <= 0) {
      toast.error(t("admin.products.errors.invalidDosesPerPackage"));
      return;
    }

    try {
      const locales = activeLocales.length > 0 ? activeLocales : [...SUPPORTED_LOCALES];
      const baseLocale = locales.includes(formData.base_locale)
        ? formData.base_locale
        : defaultLocale;
      const keyPrefix = `products.${slug}`;

      const existingKeys = editingProduct
        ? {
            name: editingProduct.name_key,
            description: editingProduct.description_key,
            short_description: editingProduct.short_description_key,
            badge: editingProduct.badge_key,
            tagline: editingProduct.tagline_key,
            image_alt: editingProduct.image_alt_key,
            benefits_title: editingProduct.benefits_title_key,
            composition_title: editingProduct.composition_title_key,
            usage_title: editingProduct.usage_title_key,
          }
        : {};

      const resolveKey = (field: string, existing?: string | null) =>
        existing && existing.trim().length > 0 ? existing : `${keyPrefix}.${field}`;

      const nameKey = resolveKey("name", existingKeys.name);
      const descriptionKey = resolveKey("description", existingKeys.description);
      const shortDescriptionKey = resolveKey("short_description", existingKeys.short_description);
      const badgeKey = resolveKey("badge", existingKeys.badge);
      const taglineKey = resolveKey("tagline", existingKeys.tagline);
      const imageAltKey = resolveKey("image_alt", existingKeys.image_alt);
      const benefitsTitleKey = resolveKey("benefits_title", existingKeys.benefits_title);
      const compositionTitleKey = resolveKey("composition_title", existingKeys.composition_title);
      const usageTitleKey = resolveKey("usage_title", existingKeys.usage_title);

      const translationInputs: TranslationInput[] = [];
      const seen = new Set<string>();
      const pushTranslation = (key: string, locale: SupportedLocale, value?: string) => {
        const trimmed = value?.trim();
        if (!trimmed) return;
        const dedupeKey = `${key}|${locale}`;
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        translationInputs.push({
          key,
          locale,
          namespace: "products",
          value: trimmed,
        });
      };

      locales.forEach((locale) => {
        pushTranslation(nameKey, locale, formData.name[locale]);
        pushTranslation(descriptionKey, locale, formData.description[locale]);
        pushTranslation(shortDescriptionKey, locale, formData.short_description[locale]);
        pushTranslation(badgeKey, locale, formData.badge[locale]);
        pushTranslation(taglineKey, locale, formData.tagline[locale]);
        pushTranslation(imageAltKey, locale, formData.image_alt[locale]);
        pushTranslation(benefitsTitleKey, locale, formData.benefits_title[locale]);
        pushTranslation(compositionTitleKey, locale, formData.composition_title[locale]);
        pushTranslation(usageTitleKey, locale, formData.usage_title[locale]);
      });

      Object.entries(jsonKeyTranslations).forEach(([key, values]) => {
        locales.forEach((locale) => pushTranslation(key, locale, values[locale]));
      });

      if (translationInputs.length > 0) {
        await upsertTranslations.mutateAsync(translationInputs);
      }

      const originParsed = safeParseJson(formData.origin_content);
      if (formData.origin_content.trim() && originParsed === null) {
        toast.error(t("admin.products.errors.invalidJson"));
        return;
      }
      const benefitsParsed = safeParseJson(formData.benefits_content);
      if (formData.benefits_content.trim() && benefitsParsed === null) {
        toast.error(t("admin.products.errors.invalidJson"));
        return;
      }
      const substancesParsed = safeParseJson(formData.substances_content);
      if (formData.substances_content.trim() && substancesParsed === null) {
        toast.error(t("admin.products.errors.invalidJson"));
        return;
      }
      const usageParsed = safeParseJson(formData.usage_content);
      if (formData.usage_content.trim() && usageParsed === null) {
        toast.error(t("admin.products.errors.invalidJson"));
        return;
      }

      const baseName =
        formData.name[baseLocale]?.trim() ||
        formData.name.en?.trim() ||
        formData.name.cs?.trim() ||
        slug;
      const baseDescription =
        formData.description[baseLocale]?.trim() ||
        formData.description.en?.trim() ||
        formData.description.cs?.trim() ||
        "";
      const baseShortDescription =
        formData.short_description[baseLocale]?.trim() ||
        formData.short_description.en?.trim() ||
        formData.short_description.cs?.trim() ||
        "";

      const productData: Partial<ProductAdmin> = {
        name: baseName,
        name_key: nameKey,
        slug,
        description: baseDescription || "",
        description_key: descriptionKey,
        short_description: baseShortDescription || "",
        short_description_key: shortDescriptionKey,
        base_locale: baseLocale,
        price: parseFloat(formData.price) || 0,
        compare_at_price: formData.compare_at_price ? parseFloat(formData.compare_at_price) : null,
        category: formData.category || null,
        image_url: formData.image_url || null,
        in_stock: formData.in_stock,
        stock_quantity: parseInt(formData.stock_quantity) || 0,
        doses_per_package: dosesPerPackage,
        badge_key: badgeKey,
        tagline_key: taglineKey,
        image_alt_key: imageAltKey,
        benefits_title_key: benefitsTitleKey,
        composition_title_key: compositionTitleKey,
        usage_title_key: usageTitleKey,
        origin_content: originParsed as Record<string, unknown> | null,
        benefits_content: benefitsParsed as Record<string, unknown> | null,
        substances_content: substancesParsed as Record<string, unknown> | null,
        usage_content: usageParsed as Record<string, unknown> | null,
      };

      if (editingProduct) {
        await updateMutation.mutateAsync({ id: editingProduct.id, data: productData });
        toast.success(t("admin.products.updated"));
      } else {
        await createMutation.mutateAsync(productData);
        toast.success(t("admin.products.created"));
      }
      onSuccess();
    } catch {
      toast.error(
        editingProduct
          ? t("admin.products.errors.updateFailed")
          : t("admin.products.errors.createFailed")
      );
    }
  };

  const handleCancel = () => {
    resetForm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button onClick={() => resetForm()}>
          <Plus className="h-4 w-4 mr-2" />
          {t("admin.products.addProduct")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingProduct
              ? t("admin.products.editProduct")
              : t("admin.products.addProduct")}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Slug field */}
          <div className="space-y-2">
            <Label htmlFor="slug">{t("admin.products.form.slug")} *</Label>
            <Input
              id="slug"
              value={formData.slug}
              onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
              required
              placeholder={t("admin.products.form.slugPlaceholder")}
            />
          </div>

          {/* Primary editing language + base locale */}
          <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/50 border">
            <div className="space-y-1 flex-1">
              <Label htmlFor="primary-locale" className="text-xs text-muted-foreground">
                {t("admin.translations.primaryLanguage")}
              </Label>
              <Select
                value={primaryLocale}
                onValueChange={(value) => handlePrimaryLocaleChange(value as SupportedLocale)}
              >
                <SelectTrigger id="primary-locale" className="w-48 h-9">
                  <SelectValue>
                    {localeLabels[primaryLocale] ?? primaryLocale.toUpperCase()}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {activeLocales.map((locale) => (
                    <SelectItem key={locale} value={locale}>
                      {localeLabels[locale] ?? locale.toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="base-locale" className="text-xs text-muted-foreground">
                {t("admin.products.form.baseLocale")}
              </Label>
              <Select
                value={formData.base_locale}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, base_locale: value as SupportedLocale }))}
              >
                <SelectTrigger id="base-locale" className="w-48 h-9">
                  <SelectValue>
                    {localeLabels[formData.base_locale] ?? formData.base_locale.toUpperCase()}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {activeLocales.map((locale) => (
                    <SelectItem key={locale} value={locale}>
                      {localeLabels[locale] ?? locale.toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Localized Name */}
          <LocalizedFieldEditor
            label={t("admin.products.form.name")}
            fieldId="product-name"
            value={formData.name}
            onChange={(locale, value) => handleLocalizedChange("name", locale, value)}
            primaryLocale={primaryLocale}
            baseLocale={formData.base_locale}
            locales={activeLocales}
            localeLabels={localeLabels}
            required
          />

          {/* Localized Short Description */}
          <LocalizedFieldEditor
            label={t("admin.products.form.shortDescription")}
            fieldId="product-short-description"
            value={formData.short_description}
            onChange={(locale, value) =>
              handleLocalizedChange("short_description", locale, value)
            }
            primaryLocale={primaryLocale}
            baseLocale={formData.base_locale}
            locales={activeLocales}
            localeLabels={localeLabels}
          />

          {/* Localized Description */}
          <LocalizedFieldEditor
            label={t("admin.products.form.description")}
            fieldId="product-description"
            value={formData.description}
            onChange={(locale, value) => handleLocalizedChange("description", locale, value)}
            primaryLocale={primaryLocale}
            baseLocale={formData.base_locale}
            locales={activeLocales}
            localeLabels={localeLabels}
            multiline
            rows={4}
          />

          {/* Price fields */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="price">{t("admin.products.form.price")} *</Label>
              <Input
                id="price"
                type="number"
                step="0.01"
                value={formData.price}
                onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="compare_at_price">
                {t("admin.products.form.compareAtPrice")}
              </Label>
              <Input
                id="compare_at_price"
                type="number"
                step="0.01"
                value={formData.compare_at_price}
                onChange={(e) =>
                  setFormData({ ...formData, compare_at_price: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">{t("admin.products.form.category")}</Label>
              <Input
                id="category"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              />
            </div>
          </div>

          {/* Image Upload */}
          <div className="space-y-2">
            <Label>{t("admin.products.form.image")}</Label>
            <div className="flex items-center gap-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                onChange={handleImageUpload}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
              >
                {isUploading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                {t("admin.products.form.uploadImage")}
              </Button>
              {formData.image_url && (
                <div className="flex items-center gap-2">
                  <img
                    src={formData.image_url}
                    alt={t("admin.products.form.imagePreviewAlt")}
                    className="h-16 w-16 object-cover rounded border"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleRemoveImage}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Stock fields */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="stock_quantity">
                {t("admin.products.form.stockQuantity")}
              </Label>
              <Input
                id="stock_quantity"
                type="number"
                value={formData.stock_quantity}
                onChange={(e) =>
                  setFormData({ ...formData, stock_quantity: e.target.value })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="doses_per_package">
                {t("admin.products.form.dosesPerPackage")}
              </Label>
              <Input
                id="doses_per_package"
                type="number"
                min={1}
                value={formData.doses_per_package}
                onChange={(e) =>
                  setFormData({ ...formData, doses_per_package: e.target.value })
                }
              />
            </div>

            <div className="flex items-center space-x-2 pt-6">
              <Switch
                id="in_stock"
                checked={formData.in_stock}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, in_stock: checked })
                }
              />
              <Label htmlFor="in_stock">{t("admin.products.form.inStock")}</Label>
            </div>
          </div>

          {/* Marketing Content Section */}
          <ProductMarketingFields
            activeLocales={activeLocales}
            editingProduct={editingProduct}
            formData={formData}
            jsonKeyTranslations={jsonKeyTranslations}
            jsonTranslationKeys={jsonTranslationKeys}
            localeLabels={localeLabels}
            onJsonContentChange={handleJsonContentChange}
            onJsonKeyTranslationsChange={setJsonKeyTranslations}
            onLocalizedChange={handleLocalizedChange}
            primaryLocale={primaryLocale}
            selectedJsonKey={selectedJsonKey}
            setSelectedJsonKey={setSelectedJsonKey}
          />

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={handleCancel}>
              {t("common.cancel")}
            </Button>
            <Button type="submit">
              {editingProduct ? t("common.save") : t("admin.products.create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
