/**
 * Hook for managing call recording consent (GDPR compliant).
 *
 * Handles consent collection before recording starts, stores
 * consent in consultation_sessions, and provides LiveKit Egress
 * start/stop via the `livekit-recording` edge function.
 *
 * @module hooks/useRecordingConsent
 */

import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { invokeEdgeFunction } from "@/integrations/api/edge";
import { safeError, safeInfo } from "@/lib/security/safeLogger";
import { z } from "zod";

// =============================================================================
// Schemas
// =============================================================================

const recordingResponseSchema = z.object({
  egress_id: z.string(),
  status: z.enum(["started", "stopped", "failed"]),
});

// =============================================================================
// Types
// =============================================================================

export type RecordingStatus = "idle" | "consenting" | "recording" | "stopped" | "error";

export interface RecordingState {
  status: RecordingStatus;
  egressId: string | null;
  consentGiven: boolean;
  consentTimestamp: string | null;
  error: string | null;
}

// =============================================================================
// Hook
// =============================================================================

export function useRecordingConsent(sessionId: string | null, userId: string | undefined) {
  const queryClient = useQueryClient();

  const [recordingState, setRecordingState] = useState<RecordingState>({
    status: "idle",
    egressId: null,
    consentGiven: false,
    consentTimestamp: null,
    error: null,
  });

  // ─── Grant consent ─────────────────────────────────────────
  const grantConsent = useCallback(async () => {
    if (!sessionId || !userId) return;

    const timestamp = new Date().toISOString();

    // Update consent + audit journal via RPC
    const { error } = await aisha.rpc("update_recording_consent_audited", {
      p_consent: true,
      p_session_id: sessionId,
    });

    if (error) {
      safeError("recordingConsent.grant", error);
      return;
    }

    setRecordingState((prev) => ({
      ...prev,
      consentGiven: true,
      consentTimestamp: timestamp,
      status: "consenting",
    }));

    safeInfo("recordingConsent.granted", { sessionId });
  }, [sessionId, userId]);

  // ─── Revoke consent ────────────────────────────────────────
  const revokeConsent = useCallback(async () => {
    if (!sessionId || !userId) return;

    // Revoke consent + audit journal via RPC
    const { error } = await aisha.rpc("update_recording_consent_audited", {
      p_consent: false,
      p_session_id: sessionId,
    });

    if (error) {
      safeError("recordingConsent.revoke", error);
      return;
    }

    setRecordingState({
      status: "idle",
      egressId: null,
      consentGiven: false,
      consentTimestamp: null,
      error: null,
    });

    safeInfo("recordingConsent.revoked", { sessionId });
  }, [sessionId, userId]);

  // ─── Start recording (requires consent) ────────────────────
  const startRecording = useMutation({
    mutationFn: async (roomName: string) => {
      if (!recordingState.consentGiven) {
        throw new Error("Recording consent is required before starting");
      }
      if (!sessionId) throw new Error("No active session");

      const result = await invokeEdgeFunction({
        functionName: "livekit-recording",
        body: {
          action: "start",
          room_name: roomName,
          session_id: sessionId,
        },
        schema: recordingResponseSchema,
        context: "recordingConsent.start",
      });

      return result;
    },
    onSuccess: (data) => {
      setRecordingState((prev) => ({
        ...prev,
        status: "recording",
        egressId: data.egress_id,
        error: null,
      }));
    },
    onError: (error) => {
      safeError("recordingConsent.startRecording", error);
      setRecordingState((prev) => ({
        ...prev,
        status: "error",
        error: error.message,
      }));
    },
  });

  // ─── Stop recording ────────────────────────────────────────
  const stopRecording = useMutation({
    mutationFn: async () => {
      if (!recordingState.egressId) {
        throw new Error("No active recording to stop");
      }

      const result = await invokeEdgeFunction({
        functionName: "livekit-recording",
        body: {
          action: "stop",
          egress_id: recordingState.egressId,
          session_id: sessionId,
        },
        schema: recordingResponseSchema,
        context: "recordingConsent.stop",
      });

      return result;
    },
    onSuccess: () => {
      setRecordingState((prev) => ({
        ...prev,
        status: "stopped",
        error: null,
      }));
    },
    onError: (error) => {
      safeError("recordingConsent.stopRecording", error);
      setRecordingState((prev) => ({
        ...prev,
        status: "error",
        error: error.message,
      }));
    },
  });

  // ─── Reset ─────────────────────────────────────────────────
  const resetRecording = useCallback(() => {
    setRecordingState({
      status: "idle",
      egressId: null,
      consentGiven: false,
      consentTimestamp: null,
      error: null,
    });
  }, []);

  return {
    recordingState,
    grantConsent,
    revokeConsent,
    startRecording,
    stopRecording,
    resetRecording,
    isRecording: recordingState.status === "recording",
    canRecord: recordingState.consentGiven && recordingState.status !== "recording",
  };
}
