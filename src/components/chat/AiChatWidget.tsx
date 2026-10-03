import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Send, Plus, Loader2, Lock, Archive, ClipboardList, Clock, Bug, History, ShieldCheck } from "lucide-react";
import { AishaAvatar } from "@/components/chat/AishaAvatar";
import { ChatMarkdown } from "@/components/chat/ChatMarkdown";
import { FeedbackButtons } from "@/components/chat/FeedbackButtons";
import { FaithfulnessChip } from "@/components/chat/FaithfulnessChip";
import { CitationPanel } from "@/components/chat/CitationPanel";
import { ExplainabilityPanel } from "@/components/chat/ExplainabilityPanel";
import { AskAishaPanel, AskStarter } from "@/components/chat/AskAishaPanel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAiChat, ChatMessage } from "@/hooks/useAiChat";
import { useNewsDelivery } from "@/hooks/useNewsDelivery";
import { useSession } from "@/hooks/useSession";
import { ConversationList } from "@/components/chat/ConversationList";
import { cn } from "@/lib/utils";

export function AiChatWidget() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, isAdmin, hasRole } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [debugMode, setDebugMode] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const canUseDebugMode = isAdmin || hasRole("staff");
  
  const {
    messages,
    messagesLoading,
    sendMessage,
    isSending,
    aishaIsTyping,
    sendErrorMessage,
    clearSendError,
    startNewConversation,
    canChat,
    accessLevel,
    blockReason,
    accessLoading,
    activeConversationId,
    conversations,
    conversationsLoading,
    selectConversation,
    archiveConversation,
  } = useAiChat({
    language: i18n.language,
    debugMode: canUseDebugMode && debugMode,
  });

  // Deliver pending news articles as Aisha messages when chat opens
  const { deliverNews } = useNewsDelivery();
  useEffect(() => {
    if (isOpen && canChat) {
      deliverNews();
    }
  }, [isOpen, canChat, deliverNews]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Starter questions for the empty state. Generic defaults ship in the platform
  // locale; role-gated ones map to staff-tier agent_tools. Instance-specific
  // prompts (RIQ) override via instance-data (<fork>-instance-data/ask_prompts.json).
  const askStarters: AskStarter[] = [
    { id: "attention", label: t("askStarters.attention") },
    { id: "reviewQueue", label: t("askStarters.reviewQueue"), roles: ["staff"] },
    { id: "register", label: t("askStarters.register"), roles: ["staff"] },
  ];

  const handleSend = async () => {
    if (!inputValue.trim() || isSending || !canChat) return;
    const msg = inputValue;
    clearSendError();
    setInputValue("");
    try {
      await sendMessage(msg);
    } catch {
      // Error handled by hook
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNavigate = (path: string) => {
    setIsOpen(false);
    navigate(path);
  };

  const isAuthenticated = !!user;
  const showAccessDenied = !canChat && !accessLoading;

  // Render appropriate access denied state based on block reason
  const renderAccessDeniedContent = () => {
    // Not authenticated
    if (!isAuthenticated) {
      return (
        <div className="text-center max-w-sm">
          <div className="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Lock className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="font-semibold text-lg mb-2">
            {t("aiChat.accessDenied.title")}
          </h3>
          <p className="text-muted-foreground text-sm mb-4">
            {t("aiChat.accessDenied.description")}
          </p>
          <div className="bg-muted/50 rounded-lg p-3 mb-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Archive className="h-4 w-4 flex-shrink-0" />
              <span>{t("aiChat.accessDenied.archiveHint")}</span>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Button onClick={() => handleNavigate("/auth")}>
              {t("aiChat.accessDenied.signIn")}
            </Button>
            <Button variant="outline" onClick={() => handleNavigate("/auth?mode=register")}>
              {t("aiChat.accessDenied.register")}
            </Button>
            <Button variant="ghost" onClick={() => handleNavigate("/archive")}>
              {t("aiChat.accessDenied.browseArchive")}
            </Button>
          </div>
        </div>
      );
    }

    // Needs to complete questionnaire
    if (blockReason === "terms_not_accepted") {
      return (
        <div className="text-center max-w-sm">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Lock className="h-8 w-8 text-primary" />
          </div>
          <h3 className="font-semibold text-lg mb-2">
            {t("auth.consent_terms_title")}
          </h3>
          <p className="text-muted-foreground text-sm mb-4">
            {t("auth.consent_terms_desc")}
          </p>
          <div className="flex flex-col gap-2">
            <Button onClick={() => handleNavigate("/terms")}>
              {t("footer.termsOfService")}
            </Button>
            <Button variant="ghost" onClick={() => handleNavigate("/archive")}>
              {t("aiChat.accessDenied.browseArchive")}
            </Button>
          </div>
        </div>
      );
    }

    // Needs to complete questionnaire
    if (blockReason === "needs_questionnaire" || accessLevel === "needs_questionnaire") {
      return (
        <div className="text-center max-w-sm">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <ClipboardList className="h-8 w-8 text-primary" />
          </div>
          <h3 className="font-semibold text-lg mb-2">
            {t("aiChat.needsQuestionnaire.title")}
          </h3>
          <p className="text-muted-foreground text-sm mb-4">
            {t("aiChat.needsQuestionnaire.description")}
          </p>
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mb-6">
            <p className="text-sm text-primary">
              {t("aiChat.needsQuestionnaire.hint")}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Button onClick={() => handleNavigate("/member/onboarding")}>
              {t("aiChat.needsQuestionnaire.startQuestionnaire")}
            </Button>
            <Button variant="ghost" onClick={() => handleNavigate("/archive")}>
              {t("aiChat.accessDenied.browseArchive")}
            </Button>
          </div>
        </div>
      );
    }

    // Pending approval
    if (blockReason === "pending_approval" || accessLevel === "pending_approval") {
      return (
        <div className="text-center max-w-sm">
          <div className="mx-auto w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-4">
            <Clock className="h-8 w-8 text-amber-600 dark:text-amber-400" />
          </div>
          <h3 className="font-semibold text-lg mb-2">
            {t("aiChat.pendingApproval.title")}
          </h3>
          <p className="text-muted-foreground text-sm mb-4">
            {t("aiChat.pendingApproval.description")}
          </p>
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 mb-6">
            <p className="text-sm text-amber-700 dark:text-amber-300">
              {t("aiChat.pendingApproval.hint")}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Button variant="outline" onClick={() => handleNavigate("/member")}>
              {t("aiChat.pendingApproval.viewStatus")}
            </Button>
            <Button variant="ghost" onClick={() => handleNavigate("/archive")}>
              {t("aiChat.accessDenied.browseArchive")}
            </Button>
          </div>
        </div>
      );
    }

    // Default: no registration or membership
    return (
      <div className="text-center max-w-sm">
        <div className="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Lock className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="font-semibold text-lg mb-2">
          {t("aiChat.noRegistration.title")}
        </h3>
        <p className="text-muted-foreground text-sm mb-4">
          {t("aiChat.noRegistration.description")}
        </p>
        <div className="bg-muted/50 rounded-lg p-3 mb-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Archive className="h-4 w-4 flex-shrink-0" />
            <span>{t("aiChat.accessDenied.archiveHint")}</span>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Button onClick={() => handleNavigate("/studies")}>
            {t("aiChat.noRegistration.viewStudies")}
          </Button>
          <Button variant="ghost" onClick={() => handleNavigate("/archive")}>
            {t("aiChat.accessDenied.browseArchive")}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button
          size="lg"
          className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-xl z-50 p-0 overflow-hidden"
          aria-label={t("aiChat.title")}
        >
          <AishaAvatar size="lg" className="h-full w-full rounded-full" />
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-lg p-0 flex flex-col border-l border-border/50 shadow-2xl outline-none focus:outline-none">
        <SheetHeader className="px-4 py-3 border-b border-border/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AishaAvatar size="md" />
              <SheetTitle className="text-base font-semibold">{t("aiChat.title")}</SheetTitle>
            </div>
            {canChat && (
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowHistory((prev) => !prev)}
                  title={t("aiChat.conversations.title")}
                >
                  <History className="h-4 w-4" />
                </Button>
                {canUseDebugMode && (
                  <Button
                    variant={debugMode ? "default" : "outline"}
                    size="sm"
                    onClick={() => setDebugMode((prev) => !prev)}
                  >
                    <Bug className="h-4 w-4 mr-1" />
                    {t("admin.audit.severities.debug")}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => { startNewConversation(); setShowHistory(false); }}>
                  <Plus className="h-4 w-4 mr-1" />
                  {t("aiChat.newConversation")}
                </Button>
              </div>
            )}
          </div>
        </SheetHeader>

        <div className="flex-1 flex flex-col min-h-0">
          {/* Access Denied States */}
          {showAccessDenied ? (
            <div className="flex-1 flex items-center justify-center p-6">
              {renderAccessDeniedContent()}
            </div>
          ) : showHistory ? (
            /* Conversation History Panel */
            <ConversationList
              conversations={conversations}
              isLoading={conversationsLoading}
              activeConversationId={activeConversationId}
              onSelect={selectConversation}
              onArchive={archiveConversation}
              onNewConversation={startNewConversation}
              onBack={() => setShowHistory(false)}
            />
          ) : (
            <>
              {/* Messages */}
              <ScrollArea className="flex-1 p-4">
                {accessLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : messages.length === 0 && !messagesLoading ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <AishaAvatar size="lg" className="mx-auto mb-4 opacity-70" />
                    <h3 className="font-medium text-foreground mb-2">
                      {t("aiChat.emptyState.title")}
                    </h3>
                    <p className="text-sm max-w-xs mx-auto">
                      {t("aiChat.emptyState.description")}
                    </p>
                    {canChat && (
                      <AskAishaPanel
                        starters={askStarters}
                        onSelect={(prompt) => sendMessage(prompt)}
                        hasRole={hasRole}
                        disabled={isSending}
                      />
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.map((msg: ChatMessage) => {
                      const isAishaDirigent = msg.routing_category === "aisha_dirigent";
                      return (
                      <div
                        key={msg.id}
                        className={cn(
                          "flex gap-2",
                          msg.role === "user" ? "justify-end" : "justify-start"
                        )}
                      >
                        {msg.role === "assistant" && (
                          <div className="relative mt-1">
                            <AishaAvatar size="sm" />
                            {isAishaDirigent && (
                              <ShieldCheck className="absolute -bottom-1 -right-1 h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                            )}
                          </div>
                        )}
                        <div
                          className={cn(
                            "max-w-[85%] rounded-lg px-4 py-2",
                            msg.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : msg.role === "system"
                                ? "border border-dashed border-border bg-muted/40 text-muted-foreground"
                                : isAishaDirigent
                                  ? "bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800"
                                  : "bg-muted"
                          )}
                        >
                          {isAishaDirigent && (
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400 block mb-0.5">
                              {t("aiChat.routingCategories.aisha_dirigent")}
                            </span>
                          )}
                          <ChatMarkdown content={msg.content} />
                          {msg.role === "assistant" && (
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              {msg.routing_category && !isAishaDirigent && (
                                <span className="text-xs opacity-70">
                                  {t(`aiChat.routingCategories.${msg.routing_category}`)}
                                </span>
                              )}
                              {/* Step 2 UI: faithfulness chip surfaces per-run
                                  retrieval quality next to routing badge. */}
                              <FaithfulnessChip runId={msg.ai_run_id} />
                            </div>
                          )}
                          {msg.role === "assistant" && msg.ai_run_id && (
                            <CitationPanel runId={msg.ai_run_id} className="mt-2" />
                          )}
                          {msg.role === "assistant" && msg.ai_run_id && (
                            <ExplainabilityPanel runId={msg.ai_run_id} className="mt-1" />
                          )}
                          {msg.role === "assistant" && (
                            <FeedbackButtons messageId={msg.id} aiRunId={msg.ai_run_id ?? null} />
                          )}
                        </div>
                      </div>
                      );
                    })}
                    {isSending && (
                      <div className="flex justify-start">
                        <div className="bg-muted rounded-lg px-4 py-2 flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span className="text-sm">{t("aiChat.thinking")}</span>
                        </div>
                      </div>
                    )}
                    {aishaIsTyping && !isSending && (
                      <div className="flex justify-start gap-2">
                        <div className="bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-lg px-4 py-2 flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
                          <span className="text-sm text-violet-600 dark:text-violet-400">{t("aiChat.aishaThinking")}</span>
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </ScrollArea>

              {/* Input */}
              <div className="p-4 border-t bg-background">
                <div className="flex gap-2">
                  <Textarea
                    value={inputValue}
                    onChange={(e) => {
                      if (sendErrorMessage) clearSendError();
                      setInputValue(e.target.value);
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder={canChat ? t("aiChat.placeholder") : t("aiChat.placeholderDisabled")}
                    className="min-h-[44px] max-h-32 resize-none"
                    disabled={isSending || !canChat}
                  />
                  <Button onClick={handleSend} disabled={!inputValue.trim() || isSending || !canChat}>
                    {isSending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                {sendErrorMessage && (
                  <p className="mt-2 text-sm text-destructive">{sendErrorMessage}</p>
                )}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
