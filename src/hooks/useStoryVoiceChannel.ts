/**
 * Hook for walkie-talkie Push-to-Talk (PTT) voice channels within stories.
 *
 * Creates/joins a persistent PTT voice room per story, tracks participants
 * via Supabase Realtime, and provides hold-to-talk audio publish/unpublish.
 *
 * Uses same patterns as useConsultationCall: Supabase direct queries,
 * invokeEdgeFunction for LiveKit tokens, Realtime for participant changes.
 *
 * @module hooks/useStoryVoiceChannel
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { invokeEdgeFunction } from "@/integrations/api/edge";
import { safeError, safeWarn } from "@/lib/security/safeLogger";
import { useSession } from "@/hooks/useSession";
import { z } from "zod";

import type { RealtimeChannel } from "@/integrations/api/realtime";

// =============================================================================
// Schemas
// =============================================================================

const livekitTokenSchema = z.object({
  token: z.string(),
  identity: z.string(),
  name: z.string(),
  roomName: z.string(),
});

const participantSchema = z.object({
  id: z.string().uuid(),
  voice_room_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: z.enum(["host", "participant", "listener"]),
  is_muted: z.boolean(),
  joined_at: z.string(),
  left_at: z.string().nullable(),
});

// =============================================================================
// Types
// =============================================================================

export type ChannelStatus = "disconnected" | "connecting" | "connected" | "error";

export interface VoiceChannelState {
  status: ChannelStatus;
  roomName: string | null;
  roomId: string | null;
  token: string | null;
  isTalking: boolean;
  isMuted: boolean;
  error: string | null;
}

export interface VoiceParticipant {
  userId: string;
  role: "host" | "participant" | "listener";
  isMuted: boolean;
  joinedAt: string;
}

type Participant = z.infer<typeof participantSchema>;

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

export function useStoryVoiceChannel(storyId: string | null) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const userId = session?.user?.id;

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
      const { data, error } = await aisha.rpc("get_story_ptt_room", { p_story_id: storyId! });

      if (error) {
        safeWarn("voiceChannel.getRoom", error);
        return null;
      }
      // RPC returns SETOF rows; this room is unique per story, so take the first.
      return data?.[0] ?? null;
    },
    enabled: !!storyId && !!userId,
    staleTime: 30_000,
  });

  // ─── Query: participants in room ───────────────────────────
  const participants = useQuery({
    queryKey: voiceChannelKeys.participants(channelState.roomId ?? ""),
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_room_participants", {
        p_voice_room_id: channelState.roomId!,
      });

      if (error) {
        safeWarn("voiceChannel.getParticipants", error);
        return [];
      }

      return (data ?? []).map((p): VoiceParticipant => ({
        userId: p.user_id,
        role: p.role as VoiceParticipant["role"],
        isMuted: p.is_muted,
        joinedAt: p.joined_at,
      }));
    },
    enabled: !!channelState.roomId,
    staleTime: 5_000,
  });

  // ─── Realtime: participant changes ─────────────────────────
  useEffect(() => {
    if (!channelState.roomId) return;

    if (participantsChannelRef.current) {
      aisha.removeChannel(participantsChannelRef.current);
    }

    const channel = aisha
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
      aisha.removeChannel(channel);
      participantsChannelRef.current = null;
    };
  }, [channelState.roomId, queryClient]);

  // ─── Cleanup on unmount ────────────────────────────────────
  useEffect(() => {
    return () => {
      if (participantsChannelRef.current) {
        aisha.removeChannel(participantsChannelRef.current);
        participantsChannelRef.current = null;
      }
    };
  }, []);

  // ─── Join channel ──────────────────────────────────────────
  const joinChannel = useMutation({
    mutationFn: async () => {
      if (!storyId || !userId) throw new Error("Missing storyId or userId");

      setChannelState((prev) => ({ ...prev, status: "connecting", error: null }));

      // Find-or-create PTT room + join as participant atomically
      const roomNameCandidate = `ptt-story-${storyId.slice(0, 8)}-${Date.now()}`;
      const { data, error } = await aisha.rpc("join_ptt_channel", {
        p_livekit_room_name: roomNameCandidate,
        p_room_name: `PTT — Story ${storyId.slice(0, 8)}`,
        p_story_id: storyId,
      });

      if (error) {
        safeError("voiceChannel.join", error);
        throw new Error(error.message);
      }

      const result = z.object({ room_id: z.string(), room_name: z.string() }).parse(data);

      // Get LiveKit token (listen-only initially, PTT activates publish)
      const tokenResult = await invokeEdgeFunction({
        functionName: "create-livekit-token",
        body: { roomName: result.room_name, canPublish: true, canSubscribe: true },
        schema: livekitTokenSchema,
        context: "voiceChannel.getToken",
      });

      return { roomId: result.room_id, roomName: result.room_name, token: tokenResult.token };
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
      setChannelState((prev) => ({
        ...prev,
        status: "error",
        error: error.message,
      }));
    },
  });

  // ─── Leave channel ─────────────────────────────────────────
  const leaveChannel = useMutation({
    mutationFn: async () => {
      if (!channelState.roomId || !userId) return;

      const { error } = await aisha.rpc("leave_voice_room", {
        p_voice_room_id: channelState.roomId,
      });
      if (error) safeError("voiceChannel.leave", error);
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

    await aisha.rpc("set_participant_mute", {
      p_is_muted: false,
      p_voice_room_id: channelState.roomId,
    });
  }, [channelState.status, channelState.roomId, userId]);

  const stopTalking = useCallback(async () => {
    if (!channelState.roomId || !userId) return;

    setChannelState((prev) => ({ ...prev, isTalking: false, isMuted: true }));

    await aisha.rpc("set_participant_mute", {
      p_is_muted: true,
      p_voice_room_id: channelState.roomId,
    });
  }, [channelState.roomId, userId]);

  // ─── Toggle mute (for always-on audio mode) ───────────────
  const toggleMute = useCallback(async () => {
    if (!channelState.roomId || !userId) return;

    const newMuted = !channelState.isMuted;
    setChannelState((prev) => ({ ...prev, isMuted: newMuted, isTalking: !newMuted }));

    await aisha.rpc("set_participant_mute", {
      p_is_muted: newMuted,
      p_voice_room_id: channelState.roomId,
    });
  }, [channelState.roomId, channelState.isMuted, userId]);

  return {
    channelState,
    joinChannel,
    leaveChannel,
    startTalking,
    stopTalking,
    toggleMute,
    storyRoom,
    participants: participants.data ?? [],
    isConnected: channelState.status === "connected",
    isTalking: channelState.isTalking,
    participantCount: (participants.data ?? []).length,
  };
}
