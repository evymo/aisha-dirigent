/**
 * StoryVoicePanel — LiveKit-backed push-to-talk controls for a story.
 */
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { Mic, MicOff, PhoneOff, Radio } from "lucide-react-native";
import { useStoryVoiceChannel } from "@/hooks/useStoryVoiceChannel";
import { useTranslation } from "@/hooks";
import { colors, spacing, typography } from "@/theme";

export function StoryVoicePanel({ storyId, userId }: { storyId: string; userId: string | undefined }) {
  const { t } = useTranslation();
  const voice = useStoryVoiceChannel(storyId, userId);
  const state = voice.channelState;
  const connected = state.status === "connected";
  const busy = voice.joinChannel.isPending || voice.leaveChannel.isPending;

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Radio size={30} color={connected ? colors.success : colors.primary} />
        <Text style={styles.title}>{t("story.voice_title")}</Text>
        <Text style={styles.meta}>
          {connected ? state.roomName : t(`story.voice_status.${state.status}`)}
        </Text>
        {state.error ? <Text style={styles.error}>{state.error}</Text> : null}
        <Text style={styles.meta}>
          {voice.participantCount} {t("story.voice_participants")}
          {state.token ? ` · ${t("story.voice_ready")}` : ""}
        </Text>

        {!connected ? (
          <TouchableOpacity
            testID="story-voice-join"
            style={[styles.primary, busy && styles.disabled]}
            disabled={busy || !userId}
            onPress={() => voice.joinChannel.mutate()}
          >
            {busy ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <>
                <Mic size={18} color={colors.text} />
                <Text style={styles.primaryText}>{t("story.voice_join")}</Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <View style={styles.controls}>
            <TouchableOpacity
              testID="story-voice-talk"
              style={[styles.talkButton, state.isTalking && styles.talkButtonActive]}
              onPressIn={() => { void voice.startTalking(); }}
              onPressOut={() => { void voice.stopTalking(); }}
            >
              {state.isTalking ? (
                <Mic size={24} color={colors.text} />
              ) : (
                <MicOff size={24} color={colors.textSecondary} />
              )}
              <Text style={styles.talkText}>{t("story.voice_hold")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="story-voice-leave"
              style={styles.leaveButton}
              disabled={busy}
              onPress={() => voice.leaveChannel.mutate()}
            >
              <PhoneOff size={18} color={colors.error} />
              <Text style={styles.leaveText}>{t("story.voice_leave")}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.sm,
  },
  title: { ...typography.h3, textAlign: "center" },
  meta: { ...typography.bodySmall, color: colors.textMuted, textAlign: "center" },
  error: { ...typography.bodySmall, color: colors.error, textAlign: "center" },
  primary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minWidth: 180,
    marginTop: spacing.sm,
  },
  primaryText: { ...typography.body, color: colors.text, fontWeight: "700" },
  disabled: { opacity: 0.6 },
  controls: { width: "100%", gap: spacing.md, marginTop: spacing.sm },
  talkButton: {
    minHeight: 120,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceLight,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  talkButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  talkText: { ...typography.bodySmall, color: colors.text, fontWeight: "700" },
  leaveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 12,
    paddingVertical: spacing.md,
  },
  leaveText: { ...typography.bodySmall, color: colors.error, fontWeight: "700" },
});
