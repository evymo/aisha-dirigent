import { useState, useCallback } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useDistributionProtocolsAdmin,
  useStudiesDropdownDistribution,
  useProductsDropdownDistribution,
  useCreateDistributionProtocol,
  useUpdateDistributionProtocol,
  useDeleteDistributionProtocol,
  type DistributionProtocol,
} from "@/hooks";
import {
  useFetchTranslationsForKeys,
  useUpsertTranslations,
  SUPPORTED_LOCALES,
  type SupportedLocale,
  type TranslationInput,
} from "@/hooks/useDynamicTranslations";
import { LocalizedFieldEditor } from "@/components/admin/LocalizedFieldEditor";
import { 
  Pill,
  Plus,
  Pencil,
  Trash2,
  FlaskConical,
  Package,
  Loader2,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Globe
} from "lucide-react";
import { toast } from "sonner";
import { safeError } from "@/lib/security/safeLogger";

const DOSE_UNITS = ['drops', 'ml', 'capsules', 'tablets', 'mg', 'g'];
const DOSE_TIMINGS = ['morning', 'noon', 'afternoon', 'evening', 'night', 'with_meals', 'before_meals', 'after_meals'];
const TRANSLATION_NAMESPACE = 'distribution_protocols';

type LocalizedText = Partial<Record<SupportedLocale, string>>;

// Helper to create empty localized record
const createEmptyLocalized = (): LocalizedText =>
  SUPPORTED_LOCALES.reduce<LocalizedText>((acc, locale) => {
    acc[locale] = "";
    return acc;
  }, {});

interface FormData {
  name: string;
  description: string;
  study_id: string;
  product_id: string;
  dose_amount: number;
  dose_unit: string;
  doses_per_day: number;
  dose_timing: string[];
  arm_code: string;
  is_active: boolean;
  // Localized values for inline editing
  nameTranslations: LocalizedText;
  descriptionTranslations: LocalizedText;
}

const initialFormData: FormData = {
  name: '',
  description: '',
  study_id: '',
  product_id: '',
  dose_amount: 5,
  dose_unit: 'drops',
  doses_per_day: 3,
  dose_timing: ['morning', 'noon', 'evening'],
  arm_code: '',
  is_active: true,
  nameTranslations: createEmptyLocalized(),
  descriptionTranslations: createEmptyLocalized(),
};

export default function AdminDistributionProtocols() {
  const { t, i18n } = useTranslation();
  
  // React Query hooks
  const { data: protocols = [], isLoading: protocolsLoading, refetch: refetchProtocols } = useDistributionProtocolsAdmin();
  const { data: studies = [] } = useStudiesDropdownDistribution();
  const { data: products = [] } = useProductsDropdownDistribution();
  const createProtocol = useCreateDistributionProtocol();
  const updateProtocol = useUpdateDistributionProtocol();
  const deleteProtocol = useDeleteDistributionProtocol();
  const upsertTranslations = useUpsertTranslations();
  const { mutateAsync: fetchTranslationsForKeys } = useFetchTranslationsForKeys();

  const loading = protocolsLoading;
  const saving = createProtocol.isPending || updateProtocol.isPending || upsertTranslations.isPending;
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProtocol, setEditingProtocol] = useState<DistributionProtocol | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [protocolToDelete, setProtocolToDelete] = useState<DistributionProtocol | null>(null);
  const [formData, setFormData] = useState<FormData>(initialFormData);

  // Locale state for LocalizedFieldEditor
  const [sourceLocale, setSourceLocale] = useState<SupportedLocale>(
    (i18n.language as SupportedLocale) || "en"
  );
  const [targetLocale, setTargetLocale] = useState<SupportedLocale>("cs");

  const handleLocalizedChange = (
    field: 'nameTranslations' | 'descriptionTranslations',
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

  const resetForm = () => {
    setFormData(initialFormData);
    setEditingProtocol(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEditDialog = useCallback(async (protocol: DistributionProtocol) => {
    setEditingProtocol(protocol);
    
    const newFormData: FormData = {
      name: protocol.name,
      description: protocol.description || '',
      study_id: protocol.study_id || '',
      product_id: protocol.product_id || '',
      dose_amount: protocol.dose_amount,
      dose_unit: protocol.dose_unit,
      doses_per_day: protocol.doses_per_day,
      dose_timing: protocol.dose_timing || ['morning'],
      arm_code: protocol.arm_code || '',
      is_active: (protocol as { is_active?: boolean }).is_active ?? true,
      nameTranslations: createEmptyLocalized(),
      descriptionTranslations: createEmptyLocalized(),
    };

    // Collect translation keys (cast to access new DB fields)
    const protocolWithKeys = protocol as DistributionProtocol & { name_key?: string | null; description_key?: string | null };
    const keysToFetch: string[] = [];
    if (protocolWithKeys.name_key) keysToFetch.push(protocolWithKeys.name_key);
    if (protocolWithKeys.description_key) keysToFetch.push(protocolWithKeys.description_key);

    if (keysToFetch.length > 0) {
      try {
        const rows = await fetchTranslationsForKeys({
          keys: keysToFetch,
          namespace: TRANSLATION_NAMESPACE,
        });

        // Group translations by key
        const translationsByKey: Record<string, LocalizedText> = {};
        for (const row of rows) {
          if (!translationsByKey[row.key]) {
            translationsByKey[row.key] = {};
          }
          translationsByKey[row.key][row.locale] = row.value;
        }

        // Populate form data with translations
        if (protocolWithKeys.name_key && translationsByKey[protocolWithKeys.name_key]) {
          newFormData.nameTranslations = { ...createEmptyLocalized(), ...translationsByKey[protocolWithKeys.name_key] };
        }
        if (protocolWithKeys.description_key && translationsByKey[protocolWithKeys.description_key]) {
          newFormData.descriptionTranslations = { ...createEmptyLocalized(), ...translationsByKey[protocolWithKeys.description_key] };
        }
      } catch (error) {
        safeError("admin.distributionProtocols.loadTranslationsFailed", error);
      }
    }

    // Fallback: populate base locale from direct fields if no translations
    if (!newFormData.nameTranslations[sourceLocale]) {
      newFormData.nameTranslations[sourceLocale] = protocol.name || '';
    }
    if (!newFormData.descriptionTranslations[sourceLocale]) {
      newFormData.descriptionTranslations[sourceLocale] = protocol.description || '';
    }

    setFormData(newFormData);
    setDialogOpen(true);
  }, [fetchTranslationsForKeys, sourceLocale]);

  const handleSave = async () => {
    if (!formData.nameTranslations[sourceLocale]?.trim()) {
      toast.error(t("admin.distributionProtocols.nameRequired"));
      return;
    }

    try {
      // Generate keys based on protocol id or create new ones
      const protocolId = editingProtocol?.id || crypto.randomUUID();
      const nameKey = `${TRANSLATION_NAMESPACE}.${protocolId}.name`;
      const descriptionKey = `${TRANSLATION_NAMESPACE}.${protocolId}.description`;

      // Prepare translation inputs
      const translationInputs: TranslationInput[] = [];

      const addTranslations = (key: string, values: LocalizedText) => {
        SUPPORTED_LOCALES.forEach((locale) => {
          const value = values[locale];
          if (value && value.trim()) {
            translationInputs.push({
              key,
              locale,
              value: value.trim(),
              namespace: TRANSLATION_NAMESPACE,
            });
          }
        });
      };

      addTranslations(nameKey, formData.nameTranslations);
      addTranslations(descriptionKey, formData.descriptionTranslations);

      // Upsert translations first
      if (translationInputs.length > 0) {
        await upsertTranslations.mutateAsync(translationInputs);
      }

      // Use base locale value as the primary name/description
      const baseName = formData.nameTranslations[sourceLocale] || formData.nameTranslations.en || '';
      const baseDescription = formData.descriptionTranslations[sourceLocale] || formData.descriptionTranslations.en || '';

      if (editingProtocol) {
        await updateProtocol.mutateAsync({
          id: editingProtocol.id,
          data: {
            name: baseName,
            description: baseDescription,
            name_key: nameKey,
            description_key: descriptionKey,
            study_id: formData.study_id || null,
            product_id: formData.product_id || null,
            dose_amount: formData.dose_amount,
            dose_unit: formData.dose_unit,
            doses_per_day: formData.doses_per_day,
            dose_timing: formData.dose_timing,
            arm_code: formData.arm_code || "",
            is_active: formData.is_active,
          },
        });
        toast.success(t("admin.distributionProtocols.updateSuccess"));
      } else {
        await createProtocol.mutateAsync({
          name: baseName,
          description: baseDescription,
          name_key: nameKey,
          description_key: descriptionKey,
          study_id: formData.study_id || null,
          product_id: formData.product_id || null,
          dose_amount: formData.dose_amount,
          dose_unit: formData.dose_unit,
          doses_per_day: formData.doses_per_day,
          dose_timing: formData.dose_timing,
          arm_code: formData.arm_code || "",
          is_active: formData.is_active,
        });
        toast.success(t("admin.distributionProtocols.createSuccess"));
      }
      setDialogOpen(false);
      resetForm();
    } catch {
      toast.error(t("admin.distributionProtocols.saveError"));
    }
  };

  const handleDelete = async () => {
    if (!protocolToDelete) return;

    try {
      await deleteProtocol.mutateAsync(protocolToDelete.id);
      toast.success(t("admin.distributionProtocols.deleteSuccess"));
      setDeleteConfirmOpen(false);
      setProtocolToDelete(null);
    } catch {
      toast.error(t("admin.distributionProtocols.deleteError"));
    }
  };

  const toggleTimingSelection = (timing: string) => {
    setFormData(prev => ({
      ...prev,
      dose_timing: prev.dose_timing.includes(timing)
        ? prev.dose_timing.filter(t => t !== timing)
        : [...prev.dose_timing, timing]
    }));
  };

  // Stats
  const activeProtocols = protocols.filter(p => p.is_active ?? true).length;
  const uniqueStudies = new Set(protocols.filter(p => p.study_id).map(p => p.study_id)).size;
  const uniqueProducts = new Set(protocols.filter(p => p.product_id).map(p => p.product_id)).size;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("admin.distributionProtocols.title")}</h1>
          <p className="text-muted-foreground">{t("admin.distributionProtocols.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetchProtocols()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            {t("common.refresh")}
          </Button>
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4 mr-2" />
            {t("admin.distributionProtocols.create")}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("admin.distributionProtocols.stats.totalProtocols")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{protocols.length}</div>
            <p className="text-xs text-muted-foreground">
              {activeProtocols} {t("admin.distributionProtocols.stats.active")}
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("admin.distributionProtocols.stats.studies")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{uniqueStudies}</div>
            <p className="text-xs text-muted-foreground">
              {t("admin.distributionProtocols.stats.withProtocols")}
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("admin.distributionProtocols.stats.products")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{uniqueProducts}</div>
            <p className="text-xs text-muted-foreground">
              {t("admin.distributionProtocols.stats.inProtocols")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Protocols Table */}
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.distributionProtocols.list")}</CardTitle>
          <CardDescription>{t("admin.distributionProtocols.listDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : protocols.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Pill className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>{t("admin.distributionProtocols.empty")}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.distributionProtocols.table.name")}</TableHead>
                  <TableHead>{t("admin.distributionProtocols.table.study")}</TableHead>
                  <TableHead>{t("admin.distributionProtocols.table.product")}</TableHead>
                  <TableHead>{t("admin.distributionProtocols.table.distribution")}</TableHead>
                  <TableHead>{t("admin.distributionProtocols.table.timing")}</TableHead>
                  <TableHead>{t("admin.distributionProtocols.table.status")}</TableHead>
                  <TableHead className="text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {protocols.map((protocol) => (
                  <TableRow key={protocol.id}>
                    <TableCell>
                      <div className="font-medium">{protocol.name}</div>
                      {protocol.arm_code && (
                        <div className="text-xs text-muted-foreground">{t("admin.distributionProtocols.arm")}{t("common.separatorColon")} {protocol.arm_code}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      {protocol.study_name ? (
                        <div className="flex items-center gap-2">
                          <FlaskConical className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <div className="font-medium">{protocol.study_name}</div>
                            {protocol.study_code && (
                              <div className="text-xs text-muted-foreground">{protocol.study_code}</div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">{t("common.placeholderHyphen")}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {protocol.product_name ? (
                        <div className="flex items-center gap-2">
                          <Package className="h-4 w-4 text-muted-foreground" />
                          {protocol.product_name}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">{t("common.placeholderHyphen")}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">
                        {protocol.dose_amount} {protocol.dose_unit}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {protocol.doses_per_day}{t("common.multiplierTimes")} {t("admin.distributionProtocols.perDay")}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {protocol.dose_timing?.slice(0, 3).map((timing) => (
                          <Badge key={timing} variant="outline" className="text-xs">
                            {t(`admin.distributionProtocols.timing.${timing}`)}
                          </Badge>
                        ))}
                        {(protocol.dose_timing?.length || 0) > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{(protocol.dose_timing?.length || 0) - 3}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={(protocol.is_active ?? true) ? "default" : "secondary"}>
                        {(protocol.is_active ?? true) ? (
                          <><CheckCircle className="h-3 w-3 mr-1" />{t("common.active")}</>
                        ) : (
                          <><AlertTriangle className="h-3 w-3 mr-1" />{t("common.inactive")}</>
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(protocol)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setProtocolToDelete(protocol);
                            setDeleteConfirmOpen(true);
                          }}
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

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingProtocol 
                ? t("admin.distributionProtocols.edit") 
                : t("admin.distributionProtocols.create")}
            </DialogTitle>
            <DialogDescription>
              {t("admin.distributionProtocols.dialogDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Localized Name and Description */}
            <div className="space-y-4 border rounded-lg p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Globe className="h-4 w-4" />
                <span>{t("admin.distributionProtocols.localizedContent")}</span>
              </div>

              <LocalizedFieldEditor
                label={t("admin.distributionProtocols.form.name")}
                fieldId="protocol-name"
                value={formData.nameTranslations}
                onChange={(locale, value) => handleLocalizedChange('nameTranslations', locale, value)}
                primaryLocale={sourceLocale}
                targetLocale={targetLocale}
                onSourceLocaleChange={setSourceLocale}
                onTargetLocaleChange={setTargetLocale}
                required
              />

              <LocalizedFieldEditor
                label={t("admin.distributionProtocols.form.description")}
                fieldId="protocol-description"
                value={formData.descriptionTranslations}
                onChange={(locale, value) => handleLocalizedChange('descriptionTranslations', locale, value)}
                primaryLocale={sourceLocale}
                targetLocale={targetLocale}
                onSourceLocaleChange={setSourceLocale}
                onTargetLocaleChange={setTargetLocale}
                multiline
                rows={2}
              />
            </div>

            {/* Arm Code */}
            <div className="space-y-2">
              <Label>{t("admin.distributionProtocols.form.armCode")}</Label>
              <Input
                value={formData.arm_code}
                onChange={(e) => setFormData(prev => ({ ...prev, arm_code: e.target.value }))}
                placeholder={t("admin.distributionProtocols.form.armCodePlaceholder")}
              />
            </div>

            {/* Study and Product selection */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("admin.distributionProtocols.form.study")}</Label>
                <Select
                  value={formData.study_id || undefined}
                  onValueChange={(value) =>
                    setFormData((prev) => ({
                      ...prev,
                      study_id: value === "__none__" ? "" : value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("admin.distributionProtocols.form.selectStudy")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      <span className="text-muted-foreground">{t("common.none")}</span>
                    </SelectItem>
                    {studies.map((study) => (
                      <SelectItem key={study.id} value={study.id}>
                        {study.name} ({study.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{t("admin.distributionProtocols.form.product")}</Label>
                <Select
                  value={formData.product_id || undefined}
                  onValueChange={(value) =>
                    setFormData((prev) => ({
                      ...prev,
                      product_id: value === "__none__" ? "" : value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("admin.distributionProtocols.form.selectProduct")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      <span className="text-muted-foreground">{t("common.none")}</span>
                    </SelectItem>
                    {products.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Distribution info */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>{t("admin.distributionProtocols.form.doseAmount")}</Label>
                <Input
                  type="number"
                  value={formData.dose_amount}
                  onChange={(e) => setFormData(prev => ({ ...prev, dose_amount: parseInt(e.target.value) || 0 }))}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("admin.distributionProtocols.form.doseUnit")}</Label>
                <Select
                  value={formData.dose_unit}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, dose_unit: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOSE_UNITS.map((unit) => (
                      <SelectItem key={unit} value={unit}>
                        {t(`admin.distributionProtocols.units.${unit}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("admin.distributionProtocols.form.dosesPerDay")}</Label>
                <Input
                  type="number"
                  min={1}
                  max={12}
                  value={formData.doses_per_day}
                  onChange={(e) => setFormData(prev => ({ ...prev, doses_per_day: parseInt(e.target.value) || 1 }))}
                />
              </div>
            </div>

            {/* Timing */}
            <div className="space-y-2">
              <Label>{t("admin.distributionProtocols.form.timing")}</Label>
              <div className="flex flex-wrap gap-2">
                {DOSE_TIMINGS.map((timing) => (
                  <Badge
                    key={timing}
                    variant={formData.dose_timing.includes(timing) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => toggleTimingSelection(timing)}
                  >
                    {t(`admin.distributionProtocols.timing.${timing}`)}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Active toggle */}
            <div className="flex items-center gap-2">
              <Switch
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_active: checked }))}
              />
              <Label>{t("common.active")}</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.distributionProtocols.confirmDeleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("admin.distributionProtocols.confirmDeleteMessage", { name: protocolToDelete?.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
