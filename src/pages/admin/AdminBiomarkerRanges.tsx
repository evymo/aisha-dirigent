import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Activity, Search, Globe, Loader2 } from 'lucide-react';
import {
  useAllBiomarkerReferenceRanges,
  useUpdateBiomarkerReferenceRange,
  useCreateBiomarkerReferenceRange,
  useDeleteBiomarkerReferenceRange,
  BiomarkerReferenceRange,
} from '@/hooks/useBiomarkerReferenceRanges';
import {
  useDynamicTranslationsMap,
  useFetchTranslationsForKeys,
  useUpsertTranslations,
  SUPPORTED_LOCALES,
  type SupportedLocale,
  type TranslationInput,
} from '@/hooks/useDynamicTranslations';
import { LocalizedFieldEditor } from '@/components/admin/LocalizedFieldEditor';
import { getUserFacingDataErrorMessage } from '@/lib/security/userFacingErrors';
import { safeError } from '@/lib/security/safeLogger';

type LocalizedText = Partial<Record<SupportedLocale, string>>;

const TRANSLATION_NAMESPACE = 'biomarkers';

// Helper to create empty localized record
const createEmptyLocalized = (): LocalizedText =>
  SUPPORTED_LOCALES.reduce<LocalizedText>((acc, locale) => {
    acc[locale] = "";
    return acc;
  }, {});

interface FormData {
  biomarker_key: string;
  name_key: string;
  unit: string;
  min_value: string;
  max_value: string;
  optimal_min: string;
  optimal_max: string;
  critical_low: string;
  critical_high: string;
  category: string;
  description_key: string;
  is_active: boolean;
  // Localized values for inline editing
  nameTranslations: LocalizedText;
  descriptionTranslations: LocalizedText;
}

const initialFormData: FormData = {
  biomarker_key: '',
  name_key: '',
  unit: '',
  min_value: '',
  max_value: '',
  optimal_min: '',
  optimal_max: '',
  critical_low: '',
  critical_high: '',
  category: 'general',
  description_key: '',
  is_active: true,
  nameTranslations: createEmptyLocalized(),
  descriptionTranslations: createEmptyLocalized(),
};

const AdminBiomarkerRanges = () => {
  const { t, i18n } = useTranslation();
  const { data: ranges, isLoading } = useAllBiomarkerReferenceRanges();
  const updateRange = useUpdateBiomarkerReferenceRange();
  const createRange = useCreateBiomarkerReferenceRange();
  const deleteRange = useDeleteBiomarkerReferenceRange();
  const upsertTranslations = useUpsertTranslations();
  const { mutateAsync: fetchTranslationsForKeys } = useFetchTranslationsForKeys();

  const categories = [
    { value: 'inflammation', label: t('admin.biomarkers.categories.inflammation') },
    { value: 'metabolic', label: t('admin.biomarkers.categories.metabolic') },
    { value: 'lipids', label: t('admin.biomarkers.categories.lipids') },
    { value: 'vitamins', label: t('admin.biomarkers.categories.vitamins') },
    { value: 'liver', label: t('admin.biomarkers.categories.liver') },
    { value: 'kidney', label: t('admin.biomarkers.categories.kidney') },
    { value: 'immune', label: t('admin.biomarkers.categories.immune') },
    { value: 'advanced', label: t('admin.biomarkers.categories.advanced') },
    { value: 'blood', label: t('admin.biomarkers.categories.blood') },
    { value: 'general', label: t('admin.biomarkers.categories.general') },
  ];

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRange, setEditingRange] = useState<BiomarkerReferenceRange | null>(null);
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [isSaving, setIsSaving] = useState(false);

  // Locale state for LocalizedFieldEditor
  const [sourceLocale, setSourceLocale] = useState<SupportedLocale>(
    (i18n.language as SupportedLocale) || "en"
  );
  const [targetLocale, setTargetLocale] = useState<SupportedLocale>("cs");

  // Resolve translation keys for display
  const nameKeys = (ranges ?? []).map(r => r.name_key).filter(Boolean);
  const descKeys = (ranges ?? []).map(r => r.description_key).filter((k): k is string => Boolean(k));
  const translationsMap = useDynamicTranslationsMap([...nameKeys, ...descKeys], TRANSLATION_NAMESPACE, "en");

  const filteredRanges = ranges?.filter((range) => {
    const matchesSearch =
      range.biomarker_key.toLowerCase().includes(searchTerm.toLowerCase()) ||
      range.name_key.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (translationsMap[range.name_key] ?? '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || range.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

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

  const handleOpenDialog = useCallback(async (range?: BiomarkerReferenceRange) => {
    if (range) {
      setEditingRange(range);
      
      const newFormData: FormData = {
        biomarker_key: range.biomarker_key,
        name_key: range.name_key,
        unit: range.unit,
        min_value: range.min_value?.toString() || '',
        max_value: range.max_value?.toString() || '',
        optimal_min: range.optimal_min?.toString() || '',
        optimal_max: range.optimal_max?.toString() || '',
        critical_low: range.critical_low?.toString() || '',
        critical_high: range.critical_high?.toString() || '',
        category: range.category,
        description_key: range.description_key || '',
        is_active: range.is_active,
        nameTranslations: createEmptyLocalized(),
        descriptionTranslations: createEmptyLocalized(),
      };

      // Collect translation keys
      const keysToFetch: string[] = [];
      if (range.name_key) keysToFetch.push(range.name_key);
      if (range.description_key) keysToFetch.push(range.description_key);

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
          if (range.name_key && translationsByKey[range.name_key]) {
            newFormData.nameTranslations = { ...createEmptyLocalized(), ...translationsByKey[range.name_key] };
          }
          if (range.description_key && translationsByKey[range.description_key]) {
            newFormData.descriptionTranslations = { ...createEmptyLocalized(), ...translationsByKey[range.description_key] };
          }
        } catch (error) {
          safeError("admin.biomarkers.loadTranslationsFailed", error);
        }
      }

      setFormData(newFormData);
    } else {
      setEditingRange(null);
      setFormData(initialFormData);
    }
    setIsDialogOpen(true);
  }, [fetchTranslationsForKeys]);

  const handleSave = async () => {
    setIsSaving(true);
    
    try {
      // Generate keys if not provided
      const nameKey = formData.name_key || `biomarkers.${formData.biomarker_key}.name`;
      const descriptionKey = formData.description_key || `biomarkers.${formData.biomarker_key}.description`;

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

      // Prepare payload for RPC
      const payload = {
        biomarker_key: formData.biomarker_key,
        name_key: nameKey,
        unit: formData.unit,
        min_value: formData.min_value ? parseFloat(formData.min_value) : null,
        max_value: formData.max_value ? parseFloat(formData.max_value) : null,
        optimal_min: formData.optimal_min ? parseFloat(formData.optimal_min) : null,
        optimal_max: formData.optimal_max ? parseFloat(formData.optimal_max) : null,
        critical_low: formData.critical_low ? parseFloat(formData.critical_low) : null,
        critical_high: formData.critical_high ? parseFloat(formData.critical_high) : null,
        category: formData.category,
        description_key: descriptionKey || null,
        is_active: formData.is_active,
      };

      if (editingRange) {
        await updateRange.mutateAsync({ id: editingRange.id, ...payload });
        toast.success(t('admin.biomarkers.updateSuccess'));
      } else {
        await createRange.mutateAsync(payload);
        toast.success(t('admin.biomarkers.createSuccess'));
      }
      setIsDialogOpen(false);
    } catch (error) {
      toast.error(getUserFacingDataErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('admin.biomarkers.confirmDelete'))) {
      return;
    }
    try {
      await deleteRange.mutateAsync(id);
      toast.success(t('admin.biomarkers.deleteSuccess'));
    } catch (error) {
      toast.error(getUserFacingDataErrorMessage(error));
    }
  };

  const handleToggleActive = async (range: BiomarkerReferenceRange) => {
    try {
      await updateRange.mutateAsync({ id: range.id, is_active: !range.is_active });
      toast.success(t('admin.biomarkers.statusUpdated'));
    } catch (error) {
      toast.error(getUserFacingDataErrorMessage(error));
    }
  };

  const getName = (range: BiomarkerReferenceRange) => {
    return translationsMap[range.name_key] ?? range.name_key;
  };

  return (
    <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="h-6 w-6" />
              {t('admin.biomarkers.title')}
            </h1>
            <p className="text-muted-foreground">
              {t('admin.biomarkers.description')}
            </p>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => handleOpenDialog()}>
                <Plus className="h-4 w-4 mr-2" />
                {t('admin.biomarkers.addNew')}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingRange
                    ? t('admin.biomarkers.edit')
                    : t('admin.biomarkers.create')}
                </DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t('admin.biomarkers.key')}</Label>
                    <Input
                      value={formData.biomarker_key}
                      onChange={(e) => setFormData({ ...formData, biomarker_key: e.target.value })}
                      placeholder={t('admin.biomarkers.placeholders.biomarkerKey')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('admin.biomarkers.category')}</Label>
                    <Select
                      value={formData.category}
                      onValueChange={(v) => setFormData({ ...formData, category: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((cat) => (
                          <SelectItem key={cat.value} value={cat.value}>
                            {cat.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{t('admin.biomarkers.unit')}</Label>
                  <Input
                    value={formData.unit}
                    onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                    placeholder={t('admin.biomarkers.placeholders.unit')}
                  />
                </div>

                {/* Inline Localization for Name */}
                <div className="space-y-4 border rounded-lg p-4">
                  <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <Globe className="h-4 w-4" />
                    <span>{t('admin.biomarkers.localizedContent')}</span>
                  </div>

                  <LocalizedFieldEditor
                    label={t('admin.biomarkers.name')}
                    fieldId="biomarker-name"
                    value={formData.nameTranslations}
                    onChange={(locale, value) => handleLocalizedChange('nameTranslations', locale, value)}
                    primaryLocale={sourceLocale}
                    targetLocale={targetLocale}
                    onSourceLocaleChange={setSourceLocale}
                    onTargetLocaleChange={setTargetLocale}
                    required
                  />

                  <LocalizedFieldEditor
                    label={t('admin.biomarkers.descriptionLabel')}
                    fieldId="biomarker-description"
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

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t('admin.biomarkers.minValue')}</Label>
                    <Input
                      type="number"
                      step="any"
                      value={formData.min_value}
                      onChange={(e) => setFormData({ ...formData, min_value: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('admin.biomarkers.maxValue')}</Label>
                    <Input
                      type="number"
                      step="any"
                      value={formData.max_value}
                      onChange={(e) => setFormData({ ...formData, max_value: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t('admin.biomarkers.optimalMin')}</Label>
                    <Input
                      type="number"
                      step="any"
                      value={formData.optimal_min}
                      onChange={(e) => setFormData({ ...formData, optimal_min: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('admin.biomarkers.optimalMax')}</Label>
                    <Input
                      type="number"
                      step="any"
                      value={formData.optimal_max}
                      onChange={(e) => setFormData({ ...formData, optimal_max: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t('admin.biomarkers.criticalLow')}</Label>
                    <Input
                      type="number"
                      step="any"
                      value={formData.critical_low}
                      onChange={(e) => setFormData({ ...formData, critical_low: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('admin.biomarkers.criticalHigh')}</Label>
                    <Input
                      type="number"
                      step="any"
                      value={formData.critical_high}
                      onChange={(e) => setFormData({ ...formData, critical_high: e.target.value })}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Switch
                    checked={formData.is_active}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                  />
                  <Label>{t('admin.biomarkers.active')}</Label>
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button onClick={handleSave} disabled={isSaving || upsertTranslations.isPending}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {t('common.save')}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t('admin.biomarkers.search')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder={t('admin.biomarkers.filterCategory')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('admin.biomarkers.allCategories')}</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.value} value={cat.value}>
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                {t('common.loading')}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('admin.biomarkers.name')}</TableHead>
                      <TableHead>{t('admin.biomarkers.key')}</TableHead>
                      <TableHead>{t('admin.biomarkers.category')}</TableHead>
                      <TableHead>{t('admin.biomarkers.normalRange')}</TableHead>
                      <TableHead>{t('admin.biomarkers.optimalRange')}</TableHead>
                      <TableHead>{t('admin.biomarkers.status')}</TableHead>
                      <TableHead className="text-right">{t('admin.biomarkers.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRanges?.map((range) => (
                      <TableRow key={range.id}>
                        <TableCell className="font-medium">{getName(range)}</TableCell>
                        <TableCell>
                          <code className="text-xs bg-muted px-1 py-0.5 rounded">{range.biomarker_key}</code>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{range.category}</Badge>
                        </TableCell>
                        <TableCell>
                          {range.min_value !== null || range.max_value !== null ? (
                            <span className="text-sm">
                              {range.min_value ?? '—'} – {range.max_value ?? '—'} {range.unit}
                            </span>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell>
                          {range.optimal_min !== null || range.optimal_max !== null ? (
                            <span className="text-sm text-success">
                              {range.optimal_min ?? '—'} – {range.optimal_max ?? '—'} {range.unit}
                            </span>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={range.is_active}
                            onCheckedChange={() => handleToggleActive(range)}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(range)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(range.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
    </div>
  );
};

export default AdminBiomarkerRanges;
