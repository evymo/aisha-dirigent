import { useState, useMemo, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Globe, Languages, GripVertical, Check } from "lucide-react";
import {
  useDynamicTranslationsWithStatus,
  useUpsertTranslations,
  useDeleteTranslationsByKey,
  type TranslationWithStatus,
  SUPPORTED_LOCALES,
  type SupportedLocale,
  LOCALE_LABELS,
  type LocaleCode,
} from "@/hooks/useDynamicTranslations";
import {
  useSupportedLanguages,
  useCreateLanguage,
  useUpdateLanguage,
  useDeleteLanguage,
  type SupportedLanguage,
} from "@/hooks/useSupportedLanguages";
import { LocalizedFieldEditor } from "@/components/admin/LocalizedFieldEditor";

import { DataTable } from "@/components/ui/data-table/DataTable";
import { useTranslationColumns, TranslationGroup } from "./translations-columns";

/**
 * ⛔ SEZNAM NAMESPACŮ SE ODVOZUJE Z DAT, NEPÍŠE SE DO KÓDU (naměřeno 2026-09-21).
 *
 * Do teď tu stál pevný seznam 14 hodnot. V datech i v kódu jich ale žije víc:
 * naměřeno v repu `namespace: "common"` (14×), `"news"` (5×), `"notifications"`,
 * `"subscription_packages"`, `"consent"` — žádný z nich v seznamu nebyl. Důsledek
 * nebyl kosmetický: filtr je zároveň JEDINÁ cesta, jak v administraci texty
 * daného namespacu najít, takže překlady novinek (namespace `news`) nešlo
 * ve správě překladů vybrat vůbec — a při zakládání klíče se nešlo do `news`
 * ani přepnout. Texty existovaly a byly neviditelné.
 *
 * `useDynamicTranslationsWithStatus()` stejně čte všechny řádky včetně namespacu,
 * takže odvození nic nestojí a nemůže zastarat. Popisek bere přeložené jméno,
 * když existuje, jinak samotný namespace — nový obsahový typ se tím objeví
 * okamžitě, i než mu někdo dopíše popisek.
 */
type TranslationStatusFilter = "all" | "missing" | "stale";

export default function AdminTranslations() {
  const { t } = useTranslation();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLanguageDialogOpen, setIsLanguageDialogOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingLanguage, setEditingLanguage] = useState<SupportedLanguage | null>(null);
  const [filterNamespace, setFilterNamespace] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<TranslationStatusFilter>("all");

  // Languages
  const { data: languages = [], isLoading: languagesLoading } = useSupportedLanguages();
  const activeLanguages = languages.filter(l => l.is_active === true);
  const isSupportedLocale = (code: string): code is SupportedLocale =>
    (SUPPORTED_LOCALES as readonly string[]).includes(code);
  const activeLocales = useMemo(() => {
    const codes = activeLanguages.map((lang) => lang.code).filter(isSupportedLocale);
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
  const createLanguageMutation = useCreateLanguage();
  const updateLanguageMutation = useUpdateLanguage();
  const deleteLanguageMutation = useDeleteLanguage();

  const [languageForm, setLanguageForm] = useState({
    code: "",
    name_native: "",
    name_key: "",
    is_active: true,
    is_default: false,
    sort_order: 0,
  });

  const [formData, setFormData] = useState<{
    key: string;
    namespace: string;
    values: Record<string, string>;
  }>({
    key: "",
    namespace: "questionnaires",
    values: {},
  });
  const [sourceLocale, setSourceLocale] = useState<SupportedLocale>("en");
  const [targetLocale, setTargetLocale] = useState<SupportedLocale>("cs");
  const [showAllLocales, setShowAllLocales] = useState(false);

  const { translations = [], isLoading: translationsLoading, error: translationsError, isError } = useDynamicTranslationsWithStatus();

  // Bez `useMemo`/`useCallback` ZÁMĚRNĚ: ráčna WP 4.5 (React Compiler) drží ruční
  // memoizaci na klesající křivce — compiler tohle zvládne sám a nový hook by
  // ráčnu posunul zpět.
  const namespaces = Array.from(
    new Set(
      translations
        .map((row) => row.namespace)
        .filter((ns): ns is string => typeof ns === "string" && ns.length > 0),
    ),
  ).sort((a, b) => a.localeCompare(b));
  const namespaceLabel = (ns: string): string => t(`admin.translations.namespaces.${ns}`, ns);
  const upsertMutation = useUpsertTranslations();
  const deleteMutation = useDeleteTranslationsByKey();

  // Výchozí namespace v dialogu musí být jeden z NABÍZENÝCH. Pevná hodnota
  // „questionnaires" by u instance, která ten namespace nemá, nechala Select
  // prázdný a založený klíč by skončil v namespacu, který nikdo nevybral.
  useEffect(() => {
    if (editingKey) return;
    if (namespaces.length === 0) return;
    setFormData((predchozi) =>
      namespaces.includes(predchozi.namespace)
        ? predchozi
        : { ...predchozi, namespace: namespaces[0] },
    );
  }, [editingKey, namespaces]);

  useEffect(() => {
    if (activeLocales.length === 0) return;
    if (!activeLocales.includes(sourceLocale)) {
      setSourceLocale(activeLocales[0]);
    }
    if (!activeLocales.includes(targetLocale) || targetLocale === sourceLocale) {
      const fallback = activeLocales.find((locale) => locale !== sourceLocale) ?? activeLocales[0];
      setTargetLocale(fallback);
    }
  }, [activeLocales, sourceLocale, targetLocale]);

  // Group translations by key with status tracking
  const groupedTranslations = useMemo(() => {
    const groups: Record<string, TranslationGroup> = {};
    translations.forEach((t: TranslationWithStatus) => {
      const groupKey = `${t.namespace}:${t.key}`;
      if (!groups[groupKey]) {
        groups[groupKey] = {
          key: t.key,
          namespace: t.namespace,
          values: {},
          statuses: {},
        };
      }
      groups[groupKey].values[t.locale] = t.value;
      groups[groupKey].statuses[t.locale] = {
        is_stale: t.is_stale,
        is_missing: t.is_missing,
      };
    });
    return Object.values(groups);
  }, [translations]);

  // Filter translations
  const filteredTranslations = useMemo(() => {
    return groupedTranslations.filter((group) => {
      const matchesNamespace =
        filterNamespace === "all" || group.namespace === filterNamespace;

      // Status filter
      let matchesStatus = true;
      if (filterStatus === "missing") {
        // Show if any language has missing translation
        matchesStatus = Object.values(group.statuses).some(s => s.is_missing);
      } else if (filterStatus === "stale") {
        // Show if any language has stale translation
        matchesStatus = Object.values(group.statuses).some(s => s.is_stale);
      }

      return matchesNamespace && matchesStatus;
    });
  }, [groupedTranslations, filterNamespace, filterStatus]);

  const handleEdit = useCallback((group: TranslationGroup) => {
    setEditingKey(group.key);
    const values: Record<string, string> = {};
    activeLocales.forEach((locale) => {
      values[locale] = group.values[locale] || "";
    });
    setFormData({
      key: group.key,
      namespace: group.namespace,
      values,
    });
    setIsDialogOpen(true);
  }, [activeLocales]);

  const handleCreate = () => {
    setEditingKey(null);
    const values: Record<string, string> = {};
    activeLocales.forEach((locale) => {
      values[locale] = "";
    });
    setFormData({
      key: "",
      namespace: "questionnaires",
      values,
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.key.trim()) {
      toast.error(t("admin.translations.keyRequired"));
      return;
    }

    const inputs = activeLocales.map((locale) => ({
      key: formData.key,
      locale,
      value: formData.values[locale] || "",
      namespace: formData.namespace,
    }));

    try {
      await upsertMutation.mutateAsync(inputs);
      toast.success(
        editingKey
          ? t("admin.translations.updated")
          : t("admin.translations.created")
      );
      setIsDialogOpen(false);
    } catch (error) {
      toast.error(t("admin.translations.error"));
    }
  };

  const handleDelete = useCallback(async (key: string, namespace: string) => {
    // Basic confirmation usually handled by UI/dialog, for now standard confirm
    if (!confirm(t("admin.translations.confirmDelete"))) return;
    try {
      await deleteMutation.mutateAsync({ key, namespace });
      toast.success(t("admin.translations.deleted"));
    } catch (error) {
      toast.error(t("admin.translations.error"));
    }
  }, [deleteMutation, t]);

  // Language handlers - Keeping original logic for languages tab since it's separate from translation data table
  const handleEditLanguage = (lang: SupportedLanguage) => {
    setEditingLanguage(lang);
    setLanguageForm({
      code: lang.code,
      name_native: lang.name_native,
      name_key: lang.name_key || "",
      is_active: lang.is_active ?? false,
      is_default: lang.is_default || false,
      sort_order: lang.sort_order || 0,
    });
    setIsLanguageDialogOpen(true);
  };

  const handleCreateLanguage = () => {
    setEditingLanguage(null);
    setLanguageForm({
      code: "",
      name_native: "",
      name_key: "",
      is_active: true,
      is_default: false,
      sort_order: languages.length + 1,
    });
    setIsLanguageDialogOpen(true);
  };

  const handleSubmitLanguage = async () => {
    if (!languageForm.code.trim() || !languageForm.name_native.trim() || !languageForm.name_key.trim()) {
      toast.error(t("admin.languages.fieldsRequired"));
      return;
    }

    try {
      if (editingLanguage) {
        await updateLanguageMutation.mutateAsync(languageForm);
        toast.success(t("admin.languages.updated"));
      } else {
        await createLanguageMutation.mutateAsync(languageForm);
        toast.success(t("admin.languages.created"));
      }
      setIsLanguageDialogOpen(false);
    } catch (error) {
      toast.error(t("admin.languages.error"));
    }
  };

  const handleDeleteLanguage = async (code: string) => {
    if (!confirm(t("admin.languages.confirmDelete"))) return;
    try {
      await deleteLanguageMutation.mutateAsync(code);
      toast.success(t("admin.languages.deleted"));
    } catch (error) {
      toast.error(t("admin.languages.error"));
    }
  };

  const handleToggleLanguage = async (lang: SupportedLanguage) => {
    try {
      await updateLanguageMutation.mutateAsync({
        code: lang.code,
        is_active: !lang.is_active,
      });
      toast.success(lang.is_active ? t("admin.languages.deactivated") : t("admin.languages.activated"));
    } catch (error) {
      toast.error(t("admin.languages.error"));
    }
  };

  // Normalize activeLanguages to ensure is_active is boolean (not null)
  const normalizedLanguages: SupportedLanguage[] = useMemo(() =>
    activeLanguages.map(l => ({
      ...l,
      is_active: l.is_active ?? false,
      name_key: l.name_key ?? "",
    })),
    [activeLanguages]
  );

  const columns = useTranslationColumns(handleEdit, handleDelete, normalizedLanguages);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold font-serif">{t("admin.translations.title")}</h1>
          <p className="text-muted-foreground">
            {t("admin.translations.description")}
          </p>
        </div>
      </div>

      <Tabs defaultValue="translations">
        <TabsList>
          <TabsTrigger value="translations" className="gap-2">
            <Languages className="h-4 w-4" />
            {t("admin.translations.dynamicTranslations")}
          </TabsTrigger>
          <TabsTrigger value="languages" className="gap-2">
            <Globe className="h-4 w-4" />
            {t("admin.languages.title")}
          </TabsTrigger>
        </TabsList>

        {/* Translations Tab */}
        <TabsContent value="translations" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row gap-4 justify-between">
                <div className="flex flex-col sm:flex-row gap-4 flex-1">
                  {/* Filters are now separate from DataTable internal search, 
                       we can pass them as props or let DataTable handle global filtering.
                       However, DataTable usually handles one search key. 
                       Here we might want custom filters outside or integrated.
                       For now, we'll keep the custom filters and pass filtered data to DataTable.
                       Wait, DataTable has its own search input. We should rely on that for text search,
                       and use external controls for Namespace/Status filtering.
                   */}
                  <div className="flex gap-4">
                    <Select value={filterNamespace} onValueChange={setFilterNamespace}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">
                          {t("admin.translations.allNamespaces")}
                        </SelectItem>
                        {namespaces.map((ns) => (
                          <SelectItem key={ns} value={ns}>
                            {namespaceLabel(ns)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as TranslationStatusFilter)}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">
                          {t("admin.translations.statusFilter.all")}
                        </SelectItem>
                        <SelectItem value="missing">
                          {t("admin.translations.statusFilter.missing")}
                        </SelectItem>
                        <SelectItem value="stale">
                          {t("admin.translations.statusFilter.stale")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button onClick={handleCreate}>
                  <Plus className="h-4 w-4 mr-2" />
                  {t("admin.translations.add")}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {translationsLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  {t("common.loading")}
                </div>
              ) : isError ? (
                <div className="text-center py-8 text-destructive">
                  <p>{t("common.error")}</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    {translationsError instanceof Error ? translationsError.message : String(translationsError)}
                  </p>
                </div>
              ) : (
                <DataTable
                  columns={columns}
                  data={filteredTranslations}
                  searchKey="key"
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Languages Tab - Keeping Manual Table as it's small and specific */}
        <TabsContent value="languages" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>{t("admin.languages.title")}</CardTitle>
                <CardDescription>{t("admin.languages.description")}</CardDescription>
              </div>
              <Button onClick={handleCreateLanguage}>
                <Plus className="h-4 w-4 mr-2" />
                {t("admin.languages.add")}
              </Button>
            </CardHeader>
            <CardContent>
              {languagesLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  {t("common.loading")}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]"></TableHead>
                      <TableHead>{t("admin.languages.code")}</TableHead>
                      <TableHead>{t("admin.languages.nativeName")}</TableHead>
                      <TableHead>{t("admin.languages.englishName")}</TableHead>
                      <TableHead>{t("admin.languages.status")}</TableHead>
                      <TableHead>{t("admin.languages.default")}</TableHead>
                      <TableHead className="w-[100px]">{t("admin.translations.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {languages.map((lang) => (
                      <TableRow key={lang.code}>
                        <TableCell>
                          <GripVertical className="h-4 w-4 text-muted-foreground" />
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono">
                            {lang.code}
                          </Badge>
                        </TableCell>
                        <TableCell>{lang.name_native}</TableCell>
                        <TableCell>{lang.name_key}</TableCell>
                        <TableCell>
                          <Switch
                            checked={!!lang.is_active}
                            onCheckedChange={() => handleToggleLanguage({ ...lang, name_key: lang.name_key ?? "" })}
                          />
                        </TableCell>
                        <TableCell>
                          {lang.is_default && (
                            <Check className="h-4 w-4 text-primary" />
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEditLanguage({ ...lang, name_key: lang.name_key ?? "" })}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {!lang.is_default && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteLanguage(lang.code)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Translation Dialog - Reuse key parts from original */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Languages className="h-5 w-5" />
              {editingKey
                ? t("admin.translations.editTitle")
                : t("admin.translations.createTitle")}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("admin.translations.key")}</Label>
                <Input
                  value={formData.key}
                  onChange={(e) =>
                    setFormData({ ...formData, key: e.target.value })
                  }
                  placeholder={t("admin.translations.placeholders.keyExample")}
                  disabled={!!editingKey}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("admin.translations.namespace")}</Label>
                <Select
                  value={formData.namespace}
                  onValueChange={(value) =>
                    setFormData({ ...formData, namespace: value })
                  }
                  disabled={!!editingKey}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {namespaces.map((ns) => (
                      <SelectItem key={ns} value={ns}>
                        {namespaceLabel(ns)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-4">
              <LocalizedFieldEditor
                label={t("admin.translations.value")}
                fieldId="translation-value"
                value={formData.values as Partial<Record<SupportedLocale, string>>}
                onChange={(locale, value) =>
                  setFormData({
                    ...formData,
                    values: { ...formData.values, [locale]: value },
                  })
                }
                primaryLocale={sourceLocale}
                targetLocale={targetLocale}
                onSourceLocaleChange={setSourceLocale}
                onTargetLocaleChange={setTargetLocale}
                locales={activeLocales}
                localeLabels={localeLabels}
                multiline
                rows={3}
              />

              <div className="flex items-center gap-2">
                <Switch
                  id="translations-show-all"
                  checked={showAllLocales}
                  onCheckedChange={setShowAllLocales}
                />
                <Label htmlFor="translations-show-all">
                  {t("admin.translations.showAllLanguages")}
                </Label>
              </div>

              {showAllLocales && (
                <div className="space-y-4">
                  {activeLocales.map((locale) => (
                    <div key={locale} className="space-y-2">
                      <Label className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono text-xs">
                          {locale.toUpperCase()}
                        </Badge>
                        {localeLabels[locale] ?? locale.toUpperCase()}
                      </Label>
                      <Textarea
                        value={formData.values[locale] || ""}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            values: { ...formData.values, [locale]: e.target.value },
                          })
                        }
                        rows={2}
                        placeholder={`${t("admin.translations.valuePlaceholder")} (${localeLabels[locale] ?? locale.toUpperCase()})`}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleSubmit} disabled={upsertMutation.isPending}>
              {upsertMutation.isPending
                ? t("common.saving")
                : editingKey
                  ? t("common.save")
                  : t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Language Dialog - Reuse from original (simplified for brevity in this tool call) */}
      <Dialog open={isLanguageDialogOpen} onOpenChange={setIsLanguageDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              {editingLanguage
                ? t("admin.languages.editTitle")
                : t("admin.languages.createTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("admin.languages.code")}</Label>
              <Input
                value={languageForm.code}
                onChange={(e) =>
                  setLanguageForm({ ...languageForm, code: e.target.value.toLowerCase() })
                }
                disabled={!!editingLanguage}
                maxLength={5}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("admin.languages.nativeName")}</Label>
              <Input
                value={languageForm.name_native}
                onChange={(e) =>
                  setLanguageForm({ ...languageForm, name_native: e.target.value })
                }
              />
            </div>
            {/* ... other fields ... */}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsLanguageDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleSubmitLanguage}
              disabled={createLanguageMutation.isPending || updateLanguageMutation.isPending}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
