/**
 * Push-to-Talk (PTT) voice panel for story views.
 *
 * Renders a collapsible panel with hold-to-talk button, participant list,
 * and channel status. Integrates with useStoryVoiceChannel hook.
 *
 * @module components/consultation/StoryVoicePanel
 */

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Mic,
  MicOff,
  Radio,
  LogIn,
  LogOut,
  Users,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { useStoryVoiceChannel } from "@/hooks/useStoryVoiceChannel";

import type { VoiceParticipant } from "@/hooks/useStoryVoiceChannel";

// =============================================================================
// Types
// =============================================================================

interface StoryVoicePanelProps {
  storyId: string | null;
  /** Lookup function to resolve userId → display name */
  resolveUserName?: (userId: string) => string;
  /** SLA tracking indicators */
  slaWarning?: boolean;
  slaBreach?: boolean;
}

// =============================================================================
// Sub-components
// =============================================================================

function ParticipantBadge({
  participant,
  resolveUserName,
  currentUserId,
}: {
  participant: VoiceParticipant;
  resolveUserName?: (userId: string) => string;
  currentUserId?: string;
}) {
  const name = resolveUserName?.(participant.userId) ?? participant.userId.slice(0, 8);
  const isMe = participant.userId === currentUserId;

  return (
    <div className="flex items-center gap-2 py-1">
      <div className="relative">
        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
          {name.slice(0, 2).toUpperCase()}
        </div>
        {!participant.isMuted && (
          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-background animate-pulse" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {name}
          {isMe && <span className="text-muted-foreground ml-1">(you)</span>}
        </p>
        <p className="text-xs text-muted-foreground">
          {participant.isMuted ? "Muted" : "Speaking"}
        </p>
      </div>
      {participant.isMuted ? (
        <MicOff className="h-3.5 w-3.5 text-muted-foreground" />
      ) : (
        <Mic className="h-3.5 w-3.5 text-green-500" />
      )}
    </div>
  );
}

// =============================================================================
// Component
// =============================================================================

export function StoryVoicePanel({ storyId, resolveUserName, slaWarning, slaBreach }: StoryVoicePanelProps) {
  const { t } = useTranslation();
  const {
    channelState,
    joinChannel,
    leaveChannel,
    startTalking,
    stopTalking,
    participants,
    isConnected,
    isTalking,
    participantCount,
  } = useStoryVoiceChannel(storyId);

  const handlePointerDown = useCallback(() => {
    startTalking();
  }, [startTalking]);

  const handlePointerUp = useCallback(() => {
    stopTalking();
  }, [stopTalking]);

  if (!storyId) return null;

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Radio className="h-4 w-4" />
            {t("guild.voice.title")}
          </CardTitle>
          <div className="flex items-center gap-2">
            {isConnected && (
              <Badge variant="secondary" className="text-xs">
                <Users className="h-3 w-3 mr-1" />
                {participantCount}
              </Badge>
            )}
            <Badge
              variant={isConnected ? "default" : "outline"}
              className="text-xs"
            >
              {isConnected
                ? t("guild.voice.connected")
                : t("guild.voice.disconnected")}
            </Badge>
            {(slaWarning || slaBreach) && (
              <Badge
                variant={slaBreach ? "destructive" : "outline"}
                className="text-xs"
              >
                <AlertTriangle className="h-3 w-3 mr-1" />
                SLA
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* ── Connection controls ── */}
        {!isConnected ? (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => joinChannel.mutate()}
            disabled={joinChannel.isPending}
          >
            {joinChannel.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <LogIn className="h-4 w-4 mr-2" />
            )}
            {t("guild.voice.join")}
          </Button>
        ) : (
          <>
            {/* ── PTT button ── */}
            <Button
              variant={isTalking ? "default" : "secondary"}
              className={`w-full h-16 text-lg transition-all ${
                isTalking
                  ? "bg-green-600 hover:bg-green-700 scale-[1.02] shadow-lg"
                  : ""
              }`}
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              onContextMenu={(e) => e.preventDefault()}
            >
              {isTalking ? (
                <>
                  <Mic className="h-6 w-6 mr-2 animate-pulse" />
                  {t("guild.voice.talking")}
                </>
              ) : (
                <>
                  <MicOff className="h-6 w-6 mr-2" />
                  {t("guild.voice.holdToTalk")}
                </>
              )}
            </Button>

            {/* ── Participants ── */}
            {participants.length > 0 && (
              <div className="space-y-1 pt-2 border-t">
                {participants.map((p) => (
                  <ParticipantBadge
                    key={p.userId}
                    participant={p}
                    resolveUserName={resolveUserName}
                  />
                ))}
              </div>
            )}

            {/* ── Leave ── */}
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-destructive hover:text-destructive"
              onClick={() => leaveChannel.mutate()}
              disabled={leaveChannel.isPending}
            >
              <LogOut className="h-4 w-4 mr-2" />
              {t("guild.voice.leave")}
            </Button>
          </>
        )}

        {/* ── Error ── */}
        {channelState.error && (
          <p className="text-sm text-destructive">{channelState.error}</p>
        )}
      </CardContent>
    </Card>
  );
}
