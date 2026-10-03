import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Edit2, Trash2, FileText, ClipboardList, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { useStudies } from "@/hooks/useStudies";
import {
  useConsentTemplatesAdmin,
  useStudyConsentRequirementsAdmin,
  useStudyQuestionnairesAdmin,
  useQuestionnairesAdmin,
  useCreateConsentTemplateMutation,
  useDeleteConsentTemplateMutation,
  useUpsertStudyConsentRequirementMutation,
  useDeleteStudyConsentRequirementMutation,
  useUpsertStudyQuestionnaireMutation,
  useDeleteStudyQuestionnaireMutation,
  fetchTranslationsForKeys,
  QUESTIONNAIRE_TYPES,
  type ConsentTemplateAdmin,
} from "@/hooks";
import { useUpsertTranslations, type TranslationInput, SUPPORTED_LOCALES, type SupportedLocale } from "@/hooks/useDynamicTranslations";

import {
  ConsentTemplateDialog,
  ConsentRequirementDialog,
  StudyQuestionnaireDialog,
  CONSENT_NAMESPACE,
  QUESTIONNAIRE_NAMESPACE,
  emptyLocaleRecord,
  buildConsentTemplateKeys,
  buildStudyQuestionnaireKeys,
} from "./study-consents";

import type {
  ConsentTemplateForm,
  StudyConsentRequirementForm,
  StudyQuestionnaireForm,
} from "./study-consents";

export default function AdminStudyConsents() {
  const { t } = useTranslation();

  const frequencyOptions = [
    { value: "one_time", label: t("admin.studyConsents.frequencyOptions.oneTime") },
    { value: "daily", label: t("admin.studyConsents.frequencyOptions.daily") },
    { value: "weekly", label: t("admin.studyConsents.frequencyOptions.weekly") },
    { value: "monthly", label: t("admin.studyConsents.frequencyOptions.monthly") },
    { value: "quarterly", label: t("admin.studyConsents.frequencyOptions.quarterly") },
  ];
  const [selectedStudyId, setSelectedStudyId] = useState<string | undefined>();
  const [editingTemplate, setEditingTemplate] = useState<ConsentTemplateForm | null>(null);
  const [editingRequirement, setEditingRequirement] = useState<StudyConsentRequirementForm | null>(null);
  const [editingQuestionnaire, setEditingQuestionnaire] = useState<StudyQuestionnaireForm | null>(null);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [requirementDialogOpen, setRequirementDialogOpen] = useState(false);
  const [questionnaireDialogOpen, setQuestionnaireDialogOpen] = useState(false);

  const { studies } = useStudies();
  const upsertTranslations = useUpsertTranslations();

  // Get selected study for key generation
  const selectedStudy = studies?.find((s) => s.id === selectedStudyId);

  // Consent Templates query
  const { data: consentTemplates, isLoading: templatesLoading } = useConsentTemplatesAdmin();

  // Study Consent Requirements query
  const { data: consentRequirements, isLoading: requirementsLoading } = useStudyConsentRequirementsAdmin(selectedStudyId);

  // Study Questionnaires query
  const { data: studyQuestionnaires, isLoading: questionnairesLoading } = useStudyQuestionnairesAdmin(selectedStudyId);

  // Questionnaires for linking
  const { data: questionnaires } = useQuestionnairesAdmin();

  const questionnaireTypeOptions = useMemo(() => {
    const values = new Set<string>(QUESTIONNAIRE_TYPES);
    values.add("custom");

    (questionnaires ?? []).forEach((q) => {
      if (q.questionnaire_type) values.add(q.questionnaire_type);
    });
    (studyQuestionnaires ?? []).forEach((sq) => {
      if (sq.questionnaire_type) values.add(sq.questionnaire_type);
    });

    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [questionnaires, studyQuestionnaires]);

  const getQuestionnaireTypeLabel = (type: string) => {
    const key = `admin.questionnaires.questionnaireTypes.${type}`;
    const translated = t(key);
    return translated === key ? type : translated;
  };

  // Helper to save consent template translations and get keys
  const saveTemplateTranslationsAndGetKeys = async (
    templateKey: string,
    data: ConsentTemplateForm
  ): Promise<{ titleKey: string; descriptionKey: string }> => {
    const keys = buildConsentTemplateKeys(templateKey);

    const translations: TranslationInput[] = [];
    for (const locale of SUPPORTED_LOCALES) {
      if (data.title[locale]) {
        translations.push({
          key: keys.titleKey,
          locale,
          value: data.title[locale],
          namespace: CONSENT_NAMESPACE,
        });
      }
      if (data.content[locale]) {
        translations.push({
          key: keys.descriptionKey,
          locale,
          value: data.content[locale],
          namespace: CONSENT_NAMESPACE,
        });
      }
    }

    if (translations.length > 0) {
      await upsertTranslations.mutateAsync(translations);
    }

    return { titleKey: keys.titleKey, descriptionKey: keys.descriptionKey };
  };

  // Helper to save questionnaire translations and get keys
  const saveQuestionnaireTranslationsAndGetKeys = async (
    studyCode: string,
    questionnaireType: string,
    data: StudyQuestionnaireForm
  ): Promise<{ titleKey: string; descriptionKey: string }> => {
    const keys = buildStudyQuestionnaireKeys(studyCode, questionnaireType);

    const translations: TranslationInput[] = [];
    for (const locale of SUPPORTED_LOCALES) {
      if (data.title[locale]) {
        translations.push({
          key: keys.titleKey,
          locale,
          value: data.title[locale],
          namespace: QUESTIONNAIRE_NAMESPACE,
        });
      }
      if (data.description[locale]) {
        translations.push({
          key: keys.descriptionKey,
          locale,
          value: data.description[locale],
          namespace: QUESTIONNAIRE_NAMESPACE,
        });
      }
    }

    if (translations.length > 0) {
      await upsertTranslations.mutateAsync(translations);
    }

    return { titleKey: keys.titleKey, descriptionKey: keys.descriptionKey };
  };

  // Mutations - use imported hooks
  const createTemplateMutationHook = useCreateConsentTemplateMutation();
  const deleteTemplateMutationHook = useDeleteConsentTemplateMutation();
  const upsertRequirementMutationHook = useUpsertStudyConsentRequirementMutation(selectedStudyId);
  const deleteRequirementMutationHook = useDeleteStudyConsentRequirementMutation(selectedStudyId);
  const upsertQuestionnaireMutationHook = useUpsertStudyQuestionnaireMutation(selectedStudyId);
  const deleteQuestionnaireMutationHook = useDeleteStudyQuestionnaireMutation(selectedStudyId);

  // Wrapped mutations with local orchestration (translation save + state management)
  const createTemplateMutation = {
    mutate: async (payload: ConsentTemplateForm) => {
      try {
        const { titleKey, descriptionKey } = await saveTemplateTranslationsAndGetKeys(
          payload.template_key,
          payload
        );
        await createTemplateMutationHook.mutateAsync({
          template_key: payload.template_key,
          title_key: titleKey,
          content_key: descriptionKey,
          version: payload.version,
          is_active: payload.is_active,
          requires_signature: payload.requires_signature,
        });
        toast.success(t("admin.studyConsents.templates.created"));
        setTemplateDialogOpen(false);
        setEditingTemplate(null);
      } catch {
        toast.error(t("admin.studyConsents.errors.createFailed"));
      }
    },
    mutateAsync: async (payload: ConsentTemplateForm) => {
      const { titleKey, descriptionKey } = await saveTemplateTranslationsAndGetKeys(
        payload.template_key,
        payload
      );
      await createTemplateMutationHook.mutateAsync({
        template_key: payload.template_key,
        title_key: titleKey,
        content_key: descriptionKey,
        version: payload.version,
        is_active: payload.is_active,
        requires_signature: payload.requires_signature,
      });
      toast.success(t("admin.studyConsents.templates.created"));
      setTemplateDialogOpen(false);
      setEditingTemplate(null);
    },
    isPending: createTemplateMutationHook.isPending,
  };

  const deleteTemplateMutation = {
    mutate: (id: string) => {
      deleteTemplateMutationHook.mutate(id, {
        onSuccess: () => toast.success(t("admin.studyConsents.templates.deleted")),
        onError: () => toast.error(t("admin.studyConsents.errors.deleteFailed")),
      });
    },
    isPending: deleteTemplateMutationHook.isPending,
  };

  const upsertRequirementMutation = {
    mutate: (payload: { study_id: string } & StudyConsentRequirementForm) => {
      upsertRequirementMutationHook.mutate({
        study_id: payload.study_id,
        consent_template_id: payload.consent_template_id,
        is_required: payload.is_required,
        sort_order: payload.sort_order,
      }, {
        onSuccess: () => {
          toast.success(t("admin.studyConsents.requirements.saved"));
          setRequirementDialogOpen(false);
          setEditingRequirement(null);
        },
        onError: () => toast.error(t("admin.studyConsents.errors.saveFailed")),
      });
    },
    mutateAsync: async (payload: { study_id: string } & StudyConsentRequirementForm) => {
      await upsertRequirementMutationHook.mutateAsync({
        study_id: payload.study_id,
        consent_template_id: payload.consent_template_id,
        is_required: payload.is_required,
        sort_order: payload.sort_order,
      });
      toast.success(t("admin.studyConsents.requirements.saved"));
      setRequirementDialogOpen(false);
      setEditingRequirement(null);
    },
    isPending: upsertRequirementMutationHook.isPending,
  };

  const deleteRequirementMutation = {
    mutate: (id: string) => {
      deleteRequirementMutationHook.mutate(id, {
        onSuccess: () => toast.success(t("admin.studyConsents.requirements.deleted")),
        onError: () => toast.error(t("admin.studyConsents.errors.deleteFailed")),
      });
    },
    isPending: deleteRequirementMutationHook.isPending,
  };

  const upsertQuestionnaireMutation = {
    mutate: async (payload: { study_id: string; study_code: string } & StudyQuestionnaireForm) => {
      try {
        const { titleKey, descriptionKey } = await saveQuestionnaireTranslationsAndGetKeys(
          payload.study_code,
          payload.questionnaire_type,
          payload
        );
        await upsertQuestionnaireMutationHook.mutateAsync({
          study_id: payload.study_id,
          questionnaire_id: payload.questionnaire_id,
          questionnaire_type: payload.questionnaire_type,
          is_required: payload.is_required,
          is_active: payload.is_active,
          frequency_type: payload.frequency_type,
          frequency_days: payload.frequency_days ?? undefined,
          token_reward: payload.token_reward,
          display_order: payload.display_order,
          starts_after_days: payload.starts_after_days,
          ends_after_days: payload.ends_after_days ?? undefined,
          title_key: titleKey,
          description_key: descriptionKey,
        });
        toast.success(t("admin.studyConsents.questionnaires.saved"));
        setQuestionnaireDialogOpen(false);
        setEditingQuestionnaire(null);
      } catch {
        toast.error(t("admin.studyConsents.errors.saveFailed"));
      }
    },
    mutateAsync: async (payload: { study_id: string; study_code: string } & StudyQuestionnaireForm) => {
      const { titleKey, descriptionKey } = await saveQuestionnaireTranslationsAndGetKeys(
        payload.study_code,
        payload.questionnaire_type,
        payload
      );
      await upsertQuestionnaireMutationHook.mutateAsync({
        study_id: payload.study_id,
        questionnaire_id: payload.questionnaire_id,
        questionnaire_type: payload.questionnaire_type,
        is_required: payload.is_required,
        is_active: payload.is_active,
        frequency_type: payload.frequency_type,
        frequency_days: payload.frequency_days ?? undefined,
        token_reward: payload.token_reward,
        display_order: payload.display_order,
        starts_after_days: payload.starts_after_days,
        ends_after_days: payload.ends_after_days ?? undefined,
        title_key: titleKey,
        description_key: descriptionKey,
      });
      toast.success(t("admin.studyConsents.questionnaires.saved"));
      setQuestionnaireDialogOpen(false);
      setEditingQuestionnaire(null);
    },
    isPending: upsertQuestionnaireMutationHook.isPending,
  };

  const deleteQuestionnaireMutation = {
    mutate: (id: string) => {
      deleteQuestionnaireMutationHook.mutate(id, {
        onSuccess: () => toast.success(t("admin.studyConsents.questionnaires.deleted")),
        onError: () => toast.error(t("admin.studyConsents.errors.deleteFailed")),
      });
    },
    isPending: deleteQuestionnaireMutationHook.isPending,
  };

  // Handlers
  const openNewTemplateDialog = () => {
    setEditingTemplate({
      template_key: "",
      title: emptyLocaleRecord(),
      content: emptyLocaleRecord(),
      version: "1.0",
      requires_signature: false,
      is_active: true,
    });
    setTemplateDialogOpen(true);
  };

  const handleEditTemplate = async (template: ConsentTemplateAdmin) => {
    // Load translations if keys exist
    let title = emptyLocaleRecord();
    let content = emptyLocaleRecord();

    if (template.title_key || template.description_key) {
      try {
        const keysToLoad = [template.title_key, template.description_key].filter(Boolean) as string[];
        const loaded = await fetchTranslationsForKeys(keysToLoad, CONSENT_NAMESPACE);
        if (template.title_key && loaded[template.title_key]) {
          const loadedTitle = loaded[template.title_key];
          title = { ...title, cs: loadedTitle.cs ?? "", en: loadedTitle.en ?? "" };
        }
        if (template.description_key && loaded[template.description_key]) {
          const loadedContent = loaded[template.description_key];
          content = { ...content, cs: loadedContent.cs ?? "", en: loadedContent.en ?? "" };
        }
      } catch {
        // Fallback - keep empty records
      }
    }

    setEditingTemplate({
      id: template.id,
      template_key: template.template_key,
      title,
      content,
      version: template.version,
      requires_signature: template.requires_signature,
      is_active: template.is_active,
    });
    setTemplateDialogOpen(true);
  };

  const handleSaveTemplate = async () => {
    if (!editingTemplate) return;
    if (!editingTemplate.template_key.trim()) {
      toast.error(t("admin.studyConsents.templates.keyRequired"));
      return;
    }
    if (!editingTemplate.title.cs.trim() && !editingTemplate.title.en.trim()) {
      toast.error(t("admin.studyConsents.templates.titleRequired"));
      return;
    }
    await createTemplateMutation.mutateAsync(editingTemplate);
  };

  const openNewRequirementDialog = () => {
    setEditingRequirement({
      consent_template_id: consentTemplates?.[0]?.id ?? "",
      is_required: true,
      sort_order: (consentRequirements?.length || 0) + 1,
    });
    setRequirementDialogOpen(true);
  };

  const handleSaveRequirement = async () => {
    if (!editingRequirement || !selectedStudyId || !editingRequirement.consent_template_id) return;
    await upsertRequirementMutation.mutateAsync({
      study_id: selectedStudyId,
      ...editingRequirement,
    });
  };

  const openNewQuestionnaireDialog = () => {
    const defaultType = questionnaireTypeOptions.includes("registration")
      ? "registration"
      : questionnaireTypeOptions[0] ?? "registration";

    setEditingQuestionnaire({
      questionnaire_id: questionnaires?.[0]?.id ?? "",
      questionnaire_type: defaultType,
      title: emptyLocaleRecord(),
      description: emptyLocaleRecord(),
      is_required: true,
      is_active: true,
      frequency_type: "one_time",
      frequency_days: null,
      token_reward: 10,
      display_order: (studyQuestionnaires?.length || 0) + 1,
      starts_after_days: 0,
      ends_after_days: null,
    });
    setQuestionnaireDialogOpen(true);
  };

  const handleEditQuestionnaire = async (sq: {
    id: string;
    questionnaire_id: string | null;
    questionnaire_type: string | null;
    is_required: boolean;
    is_active: boolean;
    frequency_type: string | null;
    frequency_days: number | null;
    token_reward: number | null;
    display_order: number | null;
    starts_after_days: number | null;
    ends_after_days: number | null;
    title_key?: string | null;
    description_key?: string | null;
  }) => {
    // Load translations if keys exist
    let title = emptyLocaleRecord();
    let description = emptyLocaleRecord();

    if (sq.title_key || sq.description_key) {
      try {
        const keysToLoad = [sq.title_key, sq.description_key].filter(Boolean) as string[];
        const loaded = await fetchTranslationsForKeys(keysToLoad, QUESTIONNAIRE_NAMESPACE);
        if (sq.title_key && loaded[sq.title_key]) {
          const loadedTitle = loaded[sq.title_key];
          title = { ...title, cs: loadedTitle.cs ?? "", en: loadedTitle.en ?? "" };
        }
        if (sq.description_key && loaded[sq.description_key]) {
          const loadedDesc = loaded[sq.description_key];
          description = { ...description, cs: loadedDesc.cs ?? "", en: loadedDesc.en ?? "" };
        }
      } catch {
        // Fallback - keep empty records
      }
    }

    setEditingQuestionnaire({
      id: sq.id,
      questionnaire_id: sq.questionnaire_id || "",
      questionnaire_type: sq.questionnaire_type || questionnaireTypeOptions[0] || "registration",
      title,
      description,
      is_required: sq.is_required,
      is_active: sq.is_active,
      frequency_type: sq.frequency_type || "one_time",
      frequency_days: sq.frequency_days,
      token_reward: sq.token_reward || 0,
      display_order: sq.display_order || 0,
      starts_after_days: sq.starts_after_days || 0,
      ends_after_days: sq.ends_after_days,
    });
    setQuestionnaireDialogOpen(true);
  };

  const handleSaveQuestionnaire = async () => {
    if (!editingQuestionnaire || !selectedStudyId || !editingQuestionnaire.questionnaire_type) return;
    if (!selectedStudy?.code) {
      toast.error(t("admin.studyConsents.errors.studyCodeMissing"));
      return;
    }
    await upsertQuestionnaireMutation.mutateAsync({
      study_id: selectedStudyId,
      study_code: selectedStudy.code,
      ...editingQuestionnaire,
    });
  };

  // Helper to get display title from template_title_key
  const getTemplateDisplayTitle = (titleKey: string | null): string => {
    // In unified pattern, title comes from translations table via key
    // For now show the key or a placeholder
    return titleKey || t("common.untitled");
  };

  // Helper to get questionnaire display title
  const getQuestionnaireDisplayTitle = (sq: {
    questionnaire_name?: string | null;
    questionnaire_code?: string | null;
    questionnaire_type?: string | null;
  }): string => {
    return sq.questionnaire_name || sq.questionnaire_code || sq.questionnaire_type || t("common.untitled");
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t("admin.studyConsents.title")}</h1>
        <p className="text-muted-foreground">{t("admin.studyConsents.subtitle")}</p>
      </header>

      {/* Consent Templates Section */}
      <section aria-label={t("admin.studyConsents.templates.sectionLabel")}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle>{t("admin.studyConsents.templates.title")}</CardTitle>
              <CardDescription>{t("admin.studyConsents.templates.subtitle")}</CardDescription>
            </div>
            <Button onClick={openNewTemplateDialog} className="gap-2">
              <Plus className="h-4 w-4" />
              {t("admin.studyConsents.templates.add")}
            </Button>
          </CardHeader>
          <CardContent>
            {templatesLoading ? (
              <p className="text-muted-foreground">{t("common.loading")}</p>
            ) : consentTemplates?.length === 0 ? (
              <p className="text-muted-foreground">{t("admin.studyConsents.templates.empty")}</p>
            ) : (
              <div className="space-y-3">
                {consentTemplates?.map((template) => (
                  <div key={template.id} className="flex items-start gap-4 p-4 border rounded-lg">
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{template.template_key}</span>
                        <Badge variant="outline">
                          {t("common.versionPrefixShort")}
                          {template.version}
                        </Badge>
                        {template.requires_signature && (
                          <Badge variant="outline">{t("admin.studyConsents.templates.requiresSignature")}</Badge>
                        )}
                        {!template.is_active && <Badge variant="secondary">{t("common.inactive")}</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {template.title_key || template.template_key}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="icon" onClick={() => handleEditTemplate(template)}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm(t("admin.studyConsents.templates.confirmDelete"))) {
                            deleteTemplateMutation.mutate(template.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Study Selection Section */}
      <section aria-label={t("admin.studyConsents.studySectionLabel")}>
        <Card>
          <CardHeader>
            <CardTitle>{t("admin.studyConsents.studySelectTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={selectedStudyId} onValueChange={setSelectedStudyId}>
              <SelectTrigger className="w-full max-w-md">
                <SelectValue placeholder={t("admin.studyConsents.studySelectPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {studies?.map((study) => (
                  <SelectItem key={study.id} value={study.id}>
                    {study.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      </section>

      {/* Study-specific requirements and questionnaires */}
      {selectedStudyId && (
        <section aria-label={t("admin.studyConsents.manageSectionLabel")}>
          <Tabs defaultValue="requirements" className="space-y-4">
            <TabsList className="w-fit">
              <TabsTrigger value="requirements" className="gap-2">
                <FileText className="h-4 w-4" />
                {t("admin.studyConsents.requirements.tab")} ({consentRequirements?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="questionnaires" className="gap-2">
                <ClipboardList className="h-4 w-4" />
                {t("admin.studyConsents.questionnaires.tab")} ({studyQuestionnaires?.length || 0})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="requirements">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-4">
                  <div>
                    <CardTitle>{t("admin.studyConsents.requirements.title")}</CardTitle>
                    <CardDescription>{t("admin.studyConsents.requirements.subtitle")}</CardDescription>
                  </div>
                  <Button onClick={openNewRequirementDialog} className="gap-2">
                    <Plus className="h-4 w-4" />
                    {t("admin.studyConsents.requirements.add")}
                  </Button>
                </CardHeader>
                <CardContent>
                  {requirementsLoading ? (
                    <p className="text-muted-foreground">{t("common.loading")}</p>
                  ) : consentRequirements?.length === 0 ? (
                    <p className="text-muted-foreground">{t("admin.studyConsents.requirements.empty")}</p>
                  ) : (
                    <div className="space-y-3">
                      {consentRequirements?.map((req) => (
                        <div key={req.id} className="flex items-start gap-4 p-4 border rounded-lg">
                          <GripVertical className="h-5 w-5 text-muted-foreground mt-1 cursor-move" />
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{req.template_key}</span>
                              <span className="text-sm text-muted-foreground">
                                {getTemplateDisplayTitle(req.template_title_key)}
                              </span>
                              {req.is_required && <Badge variant="destructive">{t("common.required")}</Badge>}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                if (confirm(t("admin.studyConsents.requirements.confirmDelete"))) {
                                  deleteRequirementMutation.mutate(req.id);
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="questionnaires">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-4">
                  <div>
                    <CardTitle>{t("admin.studyConsents.questionnaires.title")}</CardTitle>
                    <CardDescription>{t("admin.studyConsents.questionnaires.subtitle")}</CardDescription>
                  </div>
                  <Button onClick={openNewQuestionnaireDialog} className="gap-2">
                    <Plus className="h-4 w-4" />
                    {t("admin.studyConsents.questionnaires.add")}
                  </Button>
                </CardHeader>
                <CardContent>
                  {questionnairesLoading ? (
                    <p className="text-muted-foreground">{t("common.loading")}</p>
                  ) : studyQuestionnaires?.length === 0 ? (
                    <p className="text-muted-foreground">{t("admin.studyConsents.questionnaires.empty")}</p>
                  ) : (
                    <div className="space-y-3">
                      {studyQuestionnaires?.map((sq) => (
                        <div key={sq.id} className="flex items-start gap-4 p-4 border rounded-lg">
                          <GripVertical className="h-5 w-5 text-muted-foreground mt-1 cursor-move" />
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium">{sq.questionnaire_code || sq.questionnaire_type}</span>
                              <span className="text-sm text-muted-foreground">
                                {getQuestionnaireDisplayTitle(sq)}
                              </span>
                              <Badge variant="outline">
                                {frequencyOptions.find((o) => o.value === sq.frequency_type)?.label || sq.frequency_type}
                              </Badge>
                              {sq.token_reward && sq.token_reward > 0 && (
                                <Badge variant="secondary">
                                  {sq.token_reward} {t("admin.studyConsents.questionnaires.tokensUnit")}
                                </Badge>
                              )}
                              {sq.is_required && <Badge variant="destructive">{t("common.required")}</Badge>}
                              {!sq.is_active && <Badge variant="outline">{t("common.inactive")}</Badge>}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEditQuestionnaire(sq)}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                if (confirm(t("admin.studyConsents.questionnaires.confirmDelete"))) {
                                  deleteQuestionnaireMutation.mutate(sq.id);
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </section>
      )}

      {/* Template Dialog */}
      <ConsentTemplateDialog
        editingTemplate={editingTemplate}
        setEditingTemplate={setEditingTemplate}
        open={templateDialogOpen}
        onOpenChange={setTemplateDialogOpen}
        onSave={handleSaveTemplate}
        isPending={createTemplateMutation.isPending}
      />

      {/* Requirement Dialog */}
      <ConsentRequirementDialog
        consentTemplates={consentTemplates}
        editingRequirement={editingRequirement}
        setEditingRequirement={setEditingRequirement}
        open={requirementDialogOpen}
        onOpenChange={setRequirementDialogOpen}
        onSave={handleSaveRequirement}
        isPending={upsertRequirementMutation.isPending}
      />

      {/* Questionnaire Dialog */}
      <StudyQuestionnaireDialog
        editingQuestionnaire={editingQuestionnaire}
        setEditingQuestionnaire={setEditingQuestionnaire}
        open={questionnaireDialogOpen}
        onOpenChange={setQuestionnaireDialogOpen}
        onSave={handleSaveQuestionnaire}
        isPending={upsertQuestionnaireMutation.isPending}
        frequencyOptions={frequencyOptions}
        questionnaireTypeOptions={questionnaireTypeOptions}
        getQuestionnaireTypeLabel={getQuestionnaireTypeLabel}
        questionnaires={questionnaires}
      />
    </div>
  );
}
