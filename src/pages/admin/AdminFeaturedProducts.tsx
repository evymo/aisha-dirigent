import { useState } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, Trash2, Star, Loader2 } from "lucide-react";
import { LocalizedFieldEditor } from "@/components/admin/LocalizedFieldEditor";
import { toast } from "sonner";
import { useAdminFeaturedProducts, type FeaturedProductAdmin, type FeaturedProductPayload } from "@/hooks/useAdminFeaturedProducts";
import { useProductsAdmin } from "@/hooks/useAdminProducts";
import { Badge } from "@/components/ui/badge";
import {
  useUpsertTranslations,
  useDynamicTranslationsMultiLocale,
  type TranslationInput,
  SUPPORTED_LOCALES,
  type LocaleCode,
  type SupportedLocale,
} from "@/hooks/useDynamicTranslations";

const TRANSLATION_NAMESPACE = "featured";

interface FormData {
  product_id: string;
  // Multi-language translatable fields
  badge: Record<SupportedLocale, string>;
  title: Record<SupportedLocale, string>;
  subtitle: Record<SupportedLocale, string>;
  cta_text: Record<SupportedLocale, string>;
  features: Record<SupportedLocale, string>; // comma-separated per locale
  // Non-translatable fields
  cta_url: string;
  price_period_days: number;
  show_price: boolean;
  image_url: string;
  background_gradient: string;
  display_location: string;
  sort_order: number;
  is_active: boolean;
}

const DISPLAY_LOCATIONS = ["homepage", "shop", "studies"];

const createEmptyLocaleRecord = (): Record<SupportedLocale, string> =>
  SUPPORTED_LOCALES.reduce((acc, locale) => ({ ...acc, [locale]: "" }), {} as Record<SupportedLocale, string>);

const createEmptyFormData = (): FormData => ({
  product_id: "",
  badge: createEmptyLocaleRecord(),
  title: createEmptyLocaleRecord(),
  subtitle: createEmptyLocaleRecord(),
  cta_text: createEmptyLocaleRecord(),
  features: createEmptyLocaleRecord(),
  cta_url: "",
  price_period_days: 60,
  show_price: true,
  image_url: "",
  background_gradient: "from-primary/5 via-primary/10 to-secondary/10",
  display_location: "homepage",
  sort_order: 0,
  is_active: true,
});

const formDataFromItem = (
  item: FeaturedProductAdmin,
  // Keyed by LocaleCode: the map is built from `translations` rows, whose locale
  // is whatever the instance publishes — not only the locales we ship chrome for.
  translationsMap: Map<string, Map<LocaleCode, string>>
): FormData => {
  const getTranslations = (key: string): Record<SupportedLocale, string> => {
    const localeMap = translationsMap.get(key);
    if (!localeMap) return createEmptyLocaleRecord();
    return SUPPORTED_LOCALES.reduce(
      (acc, locale) => ({ ...acc, [locale]: localeMap.get(locale) || "" }),
      {} as Record<SupportedLocale, string>
    );
  };

  return {
    product_id: item.product_id,
    badge: getTranslations(item.badge_key),
    title: getTranslations(item.title_key),
    subtitle: item.subtitle_key ? getTranslations(item.subtitle_key) : createEmptyLocaleRecord(),
    cta_text: getTranslations(item.cta_text_key),
    features: SUPPORTED_LOCALES.reduce((acc, locale) => {
      // Combine all feature translations for this locale
      const featureValues = item.feature_keys
        .map((key) => translationsMap.get(key)?.get(locale) || "")
        .filter(Boolean);
      return { ...acc, [locale]: featureValues.join(", ") };
    }, {} as Record<SupportedLocale, string>),
    cta_url: item.cta_url ?? "",
    price_period_days: item.price_period_days,
    show_price: item.show_price,
    image_url: item.image_url ?? "",
    background_gradient: item.background_gradient,
    display_location: item.display_location,
    sort_order: item.sort_order,
    is_active: item.is_active,
  };
};

export default function AdminFeaturedProducts() {
  const { t, i18n } = useTranslation();
  const {
    featuredProducts,
    isLoading,
    create,
    update,
    remove,
    isCreating,
    isUpdating,
    isDeleting,
  } = useAdminFeaturedProducts();
  const { data: products } = useProductsAdmin();
  const upsertTranslations = useUpsertTranslations();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<FeaturedProductAdmin | null>(null);
  const [formData, setFormData] = useState<FormData>(createEmptyFormData());
  const [deleteDialogId, setDeleteDialogId] = useState<string | null>(null);
  const [sourceLocale, setSourceLocale] = useState<SupportedLocale>("en");
  const [targetLocale, setTargetLocale] = useState<SupportedLocale>(
    (i18n.language as SupportedLocale) !== "en" ? (i18n.language as SupportedLocale) : "cs"
  );

  // Gather all translation keys from featured products for loading
  const allTranslationKeys = featuredProducts.flatMap((fp) => [
    fp.badge_key,
    fp.title_key,
    fp.subtitle_key,
    fp.cta_text_key,
    ...fp.feature_keys,
  ].filter(Boolean)) as string[];

  // Fetch all locales for admin editing (not just current locale)
  const translationsMap = useDynamicTranslationsMultiLocale(allTranslationKeys, TRANSLATION_NAMESPACE);
  const currentLocale: SupportedLocale = SUPPORTED_LOCALES.includes(i18n.language as SupportedLocale)
    ? (i18n.language as SupportedLocale)
    : "en";

  const getTranslatedValue = (key: string): string => {
    const localeMap = translationsMap.get(key);
    if (!localeMap) return key;
    return localeMap.get(currentLocale) || localeMap.get("en") || key;
  };

  const openCreateDialog = () => {
    setEditingItem(null);
    setFormData(createEmptyFormData());
    setIsDialogOpen(true);
  };

  const openEditDialog = (item: FeaturedProductAdmin) => {
    setEditingItem(item);
    setFormData(formDataFromItem(item, translationsMap));
    setIsDialogOpen(true);
  };

  // Generate canonical translation keys based on product slug or ID
  const buildTranslationKeys = (productId: string, existingItem?: FeaturedProductAdmin) => {
    const product = products?.find((p) => p.id === productId);
    const slug = product?.slug || productId.slice(0, 8);
    const base = `featured.${slug}`;

    return {
      badgeKey: existingItem?.badge_key || `${base}.badge`,
      titleKey: existingItem?.title_key || `${base}.title`,
      subtitleKey: existingItem?.subtitle_key || `${base}.subtitle`,
      ctaTextKey: existingItem?.cta_text_key || `${base}.cta`,
      featureKeyPrefix: `${base}.feature`,
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.product_id) {
      toast.error(t("admin.featuredProducts.errors.selectProduct"));
      return;
    }

    const keys = buildTranslationKeys(formData.product_id, editingItem ?? undefined);

    // Build translation inputs
    const translationInputs: TranslationInput[] = [];

    // Badge translations
    SUPPORTED_LOCALES.forEach((locale) => {
      const value = formData.badge[locale]?.trim();
      if (value) {
        translationInputs.push({
          key: keys.badgeKey,
          locale,
          value,
          namespace: TRANSLATION_NAMESPACE,
        });
      }
    });

    // Title translations
    SUPPORTED_LOCALES.forEach((locale) => {
      const value = formData.title[locale]?.trim();
      if (value) {
        translationInputs.push({
          key: keys.titleKey,
          locale,
          value,
          namespace: TRANSLATION_NAMESPACE,
        });
      }
    });

    // Subtitle translations (optional)
    const hasSubtitle = Object.values(formData.subtitle).some((v) => v?.trim());
    if (hasSubtitle) {
      SUPPORTED_LOCALES.forEach((locale) => {
        const value = formData.subtitle[locale]?.trim();
        if (value) {
          translationInputs.push({
            key: keys.subtitleKey,
            locale,
            value,
            namespace: TRANSLATION_NAMESPACE,
          });
        }
      });
    }

    // CTA text translations
    SUPPORTED_LOCALES.forEach((locale) => {
      const value = formData.cta_text[locale]?.trim();
      if (value) {
        translationInputs.push({
          key: keys.ctaTextKey,
          locale,
          value,
          namespace: TRANSLATION_NAMESPACE,
        });
      }
    });

    // Features - split by comma, create numbered keys
    const featureKeys: string[] = [];
    // Use English as the base for determining number of features
    const enFeatures = formData.features.en?.split(",").map((f) => f.trim()).filter(Boolean) || [];
    enFeatures.forEach((_, index) => {
      const featureKey = `${keys.featureKeyPrefix}.${index + 1}`;
      featureKeys.push(featureKey);

      SUPPORTED_LOCALES.forEach((locale) => {
        const localeFeatures = formData.features[locale]?.split(",").map((f) => f.trim()) || [];
        const value = localeFeatures[index]?.trim();
        if (value) {
          translationInputs.push({
            key: featureKey,
            locale,
            value,
            namespace: TRANSLATION_NAMESPACE,
          });
        }
      });
    });

    // Save translations first
    if (translationInputs.length > 0) {
      try {
        await upsertTranslations.mutateAsync(translationInputs);
      } catch {
        toast.error(t("admin.featuredProducts.errors.translationFailed"));
        return;
      }
    }

    // Build payload for featured product
    const payload: FeaturedProductPayload = {
      product_id: formData.product_id,
      badge_key: keys.badgeKey,
      title_key: keys.titleKey,
      subtitle_key: hasSubtitle ? keys.subtitleKey : null,
      feature_keys: featureKeys.length > 0 ? featureKeys : undefined,
      cta_text_key: keys.ctaTextKey,
      cta_url: formData.cta_url || null,
      price_period_days: formData.price_period_days,
      show_price: formData.show_price,
      image_url: formData.image_url || null,
      background_gradient: formData.background_gradient || undefined,
      display_location: formData.display_location || undefined,
      sort_order: formData.sort_order,
      is_active: formData.is_active,
    };

    if (editingItem) {
      update({ id: editingItem.id, ...payload });
    } else {
      create(payload);
    }
    setIsDialogOpen(false);
  };

  const handleDelete = () => {
    if (deleteDialogId) {
      remove(deleteDialogId);
      setDeleteDialogId(null);
    }
  };

  const isSaving = isCreating || isUpdating;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Star className="h-5 w-5" />
              {t("admin.featuredProducts.title")}
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {t("admin.featuredProducts.subtitle")}
            </p>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreateDialog}>
                <Plus className="h-4 w-4 mr-2" />
                {t("admin.featuredProducts.add")}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingItem
                    ? t("admin.featuredProducts.edit")
                    : t("admin.featuredProducts.add")}
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Product Selection */}
                <div className="space-y-2">
                  <Label>{t("admin.featuredProducts.form.product")}</Label>
                  <Select
                    value={formData.product_id}
                    onValueChange={(v) => setFormData({ ...formData, product_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("admin.featuredProducts.form.selectProduct")} />
                    </SelectTrigger>
                    <SelectContent>
                      {products?.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} ({p.slug})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Localized fields with side-by-side translation */}
                <div className="space-y-4">
                  {/* Badge */}
                  <LocalizedFieldEditor
                    label={t("admin.featuredProducts.form.badge")}
                    fieldId="featured-badge"
                    value={formData.badge}
                    onChange={(locale, value) =>
                      setFormData({ ...formData, badge: { ...formData.badge, [locale]: value } })
                    }
                    primaryLocale={sourceLocale}
                    targetLocale={targetLocale}
                    onSourceLocaleChange={setSourceLocale}
                    onTargetLocaleChange={setTargetLocale}
                    placeholder={t("admin.featuredProducts.form.badgePlaceholder")}
                  />

                  {/* Title */}
                  <LocalizedFieldEditor
                    label={t("admin.featuredProducts.form.title")}
                    fieldId="featured-title"
                    value={formData.title}
                    onChange={(locale, value) =>
                      setFormData({ ...formData, title: { ...formData.title, [locale]: value } })
                    }
                    primaryLocale={sourceLocale}
                    targetLocale={targetLocale}
                    onSourceLocaleChange={setSourceLocale}
                    onTargetLocaleChange={setTargetLocale}
                    required
                    placeholder={t("admin.featuredProducts.form.titlePlaceholder")}
                  />

                  {/* Subtitle */}
                  <LocalizedFieldEditor
                    label={t("admin.featuredProducts.form.subtitle")}
                    fieldId="featured-subtitle"
                    value={formData.subtitle}
                    onChange={(locale, value) =>
                      setFormData({ ...formData, subtitle: { ...formData.subtitle, [locale]: value } })
                    }
                    primaryLocale={sourceLocale}
                    targetLocale={targetLocale}
                    onSourceLocaleChange={setSourceLocale}
                    onTargetLocaleChange={setTargetLocale}
                    multiline
                    rows={2}
                    placeholder={t("admin.featuredProducts.form.subtitlePlaceholder")}
                  />

                  {/* CTA Text */}
                  <LocalizedFieldEditor
                    label={t("admin.featuredProducts.form.ctaText")}
                    fieldId="featured-cta"
                    value={formData.cta_text}
                    onChange={(locale, value) =>
                      setFormData({ ...formData, cta_text: { ...formData.cta_text, [locale]: value } })
                    }
                    primaryLocale={sourceLocale}
                    targetLocale={targetLocale}
                    onSourceLocaleChange={setSourceLocale}
                    onTargetLocaleChange={setTargetLocale}
                    placeholder={t("admin.featuredProducts.form.ctaTextPlaceholder")}
                  />

                  {/* Features */}
                  <LocalizedFieldEditor
                    label={t("admin.featuredProducts.form.features")}
                    fieldId="featured-features"
                    value={formData.features}
                    onChange={(locale, value) =>
                      setFormData({ ...formData, features: { ...formData.features, [locale]: value } })
                    }
                    primaryLocale={sourceLocale}
                    targetLocale={targetLocale}
                    onSourceLocaleChange={setSourceLocale}
                    onTargetLocaleChange={setTargetLocale}
                    multiline
                    rows={3}
                    placeholder={t("admin.featuredProducts.form.featuresPlaceholder")}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("admin.featuredProducts.form.featuresHelp")}
                  </p>
                </div>

                {/* URLs and Display */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t("admin.featuredProducts.form.ctaUrl")}</Label>
                    <Input
                      value={formData.cta_url}
                      onChange={(e) => setFormData({ ...formData, cta_url: e.target.value })}
                      placeholder="/shop/duo-sprej"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("admin.featuredProducts.form.ctaUrlHelp")}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>{t("admin.featuredProducts.form.imageUrl")}</Label>
                    <Input
                      value={formData.image_url}
                      onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
                      placeholder="https://..."
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{t("admin.featuredProducts.form.backgroundGradient")}</Label>
                  <Input
                    value={formData.background_gradient}
                    onChange={(e) => setFormData({ ...formData, background_gradient: e.target.value })}
                    placeholder="from-primary/5 via-primary/10 to-secondary/10"
                  />
                </div>

                {/* Settings */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>{t("admin.featuredProducts.form.displayLocation")}</Label>
                    <Select
                      value={formData.display_location}
                      onValueChange={(v) => setFormData({ ...formData, display_location: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DISPLAY_LOCATIONS.map((loc) => (
                          <SelectItem key={loc} value={loc}>
                            {t(`admin.featuredProducts.locations.${loc}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t("admin.featuredProducts.form.sortOrder")}</Label>
                    <Input
                      type="number"
                      value={formData.sort_order}
                      onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("admin.featuredProducts.form.pricePeriodDays")}</Label>
                    <Input
                      type="number"
                      value={formData.price_period_days}
                      onChange={(e) => setFormData({ ...formData, price_period_days: parseInt(e.target.value) || 60 })}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={formData.show_price}
                      onCheckedChange={(v) => setFormData({ ...formData, show_price: v })}
                    />
                    <Label>{t("admin.featuredProducts.form.showPrice")}</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={formData.is_active}
                      onCheckedChange={(v) => setFormData({ ...formData, is_active: v })}
                    />
                    <Label>{t("admin.featuredProducts.form.isActive")}</Label>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsDialogOpen(false)}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button type="submit" disabled={isSaving}>
                    {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {editingItem ? t("common.save") : t("admin.featuredProducts.create")}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : featuredProducts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t("admin.featuredProducts.noItems")}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.featuredProducts.table.product")}</TableHead>
                  <TableHead>{t("admin.featuredProducts.table.titleKey")}</TableHead>
                  <TableHead>{t("admin.featuredProducts.table.location")}</TableHead>
                  <TableHead>{t("admin.featuredProducts.table.order")}</TableHead>
                  <TableHead>{t("admin.featuredProducts.table.status")}</TableHead>
                  <TableHead className="text-right">{t("admin.featuredProducts.table.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {featuredProducts.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.product_name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <div className="font-medium text-foreground">{getTranslatedValue(item.title_key)}</div>
                      <div className="font-mono text-xs text-muted-foreground">{item.title_key}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {t(`admin.featuredProducts.locations.${item.display_location}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>{item.sort_order}</TableCell>
                    <TableCell>
                      <Badge variant={item.is_active ? "default" : "secondary"}>
                        {item.is_active
                          ? t("admin.featuredProducts.active")
                          : t("admin.featuredProducts.inactive")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(item)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteDialogId(item.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteDialogId} onOpenChange={() => setDeleteDialogId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.confirmDelete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.featuredProducts.deleteWarning")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isDeleting}>
              {isDeleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
