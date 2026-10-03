/**
 * Recording consent banner — GDPR-compliant opt-in before recording starts.
 *
 * Shown inside the call window when recording is possible. Both parties
 * must consent before the recording can begin.
 *
 * @module components/consultation/RecordingConsentBanner
 */

import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Circle, StopCircle, ShieldCheck, ShieldAlert } from "lucide-react";

import type { RecordingState } from "@/hooks/useRecordingConsent";

// =============================================================================
// Types
// =============================================================================

interface RecordingConsentBannerProps {
  recordingState: RecordingState;
  onGrantConsent: () => void;
  onRevokeConsent: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  disabled?: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function RecordingConsentBanner({
  recordingState,
  onGrantConsent,
  onRevokeConsent,
  onStartRecording,
  onStopRecording,
  disabled = false,
}: RecordingConsentBannerProps) {
  const { t } = useTranslation();

  if (recordingState.status === "idle") {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
        <ShieldAlert className="h-5 w-5 shrink-0 text-amber-600" />
        <div className="flex-1">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            {t("guild.call.recordingConsentTitle", "Call Recording")}
          </p>
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {t(
              "guild.call.recordingConsentDescription",
              "This call can be recorded for quality assurance. Your consent is required."
            )}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onGrantConsent}
          disabled={disabled}
          className="shrink-0"
        >
          <ShieldCheck className="mr-1 h-4 w-4" />
          {t("guild.call.giveConsent", "I Consent")}
        </Button>
      </div>
    );
  }

  if (recordingState.status === "consenting" || recordingState.consentGiven) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950">
        <ShieldCheck className="h-5 w-5 shrink-0 text-green-600" />
        <div className="flex-1">
          <p className="text-sm font-medium text-green-800 dark:text-green-200">
            {t("guild.call.consentGranted", "Consent Granted")}
          </p>
          <div className="flex items-center gap-2">
            {recordingState.status === "recording" && (
              <Badge variant="destructive" className="animate-pulse">
                <Circle className="mr-1 h-2 w-2 fill-current" />
                {t("guild.call.recording", "Recording")}
              </Badge>
            )}
            {recordingState.status === "stopped" && (
              <Badge variant="secondary">
                {t("guild.call.recordingStopped", "Recording Stopped")}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {recordingState.status !== "recording" && recordingState.consentGiven && (
            <Button
              size="sm"
              variant="default"
              onClick={onStartRecording}
              disabled={disabled}
            >
              <Circle className="mr-1 h-3 w-3 fill-red-500 text-red-500" />
              {t("guild.call.startRecording", "Record")}
            </Button>
          )}
          {recordingState.status === "recording" && (
            <Button
              size="sm"
              variant="destructive"
              onClick={onStopRecording}
              disabled={disabled}
            >
              <StopCircle className="mr-1 h-4 w-4" />
              {t("guild.call.stopRecording", "Stop")}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={onRevokeConsent}
            disabled={disabled || recordingState.status === "recording"}
          >
            {t("guild.call.revokeConsent", "Revoke")}
          </Button>
        </div>
      </div>
    );
  }

  if (recordingState.status === "error") {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
        <ShieldAlert className="h-5 w-5 shrink-0 text-red-600" />
        <p className="text-sm text-red-700 dark:text-red-300">
          {recordingState.error ??
            t("guild.call.recordingError", "Recording failed")}
        </p>
      </div>
    );
  }

  return null;
}
