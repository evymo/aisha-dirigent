import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  fetchTranslationsForKeys,
} from "@/hooks";
import {
  type Question,
  type QuestionBlock,
  type BlockConfig,
  type SupportedLanguage,
  TRANSLATION_NAMESPACE,
  SUPPORTED_LOCALES,
  emptyLocaleRecord,
} from "@/components/admin/questionnaires";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface QuestionnaireBlockInsertDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback to toggle dialog open state */
  onOpenChange: (open: boolean) => void;
  /** Available question blocks from the library */
  questionBlocks: QuestionBlock[];
  /** Current number of questions (for ordering) */
  currentQuestionCount: number;
  /** Callback to add the resolved question from a block */
  onInsertQuestion: (question: Question) => void;
}

/**
 * Dialog for inserting a question from the block library.
 *
 * Resolves block translations and creates a fully hydrated Question
 * object from the selected question block type.
 */
export function QuestionnaireBlockInsertDialog({
  open,
  onOpenChange,
  questionBlocks,
  currentQuestionCount,
  onInsertQuestion,
}: QuestionnaireBlockInsertDialogProps) {
  const { t } = useTranslation();
  const [selectedBlockId, setSelectedBlockId] = useState<string>("");
  const [isInserting, setIsInserting] = useState(false);

  const handleInsertBlock = useCallback(async () => {
    const block = questionBlocks?.find((item) => item.id === selectedBlockId);
    if (!block) return;

    setIsInserting(true);

    const config = (block.config ?? {}) as BlockConfig;
    const options = (config.options ?? []).map((option) => ({
      value: option.value,
      label: emptyLocaleRecord(),
      labelKey: option.labelKey,
    }));
    const scaleLabels = (config.scale?.labels ?? []).map((option) => ({
      value: option.value,
      label: emptyLocaleRecord(),
      labelKey: option.labelKey,
    }));

    const translationKeys = [
      block.text_key,
      block.description_key,
      ...options.map((option) => option.labelKey),
      ...scaleLabels.map((option) => option.labelKey),
    ].filter((key): key is string => Boolean(key));

    try {
      let translationMap = new Map<
        string,
        Partial<Record<SupportedLanguage, string>>
      >();

      if (translationKeys.length > 0) {
        const translations = await fetchTranslationsForKeys(
          translationKeys,
          TRANSLATION_NAMESPACE
        );
        translationMap = new Map(
          Object.entries(translations).map(([key, localeRecord]) => [
            key,
            localeRecord as Partial<Record<SupportedLanguage, string>>,
          ])
        );
      }

      const resolveLabels = (
        key?: string | null
      ): Record<SupportedLanguage, string> => {
        const result = emptyLocaleRecord();
        if (key) {
          const translations = translationMap.get(key);
          if (translations) {
            SUPPORTED_LOCALES.forEach((lang) => {
              result[lang] = translations[lang] || "";
            });
          }
        }
        return result;
      };

      const question: Question = {
        id: `block_${block.code}_${Date.now()}`,
        type: block.question_type as Question["type"],
        text: resolveLabels(block.text_key),
        textKey: block.text_key,
        description: block.description_key
          ? resolveLabels(block.description_key)
          : undefined,
        descriptionKey: block.description_key ?? undefined,
        required: block.is_required_default,
        options: options.map((option) => ({
          ...option,
          label: resolveLabels(option.labelKey),
        })),
        scaleLabels: scaleLabels.map((option) => ({
          ...option,
          label: resolveLabels(option.labelKey),
        })),
        min: config.scale?.min,
        max: config.scale?.max,
        order: currentQuestionCount,
        blockCode: block.code,
        blockId: block.id,
      };

      onInsertQuestion(question);
      setSelectedBlockId("");
      onOpenChange(false);
    } catch {
      toast.error(t("admin.questionnaires.translationsLoadError"));
    } finally {
      setIsInserting(false);
    }
  }, [questionBlocks, selectedBlockId, currentQuestionCount, t, onInsertQuestion, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("admin.questionnaires.blocks.insertTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("admin.questionnaires.blocks.insertDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Select
            value={selectedBlockId}
            onValueChange={setSelectedBlockId}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={t(
                  "admin.questionnaires.blocks.selectPlaceholder"
                )}
              />
            </SelectTrigger>
            <SelectContent>
              {(questionBlocks ?? []).map((block) => (
                <SelectItem key={block.id} value={block.id}>
                  {block.code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(questionBlocks?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("admin.questionnaires.blocks.noBlocks")}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => void handleInsertBlock()}
            disabled={!selectedBlockId || isInserting}
          >
            {t("admin.questionnaires.blocks.insertConfirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
