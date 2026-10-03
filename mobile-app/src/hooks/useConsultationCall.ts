/**
 * Mobile hook for LiveKit video consultation calls.
 *
 * Mirror of web useConsultationCall — adapted for React Native.
 * Uses @livekit/react-native when installed; provides call lifecycle
 * management via Supabase (voice_rooms, consultation_sessions).
 *
 * @module hooks/useConsultationCall
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { registerGlobals } from "@livekit/react-native";
import { Room, RoomEvent } from "livekit-client";
import { api, realtime, getLivekitServerUrl } from "@/config/api";
import { safeError, safeWarn } from "@/lib/security/safeLogger";
import { z } from "zod";

import type { RealtimeChannel } from "@aisha/api-core";

// LiveKit needs its React Native WebRTC globals registered once before any
// Room is opened. Idempotent guard keeps repeated hook mounts cheap.
let livekitGlobalsRegistered = false;
function ensureLivekitGlobals(): void {
  if (livekitGlobalsRegistered) return;
  registerGlobals();
  livekitGlobalsRegistered = true;
}

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

export type CallStatus = "idle" | "creating" | "ringing" | "connecting" | "connected" | "ended" | "error";

export interface ConsultationCallState {
  status: CallStatus;
  roomName: string | null;
  token: string | null;
  sessionId: string | null;
  error: string | null;
  duration: number;
}

interface StartCallParams {
  calleeId: string;
  bookingId?: string;
  storyId?: string;
  recordingConsent?: boolean;
}

interface JoinCallParams {
  roomName: string;
  sessionId: string;
}

// =============================================================================
// Constants
// =============================================================================

const CALL_QUERY_KEY = "consultation-call";
const RINGING_TIMEOUT_MS = 60_000;

// =============================================================================
// Hook
// =============================================================================

export function useConsultationCall(userId: string | undefined) {
  const queryClient = useQueryClient();

  const [callState, setCallState] = useState<ConsultationCallState>({
    status: "idle",
    roomName: null,
    token: null,
    sessionId: null,
    error: null,
    duration: 0,
  });

  const durationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const roomRef = useRef<Room | null>(null);

  // ─── Duration timer ────────────────────────────────────────
  const startDurationTimer = useCallback(() => {
    if (durationRef.current) clearInterval(durationRef.current);
    durationRef.current = setInterval(() => {
      setCallState((prev) => ({ ...prev, duration: prev.duration + 1 }));
    }, 1000);
  }, []);

  const stopDurationTimer = useCallback(() => {
    if (durationRef.current) {
      clearInterval(durationRef.current);
      durationRef.current = null;
    }
  }, []);

  // ─── Cleanup on unmount ────────────────────────────────────
  useEffect(() => {
    return () => {
      stopDurationTimer();
      if (ringingTimeoutRef.current) clearTimeout(ringingTimeoutRef.current);
      if (roomRef.current) {
        void roomRef.current.disconnect();
        roomRef.current = null;
      }
      if (channelRef.current) {
        realtime.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [stopDurationTimer]);

  // ─── Connect to the LiveKit Room (real media session) ──────
  // Establishes an actual real-time session and flips the call to
  // "connected" ONLY when the Room emits its `connected` event — never
  // synchronously after the token fetch.
  const connectToRoom = useCallback(
    async (token: string, roomName: string, sessionId: string) => {
      ensureLivekitGlobals();
      const serverUrl = getLivekitServerUrl();

      if (roomRef.current) {
        await roomRef.current.disconnect().catch(() => undefined);
        roomRef.current = null;
      }

      const room = new Room();
      roomRef.current = room;

      room.on(RoomEvent.Connected, () => {
        if (ringingTimeoutRef.current) clearTimeout(ringingTimeoutRef.current);
        setCallState({
          status: "connected",
          roomName,
          token,
          sessionId,
          error: null,
          duration: 0,
        });
        startDurationTimer();
      });

      room.on(RoomEvent.Disconnected, () => {
        stopDurationTimer();
        setCallState((prev) =>
          prev.status === "connected" || prev.status === "connecting"
            ? { ...prev, status: "ended" }
            : prev,
        );
      });

      await room.connect(serverUrl, token);
      // Publish local media — best-effort so a device without a camera/mic
      // still joins the audio session.
      await room.localParticipant.setMicrophoneEnabled(true).catch(() => undefined);
      await room.localParticipant.setCameraEnabled(true).catch(() => undefined);
    },
    [startDurationTimer, stopDurationTimer],
  );

  // ─── Incoming call listener ────────────────────────────────
  useEffect(() => {
    if (!userId) return;

    const channel = realtime
      .channel(`incoming-calls-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "consultation_sessions",
          filter: `callee_id=eq.${userId}`,
        },
        (payload) => {
          const session = payload.new as { id: string; status: string };
          if (session.status === "pending" || session.status === "ringing") {
            setCallState({
              status: "ringing",
              roomName: null,
              token: null,
              sessionId: session.id,
              error: null,
              duration: 0,
            });
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      realtime.removeChannel(channel);
      channelRef.current = null;
    };
  }, [userId]);

  // ─── Start a call (caller side) ────────────────────────────
  const startCall = useMutation({
    mutationFn: async (params: StartCallParams) => {
      setCallState((prev) => ({ ...prev, status: "creating", error: null }));

      const roomName = `consultation-${Date.now().toString(36)}`;
      const { data: callData, error: callError } = await api.rpc("create_consultation_call", {
        p_booking_id: params.bookingId ?? undefined,
        p_callee_id: params.calleeId,
        p_livekit_room_name: roomName,
        p_recording_consent: params.recordingConsent ?? false,
        p_room_name: `Consultation ${params.calleeId.slice(0, 8)}`,
        p_story_id: params.storyId ?? undefined,
      });

      if (callError) {
        safeError("consultationCall.create", callError);
        throw new Error(callError.message);
      }

      const callResult = z.object({ session_id: z.string(), room_id: z.string() }).parse(callData);

      // Notify callee
      await api.rpc("create_storyloop_notification", {
        p_link: `/member/story?call=${callResult.session_id}`,
        p_message: "You have an incoming video call",
        p_title: "Incoming consultation call",
        p_type: "meeting_request",
        p_user_id: params.calleeId,
      });

      return { sessionId: callResult.session_id, roomName };
    },
    onSuccess: async ({ sessionId, roomName }) => {
      try {
        const { data, error } = await api.invoke("create-livekit-token", {
          body: { roomName, canPublish: true, canSubscribe: true },
        });

        if (error) throw error;
        const parsed = livekitTokenSchema.parse(data);

        setCallState({
          status: "ringing",
          roomName,
          token: parsed.token,
          sessionId,
          error: null,
          duration: 0,
        });

        ringingTimeoutRef.current = setTimeout(() => {
          endCall.mutate({ reason: "missed" });
        }, RINGING_TIMEOUT_MS);
      } catch (err) {
        safeError("consultationCall.getToken", err as Error);
        setCallState((prev) => ({ ...prev, status: "error", error: "Failed to get call token" }));
      }
    },
    onError: (error) => {
      safeError("consultationCall.start", error);
      setCallState((prev) => ({ ...prev, status: "error", error: error.message }));
    },
  });

  // ─── Answer a call (callee side) ──────────────────────────
  const answerCall = useMutation({
    mutationFn: async (params: JoinCallParams) => {
      setCallState((prev) => ({ ...prev, status: "connecting" }));

      await api.rpc("update_consultation_status", {
        p_session_id: params.sessionId,
        p_status: "active",
      });

      const { data, error } = await api.invoke("create-livekit-token", {
        body: { roomName: params.roomName, canPublish: true, canSubscribe: true },
      });

      if (error) throw error;
      return livekitTokenSchema.parse(data);
    },
    onSuccess: async (tokenResult, params) => {
      if (ringingTimeoutRef.current) clearTimeout(ringingTimeoutRef.current);
      // Enter "connecting" and join the real Room; the RoomEvent.Connected
      // handler in connectToRoom is what flips us to "connected".
      setCallState({
        status: "connecting",
        roomName: params.roomName,
        token: tokenResult.token,
        sessionId: params.sessionId,
        error: null,
        duration: 0,
      });
      try {
        await connectToRoom(tokenResult.token, params.roomName, params.sessionId);
      } catch (err) {
        safeError("consultationCall.roomConnect", err as Error);
        setCallState((prev) => ({
          ...prev,
          status: "error",
          error: "Failed to connect media room",
        }));
      }
    },
    onError: (error) => {
      safeError("consultationCall.answer", error);
      setCallState((prev) => ({ ...prev, status: "error", error: error.message }));
    },
  });

  // ─── Decline a call ────────────────────────────────────────
  const declineCall = useMutation({
    mutationFn: async (sessionId: string) => {
      await api.rpc("update_consultation_status", {
        p_session_id: sessionId,
        p_status: "declined",
      });
    },
    onSuccess: () => {
      setCallState({ status: "idle", roomName: null, token: null, sessionId: null, error: null, duration: 0 });
    },
  });

  // ─── End a call ────────────────────────────────────────────
  const endCall = useMutation({
    mutationFn: async ({ reason }: { reason?: "ended" | "missed" } = {}) => {
      stopDurationTimer();

      // Leave the media room before recording the session outcome.
      if (roomRef.current) {
        await roomRef.current.disconnect().catch(() => undefined);
        roomRef.current = null;
      }

      if (callState.sessionId) {
        await api.rpc("update_consultation_status", {
          p_duration_seconds: callState.duration,
          p_session_id: callState.sessionId,
          p_status: reason === "missed" ? "missed" : "ended",
        });
      }
    },
    onSuccess: () => {
      if (ringingTimeoutRef.current) clearTimeout(ringingTimeoutRef.current);
      queryClient.invalidateQueries({ queryKey: [CALL_QUERY_KEY] });
      setCallState({ status: "ended", roomName: null, token: null, sessionId: null, error: null, duration: callState.duration });
    },
  });

  // ─── Active session query ─────────────────────────────────
  const activeSession = useQuery({
    queryKey: [CALL_QUERY_KEY, "active", userId],
    queryFn: async () => {
      const { data, error } = await api
        .rpc("get_active_consultation_session");

      if (error) {
        safeWarn("consultationCall.activeSession", error);
        return null;
      }
      return data;
    },
    enabled: !!userId,
    staleTime: 10_000,
  });

  // ─── Reset ─────────────────────────────────────────────────
  const resetCall = useCallback(() => {
    stopDurationTimer();
    if (ringingTimeoutRef.current) clearTimeout(ringingTimeoutRef.current);
    setCallState({ status: "idle", roomName: null, token: null, sessionId: null, error: null, duration: 0 });
  }, [stopDurationTimer]);

  return {
    callState,
    startCall,
    answerCall,
    declineCall,
    endCall,
    resetCall,
    activeSession,
    isInCall: callState.status === "connected",
    isRinging: callState.status === "ringing",
  };
}
