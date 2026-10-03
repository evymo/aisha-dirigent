import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  useProductCatalogAdmin,
  useCreateProductCatalog,
  useUpdateProductCatalog,
  useDeleteProductCatalog,
  type ProductCatalogAdmin,
} from "@/hooks";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Save,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Pill,
  Languages,
} from "lucide-react";
import { toast } from "sonner";
import { getLocaleLabel } from "@/components/common/LocaleFlag";
import { useActiveLocales } from "@/hooks/useActiveLocales";
import type { LocaleCode } from "@/hooks/useDynamicTranslations";

const PRODUCT_CATEGORIES = ["vitamin", "mineral", "amino_acid", "probiotic", "herbal", "enzyme", "fatty_acid", "product"];
const DOSE_UNITS = ["mg", "mcg", "g", "ml", "IU", "capsules", "tablets", "drops"];
const DOSE_TIMINGS = ["morning", "noon", "evening", "night", "with_meals", "before_meals", "after_meals"];

interface FormData {
  code: string;
  category: string;
  icon: string;
  color: string;
  default_dose_amount: number | null;
  default_dose_unit: string | null;
  default_doses_per_day: number | null;
  default_dose_timing: string[];
  sort_order: number;
  is_active: boolean;
  translations: Record<string, { name: string; description: string }>;
}

const emptyTranslations = (
  locales: LocaleCode[],
): Record<string, { name: string; description: string }> => {
  const result: Record<string, { name: string; description: string }> = {};
  for (const locale of locales) {
    result[locale] = { name: "", description: "" };
  }
  return result;
};

// A factory, not a const: the locale set is DB data (`supported_languages`), so
// it is not known at module-eval time.
const createDefaultFormData = (locales: LocaleCode[]): FormData => ({
  code: "",
  category: "product",
  icon: "pill",
  color: "#6366f1",
  default_dose_amount: null,
  default_dose_unit: null,
  default_doses_per_day: null,
  default_dose_timing: [],
  sort_order: 0,
  is_active: true,
  translations: emptyTranslations(locales),
});

export default function AdminProductCatalog() {
  const { t } = useTranslation();

  // Locales this instance publishes — NOT a literal list. A hardcoded
  // ["cs","en","de","fr","ru","th"] used to sit at the top of this file, so the
  // coverage count and the per-locale tabs were wrong for any fork with a
  // different language set.
  const { codes: activeLocales } = useActiveLocales();

  // React Query hooks
  const { data: items = [], isLoading, refetch } = useProductCatalogAdmin();
  const createItem = useCreateProductCatalog();
  const updateItem = useUpdateProductCatalog();
  const deleteItem = useDeleteProductCatalog();

  const saving = createItem.isPending || updateItem.isPending;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ProductCatalogAdmin | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<ProductCatalogAdmin | null>(null);
  const [formData, setFormData] = useState<FormData>(createDefaultFormData(activeLocales));

  const resetForm = () => {
    setFormData(createDefaultFormData(activeLocales));
    setEditingItem(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEditDialog = (item: ProductCatalogAdmin) => {
    setEditingItem(item);
    const translations = emptyTranslations(activeLocales);
    if (item.translations) {
      for (const [locale, trans] of Object.entries(item.translations)) {
        if (translations[locale]) {
          translations[locale] = {
            name: trans.name || "",
            description: trans.description || "",
          };
        }
      }
    }
    setFormData({
      code: item.code,
      category: item.category,
      icon: item.icon,
      color: item.color,
      default_dose_amount: item.default_dose_amount,
      default_dose_unit: item.default_dose_unit,
      default_doses_per_day: item.default_doses_per_day,
      default_dose_timing: item.default_dose_timing || [],
      sort_order: item.sort_order,
      is_active: item.is_active,
      translations,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.code.trim()) {
      toast.error(t("admin.productCatalog.codeRequired"));
      return;
    }

    if (!formData.translations.en?.name?.trim()) {
      toast.error(t("admin.productCatalog.nameRequired"));
      return;
    }

    try {
      const payload = {
        code: formData.code,
        category: formData.category,
        icon: formData.icon,
        color: formData.color,
        default_dose_amount: formData.default_dose_amount,
        default_dose_unit: formData.default_dose_unit,
        default_doses_per_day: formData.default_doses_per_day,
        default_dose_timing: formData.default_dose_timing.length > 0 ? formData.default_dose_timing : null,
        sort_order: formData.sort_order,
        is_active: formData.is_active,
        translations: formData.translations,
      };

      if (editingItem) {
        await updateItem.mutateAsync({ ...payload, id: editingItem.id });
        toast.success(t("admin.productCatalog.updateSuccess"));
      } else {
        await createItem.mutateAsync(payload);
        toast.success(t("admin.productCatalog.createSuccess"));
      }
      setDialogOpen(false);
      resetForm();
    } catch {
      toast.error(t("admin.productCatalog.saveError"));
    }
  };

  const handleDelete = async () => {
    if (!itemToDelete) return;
    try {
      await deleteItem.mutateAsync(itemToDelete.id);
      toast.success(t("admin.productCatalog.deleteSuccess"));
      setDeleteConfirmOpen(false);
      setItemToDelete(null);
    } catch {
      toast.error(t("admin.productCatalog.deleteError"));
    }
  };

  const updateTranslation = (locale: string, field: "name" | "description", value: string) => {
    setFormData((prev) => ({
      ...prev,
      translations: {
        ...prev.translations,
        [locale]: {
          ...prev.translations[locale],
          [field]: value,
        },
      },
    }));
  };

  const toggleTimingSelection = (timing: string) => {
    setFormData((prev) => ({
      ...prev,
      default_dose_timing: prev.default_dose_timing.includes(timing)
        ? prev.default_dose_timing.filter((t) => t !== timing)
        : [...prev.default_dose_timing, timing],
    }));
  };

  // Stats
  const activeCount = items.filter((i) => i.is_active).length;
  const categoryCounts = new Set(items.map((i) => i.category)).size;
  const translatedCount = items.filter((i) => {
    const tr = i.translations;
    return tr && Object.keys(tr).length >= 2;
  }).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("admin.productCatalog.title")}</h1>
          <p className="text-muted-foreground">{t("admin.productCatalog.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            {t("common.refresh")}
          </Button>
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4 mr-2" />
            {t("admin.productCatalog.create")}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("admin.productCatalog.stats.total")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{items.length}</div>
            <p className="text-xs text-muted-foreground">
              {activeCount} {t("common.active")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("admin.productCatalog.stats.categories")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{categoryCounts}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("admin.productCatalog.stats.translated")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{translatedCount}</div>
            <p className="text-xs text-muted-foreground">
              {t("admin.productCatalog.stats.withTranslations")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.productCatalog.list")}</CardTitle>
          <CardDescription>{t("admin.productCatalog.listDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Pill className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>{t("admin.productCatalog.empty")}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.productCatalog.table.icon")}</TableHead>
                  <TableHead>{t("admin.productCatalog.table.code")}</TableHead>
                  <TableHead>{t("admin.productCatalog.table.name")}</TableHead>
                  <TableHead>{t("admin.productCatalog.table.category")}</TableHead>
                  <TableHead>{t("admin.productCatalog.table.distribution")}</TableHead>
                  <TableHead>{t("admin.productCatalog.table.translations")}</TableHead>
                  <TableHead>{t("admin.productCatalog.table.status")}</TableHead>
                  <TableHead className="text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const transCount = item.translations ? Object.keys(item.translations).length : 0;
                  const enName = item.translations?.en?.name || item.code;
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <span className="text-2xl">{item.icon}</span>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-1 py-0.5 rounded">{item.code}</code>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{enName}</div>
                        {item.translations?.cs?.name && (
                          <div className="text-xs text-muted-foreground">{item.translations.cs.name}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{item.category}</Badge>
                      </TableCell>
                      <TableCell>
                        {item.default_dose_amount ? (
                          <div>
                            <div className="font-medium text-sm">
                              {item.default_dose_amount} {item.default_dose_unit}
                            </div>
                            {item.default_doses_per_day && (
                              <div className="text-xs text-muted-foreground">
                                {`${item.default_doses_per_day}× ${t("admin.productCatalog.perDay")}`}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">{t("common.placeholderHyphen")}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Languages className="h-3 w-3 text-muted-foreground" />
                          <span className="text-sm">{transCount}/{activeLocales.length}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={item.is_active ? "default" : "secondary"}>
                          {item.is_active ? (
                            <><CheckCircle className="h-3 w-3 mr-1" />{t("common.active")}</>
                          ) : (
                            <><AlertTriangle className="h-3 w-3 mr-1" />{t("common.inactive")}</>
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="icon" onClick={() => openEditDialog(item)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setItemToDelete(item);
                              setDeleteConfirmOpen(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingItem ? t("admin.productCatalog.edit") : t("admin.productCatalog.create")}
            </DialogTitle>
            <DialogDescription>
              {t("admin.productCatalog.dialogDescription")}
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="basic" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="basic">{t("admin.productCatalog.tabs.basic")}</TabsTrigger>
              <TabsTrigger value="distribution">{t("admin.productCatalog.tabs.distribution")}</TabsTrigger>
              <TabsTrigger value="translations">{t("admin.productCatalog.tabs.translations")}</TabsTrigger>
            </TabsList>

            {/* Basic Tab */}
            <TabsContent value="basic" className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productCatalog.form.code")} *</Label>
                  <Input
                    value={formData.code}
                    onChange={(e) => setFormData((prev) => ({ ...prev, code: e.target.value }))}
                    placeholder={t("admin.productCatalog.form.codePlaceholder")}
                    disabled={!!editingItem}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productCatalog.form.category")}</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={formData.category}
                    onChange={(e) => setFormData((prev) => ({ ...prev, category: e.target.value }))}
                  >
                    {PRODUCT_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {t(`admin.productCatalog.categories.${cat}`)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productCatalog.form.icon")}</Label>
                  <Input
                    value={formData.icon}
                    onChange={(e) => setFormData((prev) => ({ ...prev, icon: e.target.value }))}
                    placeholder="pill"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productCatalog.form.color")}</Label>
                  <div className="flex gap-2">
                    <Input
                      type="color"
                      value={formData.color}
                      onChange={(e) => setFormData((prev) => ({ ...prev, color: e.target.value }))}
                      className="w-12 h-10 p-1"
                    />
                    <Input
                      value={formData.color}
                      onChange={(e) => setFormData((prev) => ({ ...prev, color: e.target.value }))}
                      placeholder={t("admin.productCatalog.form.colorPlaceholder")}
                      className="flex-1"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productCatalog.form.sortOrder")}</Label>
                  <Input
                    type="number"
                    min={0}
                    value={formData.sort_order}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        sort_order: parseInt(e.target.value) || 0,
                      }))
                    }
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) =>
                    setFormData((prev) => ({ ...prev, is_active: checked }))
                  }
                />
                <Label htmlFor="is_active">{t("admin.productCatalog.form.isActive")}</Label>
              </div>
            </TabsContent>

            {/* Distribution Tab */}
            <TabsContent value="distribution" className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productCatalog.form.doseAmount")}</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.5}
                    value={formData.default_dose_amount ?? ""}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        default_dose_amount: e.target.value ? parseFloat(e.target.value) : null,
                      }))
                    }
                    placeholder={t("admin.productCatalog.form.doseAmountPlaceholder")}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productCatalog.form.doseUnit")}</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={formData.default_dose_unit || ""}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        default_dose_unit: e.target.value || null,
                      }))
                    }
                  >
                    <option value="">{t("common.none")}</option>
                    {DOSE_UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productCatalog.form.dosesPerDay")}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={formData.default_doses_per_day ?? ""}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        default_doses_per_day: e.target.value ? parseInt(e.target.value) : null,
                      }))
                    }
                    placeholder={t("admin.productCatalog.form.dosesPerDayPlaceholder")}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t("admin.productCatalog.form.doseTiming")}</Label>
                <div className="flex flex-wrap gap-2">
                  {DOSE_TIMINGS.map((timing) => (
                    <Badge
                      key={timing}
                      variant={formData.default_dose_timing.includes(timing) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => toggleTimingSelection(timing)}
                    >
                      {t(`admin.distributionProtocols.timing.${timing}`)}
                    </Badge>
                  ))}
                </div>
              </div>
            </TabsContent>

            {/* Translations Tab */}
            <TabsContent value="translations" className="space-y-4">
              {activeLocales.map((locale) => (
                <Card key={locale}>
                  <CardHeader className="py-3 px-4">
                    <CardTitle className="text-sm">{getLocaleLabel(locale)}</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-2">
                    <div className="space-y-1">
                      <Label className="text-xs">{t("admin.productCatalog.form.translationName")}</Label>
                      <Input
                        value={formData.translations[locale]?.name || ""}
                        onChange={(e) => updateTranslation(locale, "name", e.target.value)}
                        placeholder={`${t("admin.productCatalog.form.namePlaceholder")} (${locale})`}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("admin.productCatalog.form.translationDescription")}</Label>
                      <Input
                        value={formData.translations[locale]?.description || ""}
                        onChange={(e) => updateTranslation(locale, "description", e.target.value)}
                        placeholder={`${t("admin.productCatalog.form.descriptionPlaceholder")} (${locale})`}
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t("common.saving")}
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  {t("common.save")}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.productCatalog.deleteConfirm.title")}</DialogTitle>
            <DialogDescription>
              {t("admin.productCatalog.deleteConfirm.description")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              <Trash2 className="h-4 w-4 mr-2" />
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
