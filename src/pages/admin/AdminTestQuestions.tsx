import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  useAllTestQuestions,
  useCreateTestQuestion,
  useUpdateTestQuestion,
  useDeleteTestQuestion,
  useTestResults,
  TestQuestion,
} from "@/hooks/useTestQuestions";
import {
  useFetchTranslationsForKeys,
  useUpsertTranslations,
  type TranslationInput,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@/hooks/useDynamicTranslations";
import { LocalizedFieldEditor } from "@/components/admin/LocalizedFieldEditor";
import { Plus, GraduationCap, Award, Eye, Loader2 } from "lucide-react";
import { parseArrayResponse, testResultArraySchema } from "@/lib/schemas/adminSchemas";
import { DataTable } from "@/components/ui/data-table/DataTable";
import { getQuestionColumns, getResultColumns } from "./test-questions-columns";
import { safeError } from "@/lib/security/safeLogger";

type TestType = "qualification" | "certification";
type LocalizedText = Partial<Record<SupportedLocale, string>>;

const TRANSLATION_NAMESPACE = "tests";

// Helper to create empty localized record
const createEmptyLocalized = (): LocalizedText =>
  SUPPORTED_LOCALES.reduce<LocalizedText>((acc, locale) => {
    acc[locale] = "";
    return acc;
  }, {});

interface QuestionFormData {
  correct_answer: "a" | "b" | "c" | "d";
  question_order: number;
  is_active: boolean;
  // Localized fields
  question: LocalizedText;
  option_a: LocalizedText;
  option_b: LocalizedText;
  option_c: LocalizedText;
  option_d: LocalizedText;
}

const emptyFormData: QuestionFormData = {
  correct_answer: "a",
  question_order: 0,
  is_active: true,
  question: createEmptyLocalized(),
  option_a: createEmptyLocalized(),
  option_b: createEmptyLocalized(),
  option_c: createEmptyLocalized(),
  option_d: createEmptyLocalized(),
};

export default function AdminTestQuestions() {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<TestType>("qualification");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<TestQuestion | null>(null);
  const [formData, setFormData] = useState<QuestionFormData>(emptyFormData);
  const [viewResults, setViewResults] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Locale state for LocalizedFieldEditor
  const [sourceLocale, setSourceLocale] = useState<SupportedLocale>(
    (i18n.language as SupportedLocale) || "en"
  );
  const [targetLocale, setTargetLocale] = useState<SupportedLocale>("cs");

  const { data: questions = [], isLoading } = useAllTestQuestions(activeTab);
  const { data: resultsRaw = [] } = useTestResults(activeTab);
  const results = useMemo(() => parseArrayResponse(testResultArraySchema, resultsRaw, "testResults"), [resultsRaw]);

  const createQuestion = useCreateTestQuestion();
  const updateQuestion = useUpdateTestQuestion();
  const deleteQuestion = useDeleteTestQuestion();
  const upsertTranslations = useUpsertTranslations();
  const { mutateAsync: fetchTranslationsForKeys } = useFetchTranslationsForKeys();

  const isCs = i18n.language === "cs";

  const handleLocalizedChange = (
    field: keyof Pick<QuestionFormData, "question" | "option_a" | "option_b" | "option_c" | "option_d">,
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

  const handleOpenDialog = useCallback(async (question?: TestQuestion) => {
    if (question) {
      setEditingQuestion(question);
      
      const newFormData: QuestionFormData = {
        correct_answer: (question.correct_answer as "a" | "b" | "c" | "d") ?? "a",
        question_order: question.question_order,
        is_active: question.is_active,
        question: createEmptyLocalized(),
        option_a: createEmptyLocalized(),
        option_b: createEmptyLocalized(),
        option_c: createEmptyLocalized(),
        option_d: createEmptyLocalized(),
      };

      // Collect translation keys
      const keyFields: Record<string, string | null | undefined> = {
        question: question.question_key,
        option_a: question.option_a_key,
        option_b: question.option_b_key,
        option_c: question.option_c_key,
        option_d: question.option_d_key ?? null,
      };

      const keysToFetch = Object.values(keyFields).filter((key): key is string => !!key && key.trim().length > 0);

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
          if (keyFields.question && translationsByKey[keyFields.question]) {
            newFormData.question = { ...createEmptyLocalized(), ...translationsByKey[keyFields.question] };
          }
          if (keyFields.option_a && translationsByKey[keyFields.option_a]) {
            newFormData.option_a = { ...createEmptyLocalized(), ...translationsByKey[keyFields.option_a] };
          }
          if (keyFields.option_b && translationsByKey[keyFields.option_b]) {
            newFormData.option_b = { ...createEmptyLocalized(), ...translationsByKey[keyFields.option_b] };
          }
          if (keyFields.option_c && translationsByKey[keyFields.option_c]) {
            newFormData.option_c = { ...createEmptyLocalized(), ...translationsByKey[keyFields.option_c] };
          }
          if (keyFields.option_d && translationsByKey[keyFields.option_d]) {
            newFormData.option_d = { ...createEmptyLocalized(), ...translationsByKey[keyFields.option_d] };
          }
        } catch (error) {
          safeError("admin.testQuestions.loadTranslationsFailed", error);
        }
      }

      setFormData(newFormData);
    } else {
      setEditingQuestion(null);
      setFormData({
        ...emptyFormData,
        question_order: questions.length + 1,
      });
    }
    setIsDialogOpen(true);
  }, [questions.length, fetchTranslationsForKeys]);

  const handleSave = async () => {
    setIsSaving(true);

    try {
      const hasRequiredTranslations = [formData.question, formData.option_a, formData.option_b, formData.option_c]
        .every((localized) => Object.values(localized).some((value) => Boolean(value?.trim())));

      if (!hasRequiredTranslations) {
        toast.error(t("common.error"), {
          description: t("admin.testQuestions.saveError"),
        });
        return;
      }

      const translationInputs: TranslationInput[] = [];
      let questionKey: string | null | undefined;
      let optionAKey: string | null | undefined;
      let optionBKey: string | null | undefined;
      let optionCKey: string | null | undefined;
      let optionDKey: string | null | undefined;

      if (editingQuestion) {
        questionKey = editingQuestion.question_key;
        optionAKey = editingQuestion.option_a_key;
        optionBKey = editingQuestion.option_b_key;
        optionCKey = editingQuestion.option_c_key;
        optionDKey = editingQuestion.option_d_key;
      } else {
        const createdId = await createQuestion.mutateAsync({
          test_type: activeTab,
          correct_answer: formData.correct_answer,
          question_order: formData.question_order,
          is_active: formData.is_active,
          // Translation keys are generated below from the returned id and persisted
          // via the translation records — the create RPC only reads the four fields above.
        } as Parameters<typeof createQuestion.mutateAsync>[0]);
        const keyPrefix = `test_question.${createdId}`;
        questionKey = `${keyPrefix}.question`;
        optionAKey = `${keyPrefix}.option_a`;
        optionBKey = `${keyPrefix}.option_b`;
        optionCKey = `${keyPrefix}.option_c`;
        optionDKey = `${keyPrefix}.option_d`;
      }

      if (!questionKey || !optionAKey || !optionBKey || !optionCKey) {
        toast.error(t("common.error"), {
          description: t("admin.testQuestions.saveError"),
        });
        return;
      }

      // Prepare translation inputs
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

      addTranslations(questionKey, formData.question);
      addTranslations(optionAKey, formData.option_a);
      addTranslations(optionBKey, formData.option_b);
      addTranslations(optionCKey, formData.option_c);
      if (optionDKey && Object.values(formData.option_d).some((value) => value?.trim())) {
        addTranslations(optionDKey, formData.option_d);
      }

      // Upsert translations first
      if (translationInputs.length > 0) {
        await upsertTranslations.mutateAsync(translationInputs);
      }

      if (editingQuestion) {
        await updateQuestion.mutateAsync({
          id: editingQuestion.id,
          correct_answer: formData.correct_answer,
          question_order: formData.question_order,
          is_active: formData.is_active,
        });
      }

      toast(t(editingQuestion ? "admin.testQuestions.updated" : "admin.testQuestions.created"));
      setIsDialogOpen(false);
    } catch (error) {
      safeError("admin.testQuestions.saveFailed", error);
      toast.error(t("common.error"), {
        description: t("admin.testQuestions.saveError"),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm(t("admin.testQuestions.confirmDelete"))) return;

    try {
      await deleteQuestion.mutateAsync(id);
      toast(t("admin.testQuestions.deleted"));
    } catch {
      toast.error(t("common.error"));
    }
  }, [deleteQuestion, t]);

  const handleToggleActive = useCallback(async (question: TestQuestion) => {
    try {
      await updateQuestion.mutateAsync({
        id: question.id,
        is_active: !question.is_active,
      });
    } catch {
      toast.error(t("common.error"));
    }
  }, [updateQuestion, t]);

  const questionColumns = useMemo(() => getQuestionColumns(
    t, isCs, handleOpenDialog, handleDelete, handleToggleActive
  ), [t, isCs, handleOpenDialog, handleDelete, handleToggleActive]);

  const resultColumns = useMemo(() => getResultColumns(t), [t]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{t("admin.testQuestions.title")}</h1>
            <p className="text-muted-foreground">{t("admin.testQuestions.subtitle")}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setViewResults(!viewResults)}>
              <Eye className="mr-2 h-4 w-4" />
              {viewResults ? t("admin.testQuestions.viewQuestions") : t("admin.testQuestions.viewResults")}
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TestType)}>
          <TabsList>
            <TabsTrigger value="qualification" className="gap-2">
              <GraduationCap className="h-4 w-4" />
              {t("admin.testQuestions.qualificationTest")}
            </TabsTrigger>
            <TabsTrigger value="certification" className="gap-2">
              <Award className="h-4 w-4" />
              {t("admin.testQuestions.certificationTest")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="mt-6">
            {viewResults ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t("admin.testQuestions.testResults")}</CardTitle>
                  <CardDescription>
                    {activeTab === "qualification"
                      ? t("admin.testQuestions.qualificationResults")
                      : t("admin.testQuestions.certificationResults")
                    }
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {activeTab === "certification" ? (
                    <DataTable
                      columns={resultColumns}
                      data={results}
                      searchKey="user"
                    />
                  ) : (
                    <p className="text-muted-foreground text-center py-8">
                      {t("admin.testQuestions.qualificationResultsNote")}
                    </p>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>{t("admin.testQuestions.questions")}</CardTitle>
                    <CardDescription>
                      {questions.filter(q => q.is_active).length} {t("admin.testQuestions.activeQuestions")}
                    </CardDescription>
                  </div>
                  <Button onClick={() => void handleOpenDialog()}>
                    <Plus className="mr-2 h-4 w-4" />
                    {t("admin.testQuestions.addQuestion")}
                  </Button>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    {t("admin.testQuestions.keyBasedNote")}
                  </p>
                  <DataTable
                    columns={questionColumns}
                    data={questions}
                    searchKey="question_key"
                  />
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* Question Edit Dialog with Inline Localization */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {t(editingQuestion ? "admin.testQuestions.editQuestion" : "admin.testQuestions.addQuestion")}
              </DialogTitle>
              <DialogDescription>
                {t(editingQuestion ? "admin.testQuestions.formDescriptionKeyBased" : "admin.testQuestions.formDescription")}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 py-4">
              {/* Question Key Reference */}
              {editingQuestion && (
                <div className="space-y-2">
                  <Label>{t("admin.testQuestions.translationKey")}</Label>
                  <Input
                    value={editingQuestion.question_key}
                    disabled
                    className="font-mono text-sm"
                  />
                </div>
              )}

              {/* Question text with inline localization */}
              <LocalizedFieldEditor
                label={t("admin.testQuestions.questionText")}
                fieldId="question-text"
                value={formData.question}
                onChange={(locale, value) => handleLocalizedChange("question", locale, value)}
                primaryLocale={sourceLocale}
                targetLocale={targetLocale}
                onSourceLocaleChange={setSourceLocale}
                onTargetLocaleChange={setTargetLocale}
                multiline
                rows={3}
                required
              />

              {/* Options with inline localization */}
              <LocalizedFieldEditor
                label={`${t("admin.testQuestions.optionA")} (A)`}
                fieldId="option-a"
                value={formData.option_a}
                onChange={(locale, value) => handleLocalizedChange("option_a", locale, value)}
                primaryLocale={sourceLocale}
                targetLocale={targetLocale}
                onSourceLocaleChange={setSourceLocale}
                onTargetLocaleChange={setTargetLocale}
                required
              />

              <LocalizedFieldEditor
                label={`${t("admin.testQuestions.optionB")} (B)`}
                fieldId="option-b"
                value={formData.option_b}
                onChange={(locale, value) => handleLocalizedChange("option_b", locale, value)}
                primaryLocale={sourceLocale}
                targetLocale={targetLocale}
                onSourceLocaleChange={setSourceLocale}
                onTargetLocaleChange={setTargetLocale}
                required
              />

              <LocalizedFieldEditor
                label={`${t("admin.testQuestions.optionC")} (C)`}
                fieldId="option-c"
                value={formData.option_c}
                onChange={(locale, value) => handleLocalizedChange("option_c", locale, value)}
                primaryLocale={sourceLocale}
                targetLocale={targetLocale}
                onSourceLocaleChange={setSourceLocale}
                onTargetLocaleChange={setTargetLocale}
                required
              />

              <LocalizedFieldEditor
                label={`${t("admin.testQuestions.optionD")} (D)`}
                fieldId="option-d"
                value={formData.option_d}
                onChange={(locale, value) => handleLocalizedChange("option_d", locale, value)}
                primaryLocale={sourceLocale}
                targetLocale={targetLocale}
                onSourceLocaleChange={setSourceLocale}
                onTargetLocaleChange={setTargetLocale}
              />

              {/* Metadata fields */}
              <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                <div className="space-y-2">
                  <Label>{t("admin.testQuestions.correctAnswer")}</Label>
                  <Select
                    value={formData.correct_answer}
                    onValueChange={(v) => setFormData(prev => ({ ...prev, correct_answer: v as "a" | "b" | "c" | "d" }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="a">{"A"}</SelectItem>
                      <SelectItem value="b">{"B"}</SelectItem>
                      <SelectItem value="c">{"C"}</SelectItem>
                      <SelectItem value="d">{"D"}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{t("admin.testQuestions.order")}</Label>
                  <Input
                    type="number"
                    value={formData.question_order}
                    onChange={(e) => setFormData(prev => ({ ...prev, question_order: parseInt(e.target.value) || 0 }))}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id="is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_active: checked }))}
                />
                <Label htmlFor="is_active">{t("admin.testQuestions.active")}</Label>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleSave}
                disabled={isSaving || createQuestion.isPending || updateQuestion.isPending || upsertTranslations.isPending}
              >
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t("common.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
