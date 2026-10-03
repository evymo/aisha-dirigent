import { useTranslation } from "react-i18next";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { format } from "date-fns";
import { ClipboardList, Calendar, Award, Hash, Check, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuestionnaireResponseDetail } from "@/hooks/useQuestionnaireResponseDetail";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface QuestionnaireResponseDetailProps {
  /** Response UUID to fetch and display */
  responseId: string | null;
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void;
}

/**
 * Renders a single response value in human-readable format.
 */
function ResponseValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground italic">—</span>;
  }

  if (typeof value === "boolean") {
    return (
      <Badge variant={value ? "default" : "secondary"}>
        {value ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      </Badge>
    );
  }

  if (Array.isArray(value)) {
    return (
      <div className="flex flex-wrap gap-1">
        {value.map((item, i) => (
          <Badge key={i} variant="outline" className="text-xs">
            {typeof item === "object" ? JSON.stringify(item) : String(item)}
          </Badge>
        ))}
      </div>
    );
  }

  if (typeof value === "object") {
    return (
      <pre className="text-xs bg-muted p-2 rounded-md overflow-x-auto">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  return <span className="text-sm">{String(value)}</span>;
}

/**
 * Modal dialog for viewing questionnaire response details.
 *
 * Fetches the response data via audited RPC and renders each answer
 * alongside its question text.
 */
export function QuestionnaireResponseDetail({
  responseId,
  open,
  onOpenChange,
}: QuestionnaireResponseDetailProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);

  const { data, isLoading, isError, error } = useQuestionnaireResponseDetail(
    responseId,
    { enabled: open && !!responseId },
  );

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    try {
      return format(new Date(dateStr), "PPp", { locale: dateLocale });
    } catch {
      return dateStr;
    }
  };

  /**
   * Extracts individual answers from the responses field.
   * Handles both array format and record/object format.
   */
  const extractAnswers = (): Array<{ key: string; value: unknown }> => {
    if (!data?.responses) return [];

    if (Array.isArray(data.responses)) {
      return data.responses.map((answer, idx) => {
        const answerObj = answer as Record<string, unknown>;
        const key =
          (answerObj.blockCode as string) ??
          (answerObj.block_code as string) ??
          (answerObj.questionId as string) ??
          (answerObj.question_id as string) ??
          `${idx + 1}`;
        return { key, value: answerObj.value ?? answerObj };
      });
    }

    if (typeof data.responses === "object" && data.responses !== null) {
      return Object.entries(data.responses as Record<string, unknown>).map(
        ([key, value]) => ({ key, value }),
      );
    }

    return [];
  };

  const answers = data ? extractAnswers() : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            <span>{t("storyloop.responseDetail.title")}</span>
          </DialogTitle>
          <DialogDescription>
            {t("storyloop.responseDetail.description")}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-4">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {isError && (
          <Alert variant="destructive">
            <AlertDescription>
              {t("storyloop.responseDetail.loadError")}
              {error instanceof Error ? `: ${error.message}` : ""}
            </AlertDescription>
          </Alert>
        )}

        {data && (
          <div className="space-y-6">
            {/* Header metadata */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">
                  {data.questionnaire_name ?? data.questionnaire_code ?? "—"}
                </span>
              </div>
              {data.questionnaire_type && (
                <div className="flex items-center gap-2">
                  <Hash className="h-4 w-4 text-muted-foreground" />
                  <Badge variant="outline">{data.questionnaire_type}</Badge>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span>{formatDate(data.completed_at)}</span>
              </div>
              {data.score !== null && data.score !== undefined && (
                <div className="flex items-center gap-2">
                  <Award className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {t("storyloop.responseDetail.score")}: {data.score}
                  </span>
                </div>
              )}
            </div>

            {/* Version info */}
            <div className="flex gap-2">
              {data.questionnaire_version && (
                <Badge variant="secondary" className="text-xs">
                  {t("storyloop.responseDetail.questionnaireVersion", {
                    version: data.questionnaire_version,
                  })}
                </Badge>
              )}
              {data.response_version && (
                <Badge variant="secondary" className="text-xs">
                  {t("storyloop.responseDetail.responseVersion", {
                    version: data.response_version,
                  })}
                </Badge>
              )}
            </div>

            {/* Answers */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold border-b pb-1">
                {t("storyloop.responseDetail.answers")}
              </h3>
              {answers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("storyloop.responseDetail.noAnswers")}
                </p>
              ) : (
                <div className="space-y-3">
                  {answers.map((answer, idx) => (
                    <div
                      key={idx}
                      className="rounded-md border p-3 space-y-1"
                    >
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {answer.key}
                      </div>
                      <ResponseValue value={answer.value} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
