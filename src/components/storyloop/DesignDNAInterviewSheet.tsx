/**
 * DesignDNAInterviewSheet — conversational design profiling overlay.
 *
 * Opens as a side sheet where Occipitum asks the partner poetic,
 * non-marketing questions to extract their design DNA (brand personality,
 * UX persona, style preferences, constraints).
 *
 * @module
 */

import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dna, Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDesignInterview } from "@/hooks/useDesignProfile";
import { safeError } from "@/lib/security/safeLogger";

// =====================================================
// Types
// =====================================================

interface DesignDNAInterviewSheetProps {
  /** Partner UUID to profile */
  partnerId: string;
}

interface InterviewMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
}

// =====================================================
// Constants
// =====================================================

const MAX_QUESTIONS = 8;

// =====================================================
// Component
// =====================================================

/**
 * Side sheet for conducting design DNA interviews.
 *
 * Displays a conversational UI where Occipitum asks questions
 * and the partner answers. After all questions, the answers are
 * sent to the n8n workflow for DNA extraction.
 */
export function DesignDNAInterviewSheet({ partnerId }: DesignDNAInterviewSheetProps) {
  const { t } = useTranslation();
  const interviewMutation = useDesignInterview();

  const [messages, setMessages] = useState<InterviewMessage[]>([]);
  const [currentInput, setCurrentInput] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [questionCount, setQuestionCount] = useState(0);

  const addMessage = useCallback((role: "assistant" | "user", text: string) => {
    setMessages((prev) => [
      ...prev,
      { id: `${role}-${Date.now()}-${Math.random()}`, role, text },
    ]);
  }, []);

  const handleOpen = useCallback(() => {
    setIsOpen(true);
    if (messages.length === 0) {
      addMessage("assistant", t("design.interview.welcomeQuestion"));
    }
  }, [addMessage, messages.length, t]);

  const handleSend = useCallback(async () => {
    const answer = currentInput.trim();
    if (!answer) return;

    addMessage("user", answer);
    setCurrentInput("");
    const nextCount = questionCount + 1;
    setQuestionCount(nextCount);

    if (nextCount >= MAX_QUESTIONS) {
      // Collect all answers and submit
      const allAnswers = [
        ...messages.filter((m) => m.role === "user").map((m, i) => ({
          answer: m.text,
          question_id: `q${i + 1}`,
        })),
        { answer, question_id: `q${nextCount}` },
      ];

      addMessage("assistant", t("design.interview.analyzing"));

      try {
        await interviewMutation.mutateAsync({
          answers: allAnswers,
          partner_id: partnerId,
        });
        addMessage("assistant", t("design.interview.complete"));
      } catch (error) {
        safeError("design.interview.submitFailed", error as Error);
        addMessage("assistant", t("design.interview.error"));
      }
    } else {
      // Ask next question
      addMessage("assistant", t(`design.interview.q${nextCount + 1}`));
    }
  }, [addMessage, currentInput, interviewMutation, messages, partnerId, questionCount, t]);

  const isComplete = questionCount >= MAX_QUESTIONS;
  const isSubmitting = interviewMutation.isPending;

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" onClick={handleOpen}>
          <Dna className="h-4 w-4 mr-1" />
          {t("design.interview.trigger")}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[400px] sm:w-[540px] flex flex-col">
        <SheetHeader>
          <SheetTitle>{t("design.interview.title")}</SheetTitle>
          <SheetDescription>{t("design.interview.description")}</SheetDescription>
        </SheetHeader>

        {/* Messages */}
        <ScrollArea className="flex-1 px-1 py-4">
          <div className="space-y-3">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`text-sm px-3 py-2 rounded-lg max-w-[85%] ${
                  msg.role === "assistant"
                    ? "bg-violet-50 dark:bg-violet-950/30 text-foreground"
                    : "bg-primary text-primary-foreground ml-auto"
                }`}
              >
                {msg.text}
              </div>
            ))}
            {isSubmitting && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground px-3">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("design.interview.processing")}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input */}
        {!isComplete && (
          <div className="flex items-center gap-2 border-t pt-3">
            <Input
              disabled={isSubmitting}
              onChange={(e) => setCurrentInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={t("design.interview.placeholder")}
              value={currentInput}
            />
            <Button
              disabled={!currentInput.trim() || isSubmitting}
              onClick={() => void handleSend()}
              size="icon"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Progress */}
        <div className="text-xs text-muted-foreground mt-2">
          {t("design.interview.progress", { current: questionCount, total: MAX_QUESTIONS })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
