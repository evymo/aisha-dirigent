import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Plus, CreditCard } from "lucide-react";
import { DataTable } from "@/components/ui/data-table/DataTable";
import { getPackageColumns } from "./subscription-packages-columns";
import type { Enums } from "@/integrations/db/types";
import {
  useSubscriptionPackagesAdmin,
  useCreateSubscriptionPackage,
  useUpdateSubscriptionPackage,
  useDeleteSubscriptionPackage,
  type SubscriptionPackageAdmin,
} from "@/hooks/useAdminSubscriptionPackages";
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
import { safeError } from "@/lib/security/safeLogger";
import { useSupportedLanguages } from "@/hooks/useSupportedLanguages";

type LocalizedText = Partial<Record<SupportedLocale, string>>;

interface PackageFormData {
  name: LocalizedText;
  description: LocalizedText;
  base_locale: SupportedLocale;
  slug: string;
  tier: Enums<"membership_tier">;
  period: Enums<"subscription_period">;
  price: string;
  governance_tokens: string;
  impact_tokens: string;
  is_active: boolean;
  is_recurring: boolean;
  sort_order: string;
  stripe_price_id: string;
}

const createEmptyLocalized = (locales: SupportedLocale[]): LocalizedText =>
  locales.reduce<LocalizedText>((acc, locale) => {
    acc[locale] = "";
    return acc;
  }, {});

const createEmptyFormData = (
  locales: SupportedLocale[],
  baseLocale: SupportedLocale
): PackageFormData => ({
  name: createEmptyLocalized(locales),
  description: createEmptyLocalized(locales),
  base_locale: baseLocale,
  slug: "",
  tier: "basic",
  period: "monthly",
  price: "",
  governance_tokens: "0",
  impact_tokens: "0",
  is_active: true,
  is_recurring: false,
  sort_order: "0",
  stripe_price_id: "",
});

const ensureLocalizedLocales = (
  values: LocalizedText,
  locales: SupportedLocale[]
): LocalizedText => {
  const next = { ...values };
  locales.forEach((locale) => {
    if (next[locale] === undefined) next[locale] = "";
  });
  return next;
};

const isSupportedLocale = (code: string): code is SupportedLocale =>
  (SUPPORTED_LOCALES as readonly string[]).includes(code);

export default function AdminSubscriptionPackages() {
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

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<SubscriptionPackageAdmin | null>(null);
  const [formData, setFormData] = useState<PackageFormData>(
    createEmptyFormData([...SUPPORTED_LOCALES], "en")
  );
  const [sourceLocale, setSourceLocale] = useState<SupportedLocale>("en");
  const [targetLocale, setTargetLocale] = useState<SupportedLocale>("cs");

  const { data: packages, isLoading } = useSubscriptionPackagesAdmin();
  const createMutation = useCreateSubscriptionPackage();
  const updateMutation = useUpdateSubscriptionPackage();
  const deleteMutation = useDeleteSubscriptionPackage();
  const upsertTranslations = useUpsertTranslations();
  const { mutateAsync: fetchTranslationsForKeys } = useFetchTranslationsForKeys();

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

  useEffect(() => {
    if (activeLocales.length === 0) return;

    setFormData((prev) => ({
      ...prev,
      base_locale: activeLocales.includes(prev.base_locale)
        ? prev.base_locale
        : defaultLocale,
      name: ensureLocalizedLocales(prev.name, activeLocales),
      description: ensureLocalizedLocales(prev.description, activeLocales),
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
    setEditingItem(null);
    setIsDialogOpen(false);
  };

  // Load translations when editing a package
  const loadPackageTranslations = async (pkg: SubscriptionPackageAdmin) => {
    const baseLocale = (pkg.base_locale as SupportedLocale) || defaultLocale;
    const locales = activeLocales.length > 0 ? activeLocales : [...SUPPORTED_LOCALES];
    setSourceLocale(baseLocale);
    const nextTarget = locales.find((locale) => locale !== baseLocale) ?? baseLocale;
    setTargetLocale(nextTarget);

    const newFormData: PackageFormData = {
      ...createEmptyFormData(locales, baseLocale),
      slug: pkg.slug,
      tier: pkg.tier ?? "basic",
      period: pkg.period ?? "monthly",
      price: (pkg.price ?? 0).toString(),
      governance_tokens: pkg.governance_tokens?.toString() || "0",
      impact_tokens: pkg.impact_tokens?.toString() || "0",
      is_active: pkg.is_active ?? true,
      is_recurring: pkg.is_recurring ?? false,
      sort_order: pkg.sort_order?.toString() || "0",
      stripe_price_id: pkg.stripe_price_id || "",
    };

    const fieldKeys: Record<string, string | null | undefined> = {
      name: pkg.name_key,
      description: pkg.description_key,
    };

    const keysToFetch = Object.values(fieldKeys).filter(
      (key): key is string => !!key && key.trim().length > 0
    );

    if (keysToFetch.length > 0) {
      try {
        const rows = await fetchTranslationsForKeys({
          keys: keysToFetch,
          namespace: "subscription_packages",
        });

        const translationsByKey: Record<string, LocalizedText> = {};
        for (const row of rows) {
          if (!translationsByKey[row.key]) {
            translationsByKey[row.key] = {};
          }
          translationsByKey[row.key][row.locale] = row.value;
        }

        locales.forEach((locale) => {
          const nameKey = fieldKeys.name;
          if (nameKey && translationsByKey[nameKey]?.[locale]) {
            newFormData.name[locale] = translationsByKey[nameKey][locale] ?? "";
          }
          const descKey = fieldKeys.description;
          if (descKey && translationsByKey[descKey]?.[locale]) {
            newFormData.description[locale] = translationsByKey[descKey][locale] ?? "";
          }
        });
      } catch (error) {
        safeError("admin.subscriptionPackages.loadTranslationsFailed", error);
      }
    }

    // Fallback to legacy fields if no translations loaded
    if (baseLocale && isSupportedLocale(baseLocale)) {
      newFormData.name[baseLocale] ||= pkg.name;
      newFormData.description[baseLocale] ||= pkg.description || "";
    }

    setFormData(newFormData);
  };

  const handleEdit = async (item: SubscriptionPackageAdmin) => {
    setEditingItem(item);
    await loadPackageTranslations(item);
    setIsDialogOpen(true);
  };

  const handleLocalizedChange = (
    field: "name" | "description",
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const slug = formData.slug.trim();
    if (!slug) {
      return;
    }

    try {
      const locales = activeLocales.length > 0 ? activeLocales : [...SUPPORTED_LOCALES];
      const baseLocale = locales.includes(formData.base_locale)
        ? formData.base_locale
        : defaultLocale;
      const keyPrefix = `subscription_packages.${slug}`;

      const existingKeys = editingItem
        ? {
            name: editingItem.name_key,
            description: editingItem.description_key,
          }
        : {};

      const resolveKey = (field: string, existing?: string | null) =>
        existing && existing.trim().length > 0 ? existing : `${keyPrefix}.${field}`;

      const nameKey = resolveKey("name", existingKeys.name);
      const descriptionKey = resolveKey("description", existingKeys.description);

      // 1. Upsert translations
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
          namespace: "subscription_packages",
        });
      };

      locales.forEach((locale) => {
        pushTranslation(nameKey, locale, formData.name[locale]);
        pushTranslation(descriptionKey, locale, formData.description[locale]);
      });

      if (translationInputs.length > 0) {
        await upsertTranslations.mutateAsync(translationInputs);
      }

      // 2. Save package with keys
      // Use base locale value for legacy name/description fields
      const legacyName = formData.name[baseLocale] || formData.name?.en || slug;
      const legacyDescription = formData.description[baseLocale] || formData.description?.en || null;

      const data = {
        name: legacyName,
        slug: formData.slug,
        description: legacyDescription,
        tier: formData.tier,
        period: formData.period,
        price: parseFloat(formData.price),
        governance_tokens: parseInt(formData.governance_tokens) || 0,
        impact_tokens: parseInt(formData.impact_tokens) || 0,
        is_active: formData.is_active,
        is_recurring: formData.is_recurring,
        sort_order: parseInt(formData.sort_order) || 0,
        stripe_price_id: formData.stripe_price_id || null,
      };

      if (editingItem) {
        await updateMutation.mutateAsync({
          id: editingItem.id,
          ...data,
        });
      } else {
        await createMutation.mutateAsync(data);
      }

      resetForm();
    } catch (error) {
      safeError("admin.subscriptionPackages.saveFailed", error);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable callbacks
  const columns = useMemo(() => getPackageColumns(t, handleEdit, (id) => deleteMutation.mutate(id)), [t]);

  if (isLoading) {
    return <div className="p-6">{t("common.loading")}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("admin.subscriptions.title")}</h1>
          <p className="text-muted-foreground">{t("admin.subscriptions.subtitle")}</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => resetForm()}>
              <Plus className="h-4 w-4 mr-2" />
              {t("admin.subscriptions.addPackage")}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingItem ? t("admin.subscriptions.editPackage") : t("admin.subscriptions.addPackage")}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Localized Name Field */}
              <LocalizedFieldEditor
                label={t("admin.subscriptions.form.name")}
                required
                fieldId="name"
                primaryLocale={sourceLocale}
                targetLocale={targetLocale}
                onSourceLocaleChange={handleSourceLocaleChange}
                onTargetLocaleChange={handleTargetLocaleChange}
                value={formData.name}
                onChange={(locale, value) => handleLocalizedChange("name", locale, value)}
                locales={activeLocales}
                localeLabels={localeLabels}
              />

              {/* Slug field */}
              <div className="space-y-2">
                <Label htmlFor="slug">{t("admin.subscriptions.form.slug")} *</Label>
                <Input
                  id="slug"
                  value={formData.slug}
                  onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                  required
                />
              </div>

              {/* Localized Description Field */}
              <LocalizedFieldEditor
                label={t("admin.subscriptions.form.description")}
                fieldId="description"
                primaryLocale={sourceLocale}
                targetLocale={targetLocale}
                onSourceLocaleChange={handleSourceLocaleChange}
                onTargetLocaleChange={handleTargetLocaleChange}
                value={formData.description}
                onChange={(locale, value) => handleLocalizedChange("description", locale, value)}
                locales={activeLocales}
                localeLabels={localeLabels}
                multiline
              />

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="tier">{t("admin.subscriptions.form.tier")}</Label>
                  <Select
                    value={formData.tier}
                    onValueChange={(v) => setFormData({ ...formData, tier: v as Enums<"membership_tier"> })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="basic">{t("admin.subscriptions.tiers.basic")}</SelectItem>
                      <SelectItem value="upgraded">{t("admin.subscriptions.tiers.upgraded")}</SelectItem>
                      <SelectItem value="trial">{t("admin.subscriptions.tiers.trial")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="period">{t("admin.subscriptions.form.period")}</Label>
                  <Select
                    value={formData.period}
                    onValueChange={(v) => setFormData({ ...formData, period: v as Enums<"subscription_period"> })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">{t("admin.subscriptions.periods.monthly")}</SelectItem>
                      <SelectItem value="quarterly">{t("admin.subscriptions.periods.quarterly")}</SelectItem>
                      <SelectItem value="annual">{t("admin.subscriptions.periods.annual")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Single price in the instance base currency; any other-currency
                  display is derived at read time via currency_rates. */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="price">{t("admin.subscriptions.form.priceCzk")} *</Label>
                  <Input
                    id="price"
                    type="number"
                    step="0.01"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="governance_tokens">{t("admin.subscriptions.form.governanceTokens")}</Label>
                  <Input
                    id="governance_tokens"
                    type="number"
                    value={formData.governance_tokens}
                    onChange={(e) => setFormData({ ...formData, governance_tokens: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="impact_tokens">{t("admin.subscriptions.form.impactTokens")}</Label>
                  <Input
                    id="impact_tokens"
                    type="number"
                    value={formData.impact_tokens}
                    onChange={(e) => setFormData({ ...formData, impact_tokens: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="stripe_price_id">{t("admin.subscriptions.form.stripePriceId")}</Label>
                <Input
                  id="stripe_price_id"
                  value={formData.stripe_price_id}
                  onChange={(e) => setFormData({ ...formData, stripe_price_id: e.target.value })}
                  placeholder={t("admin.subscriptions.form.stripePriceIdPlaceholder")}
                />
              </div>

              <div className="flex items-center gap-6">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="is_active"
                    checked={formData.is_active}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                  />
                  <Label htmlFor="is_active">{t("admin.subscriptions.form.active")}</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="is_recurring"
                    checked={formData.is_recurring}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_recurring: checked })}
                  />
                  <Label htmlFor="is_recurring">{t("admin.subscriptions.form.recurring")}</Label>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={resetForm}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit">
                  {editingItem ? t("common.save") : t("admin.products.create")}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            {t("admin.subscriptions.allPackages")} ({packages?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={packages || []}
            searchKey="name"
          />
        </CardContent>
      </Card>
    </div>
  );
}
