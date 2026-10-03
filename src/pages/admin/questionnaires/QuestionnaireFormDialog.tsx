import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toJson } from "@/lib/types/json";
import { toast } from "sonner";
import {
  type TranslationInput,
} from "@/hooks/useDynamicTranslations";
import {
  fetchTranslationsForKeys,
} from "@/hooks";
import {
  QuestionDialog,
  type Questionnaire,
  type QuestionBlock,
  type Question,
  type QuestionFormData,
  type QuestionnaireFormData,
  type SupportedLanguage,
  TRANSLATION_NAMESPACE,
  SUPPORTED_LOCALES,
  emptyLocaleRecord,
  emptyQuestionForm,
  sanitizeKeySegment,
  buildKeyPrefix,
  toLocaleMap,
  questionsArraySchema,
} from "@/components/admin/questionnaires";
import {
  useUpsertTranslations,
} from "@/hooks/useDynamicTranslations";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { QuestionnaireMetadataForm } from "./QuestionnaireMetadataForm";
import { QuestionnaireQuestionList } from "./QuestionnaireQuestionList";
import { QuestionnaireBlockInsertDialog } from "./QuestionnaireBlockInsertDialog";

interface QuestionnaireFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingItem: Questionnaire | null;
  questionBlocks: QuestionBlock[];
  onCreateQuestionnaire: (data: Record<string, unknown>) => void;
  onUpdateQuestionnaire: (id: string, data: Record<string, unknown>) => void;
  isSaving: boolean;
}

/**
 * Full questionnaire form dialog with questions management, block insertion,
 * multi-locale translation editing, and version management.
 *
 * Composed from:
 * - {@link QuestionnaireMetadataForm} — locale, name, code, type, rewards, description
 * - {@link QuestionnaireQuestionList} — question listing with CRUD controls
 * - {@link QuestionnaireBlockInsertDialog} — block library insertion dialog
 * - {@link QuestionDialog} — individual question edit dialog
 */
export function QuestionnaireFormDialog({
  open,
  onOpenChange,
  editingItem,
  questionBlocks,
  onCreateQuestionnaire,
  onUpdateQuestionnaire,
  isSaving,
}: QuestionnaireFormDialogProps) {
  const { t, i18n } = useTranslation();
  const upsertTranslations = useUpsertTranslations();

  const defaultLocale = (i18n.language as SupportedLanguage) || "en";

  // Form state
  const [activeLang, setActiveLang] = useState<SupportedLanguage>(defaultLocale);
  const [formData, setFormData] = useState<QuestionnaireFormData>({
    name: emptyLocaleRecord(),
    code: "",
    description: emptyLocaleRecord(),
    is_active: true,
    base_locale: defaultLocale,
    questionnaire_type: "" as string,
    points_reward: 0,
    token_reward: 0,
  });
  const [questions, setQuestions] = useState<Question[]>([]);

  // Question dialog state
  const [editingQuestion, setEditingQuestion] = useState<QuestionFormData | null>(null);
  const [isQuestionDialogOpen, setIsQuestionDialogOpen] = useState(false);

  // Block insert dialog state
  const [blockInsertOpen, setBlockInsertOpen] = useState(false);

  // Reset form on open/close or editingItem change
  useEffect(() => {
    if (!open) return;

    if (editingItem) {
      loadEditingItem(editingItem);
    } else {
      resetForm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resetForm is a stable callback
  }, [open, editingItem?.id]);

  const resetForm = useCallback(() => {
    setFormData({
      name: emptyLocaleRecord(),
      code: "",
      description: emptyLocaleRecord(),
      is_active: true,
      base_locale: defaultLocale,
      questionnaire_type: "",
      points_reward: 0,
      token_reward: 0,
    });
    setQuestions([]);
  }, [defaultLocale]);

  const loadEditingItem = useCallback(
    (item: Questionnaire) => {
      const parsedQuestions = Array.isArray(item.questions)
        ? questionsArraySchema.parse(item.questions).map((q, idx) => {
            const textKey = typeof q.text === "string" ? q.text : q.textKey;
            const descriptionKey =
              typeof q.description === "string" ? q.description : q.descriptionKey;

            return {
              ...q,
              order: q.order ?? idx,
              text: typeof q.text === "object" ? toLocaleMap(q.text) : emptyLocaleRecord(),
              textKey,
              description:
                typeof q.description === "object"
                  ? toLocaleMap(q.description)
                  : emptyLocaleRecord(),
              descriptionKey,
              options: q.options?.map((option) => ({
                ...option,
                label:
                  typeof option.label === "object"
                    ? toLocaleMap(option.label)
                    : emptyLocaleRecord(),
                labelKey:
                  typeof option.label === "string" ? option.label : option.labelKey,
              })),
              scaleLabels: q.scaleLabels?.map((option) => ({
                ...option,
                label:
                  typeof option.label === "object"
                    ? toLocaleMap(option.label)
                    : emptyLocaleRecord(),
                labelKey:
                  typeof option.label === "string" ? option.label : option.labelKey,
              })),
            };
          })
        : [];

      setFormData({
        name: { ...emptyLocaleRecord(), en: item.name ?? "" },
        code: item.code,
        description: { ...emptyLocaleRecord(), en: item.description ?? "" },
        is_active: item.is_active ?? true,
        base_locale:
          (item.base_locale as SupportedLanguage) ?? defaultLocale,
        questionnaire_type: item.questionnaire_type ?? "",
        points_reward: item.points_reward ?? 0,
        token_reward: item.token_reward ?? 0,
      });
      setQuestions(parsedQuestions as Question[]);

      // Load translations for existing keys
      const translationKeys = [
        item.name_key,
        item.description_key,
        ...parsedQuestions.flatMap((q) => [
          q.textKey,
          q.descriptionKey,
          ...(q.options ?? []).map((o) => o.labelKey),
          ...(q.scaleLabels ?? []).map((o) => o.labelKey),
        ]),
      ].filter((key): key is string => Boolean(key));

      if (translationKeys.length === 0) return;

      void (async () => {
        try {
          const translations = await fetchTranslationsForKeys(
            translationKeys,
            TRANSLATION_NAMESPACE
          );
          const translationMap = new Map(
            Object.entries(translations).map(([key, localeRecord]) => [
              key,
              localeRecord as Partial<Record<SupportedLanguage, string>>,
            ])
          );

          setFormData((prev) => ({
            ...prev,
            name:
              item.name_key && translationMap.get(item.name_key)
                ? { ...prev.name, ...translationMap.get(item.name_key)! }
                : prev.name,
            description:
              item.description_key && translationMap.get(item.description_key)
                ? {
                    ...prev.description,
                    ...translationMap.get(item.description_key)!,
                  }
                : prev.description,
          }));

          setQuestions((prevQuestions) =>
            prevQuestions.map((question) => ({
              ...question,
              text:
                question.textKey && translationMap.get(question.textKey)
                  ? { ...question.text, ...translationMap.get(question.textKey)! }
                  : question.text,
              description:
                question.descriptionKey &&
                translationMap.get(question.descriptionKey)
                  ? {
                      ...(question.description ?? emptyLocaleRecord()),
                      ...translationMap.get(question.descriptionKey)!,
                    }
                  : question.description,
              options: question.options?.map((option) => ({
                ...option,
                label:
                  option.labelKey && translationMap.get(option.labelKey)
                    ? { ...option.label, ...translationMap.get(option.labelKey)! }
                    : option.label,
              })),
              scaleLabels: question.scaleLabels?.map((option) => ({
                ...option,
                label:
                  option.labelKey && translationMap.get(option.labelKey)
                    ? { ...option.label, ...translationMap.get(option.labelKey)! }
                    : option.label,
              })),
            }))
          );
        } catch {
          toast.error(t("admin.questionnaires.translationsLoadError"));
        }
      })();
    },
    [defaultLocale, t]
  );

  // ------ Question CRUD ------
  const handleAddQuestion = useCallback(() => {
    setEditingQuestion(emptyQuestionForm());
    setIsQuestionDialogOpen(true);
  }, []);

  const handleEditQuestion = useCallback((question: Question) => {
    setEditingQuestion({
      id: question.id,
      type: question.type,
      text: question.text || emptyLocaleRecord(),
      textKey: question.textKey,
      description: question.description || emptyLocaleRecord(),
      descriptionKey: question.descriptionKey,
      required: question.required || false,
      options: question.options || [],
      scaleLabels: question.scaleLabels || [],
      min: question.min || 1,
      max: question.max || 10,
    });
    setIsQuestionDialogOpen(true);
  }, []);

  const handleSaveQuestion = useCallback(() => {
    if (!editingQuestion) return;

    const existingIdx = questions.findIndex((q) => q.id === editingQuestion.id);
    const newQuestion: Question = {
      id: editingQuestion.id,
      type: editingQuestion.type,
      text: editingQuestion.text,
      textKey: editingQuestion.textKey,
      description: Object.values(editingQuestion.description).some((v) => v)
        ? editingQuestion.description
        : undefined,
      descriptionKey: editingQuestion.descriptionKey,
      required: editingQuestion.required,
      options: ["select", "radio", "checkbox"].includes(editingQuestion.type)
        ? editingQuestion.options
        : undefined,
      scaleLabels:
        editingQuestion.type === "scale" ? editingQuestion.scaleLabels : undefined,
      min: editingQuestion.type === "scale" ? editingQuestion.min : undefined,
      max: editingQuestion.type === "scale" ? editingQuestion.max : undefined,
      order: existingIdx >= 0 ? questions[existingIdx].order : questions.length,
    };

    if (existingIdx >= 0) {
      setQuestions((prev) =>
        prev.map((q, i) => (i === existingIdx ? newQuestion : q))
      );
    } else {
      setQuestions((prev) => [...prev, newQuestion]);
    }

    setIsQuestionDialogOpen(false);
    setEditingQuestion(null);
  }, [editingQuestion, questions]);

  const handleDeleteQuestion = useCallback((id: string) => {
    setQuestions((prev) => prev.filter((q) => q.id !== id));
  }, []);

  const handleDuplicateQuestion = useCallback(
    (question: Question) => {
      const duplicate: Question = {
        ...question,
        id: `q_${Date.now()}`,
        order: questions.length,
      };
      setQuestions((prev) => [...prev, duplicate]);
    },
    [questions.length]
  );

  const handleMoveQuestion = useCallback(
    (index: number, direction: "up" | "down") => {
      if (direction === "up" && index === 0) return;
      if (direction === "down" && index === questions.length - 1) return;

      const newQuestions = [...questions];
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      [newQuestions[index], newQuestions[targetIndex]] = [
        newQuestions[targetIndex],
        newQuestions[index],
      ];
      newQuestions.forEach((q, i) => (q.order = i));
      setQuestions(newQuestions);
    },
    [questions]
  );

  // ------ Block insertion ------
  const handleInsertQuestion = useCallback((question: Question) => {
    setQuestions((prev) => [...prev, question]);
  }, []);

  // ------ Submit ------
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      const baseLocale = formData.base_locale;
      const baseName = formData.name[baseLocale]?.trim();
      if (!baseName) {
        toast.error(t("admin.questionnaires.nameRequired"));
        return;
      }
      if (!formData.code.trim()) {
        toast.error(t("admin.questionnaires.codeRequired"));
        return;
      }
      const missingText = questions.find(
        (q) => !q.text[baseLocale]?.trim()
      );
      if (missingText) {
        toast.error(t("admin.questionnaires.questionTextRequired"));
        return;
      }
      const missingOption = questions.find((q) =>
        (q.options ?? []).some((o) => !o.label[baseLocale]?.trim())
      );
      if (missingOption) {
        toast.error(t("admin.questionnaires.optionLabelRequired"));
        return;
      }
      const missingScale = questions.find((q) =>
        (q.scaleLabels ?? []).some((l) => !l.label[baseLocale]?.trim())
      );
      if (missingScale) {
        toast.error(t("admin.questionnaires.scaleLabelRequired"));
        return;
      }

      const nextVersion = editingItem
        ? (editingItem.version ?? 1) + 1
        : 1;
      const keyPrefix = buildKeyPrefix(formData.code, nextVersion);
      const nameKey = `${keyPrefix}.name`;
      const descriptionKey = `${keyPrefix}.description`;

      const translationInputs: TranslationInput[] = [];
      const addEntries = (
        key: string,
        values: Record<SupportedLanguage, string>
      ) => {
        SUPPORTED_LOCALES.forEach((locale) => {
          const value = values[locale]?.trim();
          if (!value) return;
          translationInputs.push({
            key,
            locale,
            value,
            namespace: TRANSLATION_NAMESPACE,
          });
        });
      };

      addEntries(nameKey, formData.name);

      const hasDescription = Object.values(formData.description).some((v) =>
        v.trim()
      );
      if (hasDescription) {
        addEntries(descriptionKey, formData.description);
      }

      const questionsWithKeys = questions.map((question) => {
        const questionPrefix = `${keyPrefix}.questions.${sanitizeKeySegment(question.id)}`;
        const textKey = `${questionPrefix}.text`;
        const qDescKey = `${questionPrefix}.description`;

        addEntries(textKey, question.text);
        const hasQuestionDesc = Object.values(question.description ?? {}).some(
          (v) => v.trim()
        );
        if (hasQuestionDesc && question.description) {
          addEntries(qDescKey, question.description);
        }

        const optionsWithKeys = question.options?.map((option) => {
          const optionKey = `${questionPrefix}.options.${sanitizeKeySegment(option.value)}`;
          addEntries(optionKey, option.label);
          return { ...option, labelKey: optionKey };
        });

        const scaleLabelsWithKeys = question.scaleLabels?.map((option) => {
          const scaleKey = `${questionPrefix}.scale.${sanitizeKeySegment(option.value)}`;
          addEntries(scaleKey, option.label);
          return { ...option, labelKey: scaleKey };
        });

        return {
          ...question,
          textKey,
          descriptionKey: hasQuestionDesc ? qDescKey : undefined,
          options: optionsWithKeys,
          scaleLabels: scaleLabelsWithKeys,
        };
      });

      // Upsert translations
      const deduped = Array.from(
        new Map(
          translationInputs.map((input) => [
            `${input.key}:${input.locale}`,
            input,
          ])
        ).values()
      );

      if (deduped.length > 0) {
        try {
          await upsertTranslations.mutateAsync(deduped);
        } catch {
          toast.error(t("admin.questionnaires.translationsSaveError"));
          return;
        }
      }

      const data = {
        name:
          baseName ||
          formData.name.en ||
          formData.name.cs ||
          "",
        name_key: nameKey,
        code: formData.code,
        description: hasDescription
          ? formData.description[baseLocale]?.trim() ||
            formData.description.en?.trim() ||
            formData.description.cs?.trim() ||
            null
          : null,
        description_key: hasDescription ? descriptionKey : null,
        questions: toJson(questionsWithKeys),
        is_active: formData.is_active,
        base_locale: baseLocale,
        questionnaire_type: formData.questionnaire_type || undefined,
        points_reward: formData.points_reward || undefined,
        token_reward: formData.token_reward || undefined,
      };

      if (editingItem) {
        onUpdateQuestionnaire(editingItem.id, data);
      } else {
        onCreateQuestionnaire(data);
      }
    },
    [
      editingItem,
      formData,
      questions,
      t,
      upsertTranslations,
      onCreateQuestionnaire,
      onUpdateQuestionnaire,
    ]
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span>
                {editingItem
                  ? t("admin.questionnaires.editQuestionnaire")
                  : t("admin.questionnaires.addQuestionnaire")}
              </span>
              {editingItem && (
                <Badge variant="secondary">
                  v{editingItem.version ?? 1}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {t("admin.questionnaires.formDescription")}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
            <QuestionnaireMetadataForm
              formData={formData}
              activeLang={activeLang}
              onFormDataChange={setFormData}
              onActiveLangChange={setActiveLang}
            />

            <QuestionnaireQuestionList
              questions={questions}
              activeLang={activeLang}
              questionBlocks={questionBlocks}
              onAddQuestion={handleAddQuestion}
              onEditQuestion={handleEditQuestion}
              onDeleteQuestion={handleDeleteQuestion}
              onDuplicateQuestion={handleDuplicateQuestion}
              onMoveQuestion={handleMoveQuestion}
              onOpenBlockInsert={() => setBlockInsertOpen(true)}
            />

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={isSaving}>
                {editingItem ? t("common.save") : t("common.create")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Question edit dialog */}
      <QuestionDialog
        open={isQuestionDialogOpen}
        onOpenChange={setIsQuestionDialogOpen}
        editingQuestion={editingQuestion}
        setEditingQuestion={setEditingQuestion}
        onSave={handleSaveQuestion}
      />

      {/* Block insert dialog */}
      <QuestionnaireBlockInsertDialog
        open={blockInsertOpen}
        onOpenChange={setBlockInsertOpen}
        questionBlocks={questionBlocks}
        currentQuestionCount={questions.length}
        onInsertQuestion={handleInsertQuestion}
      />
    </>
  );
}
