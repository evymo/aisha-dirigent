/**
 * Hook for initiating and managing LiveKit video consultation calls.
 *
 * Extends the existing booking flow (useConsultationBooking) with real-time
 * video call capability. Uses the `create-livekit-token` edge function
 * to obtain a LiveKit JWT, then provides connection state management.
 *
 * @module hooks/useConsultationCall
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Room, RoomEvent } from "livekit-client";
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

const voiceRoomSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  room_type: z.string(),
  story_id: z.string().uuid().nullable(),
  livekit_room_name: z.string(),
  max_participants: z.number(),
  is_active: z.boolean(),
  created_at: z.string(),
});

const consultationSessionSchema = z.object({
  id: z.string().uuid(),
  voice_room_id: z.string().uuid(),
  booking_id: z.string().uuid().nullable(),
  caller_id: z.string().uuid(),
  callee_id: z.string().uuid(),
  status: z.enum(["pending", "ringing", "active", "ended", "missed", "declined"]),
  started_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  duration_seconds: z.number().nullable(),
  recording_consent: z.boolean(),
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

type LivekitTokenResult = z.infer<typeof livekitTokenSchema>;

// =============================================================================
// Constants
// =============================================================================

const CALL_QUERY_KEY = "consultation-call";
const RINGING_TIMEOUT_MS = 60_000; // 60s before marking as missed

/**
 * LiveKit media-server URL. Fail LOUD when unconfigured — a call must never
 * silently connect to a guessed/default server (no fallbacks).
 */
function resolveLivekitServerUrl(): string {
  const url = import.meta.env.VITE_LIVEKIT_URL as string | undefined;
  if (!url || !url.trim()) {
    throw new Error("VITE_LIVEKIT_URL is not configured — cannot join the call room");
  }
  return url.trim();
}

// =============================================================================
// Hook
// =============================================================================

export function useConsultationCall() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const userId = session?.user?.id;

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
        aisha.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [stopDurationTimer]);

  // ─── Connect to the LiveKit Room (real media session) ──────
  // Establishes an actual real-time session and flips the call to
  // "connected" ONLY when the Room emits its `connected` event — never
  // synchronously after the token fetch.
  const connectToRoom = async (token: string, roomName: string, sessionId: string) => {
      const serverUrl = resolveLivekitServerUrl();

      // Tear down any stale room before opening a new one.
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
    };

  // ─── Incoming call listener ────────────────────────────────
  useEffect(() => {
    if (!userId) return;

    const channel = aisha
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
          const parsed = consultationSessionSchema.safeParse(payload.new);
          if (!parsed.success) return;
          const session = parsed.data;
          if (session.status === "pending" || session.status === "ringing") {
            setCallState({
              status: "ringing",
              roomName: null, // Will be fetched when user answers
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
      aisha.removeChannel(channel);
      channelRef.current = null;
    };
  }, [userId]);

  // ─── Start a call (caller side) ────────────────────────────
  const startCall = useMutation({
    mutationFn: async (params: StartCallParams): Promise<{ sessionId: string; roomName: string }> => {
      setCallState((prev) => ({ ...prev, status: "creating", error: null }));

      const roomName = `consultation-${crypto.randomUUID().slice(0, 8)}`;

      // Create voice room + session atomically via RPC
      const { data, error } = await aisha.rpc("create_consultation_call", {
        p_booking_id: params.bookingId ?? undefined,
        p_callee_id: params.calleeId,
        p_livekit_room_name: roomName,
        p_recording_consent: params.recordingConsent ?? false,
        p_room_name: `Consultation with ${params.calleeId.slice(0, 8)}`,
        p_story_id: params.storyId ?? undefined,
      });

      if (error) {
        safeError("consultationCall.createCall", error);
        throw new Error(error.message);
      }

      const result = z.object({ session_id: z.string(), room_id: z.string() }).parse(data);

      // Notify callee via existing notification system
      await aisha.rpc("create_storyloop_notification", {
        p_link: `/member/story?call=${result.session_id}`,
        p_message: "You have an incoming video call",
        p_title: "Incoming consultation call",
        p_type: "meeting_request",
        p_user_id: params.calleeId,
      });

      return { sessionId: result.session_id, roomName };
    },
    onSuccess: async ({ sessionId, roomName }) => {
      // Get LiveKit token
      try {
        const tokenResult = await invokeEdgeFunction({
          functionName: "create-livekit-token",
          body: { roomName, canPublish: true, canSubscribe: true },
          schema: livekitTokenSchema,
          context: "consultationCall.getToken",
        });

        setCallState({
          status: "ringing",
          roomName,
          token: tokenResult.token,
          sessionId,
          error: null,
          duration: 0,
        });

        // Auto-miss after timeout
        ringingTimeoutRef.current = setTimeout(() => {
          if (callState.status === "ringing") {
            endCall.mutate({ reason: "missed" });
          }
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
    mutationFn: async (params: JoinCallParams): Promise<LivekitTokenResult> => {
      setCallState((prev) => ({ ...prev, status: "connecting" }));

      // Update session status via RPC
      const { error: statusError } = await aisha.rpc("update_consultation_status", {
        p_session_id: params.sessionId,
        p_status: "active",
      });
      if (statusError) throw statusError;

      // Get LiveKit token
      const tokenResult = await invokeEdgeFunction({
        functionName: "create-livekit-token",
        body: { roomName: params.roomName, canPublish: true, canSubscribe: true },
        schema: livekitTokenSchema,
        context: "consultationCall.answerToken",
      });

      return tokenResult;
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
      const { error } = await aisha.rpc("update_consultation_status", {
        p_session_id: sessionId,
        p_status: "declined",
      });
      if (error) throw error;
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
        const { error } = await aisha.rpc("update_consultation_status", {
          p_duration_seconds: callState.duration > 0 ? callState.duration : undefined,
          p_session_id: callState.sessionId,
          p_status: reason === "missed" ? "missed" : "ended",
        });
        if (error) safeError("consultationCall.endCall", error);
      }
    },
    onSuccess: () => {
      if (ringingTimeoutRef.current) clearTimeout(ringingTimeoutRef.current);
      queryClient.invalidateQueries({ queryKey: [CALL_QUERY_KEY] });
      setCallState({ status: "ended", roomName: null, token: null, sessionId: null, error: null, duration: callState.duration });
    },
  });

  // ─── Query: active session for current user ────────────────
  const activeSession = useQuery({
    queryKey: [CALL_QUERY_KEY, "active", userId],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_active_consultation_session");

      if (error) {
        safeWarn("consultationCall.activeSession", error);
        return null;
      }

      return data?.[0] ?? null;
    },
    enabled: !!userId,
    staleTime: 10_000, // 10s — call state changes frequently
    refetchOnWindowFocus: true,
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
