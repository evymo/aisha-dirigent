import { useState } from "react";
import { useTranslation } from "react-i18next";
import { History, Archive, MessageSquare, ChevronLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Conversation } from "@/hooks/useAiChat";
import { cn } from "@/lib/utils";

interface ConversationListProps {
  conversations: Conversation[];
  isLoading: boolean;
  activeConversationId: string | undefined;
  onSelect: (conversationId: string) => void;
  onArchive: (conversationId: string) => Promise<unknown>;
  onNewConversation: () => void;
  onBack: () => void;
}

/**
 * Sidebar-style list of user's chat conversations.
 * Allows selecting, archiving, and creating new conversations.
 */
export function ConversationList({
  conversations,
  isLoading,
  activeConversationId,
  onSelect,
  onArchive,
  onNewConversation,
  onBack,
}: ConversationListProps) {
  const { t } = useTranslation();
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const handleArchive = async (e: React.MouseEvent, conversationId: string) => {
    e.stopPropagation();
    setArchivingId(conversationId);
    try {
      await onArchive(conversationId);
    } finally {
      setArchivingId(null);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    if (diffDays === 1) {
      return t("aiChat.conversations.yesterday");
    }
    if (diffDays < 7) {
      return t("aiChat.conversations.daysAgo", { count: diffDays });
    }
    return date.toLocaleDateString([], { day: "numeric", month: "short" });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 p-3 border-b">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h3 className="font-medium text-sm">{t("aiChat.conversations.title")}</h3>
          <p className="text-xs text-muted-foreground">
            {t("aiChat.conversations.count", { count: conversations.length })}
          </p>
        </div>
      </div>

      {/* New conversation button */}
      <div className="p-2 border-b">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => {
            onNewConversation();
            onBack();
          }}
        >
          <MessageSquare className="h-4 w-4" />
          {t("aiChat.newConversation")}
        </Button>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm px-4">
            <History className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>{t("aiChat.conversations.empty")}</p>
          </div>
        ) : (
          <div className="p-1">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  onSelect(conv.id);
                  onBack();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(conv.id);
                    onBack();
                  }
                }}
                className={cn(
                  "w-full text-left rounded-md px-3 py-2.5 mb-0.5 transition-colors cursor-pointer",
                  "hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  conv.id === activeConversationId && "bg-muted border border-border"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {conv.title || t("aiChat.conversations.untitled")}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">
                        {conv.message_count} {t("aiChat.conversations.messages")}
                      </span>
                      {conv.last_message_at && (
                        <span className="text-xs text-muted-foreground">
                          {formatDate(conv.last_message_at)}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 hover:opacity-100 focus:opacity-100"
                    onClick={(e) => handleArchive(e, conv.id)}
                    disabled={archivingId === conv.id}
                    title={t("aiChat.conversations.archive")}
                  >
                    {archivingId === conv.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Archive className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
