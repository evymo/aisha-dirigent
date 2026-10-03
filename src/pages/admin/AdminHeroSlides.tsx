import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Upload, X, Presentation, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAdminHeroSlides, useHeroImageUpload, type HeroSlideAdmin, type HeroSlidePayload } from "@/hooks/useAdminHeroSlides";
import { useProductsAdmin } from "@/hooks/useAdminProducts";
import {
  useFetchTranslationsForKeys,
  useUpsertTranslations,
  type TranslationInput,
  SUPPORTED_LOCALES,
  type SupportedLocale,
  LOCALE_LABELS,
  type LocaleCode,
} from "@/hooks/useDynamicTranslations";
import { LocalizedFieldEditor } from "@/components/admin/LocalizedFieldEditor";
import { useSupportedLanguages } from "@/hooks/useSupportedLanguages";
import { safeError } from "@/lib/security/safeLogger";

import { DataTable } from "@/components/ui/data-table/DataTable";
import { useHeroSlideColumns } from "./hero-slides-columns";
import {
  TARGET_AUDIENCES,
  createEmptyLocalized,
  ensureLocalizedLocales,
  createEmptyFormData,
  isSupportedLocale,
  type LocalizedText,
  type HeroSlideFormData,
} from "./hero-slides/heroSlideTypes";

export default function AdminHeroSlides() {
  const { t } = useTranslation();
  const { data: supportedLanguages = [] } = useSupportedLanguages();
  const activeLanguages = useMemo(
    () => supportedLanguages.filter((lang) => lang.is_active === true),
    [supportedLanguages]
  );
  const activeLocales = useMemo(() => {
    const codes = activeLanguages
      .map((lang) => lang.code)
      .filter(isSupportedLocale);
    return codes.length > 0 ? codes : [...SUPPORTED_LOCALES];
  }, [activeLanguages]);
  const localeLabels = useMemo(() => {
    const labels: Record<LocaleCode, string> = { ...LOCALE_LABELS };
    activeLanguages.forEach((lang) => {
      if (isSupportedLocale(lang.code)) {
        labels[lang.code] = lang.name_native || lang.name_key || labels[lang.code];
      }
    });
    return labels;
  }, [activeLanguages]);
  const defaultLocale = useMemo<SupportedLocale>(() => {
    const preferred = activeLanguages.find((lang) => lang.is_default === true);
    if (preferred && isSupportedLocale(preferred.code)) {
      return preferred.code;
    }
    return "en";
  }, [activeLanguages]);
  const { slides = [], isLoading, createSlide, updateSlide, deleteSlide, isCreating, isUpdating } = useAdminHeroSlides();
  const { uploadImage } = useHeroImageUpload();
  const { data: products } = useProductsAdmin();
  const upsertTranslations = useUpsertTranslations();
  const { mutateAsync: fetchTranslationsForKeys } = useFetchTranslationsForKeys();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSlide, setEditingSlide] = useState<HeroSlideAdmin | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  const [formData, setFormData] = useState<HeroSlideFormData>(
    createEmptyFormData([...SUPPORTED_LOCALES], "en")
  );
  const [sourceLocale, setSourceLocale] = useState<SupportedLocale>("en");
  const [targetLocale, setTargetLocale] = useState<SupportedLocale>("cs");
  const [tableTranslations, setTableTranslations] = useState<
    Record<string, LocalizedText>
  >({});

  useEffect(() => {
    if (activeLocales.length === 0) return;

    setFormData((prev) => ({
      ...prev,
      title: ensureLocalizedLocales(prev.title, activeLocales),
      subtitle: ensureLocalizedLocales(prev.subtitle, activeLocales),
      badge: ensureLocalizedLocales(prev.badge, activeLocales),
      cta_text: ensureLocalizedLocales(prev.cta_text, activeLocales),
      circle_icon: ensureLocalizedLocales(prev.circle_icon, activeLocales, "Sparkles"),
      circle_text: ensureLocalizedLocales(prev.circle_text, activeLocales),
      base_locale: activeLocales.includes(prev.base_locale) ? prev.base_locale : defaultLocale,
    }));

    if (!activeLocales.includes(sourceLocale)) {
      setSourceLocale(activeLocales[0]);
    }
    if (!activeLocales.includes(targetLocale) || targetLocale === sourceLocale) {
      const fallback = activeLocales.find((locale) => locale !== sourceLocale) ?? activeLocales[0];
      setTargetLocale(fallback);
    }
  }, [activeLocales, defaultLocale, sourceLocale, targetLocale]);

  const resetForm = () => {
    const baseLocale = activeLocales.includes(defaultLocale)
      ? defaultLocale
      : activeLocales[0] ?? "en";
    setFormData(createEmptyFormData(activeLocales, baseLocale));
    setSourceLocale(baseLocale);
    const nextTarget = activeLocales.find((locale) => locale !== baseLocale) ?? baseLocale;
    setTargetLocale(nextTarget);
    setEditingSlide(null);
    setIsDialogOpen(false);
  };

  const loadSlideTranslations = async (slide: HeroSlideAdmin) => {
    const baseLocale = (slide.base_locale as SupportedLocale) || defaultLocale;
    const locales = activeLocales.length > 0 ? activeLocales : [...SUPPORTED_LOCALES];
    setSourceLocale(baseLocale);
    const nextTarget = locales.find((locale) => locale !== baseLocale) ?? baseLocale;
    setTargetLocale(nextTarget);

    const newFormData: HeroSlideFormData = {
      ...createEmptyFormData(locales, baseLocale),
      target_audience: slide.target_audience,
      background_image_url: slide.background_image_url,
      background_gradient: slide.background_gradient,
      cta_url: slide.cta_url,
      linked_product_id: slide.linked_product_id,
      is_active: slide.is_active,
      sort_order: slide.sort_order,
    };

    const fieldKeys: Record<string, string | null | undefined> = {
      title: slide.title_key,
      subtitle: slide.subtitle_key,
      badge: slide.badge_key,
      cta_text: slide.cta_text_key,
      circle_icon: slide.circle_icon_key,
      circle_text: slide.circle_text_key,
    };

    const keysToFetch = Object.values(fieldKeys).filter(
      (key): key is string => !!key && key.trim().length > 0
    );

    const translationsByKey: Record<string, LocalizedText> = {};
    if (keysToFetch.length > 0) {
      try {
        const rows = await fetchTranslationsForKeys({
          keys: keysToFetch,
          namespace: "hero",
        });

        for (const row of rows) {
          if (!translationsByKey[row.key]) {
            translationsByKey[row.key] = {};
          }
          translationsByKey[row.key][row.locale] = row.value;
        }
      } catch (error) {
        safeError("admin.heroSlides.loadTranslationsFailed", error);
      }
    }

    locales.forEach((locale) => {
      const titleKey = fieldKeys.title;
      if (titleKey && translationsByKey[titleKey]?.[locale]) {
        newFormData.title[locale] = translationsByKey[titleKey][locale] ?? "";
      }
      const subtitleKey = fieldKeys.subtitle;
      if (subtitleKey && translationsByKey[subtitleKey]?.[locale]) {
        newFormData.subtitle[locale] = translationsByKey[subtitleKey][locale] ?? "";
      }
      const badgeKey = fieldKeys.badge;
      if (badgeKey && translationsByKey[badgeKey]?.[locale]) {
        newFormData.badge[locale] = translationsByKey[badgeKey][locale] ?? "";
      }
      const ctaKey = fieldKeys.cta_text;
      if (ctaKey && translationsByKey[ctaKey]?.[locale]) {
        newFormData.cta_text[locale] = translationsByKey[ctaKey][locale] ?? "";
      }
      const circleIconKey = fieldKeys.circle_icon;
      if (circleIconKey && translationsByKey[circleIconKey]?.[locale]) {
        newFormData.circle_icon[locale] = translationsByKey[circleIconKey][locale] ?? "";
      }
      const circleTextKey = fieldKeys.circle_text;
      if (circleTextKey && translationsByKey[circleTextKey]?.[locale]) {
        newFormData.circle_text[locale] = translationsByKey[circleTextKey][locale] ?? "";
      }
    });

    setFormData(newFormData);
  };

  const handleEdit = async (slide: HeroSlideAdmin) => {
    setEditingSlide(slide);
    await loadSlideTranslations(slide);
    setIsDialogOpen(true);
  };

  const handleDeleteClick = (id: string) => {
    setItemToDelete(id);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (itemToDelete) {
      deleteSlide(itemToDelete, {
        onSuccess: () => {
          setDeleteDialogOpen(false);
          setItemToDelete(null);
        }
      });
    }
  };

  const handleSourceLocaleChange = (locale: SupportedLocale) => {
    setSourceLocale(locale);
    setFormData((prev) => ({
      ...prev,
      base_locale: locale,
    }));
  };

  const handleTargetLocaleChange = (locale: SupportedLocale) => {
    setTargetLocale(locale);
  };

  const handleLocalizedChange = (
    field: keyof Pick<
      HeroSlideFormData,
      "title" | "subtitle" | "badge" | "cta_text" | "circle_icon" | "circle_text"
    >,
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

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const url = await uploadImage(file);
      setFormData((prev) => ({ ...prev, background_image_url: url }));
    } catch {
      // uploadImage already handles safe logging + user-facing toast
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const locales = activeLocales.length > 0 ? activeLocales : [...SUPPORTED_LOCALES];
      const baseLocale = locales.includes(formData.base_locale)
        ? formData.base_locale
        : defaultLocale;
      const slideId = editingSlide?.id ?? crypto.randomUUID();
      const keyPrefix = `hero.${slideId}`;

      const existingKeys = editingSlide
        ? {
            title: editingSlide.title_key,
            subtitle: editingSlide.subtitle_key,
            badge: editingSlide.badge_key,
            cta_text: editingSlide.cta_text_key,
            circle_icon: editingSlide.circle_icon_key,
            circle_text: editingSlide.circle_text_key,
          }
        : {};

      const resolveKey = (field: string, existing?: string | null) =>
        existing && existing.trim().length > 0 ? existing : `${keyPrefix}.${field}`;

      const titleKey = resolveKey("title", existingKeys.title);
      const subtitleKey = resolveKey("subtitle", existingKeys.subtitle);
      const badgeKey = resolveKey("badge", existingKeys.badge);
      const ctaTextKey = resolveKey("cta_text", existingKeys.cta_text);
      const circleIconKey = resolveKey("circle_icon", existingKeys.circle_icon);
      const circleTextKey = resolveKey("circle_text", existingKeys.circle_text);

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
          value: trimmed,
          namespace: "hero",
        });
      };

      locales.forEach((locale) => {
        pushTranslation(titleKey, locale, formData.title[locale]);
        pushTranslation(subtitleKey, locale, formData.subtitle[locale]);
        pushTranslation(badgeKey, locale, formData.badge[locale]);
        pushTranslation(ctaTextKey, locale, formData.cta_text[locale]);
        pushTranslation(circleIconKey, locale, formData.circle_icon[locale]);
        pushTranslation(circleTextKey, locale, formData.circle_text[locale]);
      });

      if (translationInputs.length > 0) {
        await upsertTranslations.mutateAsync(translationInputs);
      }

      const payload: HeroSlidePayload = {
        id: slideId,
        base_locale: baseLocale,
        title_key: titleKey,
        subtitle_key: subtitleKey,
        badge_key: badgeKey,
        cta_text_key: ctaTextKey,
        circle_icon_key: circleIconKey,
        circle_text_key: circleTextKey,
        target_audience: formData.target_audience,
        background_image_url: formData.background_image_url || undefined,
        background_gradient: formData.background_gradient || undefined,
        cta_url: formData.cta_url || undefined,
        linked_product_id: formData.linked_product_id || undefined,
        is_active: formData.is_active,
        sort_order: formData.sort_order,
      };

      if (editingSlide) {
        updateSlide({ id: editingSlide.id, data: payload }, { onSuccess: resetForm });
      } else {
        createSlide(payload, { onSuccess: resetForm });
      }
    } catch {
      toast.error(
        editingSlide
          ? t("admin.heroSlides.errors.updateFailed")
          : t("admin.heroSlides.errors.createFailed")
      );
    }
  };

  useEffect(() => {
    const keys = new Set<string>();
    (slides ?? []).forEach((slide) => {
      [slide.title_key, slide.subtitle_key, slide.badge_key, slide.cta_text_key, slide.circle_icon_key, slide.circle_text_key]
        .filter((key): key is string => !!key && key.trim().length > 0)
        .forEach((key) => keys.add(key));
    });

    if (keys.size === 0) {
      setTableTranslations({});
      return;
    }

    const loadTableTranslations = async () => {
      try {
        const rows = await fetchTranslationsForKeys({
          keys: Array.from(keys),
          namespace: "hero",
        });

        const next: Record<string, LocalizedText> = {};
        rows.forEach((row) => {
          if (!next[row.key]) next[row.key] = {};
          next[row.key][row.locale] = row.value;
        });
        setTableTranslations(next);
      } catch (error) {
        safeError("admin.heroSlides.tableTranslationsFailed", error);
      }
    };

    void loadTableTranslations();
  }, [slides, fetchTranslationsForKeys]);

  const resolveTableValue = (
    key: string | null | undefined,
    slide: HeroSlideAdmin,
    localeOverride?: SupportedLocale
  ) => {
    if (!key) return "";
    const baseLocale = activeLocales.includes(slide.base_locale as SupportedLocale)
      ? (slide.base_locale as SupportedLocale)
      : defaultLocale;
    const primaryLocale = localeOverride ?? baseLocale;
    return (
      tableTranslations[key]?.[primaryLocale] ??
      tableTranslations[key]?.[baseLocale] ??
      tableTranslations[key]?.en ??
      ""
    );
  };

  const getSecondaryLocale = (baseLocale: SupportedLocale) =>
    activeLocales.find((locale) => locale !== baseLocale) ?? baseLocale;

  const columns = useHeroSlideColumns(handleEdit, handleDeleteClick, {
    resolvePrimary: (slide) => resolveTableValue(slide.title_key, slide),
    resolveSecondary: (slide) =>
      resolveTableValue(
        slide.title_key,
        slide,
        getSecondaryLocale(
          activeLocales.includes(slide.base_locale as SupportedLocale)
            ? (slide.base_locale as SupportedLocale)
            : defaultLocale
        )
      ),
    resolveImageAlt: (slide) => resolveTableValue(slide.title_key, slide) || slide.title_key,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold font-serif">{t("admin.heroSlides.title")}</h1>
          <p className="text-muted-foreground">{t("admin.heroSlides.subtitle")}</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => resetForm()}>
              <Plus className="h-4 w-4 mr-2" />
              {t("admin.heroSlides.addSlide")}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingSlide ? t("admin.heroSlides.editSlide") : t("admin.heroSlides.addSlide")}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Base locale */}
              <div className="space-y-2">
                <Label htmlFor="hero-base-locale">{t("admin.heroSlides.form.baseLocale")}</Label>
                <Select
                  value={formData.base_locale}
                  onValueChange={(value) => handleSourceLocaleChange(value as SupportedLocale)}
                >
                  <SelectTrigger id="hero-base-locale" className="w-48">
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

              {/* Title */}
              <LocalizedFieldEditor
                label={t("admin.heroSlides.form.title")}
                fieldId="hero-title"
                value={formData.title}
                onChange={(locale, value) => handleLocalizedChange("title", locale, value)}
                primaryLocale={sourceLocale}
                targetLocale={targetLocale}
                onSourceLocaleChange={handleSourceLocaleChange}
                onTargetLocaleChange={handleTargetLocaleChange}
                locales={activeLocales}
                localeLabels={localeLabels}
                required={formData.base_locale === sourceLocale}
              />

              {/* Subtitle */}
              <LocalizedFieldEditor
                label={t("admin.heroSlides.form.subtitle")}
                fieldId="hero-subtitle"
                value={formData.subtitle}
                onChange={(locale, value) => handleLocalizedChange("subtitle", locale, value)}
                primaryLocale={sourceLocale}
                targetLocale={targetLocale}
                onSourceLocaleChange={handleSourceLocaleChange}
                onTargetLocaleChange={handleTargetLocaleChange}
                locales={activeLocales}
                localeLabels={localeLabels}
                multiline
                rows={2}
              />

              {/* Badge */}
              <LocalizedFieldEditor
                label={t("admin.heroSlides.form.badge")}
                fieldId="hero-badge"
                value={formData.badge}
                onChange={(locale, value) => handleLocalizedChange("badge", locale, value)}
                primaryLocale={sourceLocale}
                targetLocale={targetLocale}
                onSourceLocaleChange={handleSourceLocaleChange}
                onTargetLocaleChange={handleTargetLocaleChange}
                locales={activeLocales}
                localeLabels={localeLabels}
              />

              {/* Background Image */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground">{t("admin.heroSlides.form.background")}</h3>
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      {isUploading ? t("common.uploading") : t("admin.heroSlides.form.uploadImage")}
                    </Button>
                    {formData.background_image_url && (
                      <div className="flex items-center gap-2">
                        <img
                          src={formData.background_image_url}
                          alt={t("admin.heroSlides.form.previewAlt")}
                          className="h-12 w-20 object-cover rounded border"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setFormData({ ...formData, background_image_url: "" })}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="background_image_url">{t("admin.heroSlides.form.imageUrl")}</Label>
                    <Input
                      id="background_image_url"
                      value={formData.background_image_url}
                      onChange={(e) => setFormData({ ...formData, background_image_url: e.target.value })}
                      placeholder={t("admin.heroSlides.form.imageUrlPlaceholder")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="background_gradient">{t("admin.heroSlides.form.gradient")}</Label>
                    <Input
                      id="background_gradient"
                      value={formData.background_gradient}
                      onChange={(e) => setFormData({ ...formData, background_gradient: e.target.value })}
                      placeholder={t("admin.heroSlides.form.gradientPlaceholder")}
                    />
                  </div>
                </div>
              </div>

              {/* CTA */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground">{t("admin.heroSlides.form.cta")}</h3>
                <LocalizedFieldEditor
                  label={t("admin.heroSlides.form.ctaText")}
                  fieldId="hero-cta-text"
                  value={formData.cta_text}
                  onChange={(locale, value) => handleLocalizedChange("cta_text", locale, value)}
                  primaryLocale={sourceLocale}
                  targetLocale={targetLocale}
                  onSourceLocaleChange={handleSourceLocaleChange}
                  onTargetLocaleChange={handleTargetLocaleChange}
                  locales={activeLocales}
                  localeLabels={localeLabels}
                />
                <div className="space-y-2">
                  <Label htmlFor="cta_url">{t("admin.heroSlides.form.ctaUrl")}</Label>
                  <Input
                    id="cta_url"
                    value={formData.cta_url}
                    onChange={(e) => setFormData({ ...formData, cta_url: e.target.value })}
                    placeholder={t("admin.heroSlides.form.ctaUrlPlaceholder")}
                  />
                </div>
              </div>

              {/* Circle Decoration */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground">{t("admin.heroSlides.form.circleDecoration")}</h3>
                <LocalizedFieldEditor
                  label={t("admin.heroSlides.form.circleIcon")}
                  fieldId="hero-circle-icon"
                  value={formData.circle_icon}
                  onChange={(locale, value) => handleLocalizedChange("circle_icon", locale, value)}
                  primaryLocale={sourceLocale}
                  targetLocale={targetLocale}
                  onSourceLocaleChange={handleSourceLocaleChange}
                  onTargetLocaleChange={handleTargetLocaleChange}
                  locales={activeLocales}
                  localeLabels={localeLabels}
                  placeholder={t("admin.heroSlides.form.iconPlaceholder")}
                />
                <LocalizedFieldEditor
                  label={t("admin.heroSlides.form.circleText")}
                  fieldId="hero-circle-text"
                  value={formData.circle_text}
                  onChange={(locale, value) => handleLocalizedChange("circle_text", locale, value)}
                  primaryLocale={sourceLocale}
                  targetLocale={targetLocale}
                  onSourceLocaleChange={handleSourceLocaleChange}
                  onTargetLocaleChange={handleTargetLocaleChange}
                  locales={activeLocales}
                  localeLabels={localeLabels}
                />
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground">{t("admin.heroSlides.form.settings")}</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="target_audience">{t("admin.heroSlides.form.targetAudience")}</Label>
                    <Select
                      value={formData.target_audience}
                      onValueChange={(value) => setFormData({ ...formData, target_audience: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TARGET_AUDIENCES.map((audience) => (
                          <SelectItem key={audience} value={audience}>
                            {t(`admin.heroSlides.audiences.${audience}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="linked_product">{t("admin.heroSlides.form.linkedProduct")}</Label>
                    <Select
                      value={formData.linked_product_id || "none"}
                      onValueChange={(value) => setFormData({ ...formData, linked_product_id: value === "none" ? null : value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t("admin.heroSlides.form.noProduct")}</SelectItem>
                        {products?.map((product) => (
                          <SelectItem key={product.id} value={product.id}>
                            {product.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sort_order">{t("admin.heroSlides.form.sortOrder")}</Label>
                    <Input
                      id="sort_order"
                      type="number"
                      value={formData.sort_order}
                      onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="is_active"
                    checked={formData.is_active}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                  />
                  <Label htmlFor="is_active">{t("admin.heroSlides.form.isActive")}</Label>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={resetForm}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={isCreating || isUpdating}>
                  {editingSlide ? t("common.save") : t("admin.heroSlides.create")}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Presentation className="h-5 w-5" />
            {t("admin.heroSlides.allSlides")} ({slides.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={slides}
            searchKey="title"
          />
        </CardContent>
      </Card>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.areYouSure")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.heroSlides.deleteWarning")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive hover:bg-destructive/90"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
