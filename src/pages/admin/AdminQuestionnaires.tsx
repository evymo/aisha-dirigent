import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toJson } from "@/lib/types/json";
import { toast } from "sonner";
import type { Json } from "@/integrations/db/types";
import {
  useDynamicTranslationsMap,
  useUpsertTranslations,
  type TranslationInput,
} from "@/hooks/useDynamicTranslations";
import {
  useQuestionnairesAdminFull,
  useQuestionBlocksAdmin,
  useCreateQuestionnaireMutation,
  useUpdateQuestionnaireMutation,
  useDeleteQuestionnaireMutation,
  useCreateQuestionBlockMutation,
  useUpdateQuestionBlockMutation,
  useDeleteQuestionBlockMutation,
  fetchTranslationsForKeys,
  QUESTIONNAIRE_TYPES,
} from "@/hooks";
import {
  QuestionnairesTable,
  QuestionBlocksTable,
  QuestionBlockEditorDialog,
  DeleteConfirmDialog,
  type Questionnaire,
  type QuestionBlock,
  type QuestionBlockFormData,
  type BlockConfig,
  type QuestionOption,
  type DeleteTarget,
  type SupportedLanguage,
  TRANSLATION_NAMESPACE,
  SUPPORTED_LOCALES,
  emptyLocaleRecord,
  emptyBlockForm,
  sanitizeKeySegment,
  buildKeyPrefix,
  buildBlockKeyPrefix,
  toLocaleMap,
  questionsArraySchema,
} from "@/components/admin/questionnaires";
import { QuestionnaireFormDialog } from "./questionnaires/QuestionnaireFormDialog";

/**
 * Admin page for managing questionnaires and reusable question blocks.
 * Orchestrates sub-components: tables, dialogs, mutations.
 */
export default function AdminQuestionnaires() {
  const { t, i18n } = useTranslation();

  // ------ Dialog state ------
  const [questionnaireDialogOpen, setQuestionnaireDialogOpen] = useState(false);
  const [editingQuestionnaire, setEditingQuestionnaire] = useState<Questionnaire | null>(null);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [editingBlockForm, setEditingBlockForm] = useState<QuestionBlockFormData | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  // ------ Data hooks ------
  const { data: questionnairesData, isLoading } = useQuestionnairesAdminFull();
  const questionnaires = questionnairesData as Questionnaire[] | undefined;
  const { data: questionBlocksData, isLoading: blocksLoading } = useQuestionBlocksAdmin();
  const upsertTranslations = useUpsertTranslations();

  // Transform blocks to UI format
  const questionBlocks: QuestionBlock[] = (questionBlocksData ?? []).map((block) => ({
    id: block.id,
    code: block.code,
    question_type: block.question_type,
    is_required_default: block.is_required_default,
    text_key: block.text_key,
    description_key: block.description_key ?? null,
    base_locale: block.base_locale,
    is_active: block.is_active,
    config: toJson(block.config ?? {}),
    sort_order: block.sort_order ?? 0,
    created_at: block.created_at,
    updated_at: block.updated_at,
  }));

  // Name translations for table display
  const nameKeys = (questionnaires ?? [])
    .map((item) => item.name_key)
    .filter((key): key is string => Boolean(key));
  const nameTranslations = useDynamicTranslationsMap(nameKeys, TRANSLATION_NAMESPACE, "en");

  // ------ Mutation hooks ------
  const createQuestionnaireMut = useCreateQuestionnaireMutation();
  const updateQuestionnaireMut = useUpdateQuestionnaireMutation();
  const deleteQuestionnaireMut = useDeleteQuestionnaireMutation();
  const createBlockMut = useCreateQuestionBlockMutation();
  const updateBlockMut = useUpdateQuestionBlockMutation();
  const deleteBlockMut = useDeleteQuestionBlockMutation();

  // ------ Questionnaire handlers ------
  const handleAddQuestionnaire = useCallback(() => {
    setEditingQuestionnaire(null);
    setQuestionnaireDialogOpen(true);
  }, []);

  const handleEditQuestionnaire = useCallback((item: Questionnaire) => {
    setEditingQuestionnaire(item);
    setQuestionnaireDialogOpen(true);
  }, []);

  const handleDeleteQuestionnaire = useCallback((id: string) => {
    setDeleteTarget({ type: "questionnaire", id });
    setDeleteConfirmOpen(true);
  }, []);

  // ------ Block handlers ------
  const handleAddBlock = useCallback(() => {
    setEditingBlockForm({
      ...emptyBlockForm(),
    });
    setBlockDialogOpen(true);
  }, []);

  const handleEditBlock = useCallback(
    (block: QuestionBlock) => {
      const config = (block.config ?? {}) as BlockConfig;
      const options = (config.options ?? []).map((option) => {
        const label = emptyLocaleRecord();
        if (typeof option.label === "object") {
          SUPPORTED_LOCALES.forEach((lang) => {
            label[lang] = (option.label as Record<string, string>)?.[lang] ?? "";
          });
        }
        return { value: option.value, label, labelKey: option.labelKey };
      });
      const scaleLabels = (config.scale?.labels ?? []).map((option) => {
        const label = emptyLocaleRecord();
        if (typeof option.label === "object") {
          SUPPORTED_LOCALES.forEach((lang) => {
            label[lang] = (option.label as Record<string, string>)?.[lang] ?? "";
          });
        }
        return { value: option.value, label, labelKey: option.labelKey };
      });

      const form: QuestionBlockFormData = {
        id: block.id,
        code: block.code,
        type: block.question_type as QuestionBlockFormData["type"],
        text: emptyLocaleRecord(),
        description: emptyLocaleRecord(),
        required: block.is_required_default,
        options,
        scaleLabels,
        min: config.scale?.min ?? 1,
        max: config.scale?.max ?? 10,
        is_active: block.is_active,
        scoring_domain: config.scoring_domain ?? "",
        reversed: config.reversed ?? false,
        section_key: config.section_key ?? "",
        multi_select: config.multi_select ?? false,
        emoji: config.emoji ?? "",
        tag_category: config.tag_category ?? "",
        date_format: config.date_format ?? "DD.MM.YYYY",
      };
      setEditingBlockForm(form);
      setBlockDialogOpen(true);

      // Load translations for block keys
      const translationKeys = [
        block.text_key,
        block.description_key,
        ...options.map((o) => o.labelKey),
        ...scaleLabels.map((o) => o.labelKey),
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

          setEditingBlockForm((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              text:
                block.text_key && translationMap.get(block.text_key)
                  ? { ...prev.text, ...translationMap.get(block.text_key)! }
                  : prev.text,
              description:
                block.description_key && translationMap.get(block.description_key)
                  ? { ...prev.description, ...translationMap.get(block.description_key)! }
                  : prev.description,
              options: prev.options.map((option) => ({
                ...option,
                label:
                  option.labelKey && translationMap.get(option.labelKey)
                    ? { ...option.label, ...translationMap.get(option.labelKey)! }
                    : option.label,
              })),
              scaleLabels: prev.scaleLabels.map((option) => ({
                ...option,
                label:
                  option.labelKey && translationMap.get(option.labelKey)
                    ? { ...option.label, ...translationMap.get(option.labelKey)! }
                    : option.label,
              })),
            };
          });
        } catch {
          toast.error(t("admin.questionnaires.translationsLoadError"));
        }
      })();
    },
    [t]
  );

  const handleDeleteBlock = useCallback((id: string) => {
    setDeleteTarget({ type: "block", id });
    setDeleteConfirmOpen(true);
  }, []);

  const handleSaveBlock = useCallback(async () => {
    if (!editingBlockForm) return;

    const baseLocale = (i18n.language as SupportedLanguage) || "en";
    if (!editingBlockForm.code.trim()) {
      toast.error(t("admin.questionnaires.blocks.codeRequired"));
      return;
    }
    if (!editingBlockForm.text[baseLocale]?.trim()) {
      toast.error(t("admin.questionnaires.blocks.textRequired"));
      return;
    }

    // Validate options for types that require them
    if (["select", "radio", "checkbox"].includes(editingBlockForm.type)) {
      const missingOption = editingBlockForm.options.some(
        (option) => !option.label[baseLocale]?.trim()
      );
      if (missingOption) {
        toast.error(t("admin.questionnaires.blocks.optionLabelRequired"));
        return;
      }
    }

    // Build translation inputs
    const keyPrefix = buildBlockKeyPrefix(editingBlockForm.code);
    const textKey = `${keyPrefix}.text`;
    const descriptionKey = `${keyPrefix}.description`;
    const hasDescription = Object.values(editingBlockForm.description).some((v) =>
      v.trim()
    );

    const translationInputs: TranslationInput[] = [];
    const addTranslations = (key: string, values: Record<SupportedLanguage, string>) => {
      SUPPORTED_LOCALES.forEach((locale) => {
        const value = values[locale]?.trim();
        if (!value) return;
        translationInputs.push({ key, locale, value, namespace: TRANSLATION_NAMESPACE });
      });
    };

    addTranslations(textKey, editingBlockForm.text);
    if (hasDescription) {
      addTranslations(descriptionKey, editingBlockForm.description);
    }

    const optionsWithKeys = editingBlockForm.options.map((option) => {
      const optionKey = `${keyPrefix}.options.${sanitizeKeySegment(option.value)}`;
      addTranslations(optionKey, option.label);
      return { ...option, labelKey: optionKey };
    });

    const scaleLabelsWithKeys = editingBlockForm.scaleLabels.map((option) => {
      const scaleKey = `${keyPrefix}.scale.${sanitizeKeySegment(option.value)}`;
      addTranslations(scaleKey, option.label);
      return { ...option, labelKey: scaleKey };
    });

    // Deduplicate and upsert translations
    const deduped = Array.from(
      new Map(
        translationInputs.map((input) => [`${input.key}:${input.locale}`, input])
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

    // Build block config
    const config: BlockConfig = {};
    if (
      ["select", "radio", "checkbox", "tags"].includes(editingBlockForm.type) &&
      optionsWithKeys.length > 0
    ) {
      config.options = optionsWithKeys;
    }
    if (editingBlockForm.type === "scale") {
      config.scale = {
        min: editingBlockForm.min,
        max: editingBlockForm.max,
        labels: scaleLabelsWithKeys,
      };
    }
    if (editingBlockForm.scoring_domain) {
      config.scoring_domain = editingBlockForm.scoring_domain;
    }
    if (editingBlockForm.reversed) {
      config.reversed = true;
    }
    if (editingBlockForm.section_key) {
      config.section_key = editingBlockForm.section_key;
    }
    if (editingBlockForm.type === "tags") {
      if (editingBlockForm.multi_select) config.multi_select = true;
      if (editingBlockForm.emoji) config.emoji = editingBlockForm.emoji;
      if (editingBlockForm.tag_category) config.tag_category = editingBlockForm.tag_category;
    }
    if (editingBlockForm.type === "date" && editingBlockForm.date_format) {
      config.date_format = editingBlockForm.date_format;
    }

    const payload = {
      code: editingBlockForm.code,
      questions: config as Json,
      is_active: editingBlockForm.is_active,
      sort_order: 0,
    };

    const onSuccess = () => {
      setBlockDialogOpen(false);
      setEditingBlockForm(null);
    };

    if (editingBlockForm.id) {
      updateBlockMut.mutate(
        { id: editingBlockForm.id, block_key: payload.code, ...payload },
        {
          onSuccess: () => {
            toast.success(t("admin.questionnaires.blocks.updated"));
            onSuccess();
          },
          onError: (error) => toast.error(error.message),
        }
      );
    } else {
      createBlockMut.mutate(
        { block_key: payload.code, ...payload },
        {
          onSuccess: () => {
            toast.success(t("admin.questionnaires.blocks.created"));
            onSuccess();
          },
          onError: (error) => toast.error(error.message),
        }
      );
    }
  }, [
    editingBlockForm,
    i18n.language,
    t,
    upsertTranslations,
    createBlockMut,
    updateBlockMut,
  ]);

  // ------ Delete confirmation ------
  const handleDeleteConfirm = useCallback(() => {
    if (!deleteTarget) return;
    if (deleteTarget.type === "block") {
      deleteBlockMut.mutate(deleteTarget.id, {
        onSuccess: () => toast.success(t("admin.questionnaires.blocks.deleted")),
        onError: (error) => toast.error(error.message),
      });
    } else {
      deleteQuestionnaireMut.mutate(deleteTarget.id, {
        onSuccess: () => toast.success(t("admin.questionnaires.deleted")),
        onError: () => toast.error(t("admin.questionnaires.errors.deleteFailed")),
      });
    }
    setDeleteTarget(null);
  }, [deleteTarget, deleteBlockMut, deleteQuestionnaireMut, t]);

  if (isLoading || blocksLoading) {
    return <div className="p-6">{t("common.loading")}</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">{t("admin.questionnaires.title")}</h1>
        <p className="text-muted-foreground">{t("admin.questionnaires.subtitle")}</p>
      </div>

      {/* Questionnaires table */}
      <QuestionnairesTable
        questionnaires={questionnaires}
        nameTranslations={nameTranslations}
        onAdd={handleAddQuestionnaire}
        onEdit={handleEditQuestionnaire}
        onDelete={handleDeleteQuestionnaire}
      />

      {/* Question blocks table */}
      <QuestionBlocksTable
        questionBlocks={questionBlocks}
        onAdd={handleAddBlock}
        onEdit={handleEditBlock}
        onDelete={handleDeleteBlock}
      />

      {/* Questionnaire form dialog */}
      <QuestionnaireFormDialog
        open={questionnaireDialogOpen}
        onOpenChange={setQuestionnaireDialogOpen}
        editingItem={editingQuestionnaire}
        questionBlocks={questionBlocks}
        onCreateQuestionnaire={(data) => {
          createQuestionnaireMut.mutate(data as Parameters<typeof createQuestionnaireMut.mutate>[0], {
            onSuccess: () => {
              toast.success(t("admin.questionnaires.created"));
              setQuestionnaireDialogOpen(false);
              setEditingQuestionnaire(null);
            },
            onError: () => toast.error(t("admin.questionnaires.errors.createFailed")),
          });
        }}
        onUpdateQuestionnaire={(id, data) => {
          updateQuestionnaireMut.mutate(
            { id, ...data },
            {
              onSuccess: () => {
                toast.success(t("admin.questionnaires.updated"));
                setQuestionnaireDialogOpen(false);
                setEditingQuestionnaire(null);
              },
              onError: () => toast.error(t("admin.questionnaires.errors.updateFailed")),
            }
          );
        }}
        isSaving={createQuestionnaireMut.isPending || updateQuestionnaireMut.isPending}
      />

      {/* Block editor dialog */}
      <QuestionBlockEditorDialog
        open={blockDialogOpen}
        onOpenChange={setBlockDialogOpen}
        block={editingBlockForm}
        onChange={setEditingBlockForm}
        onSave={() => void handleSaveBlock()}
        isSaving={createBlockMut.isPending || updateBlockMut.isPending}
      />

      {/* Delete confirmation */}
      <DeleteConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        target={deleteTarget}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
