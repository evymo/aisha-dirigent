import { useTranslation } from "react-i18next";
import {
  type Question,
  type QuestionBlock,
  type SupportedLanguage,
  LOCALE_LABELS,
} from "@/components/admin/questionnaires";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, ClipboardList, Copy } from "lucide-react";

interface QuestionnaireQuestionListProps {
  /** Array of questions in the questionnaire */
  questions: Question[];
  /** Currently active language for multi-locale display */
  activeLang: SupportedLanguage;
  /** Available question blocks for the insert button */
  questionBlocks: QuestionBlock[];
  /** Callback to add a new question */
  onAddQuestion: () => void;
  /** Callback to edit an existing question */
  onEditQuestion: (question: Question) => void;
  /** Callback to delete a question by ID */
  onDeleteQuestion: (id: string) => void;
  /** Callback to duplicate a question */
  onDuplicateQuestion: (question: Question) => void;
  /** Callback to move a question up or down */
  onMoveQuestion: (index: number, direction: "up" | "down") => void;
  /** Callback to open the block insert dialog */
  onOpenBlockInsert: () => void;
}

/**
 * Question listing section of the questionnaire form.
 *
 * Displays all questions with move/edit/delete/duplicate controls,
 * and provides buttons to add new questions or insert from block library.
 */
export function QuestionnaireQuestionList({
  questions,
  activeLang,
  questionBlocks,
  onAddQuestion,
  onEditQuestion,
  onDeleteQuestion,
  onDuplicateQuestion,
  onMoveQuestion,
  onOpenBlockInsert,
}: QuestionnaireQuestionListProps) {
  const { t } = useTranslation();

  return (
    <div className="border-t pt-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold">
            {t("admin.questionnaires.form.questions")}
          </h3>
          <p className="text-sm text-muted-foreground">
            {questions.length}{" "}
            {t("admin.questionnaires.questionsCount")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {LOCALE_LABELS[activeLang]}
          </Badge>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onOpenBlockInsert}
            disabled={
              !questionBlocks || questionBlocks.length === 0
            }
          >
            <ClipboardList className="h-4 w-4 mr-1" />
            {t("admin.questionnaires.blocks.insert")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onAddQuestion}
          >
            <Plus className="h-4 w-4 mr-1" />
            {t("admin.questionnaires.addQuestion")}
          </Button>
        </div>
      </div>

      {questions.length === 0 ? (
        <div className="border-2 border-dashed rounded-lg p-8 text-center text-muted-foreground">
          {t("admin.questionnaires.noQuestions")}
        </div>
      ) : (
        <div className="space-y-2">
          {questions.map((question, index) => (
            <div
              key={question.id}
              className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg"
            >
              <div className="flex flex-col gap-1 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() =>
                    onMoveQuestion(index, "up")
                  }
                  disabled={index === 0}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() =>
                    onMoveQuestion(index, "down")
                  }
                  disabled={index === questions.length - 1}
                >
                  ↓
                </Button>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-xs">
                    {question.type}
                  </Badge>
                  {question.required && (
                    <Badge
                      variant="secondary"
                      className="text-xs"
                    >
                      {t("admin.questionnaires.required")}
                    </Badge>
                  )}
                  {question.blockCode && (
                    <Badge
                      variant="outline"
                      className="text-xs text-blue-600"
                    >
                      {question.blockCode}
                    </Badge>
                  )}
                </div>
                <p className="font-medium truncate">
                  {question.text[activeLang] ||
                    question.text.en ||
                    "-"}
                </p>
                {question.description?.[activeLang] && (
                  <p className="text-sm text-muted-foreground truncate">
                    {question.description[activeLang]}
                  </p>
                )}
                {question.options &&
                  question.options.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {question.options.length}{" "}
                      {t(
                        "admin.questionnaires.optionsCount"
                      )}
                    </p>
                  )}
              </div>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    onDuplicateQuestion(question)
                  }
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    onEditQuestion(question)
                  }
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    onDeleteQuestion(question.id)
                  }
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
