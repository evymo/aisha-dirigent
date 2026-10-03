/**
 * Matrix messaging inbox — Sheet-based sidebar for omnichannel conversations.
 *
 * Shows rooms grouped by type (general, bridge, bot), with message composer.
 * Integrates with useMatrixClient, useMatrixRooms, useMatrixMessages.
 *
 * @module components/messaging/MatrixInbox
 */

import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  MessageSquare,
  Send,
  Loader2,
  Wifi,
  WifiOff,
  ArrowLeft,
  Hash,
  Bot,
  Link2,
  AlertTriangle,
} from "lucide-react";
import { useMatrixClient } from "@/hooks/useMatrixClient";
import { useMatrixRooms } from "@/hooks/useMatrixRooms";
import { useMatrixMessages } from "@/hooks/useMatrixMessages";

import type { MatrixRoom } from "@/hooks/useMatrixRooms";
import type { MatrixMessage } from "@/hooks/useMatrixMessages";

// =============================================================================
// Types
// =============================================================================

interface MatrixInboxProps {
  storyId?: string | null;
  /** SLA tracking state — omit to hide SLA indicators */
  slaWarning?: boolean;
  slaBreach?: boolean;
  slaWaitingMinutes?: number;
}

// =============================================================================
// Sub-components
// =============================================================================

function RoomIcon({ roomType }: { roomType: MatrixRoom["roomType"] }) {
  switch (roomType) {
    case "general":
      return <Hash className="h-4 w-4" />;
    case "bridge":
      return <Link2 className="h-4 w-4" />;
    case "bot":
      return <Bot className="h-4 w-4" />;
    default:
      return <MessageSquare className="h-4 w-4" />;
  }
}

function RoomListItem({
  room,
  isActive,
  onClick,
}: {
  room: MatrixRoom;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
        isActive
          ? "bg-primary/10 text-primary"
          : "hover:bg-muted"
      }`}
    >
      <RoomIcon roomType={room.roomType} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {room.displayName || room.matrixRoomId}
        </p>
        {room.bridgeType && (
          <p className="text-xs text-muted-foreground capitalize">
            {room.bridgeType}
          </p>
        )}
      </div>
    </button>
  );
}

function MessageBubble({
  message,
  isOwn,
}: {
  message: MatrixMessage;
  isOwn: boolean;
}) {
  const time = new Date(message.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={`flex ${isOwn ? "justify-end" : "justify-start"} mb-2`}>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 ${
          isOwn
            ? "bg-primary text-primary-foreground"
            : "bg-muted"
        }`}
      >
        {!isOwn && (
          <p className="text-xs font-medium mb-0.5 opacity-70">
            {message.sender.split(":")[0].replace("@", "")}
          </p>
        )}
        <p className="text-sm whitespace-pre-wrap break-words">{message.body}</p>
        <p className="text-[10px] opacity-50 mt-0.5 text-right">{time}</p>
      </div>
    </div>
  );
}

// =============================================================================
// Component
// =============================================================================

export function MatrixInbox({ storyId, slaWarning, slaBreach, slaWaitingMinutes }: MatrixInboxProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { status, credentials, isConnected } = useMatrixClient();
  const { rooms, generalRooms, bridgeRooms, botRooms, isLoading: roomsLoading } = useMatrixRooms(storyId);
  const { messages, isLoading: messagesLoading, sendMessage, isSending } = useMatrixMessages(selectedRoomId);

  const selectedRoom = rooms.find((r) => r.matrixRoomId === selectedRoomId);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleSend = () => {
    const trimmed = inputValue.trim();
    if (!trimmed || !selectedRoomId) return;
    sendMessage.mutate({ body: trimmed });
    setInputValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const renderRoomGroup = (label: string, groupRooms: MatrixRoom[]) => {
    if (groupRooms.length === 0) return null;
    return (
      <div className="mb-3">
        <p className="text-xs font-medium text-muted-foreground px-3 mb-1 uppercase tracking-wider">
          {label}
        </p>
        {groupRooms.map((room) => (
          <RoomListItem
            key={room.id}
            room={room}
            isActive={selectedRoomId === room.matrixRoomId}
            onClick={() => setSelectedRoomId(room.matrixRoomId)}
          />
        ))}
      </div>
    );
  };

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="relative">
          <MessageSquare className="h-5 w-5" />
          {rooms.length > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary rounded-full text-[10px] text-primary-foreground flex items-center justify-center">
              {rooms.length}
            </span>
          )}
        </Button>
      </SheetTrigger>

      <SheetContent className="w-[400px] sm:w-[540px] p-0 flex flex-col">
        <SheetHeader className="px-4 pt-4 pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {selectedRoomId && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setSelectedRoomId(null)}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              )}
              <SheetTitle className="text-base">
                {selectedRoom
                  ? selectedRoom.displayName || t("guild.messaging.conversation")
                  : t("guild.messaging.inbox")}
              </SheetTitle>
            </div>
            <Badge variant={isConnected ? "default" : "outline"} className="text-xs">
              {isConnected ? (
                <><Wifi className="h-3 w-3 mr-1" />{t("guild.messaging.connected")}</>
              ) : (
                <><WifiOff className="h-3 w-3 mr-1" />{t("guild.messaging.offline")}</>
              )}
            </Badge>
          </div>
        </SheetHeader>

        <Separator />

        {/* ── SLA warning banner ── */}
        {(slaWarning || slaBreach) && (
          <div
            className={`flex items-center gap-2 px-4 py-2 text-sm ${
              slaBreach
                ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
                : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
            }`}
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              {slaBreach
                ? t("guild.call.slaBreach")
                : t("guild.call.slaWarning", { minutes: slaWaitingMinutes ?? 0 })}
            </span>
          </div>
        )}

        {/* ── Room list view ── */}
        {!selectedRoomId && (
          <ScrollArea className="flex-1 px-2 py-2">
            {roomsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : rooms.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <MessageSquare className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">{t("guild.messaging.noRooms")}</p>
              </div>
            ) : (
              <>
                {renderRoomGroup(t("guild.messaging.channels"), generalRooms)}
                {renderRoomGroup(t("guild.messaging.bridges"), bridgeRooms)}
                {renderRoomGroup(t("guild.messaging.bots"), botRooms)}
              </>
            )}
          </ScrollArea>
        )}

        {/* ── Message view ── */}
        {selectedRoomId && (
          <>
            <ScrollArea className="flex-1 px-4 py-2">
              {messagesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p className="text-sm">{t("guild.messaging.noMessages")}</p>
                </div>
              ) : (
                messages.map((msg) => (
                  <MessageBubble
                    key={msg.eventId}
                    message={msg}
                    isOwn={msg.sender === credentials?.userId}
                  />
                ))
              )}
              <div ref={messagesEndRef} />
            </ScrollArea>

            {/* ── Composer ── */}
            <div className="border-t px-4 py-3">
              <div className="flex gap-2">
                <Input
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t("guild.messaging.placeholder")}
                  className="flex-1"
                  disabled={isSending || !isConnected}
                />
                <Button
                  size="icon"
                  onClick={handleSend}
                  disabled={!inputValue.trim() || isSending || !isConnected}
                >
                  {isSending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
