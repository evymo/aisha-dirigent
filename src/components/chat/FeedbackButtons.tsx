/**
 * Feedback buttons for AI chat messages (thumbs up/down + correction).
 *
 * Renders inline feedback controls under assistant messages. Dual-writes:
 *   1. ALE training pipeline (existing path, fine-tuning data)
 *      — useSubmitAiFeedback({ message_id, rating: 1|0 })
 *   2. RAG eval audit (Step 2 of retrieval optimization plan 2026)
 *      — useSubmitMessageFeedback({ aiRunId, rating: 1|-1, reason })
 *      — fires only when the assistant message has ai_run_id (newer chats)
 *
 * The two paths serve different consumers (training data vs eval baseline +
 * audit trail) so this is NOT a duplication — one click, two storage paths
 * via Promise.allSettled (failure in one does not block the other).
 *
 * @module components/chat/FeedbackButtons
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ThumbsUp, ThumbsDown, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useSubmitAiFeedback } from "@/hooks/useAleFeedback";
import { useSubmitMessageFeedback } from "@/hooks/useRunCitations";
import { safeError } from "@/lib/security/safeLogger";
import { cn } from "@/lib/utils";

interface FeedbackButtonsProps {
  /** UUID of the chat message being rated (ALE pipeline). */
  messageId: string;
  /**
   * Optional UUID of the linked ai_runs row (RAG eval pipeline).
   * Populated by useAiChat onSuccess from response metadata.run_id.
   * When absent, only the ALE path fires.
   */
  aiRunId?: string | null;
}

/**
 * Inline feedback controls for an AI assistant message.
 *
 * Shows thumbs up/down buttons and optional correction text area.
 * Feedback is submitted to the ALE training pipeline.
 */
export function FeedbackButtons({ messageId, aiRunId }: FeedbackButtonsProps) {
  const { t } = useTranslation("admin");
  const { toast } = useToast();
  const { mutateAsync: submitFeedback, isPending: aleSubmitting } = useSubmitAiFeedback();
  const { mutateAsync: submitRagFeedback, isPending: ragSubmitting } = useSubmitMessageFeedback();
  const isPending = aleSubmitting || ragSubmitting;

  const [rating, setRating] = useState<number | null>(null);
  const [showCorrection, setShowCorrection] = useState(false);
  const [correctionText, setCorrectionText] = useState("");

  /**
   * Dual-write helper. Translates ALE rating ({1=up, 0=down}) into RAG eval
   * rating ({1=up, -1=down, 0=neutral}) — the two systems converged on
   * different conventions historically. ALE call is the source of truth for
   * UI state (toast / disable); RAG call is best-effort and silently logged
   * via safeError on failure so it never blocks user feedback.
   */
  async function dualWrite(rawRating: number, reason: string | undefined) {
    const alePromise = submitFeedback({
      domain_tags: [],
      metadata: {},
      feedback_category: reason ? "accuracy" : "general",
      ...(reason ? { correction_text: reason } : {}),
      message_id: messageId,
      rating: rawRating,
    });
    const ragPromise = aiRunId
      ? submitRagFeedback({
          aiRunId,
          rating: rawRating === 1 ? 1 : rawRating === 0 ? -1 : 0,
          reason,
        })
      : Promise.resolve(null);
    const [ale, rag] = await Promise.allSettled([alePromise, ragPromise]);
    if (rag.status === "rejected") {
      safeError("FeedbackButtons.rag_eval_path_failed", rag.reason);
    }
    if (ale.status === "rejected") throw ale.reason;
    return ale.value;
  }

  const handleRating = async (value: number) => {
    setRating(value);

    try {
      const response = await dualWrite(value, undefined);

      if (!response.success) {
        toast({
          title: t("aleFeedback.feedbackError"),
          description: response.error === "rate_limit_exceeded"
            ? t("aleFeedback.rateLimitExceeded")
            : response.message,
          variant: "destructive",
        });
        setRating(null);
        return;
      }

      toast({
        title: t("aleFeedback.feedbackSubmitted"),
        description: t("aleFeedback.feedbackSubmittedDescription"),
      });
    } catch {
      toast({
        title: t("aleFeedback.feedbackError"),
        variant: "destructive",
      });
      setRating(null);
    }
  };

  const handleSubmitCorrection = async () => {
    if (!correctionText.trim()) return;

    try {
      const response = await dualWrite(rating ?? 0, correctionText.trim());

      if (response.success) {
        toast({
          title: t("aleFeedback.feedbackSubmitted"),
          description: t("aleFeedback.feedbackSubmittedDescription"),
        });
        setShowCorrection(false);
        setCorrectionText("");
      }
    } catch {
      toast({
        title: t("aleFeedback.feedbackError"),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="mt-1">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-6 w-6",
            rating === 1 && "text-green-600 bg-green-50 dark:bg-green-950/30"
          )}
          disabled={isPending || rating !== null}
          onClick={() => handleRating(1)}
          title={t("aleFeedback.thumbsUp")}
        >
          <ThumbsUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-6 w-6",
            rating === 0 && "text-red-600 bg-red-50 dark:bg-red-950/30"
          )}
          disabled={isPending || rating !== null}
          onClick={() => handleRating(0)}
          title={t("aleFeedback.thumbsDown")}
        >
          <ThumbsDown className="h-3.5 w-3.5" />
        </Button>
        {rating !== null && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setShowCorrection((prev) => !prev)}
            title={t("aleFeedback.submitCorrection")}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {showCorrection && (
        <div className="mt-2 space-y-2">
          <Textarea
            className="text-sm min-h-[60px]"
            maxLength={5000}
            onChange={(e) => setCorrectionText(e.target.value)}
            placeholder={t("aleFeedback.correctionPlaceholder")}
            value={correctionText}
          />
          <Button
            disabled={isPending || !correctionText.trim()}
            onClick={handleSubmitCorrection}
            size="sm"
            variant="outline"
          >
            {t("aleFeedback.submitFeedback")}
          </Button>
        </div>
      )}
    </div>
  );
}
