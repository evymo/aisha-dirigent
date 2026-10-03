/**
 * Mobile hook for walkie-talkie Push-to-Talk voice channels.
 *
 * Mirror of web useStoryVoiceChannel — adapted for React Native.
 * Uses @livekit/react-native when installed; provides PTT lifecycle
 * via Supabase (voice_rooms, call_participants).
 *
 * @module hooks/useStoryVoiceChannel
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, realtime } from "@/config/api";
import { safeError, safeWarn } from "@/lib/security/safeLogger";
import { z } from "zod";

import type { RealtimeChannel } from "@aisha/api-core";

// =============================================================================
// Schemas
// =============================================================================

const livekitTokenSchema = z.object({
  token: z.string(),
  identity: z.string(),
  name: z.string(),
  roomName: z.string(),
});

// =============================================================================
// Types
// =============================================================================

export type ChannelStatus = "disconnected" | "connecting" | "connected" | "error";

export interface VoiceParticipant {
  userId: string;
  role: "host" | "participant" | "listener";
  isMuted: boolean;
  joinedAt: string;
}

export interface VoiceChannelState {
  status: ChannelStatus;
  roomName: string | null;
  roomId: string | null;
  token: string | null;
  isTalking: boolean;
  isMuted: boolean;
  error: string | null;
}

// =============================================================================
// Keys
// =============================================================================

export const voiceChannelKeys = {
  all: ["voice-channel"] as const,
  room: (storyId: string) => [...voiceChannelKeys.all, "room", storyId] as const,
  participants: (roomId: string) => [...voiceChannelKeys.all, "participants", roomId] as const,
};

// =============================================================================
// Hook
// =============================================================================

export function useStoryVoiceChannel(storyId: string | null, userId: string | undefined) {
  const queryClient = useQueryClient();

  const [channelState, setChannelState] = useState<VoiceChannelState>({
    status: "disconnected",
    roomName: null,
    roomId: null,
    token: null,
    isTalking: false,
    isMuted: false,
    error: null,
  });

  const participantsChannelRef = useRef<RealtimeChannel | null>(null);

  // ─── Query: existing PTT room for story ────────────────────
  const storyRoom = useQuery({
    queryKey: voiceChannelKeys.room(storyId ?? ""),
    queryFn: async () => {
      const { data, error } = await api
        .rpc("get_story_ptt_room", { p_story_id: storyId! });

      if (error) {
        safeWarn("voiceChannel.getRoom", error);
        return null;
      }
      const row = Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
      return row;
    },
    enabled: !!storyId && !!userId,
    staleTime: 30_000,
  });

  // ─── Query: participants in room ───────────────────────────
  const participants = useQuery({
    queryKey: voiceChannelKeys.participants(channelState.roomId ?? ""),
    queryFn: async () => {
      const { data, error } = await api
        .rpc("get_room_participants", { p_voice_room_id: channelState.roomId! });

      if (error) {
        safeWarn("voiceChannel.getParticipants", error);
        return [];
      }

      return (Array.isArray(data) ? data : []).map((p: unknown): VoiceParticipant => {
        const row = p as { user_id: string; role: string; is_muted: boolean; joined_at: string };
        return {
          userId: row.user_id,
          role: row.role as VoiceParticipant["role"],
          isMuted: row.is_muted,
          joinedAt: row.joined_at,
        };
      });
    },
    enabled: !!channelState.roomId,
    staleTime: 5_000,
  });

  // ─── Realtime: participant changes ─────────────────────────
  useEffect(() => {
    if (!channelState.roomId) return;

    if (participantsChannelRef.current) {
      realtime.removeChannel(participantsChannelRef.current);
    }

    const channel = realtime
      .channel(`ptt-participants-${channelState.roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "call_participants",
          filter: `voice_room_id=eq.${channelState.roomId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: voiceChannelKeys.participants(channelState.roomId!),
          });
        }
      )
      .subscribe();

    participantsChannelRef.current = channel;

    return () => {
      realtime.removeChannel(channel);
      participantsChannelRef.current = null;
    };
  }, [channelState.roomId, queryClient]);

  // ─── Cleanup ───────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (participantsChannelRef.current) {
        realtime.removeChannel(participantsChannelRef.current);
        participantsChannelRef.current = null;
      }
    };
  }, []);

  // ─── Join channel ──────────────────────────────────────────
  const joinChannel = useMutation({
    mutationFn: async () => {
      if (!storyId || !userId) throw new Error("Missing storyId or userId");

      setChannelState((prev) => ({ ...prev, status: "connecting", error: null }));

      const livekitRoomName = (storyRoom.data as { livekit_room_name?: string } | null)?.livekit_room_name ?? `ptt-story-${storyId.slice(0, 8)}-${Date.now()}`;

      const { data: channelData, error: channelError } = await api.rpc("join_ptt_channel", {
        p_livekit_room_name: livekitRoomName,
        p_room_name: `PTT — Story ${storyId.slice(0, 8)}`,
        p_story_id: storyId,
      });

      if (channelError) {
        safeError("voiceChannel.joinChannel", channelError);
        throw new Error(channelError.message);
      }

      const joinResult = z.object({ room_id: z.string(), room_name: z.string() }).parse(channelData);
      const roomId = joinResult.room_id;
      const roomName = joinResult.room_name;

      const { data, error } = await api.invoke("create-livekit-token", {
        body: { roomName, canPublish: true, canSubscribe: true },
      });

      if (error) throw error;
      const parsed = livekitTokenSchema.parse(data);

      return { roomId, roomName, token: parsed.token };
    },
    onSuccess: ({ roomId, roomName, token }) => {
      setChannelState({
        status: "connected",
        roomName,
        roomId,
        token,
        isTalking: false,
        isMuted: true,
        error: null,
      });
      queryClient.invalidateQueries({ queryKey: voiceChannelKeys.room(storyId ?? "") });
    },
    onError: (error) => {
      safeError("voiceChannel.join", error);
      setChannelState((prev) => ({ ...prev, status: "error", error: error.message }));
    },
  });

  // ─── Leave channel ─────────────────────────────────────────
  const leaveChannel = useMutation({
    mutationFn: async () => {
      if (!channelState.roomId || !userId) return;

      await api.rpc("leave_voice_room", {
        p_voice_room_id: channelState.roomId!,
      });
    },
    onSuccess: () => {
      setChannelState({
        status: "disconnected",
        roomName: null,
        roomId: null,
        token: null,
        isTalking: false,
        isMuted: false,
        error: null,
      });
      queryClient.invalidateQueries({ queryKey: voiceChannelKeys.all });
    },
  });

  // ─── PTT: start/stop talking ───────────────────────────────
  const startTalking = useCallback(async () => {
    if (channelState.status !== "connected" || !channelState.roomId || !userId) return;
    setChannelState((prev) => ({ ...prev, isTalking: true, isMuted: false }));

    await api.rpc("set_participant_mute", {
      p_is_muted: false,
      p_voice_room_id: channelState.roomId,
    });
  }, [channelState.status, channelState.roomId, userId]);

  const stopTalking = useCallback(async () => {
    if (!channelState.roomId || !userId) return;
    setChannelState((prev) => ({ ...prev, isTalking: false, isMuted: true }));

    await api.rpc("set_participant_mute", {
      p_is_muted: true,
      p_voice_room_id: channelState.roomId,
    });
  }, [channelState.roomId, userId]);

  return {
    channelState,
    joinChannel,
    leaveChannel,
    startTalking,
    stopTalking,
    storyRoom,
    participants: participants.data ?? [],
    isConnected: channelState.status === "connected",
    isTalking: channelState.isTalking,
    participantCount: (participants.data ?? []).length,
  };
}
