/**
 * Mobile hook that bridges FCM push notifications with call UI.
 *
 * Listens for FCM messages of type `consultation_call` and surfaces
 * incoming-call state so the app can show a call screen even when
 * the app was in the background / killed.
 *
 * Works alongside useConsultationCall which handles Supabase Realtime
 * for foreground scenarios.
 *
 * @module hooks/useCallNotifications
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { safeError, safeInfo } from "@/lib/security/safeLogger";
import { z } from "zod";

// =============================================================================
// Schemas
// =============================================================================

const callNotificationPayloadSchema = z.object({
  type: z.literal("consultation_call"),
  session_id: z.string().uuid(),
  caller_id: z.string().uuid(),
  caller_name: z.string().optional(),
  story_id: z.string().uuid().optional(),
  room_name: z.string().optional(),
});

// =============================================================================
// Types
// =============================================================================

export interface IncomingCallInfo {
  sessionId: string;
  callerId: string;
  callerName: string;
  storyId: string | null;
  roomName: string | null;
  receivedAt: number;
}

type MessagingClient = {
  getInitialNotification: () => Promise<NotificationPayload | null>;
  onMessage: (listener: (message: NotificationPayload) => Promise<void>) => () => void;
};

type NotificationPayload = {
  notification?: { title?: string | null } | null;
  data?: Record<string, unknown> | null;
};

// =============================================================================
// Constants
// =============================================================================

/** Auto-dismiss incoming call after 45s if not answered */
const CALL_RING_TIMEOUT_MS = 45_000;

/** Lazy-load Firebase messaging */
async function getMessaging(): Promise<MessagingClient> {
  const messaging = await import("@react-native-firebase/messaging");
  return messaging.default() as MessagingClient;
}

// =============================================================================
// Hook
// =============================================================================

export function useCallNotifications(userId: string | undefined) {
  const [incomingCall, setIncomingCall] = useState<IncomingCallInfo | null>(null);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Parse notification data ───────────────────────────────
  const tryParseCallNotification = useCallback(
    (data: Record<string, unknown> | null | undefined): IncomingCallInfo | null => {
      if (!data || data.type !== "consultation_call") return null;

      const result = callNotificationPayloadSchema.safeParse(data);
      if (!result.success) return null;
      if (result.data.caller_id === userId) return null; // ignore own calls

      return {
        sessionId: result.data.session_id,
        callerId: result.data.caller_id,
        callerName: result.data.caller_name ?? "Unknown",
        storyId: result.data.story_id ?? null,
        roomName: result.data.room_name ?? null,
        receivedAt: Date.now(),
      };
    },
    [userId]
  );

  // ─── Show incoming call with auto-timeout ──────────────────
  const showIncomingCall = useCallback(
    (info: IncomingCallInfo) => {
      setIncomingCall(info);
      safeInfo("callNotifications.incoming", { sessionId: info.sessionId });

      if (ringTimeoutRef.current) clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = setTimeout(() => {
        setIncomingCall((prev) =>
          prev?.sessionId === info.sessionId ? null : prev
        );
      }, CALL_RING_TIMEOUT_MS);
    },
    []
  );

  // ─── Dismiss ───────────────────────────────────────────────
  const dismissIncomingCall = useCallback(() => {
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
    setIncomingCall(null);
  }, []);

  // ─── FCM listeners ────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;

    let unsubscribeOnMessage: (() => void) | undefined;
    let mounted = true;

    (async () => {
      try {
        const messaging = await getMessaging();

        // Foreground: new notification while app is open
        unsubscribeOnMessage = messaging.onMessage(async (remoteMessage) => {
          if (!mounted) return;
          const callInfo = tryParseCallNotification(remoteMessage.data);
          if (callInfo) showIncomingCall(callInfo);
        });

        // Cold start: app opened from a call notification tap
        const initial = await messaging.getInitialNotification();
        if (initial && mounted) {
          const callInfo = tryParseCallNotification(initial.data);
          if (callInfo) showIncomingCall(callInfo);
        }
      } catch (error) {
        safeError("callNotifications.setup", error);
      }
    })();

    return () => {
      mounted = false;
      unsubscribeOnMessage?.();
      if (ringTimeoutRef.current) {
        clearTimeout(ringTimeoutRef.current);
        ringTimeoutRef.current = null;
      }
    };
  }, [userId, tryParseCallNotification, showIncomingCall]);

  // ─── Mark session as missed when app goes to background ───
  useEffect(() => {
    if (!incomingCall) return;

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background" && incomingCall) {
        safeInfo("callNotifications.backgroundDuringRing", {
          sessionId: incomingCall.sessionId,
        });
      }
    });

    return () => subscription.remove();
  }, [incomingCall]);

  return {
    incomingCall,
    dismissIncomingCall,
    hasIncomingCall: !!incomingCall,
  };
}
