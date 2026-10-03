import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getConsultantColumns, getContributionColumns } from "./study-details-columns";


import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Plus, FlaskConical, TrendingUp, DollarSign } from "lucide-react";
import {
  useUpsertTranslations,
  useFetchTranslationsForKeys,
  type TranslationInput,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@/hooks/useDynamicTranslations";
import {
  useAdminStudiesOverview,
  useStudyConsultantsAdmin,
  useStudyContributionsForStudyAdmin,
  useCreateStudyAdmin,
  useUpdateStudyAdmin,
  useUpdateStudyConsultantStatusAdmin,
  useUpdateStudyFundingStatusAdmin,
  type StudyWithDynamicData,
  type CreateStudyParams,
  type UpdateStudyParams,
  type FundingStatus,
  type StudyType,
} from "@/hooks";
import { DataTable } from "@/components/ui/data-table/DataTable";
import { getStudyColumns } from "./studies-columns";
import {
  StudyForm,
  TRANSLATION_NAMESPACE,
  defaultFormData,
  toDateTimeLocalValue,
  fromDateTimeLocalValue,
  parseProductsInput,
  type StudyFormData,
} from "./studies/index";

export default function AdminStudies() {
  const { t, i18n } = useTranslation();
  const { data: studies } = useAdminStudiesOverview();
  const upsertTranslations = useUpsertTranslations();
  const fetchTranslationsForKeys = useFetchTranslationsForKeys();
  const createStudyMutationHook = useCreateStudyAdmin();
  const updateStudyMutationHook = useUpdateStudyAdmin();
  const updateConsultantStatusMutation = useUpdateStudyConsultantStatusAdmin();
  const updateFundingStatusMutation = useUpdateStudyFundingStatusAdmin();

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingStudy, setEditingStudy] = useState<StudyWithDynamicData | null>(null);
  const [selectedStudy, setSelectedStudy] = useState<StudyWithDynamicData | null>(null);
  const [formData, setFormData] = useState<StudyFormData>(defaultFormData);
  const [activeLang, setActiveLang] = useState<SupportedLocale>(
    (i18n.language as SupportedLocale) || "en"
  );

  const { data: consultants } = useStudyConsultantsAdmin(selectedStudy?.id ?? null);
  const { data: contributions } = useStudyContributionsForStudyAdmin(selectedStudy?.id ?? null);

  type ExistingStudyTranslationKeys = {
    nameKey?: string | null;
    descriptionKey?: string | null;
  };

  const buildCanonicalKeys = (code: string, existing?: ExistingStudyTranslationKeys) => {
    const base = code.trim();
    const nameKey = (existing?.nameKey && existing.nameKey.trim()) ? existing.nameKey : `${base}.name`;
    const descriptionKey = (existing?.descriptionKey && existing.descriptionKey.trim())
      ? existing.descriptionKey
      : `${base}.description`;
    return { nameKey, descriptionKey };
  };

  // Helper to save translations and return keys
  const saveTranslationsAndGetKeys = async (
    code: string,
    data: StudyFormData,
    existing?: ExistingStudyTranslationKeys
  ): Promise<{ nameKey: string; descriptionKey: string | null }> => {
    const { nameKey, descriptionKey } = buildCanonicalKeys(code, existing);

    const translationInputs: TranslationInput[] = [];

    // Add name translations
    SUPPORTED_LOCALES.forEach((locale) => {
      const value = data.name[locale]?.trim();
      if (value) {
        translationInputs.push({
          key: nameKey,
          locale,
          value,
          namespace: TRANSLATION_NAMESPACE,
        });
      }
    });

    // Add description translations if any value exists
    const hasDescription = Object.values(data.description).some((v) => v?.trim());
    if (hasDescription) {
      SUPPORTED_LOCALES.forEach((locale) => {
        const value = data.description[locale]?.trim();
        if (value) {
          translationInputs.push({
            key: descriptionKey,
            locale,
            value,
            namespace: TRANSLATION_NAMESPACE,
          });
        }
      });
    }

    if (translationInputs.length > 0) {
      await upsertTranslations.mutateAsync(translationInputs);
    }

    return {
      nameKey,
      descriptionKey: hasDescription ? descriptionKey : null,
    };
  };

  // Helper to build params from form data for create
  const buildCreateParams = useCallback(async (data: StudyFormData): Promise<CreateStudyParams> => {
    const { nameKey, descriptionKey } = await saveTranslationsAndGetKeys(data.code, data);
    const baseName = data.name[data.base_locale]?.trim() || data.name.en?.trim() || data.name.cs?.trim() || "";
    const baseDescription = data.description[data.base_locale]?.trim() || data.description.en?.trim() || data.description.cs?.trim() || null;
    
    return {
      code: data.code,
      name: baseName,
      description: baseDescription || undefined,
      studyType: data.study_type,
      targetCondition: data.target_condition || undefined,
      isActive: data.is_active,
      isUmbrella: data.is_umbrella,
      startingAt: fromDateTimeLocalValue(data.starts_at),
      endingAt: fromDateTimeLocalValue(data.ends_at),
      protocolUrl: data.protocol_url || undefined,
      products: parseProductsInput(data.products),
      durationWeeks: data.duration_weeks ?? undefined,
      targetRegistration: data.target_registration ?? undefined,
      minParticipants: data.min_participants,
      maxParticipants: data.max_participants ?? undefined,
      fundingGoal: data.funding_goal,
      fundingDeadline: data.funding_deadline || undefined,
      isBlinded: data.is_blinded,
      informedConsentVersion: data.informed_consent_version || undefined,
      informedConsentSpecialProvisions: data.informed_consent_special_provisions || undefined,
      nameKey,
      descriptionKey: descriptionKey ?? undefined,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable callback references omitted intentionally
  }, [upsertTranslations]);

  // Helper to build params from form data for update
  const buildUpdateParams = useCallback(async (
    id: string,
    data: StudyFormData,
    existingKeys?: ExistingStudyTranslationKeys
  ): Promise<UpdateStudyParams> => {
    const { nameKey, descriptionKey } = await saveTranslationsAndGetKeys(data.code, data, existingKeys);
    const baseName = data.name[data.base_locale]?.trim() || data.name.en?.trim() || data.name.cs?.trim() || "";
    const baseDescription = data.description[data.base_locale]?.trim() || data.description.en?.trim() || data.description.cs?.trim() || null;
    
    return {
      id,
      code: data.code,
      name: baseName,
      description: baseDescription || undefined,
      studyType: data.study_type,
      targetCondition: data.target_condition || undefined,
      isActive: data.is_active,
      isUmbrella: data.is_umbrella,
      startingAt: fromDateTimeLocalValue(data.starts_at),
      endingAt: fromDateTimeLocalValue(data.ends_at),
      protocolUrl: data.protocol_url || undefined,
      products: parseProductsInput(data.products),
      durationWeeks: data.duration_weeks ?? undefined,
      targetRegistration: data.target_registration ?? undefined,
      minParticipants: data.min_participants,
      maxParticipants: data.max_participants ?? undefined,
      fundingGoal: data.funding_goal,
      fundingDeadline: data.funding_deadline || undefined,
      isBlinded: data.is_blinded,
      informedConsentVersion: data.informed_consent_version || undefined,
      informedConsentSpecialProvisions: data.informed_consent_special_provisions || undefined,
      nameKey,
      descriptionKey: descriptionKey ?? undefined,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable callback references omitted intentionally
  }, [upsertTranslations]);

  // Wrapper for create mutation with UI side effects
  const createStudyMutation = {
    mutate: async (data: StudyFormData) => {
      try {
        const params = await buildCreateParams(data);
        await createStudyMutationHook.mutateAsync(params);
        setIsCreateOpen(false);
        setFormData(defaultFormData);
        toast(t("admin.studies.created"));
      } catch {
        toast.error(t("admin.studies.errors.createFailed"));
      }
    },
    isPending: createStudyMutationHook.isPending,
  };

  // Wrapper for update mutation with UI side effects
  const updateStudyMutation = {
    mutate: async (args: { id: string; data: StudyFormData; existingKeys?: ExistingStudyTranslationKeys }) => {
      try {
        const params = await buildUpdateParams(args.id, args.data, args.existingKeys);
        await updateStudyMutationHook.mutateAsync(params);
        setEditingStudy(null);
        setFormData(defaultFormData);
        toast(t("admin.studies.updated"));
      } catch {
        toast.error(t("admin.studies.errors.updateFailed"));
      }
    },
    isPending: updateStudyMutationHook.isPending,
  };

  const consultantColumns = useMemo(() => getConsultantColumns(t, (id, status) => {
    updateConsultantStatusMutation.mutate({ id, status }, {
      onSuccess: () => toast(t("admin.studies.consultantUpdated")),
      onError: () => toast.error(t("admin.studies.errors.consultantUpdateFailed")),
    });
  }), [t, updateConsultantStatusMutation]);

  const contributionColumns = useMemo(() => getContributionColumns(t), [t]);

  const filteredStudies = studies?.filter((study) => {
    const matchesStatus = statusFilter === "all" || study.funding_status === statusFilter;
    return matchesStatus;
  }) ?? [];

  const handleCreateSubmit = () => {
    createStudyMutation.mutate(formData);
  };

  const handleEditSubmit = () => {
    if (!editingStudy) return;
    updateStudyMutation.mutate({
      id: editingStudy.id,
      data: formData,
      existingKeys: {
        nameKey: editingStudy.name_key ?? null,
        descriptionKey: editingStudy.description_key ?? null,
      },
    });
  };

  const openEditDialog = (study: StudyWithDynamicData) => {
    setEditingStudy(study);

    // Initialize with fallback values
    const initialFormData: StudyFormData = {
      code: study.code,
      name: { en: study.name || "", cs: study.name || "", de: "", fr: "", ru: "", th: "" },
      description: { en: study.description || "", cs: study.description || "", de: "", fr: "", ru: "", th: "" },
      study_type: study.study_type as StudyType,
      target_condition: study.target_condition || "",
      is_active: study.is_active ?? true,
      is_umbrella: study.is_umbrella ?? false,
      starts_at: toDateTimeLocalValue(study.starts_at),
      ends_at: toDateTimeLocalValue(study.ends_at),
      protocol_url: study.protocol_url || "",
      products: (study.products ?? []).join(", "),
      duration_weeks: study.duration_weeks ?? null,
      target_registration: study.target_registration ?? null,
      min_participants: study.min_participants ?? 0,
      max_participants: study.max_participants ?? null,
      funding_goal: study.funding_goal ?? 0,
      funding_deadline: study.funding_deadline ? study.funding_deadline.split("T")[0] : "",
      is_blinded: study.is_blinded,
      informed_consent_version: study.informed_consent_version || "1.0",
      informed_consent_special_provisions: study.informed_consent_special_provisions || "",
      base_locale: (i18n.language as SupportedLocale) || "en",
    };

    setFormData(initialFormData);

    // Load translations if keys exist
    const translationKeys = [study.name_key, study.description_key].filter((key): key is string => Boolean(key));

    if (translationKeys.length > 0) {
      void (async () => {
        try {
          const translations = await fetchTranslationsForKeys.mutateAsync({
            keys: translationKeys,
            namespace: TRANSLATION_NAMESPACE,
          });

          if (!translations) return;

          const translationMap = new Map<string, Partial<Record<SupportedLocale, string>>>();
          translations.forEach((row) => {
            if (!translationMap.has(row.key)) {
              translationMap.set(row.key, {});
            }
            const entry = translationMap.get(row.key);
            if (entry && (row.locale === "en" || row.locale === "cs")) {
              entry[row.locale as SupportedLocale] = row.value;
            }
          });

          setFormData((prev) => ({
            ...prev,
            name: study.name_key && translationMap.get(study.name_key)
              ? { ...prev.name, ...translationMap.get(study.name_key)! }
              : prev.name,
            description: study.description_key && translationMap.get(study.description_key)
              ? { ...prev.description, ...translationMap.get(study.description_key)! }
              : prev.description,
          }));
        } catch {
          toast.error(t("admin.studies.errors.translationsLoadFailed"));
        }
      })();
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable callbacks
  const columns = useMemo(() => getStudyColumns(t, openEditDialog, setSelectedStudy), [t]);



  const totalFunding = studies?.reduce((sum, s) => sum + (s.dynamic_funding || 0), 0) || 0;
  const activeStudies = studies?.filter((s) => s.is_active).length || 0;
  const fundingStudies = studies?.filter((s) => s.funding_status === "funding").length || 0;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">{t("admin.studies.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("admin.studies.subtitle")}</p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              {t("admin.studies.createStudy")}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t("admin.studies.createStudy")}</DialogTitle>
              <DialogDescription>{t("admin.studies.createDescription")}</DialogDescription>
            </DialogHeader>
            <StudyForm formData={formData} setFormData={setFormData} activeLang={activeLang} onActiveLangChange={setActiveLang} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>{t("common.cancel")}</Button>
              <Button onClick={handleCreateSubmit} disabled={createStudyMutation.isPending}>
                {createStudyMutation.isPending ? t("common.saving") : t("admin.studies.create")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <FlaskConical className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.studies.totalStudies")}</p>
                <p className="text-2xl font-semibold">{studies?.length || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-secondary/10">
                <TrendingUp className="w-5 h-5 text-secondary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.studies.activeStudies")}</p>
                <p className="text-2xl font-semibold">{activeStudies}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent/10">
                <DollarSign className="w-5 h-5 text-accent" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.studies.fundingNow")}</p>
                <p className="text-2xl font-semibold">{fundingStudies}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-muted">
                <DollarSign className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.studies.totalFunding")}</p>
                <p className="text-2xl font-semibold">
                  {`${totalFunding.toLocaleString()} ${t("common.currencyKc")}`}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Studies List */}
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle>{t("admin.studies.allStudies")}</CardTitle>
              <CardDescription>{studies?.length || 0} {t("admin.studies.studiesCount")}</CardDescription>
            </div>
            <div className="flex gap-3">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder={t("admin.studies.filterStatus")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("common.all")}</SelectItem>
                  <SelectItem value="draft">{t("admin.studies.fundingStatuses.draft")}</SelectItem>
                  <SelectItem value="funding">{t("admin.studies.fundingStatuses.funding")}</SelectItem>
                  <SelectItem value="funded">{t("admin.studies.fundingStatuses.funded")}</SelectItem>
                  <SelectItem value="active">{t("admin.studies.fundingStatuses.active")}</SelectItem>
                  <SelectItem value="completed">{t("admin.studies.fundingStatuses.completed")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={filteredStudies}
            searchKey="name"
          />
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editingStudy} onOpenChange={(open) => !open && setEditingStudy(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("admin.studies.editStudy")}</DialogTitle>
            <DialogDescription>{t("admin.studies.editDescription")}</DialogDescription>
          </DialogHeader>
          <StudyForm formData={formData} setFormData={setFormData} activeLang={activeLang} onActiveLangChange={setActiveLang} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingStudy(null)}>{t("common.cancel")}</Button>
            <Button onClick={handleEditSubmit} disabled={updateStudyMutation.isPending}>
              {updateStudyMutation.isPending ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Study Details Dialog */}
      <Dialog open={!!selectedStudy} onOpenChange={(open) => !open && setSelectedStudy(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedStudy?.name}</DialogTitle>
            <DialogDescription>{selectedStudy?.code}</DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="consultants">
            <TabsList>
              <TabsTrigger value="consultants">{t("admin.studies.tabs.consultants")}</TabsTrigger>
              <TabsTrigger value="contributions">{t("admin.studies.tabs.contributions")}</TabsTrigger>
              <TabsTrigger value="funding">{t("admin.studies.tabs.funding")}</TabsTrigger>
            </TabsList>
            <TabsContent value="consultants" className="mt-4">
              <DataTable
                columns={consultantColumns}
                data={consultants || []}
              />
            </TabsContent>
            <TabsContent value="contributions" className="mt-4">
              <DataTable
                columns={contributionColumns}
                data={contributions || []}
              />
            </TabsContent>
            <TabsContent value="funding" className="mt-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label>{t("admin.studies.fundingStatus")}</Label>
                  <Select
                    value={selectedStudy?.funding_status || "draft"}
                    onValueChange={(status) => {
                      if (selectedStudy) {
                        updateFundingStatusMutation.mutate(
                          { id: selectedStudy.id, status: status as FundingStatus },
                          {
                            onSuccess: () => toast(t("admin.studies.fundingStatusUpdated")),
                            onError: () => toast.error(t("admin.studies.errors.fundingUpdateFailed")),
                          }
                        );
                      }
                    }}
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">{t("admin.studies.fundingStatuses.draft")}</SelectItem>
                      <SelectItem value="funding">{t("admin.studies.fundingStatuses.funding")}</SelectItem>
                      <SelectItem value="funded">{t("admin.studies.fundingStatuses.funded")}</SelectItem>
                      <SelectItem value="active">{t("admin.studies.fundingStatuses.active")}</SelectItem>
                      <SelectItem value="completed">{t("admin.studies.fundingStatuses.completed")}</SelectItem>
                      <SelectItem value="cancelled">{t("admin.studies.fundingStatuses.cancelled")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div >
  );
}

