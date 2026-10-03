/**
 * Consultation call window — full-screen dialog for active video calls.
 *
 * Uses LiveKit React Components for video/audio rendering.
 * Integrates with useConsultationCall for call lifecycle management.
 *
 * @module components/consultation/ConsultationCallWindow
 */

import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneIncoming,
  Clock,
} from "lucide-react";

import { RecordingConsentBanner } from "@/components/consultation/RecordingConsentBanner";

import type { ConsultationCallState, CallStatus } from "@/hooks/useConsultationCall";
import type { RecordingState } from "@/hooks/useRecordingConsent";

// =============================================================================
// Types
// =============================================================================

interface ConsultationCallWindowProps {
  callState: ConsultationCallState;
  callerName?: string;
  onAnswer: () => void;
  onDecline: () => void;
  onEndCall: () => void;
  onReset: () => void;
  /** Recording consent state — omit to hide recording UI */
  recordingState?: RecordingState;
  onGrantConsent?: () => void;
  onRevokeConsent?: () => void;
  onStartRecording?: () => void;
  onStopRecording?: () => void;
}

// =============================================================================
// Helpers
// =============================================================================

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function getStatusBadgeVariant(status: CallStatus): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "ringing":
      return "default";
    case "connected":
      return "secondary";
    case "error":
      return "destructive";
    default:
      return "outline";
  }
}

// =============================================================================
// Component
// =============================================================================

/**
 * Full-screen dialog for consultation calls.
 *
 * When LiveKit @livekit/components-react is installed, this component
 * should be extended to render LiveKitRoom + VideoTrack components.
 * Currently provides call controls and status display.
 *
 * @example
 * <ConsultationCallWindow
 *   callState={callState}
 *   callerName="Dr. Novák"
 *   onAnswer={() => answerCall.mutate({ roomName, sessionId })}
 *   onDecline={() => declineCall.mutate(sessionId)}
 *   onEndCall={() => endCall.mutate({})}
 *   onReset={resetCall}
 * />
 */
export function ConsultationCallWindow({
  callState,
  callerName,
  onAnswer,
  onDecline,
  onEndCall,
  onReset,
  recordingState,
  onGrantConsent,
  onRevokeConsent,
  onStartRecording,
  onStopRecording,
}: ConsultationCallWindowProps) {
  const { t } = useTranslation();

  const isOpen = callState.status !== "idle";
  const isRinging = callState.status === "ringing";
  const isConnected = callState.status === "connected";
  const isEnded = callState.status === "ended";
  const isError = callState.status === "error";

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open && (isEnded || isError)) {
        onReset();
      }
    },
    [isEnded, isError, onReset]
  );

  const statusLabel = useMemo(() => {
    switch (callState.status) {
      case "creating":
        return t("guild.call.creating");
      case "ringing":
        return t("guild.call.ringing");
      case "connecting":
        return t("guild.call.connecting");
      case "connected":
        return t("guild.call.connected");
      case "ended":
        return t("guild.call.ended");
      case "error":
        return callState.error || t("guild.call.error");
      default:
        return "";
    }
  }, [callState.status, callState.error, t]);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl p-0 overflow-hidden bg-gray-950 text-white border-gray-800">
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 pt-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
              <Phone className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-lg">
                {callerName || t("guild.call.consultation")}
              </p>
              <Badge variant={getStatusBadgeVariant(callState.status)}>
                {statusLabel}
              </Badge>
            </div>
          </div>

          {isConnected && (
            <div className="flex items-center gap-2 text-gray-400">
              <Clock className="h-4 w-4" />
              <span className="font-mono text-sm">{formatDuration(callState.duration)}</span>
            </div>
          )}
        </div>

        {/* ── Video area (placeholder for LiveKit components) ── */}
        <div className="aspect-video bg-gray-900 mx-6 rounded-lg flex items-center justify-center">
          {isRinging && (
            <div className="text-center animate-pulse">
              <PhoneIncoming className="h-16 w-16 mx-auto mb-4 text-green-400" />
              <p className="text-lg text-gray-300">{t("guild.call.incoming")}</p>
              <p className="text-sm text-gray-500">{callerName}</p>
            </div>
          )}

          {isConnected && (
            <div className="text-center text-gray-500">
              <Video className="h-16 w-16 mx-auto mb-4" />
              <p className="text-sm">{t("guild.call.livekitPending")}</p>
            </div>
          )}

          {(isEnded || isError) && (
            <div className="text-center">
              <PhoneOff className="h-16 w-16 mx-auto mb-4 text-gray-600" />
              <p className="text-lg text-gray-400">{statusLabel}</p>
              {isConnected || callState.duration > 0 ? (
                <p className="text-sm text-gray-500 mt-1">
                  {t("guild.call.duration")}: {formatDuration(callState.duration)}
                </p>
              ) : null}
            </div>
          )}
        </div>

        {/* ── Recording consent banner ── */}
        {isConnected && recordingState && onGrantConsent && onRevokeConsent && onStartRecording && onStopRecording && (
          <div className="px-6">
            <RecordingConsentBanner
              recordingState={recordingState}
              onGrantConsent={onGrantConsent}
              onRevokeConsent={onRevokeConsent}
              onStartRecording={onStartRecording}
              onStopRecording={onStopRecording}
            />
          </div>
        )}

        {/* ── Controls ── */}
        <div className="flex items-center justify-center gap-4 px-6 pb-6 pt-4">
          {isRinging && (
            <>
              <Button
                variant="destructive"
                size="lg"
                className="rounded-full w-14 h-14"
                onClick={onDecline}
              >
                <PhoneOff className="h-6 w-6" />
              </Button>
              <Button
                size="lg"
                className="rounded-full w-14 h-14 bg-green-600 hover:bg-green-700"
                onClick={onAnswer}
              >
                <Phone className="h-6 w-6" />
              </Button>
            </>
          )}

          {isConnected && (
            <Button
              variant="destructive"
              size="lg"
              className="rounded-full w-14 h-14"
              onClick={onEndCall}
            >
              <PhoneOff className="h-6 w-6" />
            </Button>
          )}

          {(isEnded || isError) && (
            <Button variant="outline" onClick={onReset}>
              {t("guild.call.close")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
