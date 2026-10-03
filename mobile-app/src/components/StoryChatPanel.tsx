/**
 * StoryChatPanel — the story's Chat surface, mirroring the workbench/extension:
 * a toggle between AISHA (AI orchestrator, story-parametrized) and Team
 * (colleagues, Matrix room). Both are story-scoped.
 */
import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Radio, Sparkles, Users } from "lucide-react-native";
import { AishaStoryChat } from "@/components/AishaStoryChat";
import { StoryChat } from "@/components/StoryChat";
import { StoryVoicePanel } from "@/components/StoryVoicePanel";
import { useTranslation } from "@/hooks";
import { colors, spacing, typography } from "@/theme";

export function StoryChatPanel({ storyId, userId }: { storyId: string; userId: string | undefined }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"aisha" | "team" | "voice">("aisha");

  return (
    <View style={styles.container}>
      <View style={styles.modeRow}>
        {([["aisha", Sparkles], ["team", Users], ["voice", Radio]] as const).map(([m, Icon]) => (
          <TouchableOpacity
            key={m}
            testID={`chat-mode-${m}`}
            style={[styles.modeBtn, mode === m && styles.modeBtnActive]}
            onPress={() => setMode(m)}
          >
            <Icon size={14} color={mode === m ? colors.text : colors.textSecondary} />
            <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>{t(`story.chat_${m}`)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {mode === "aisha" ? (
        <AishaStoryChat storyId={storyId} userId={userId} />
      ) : mode === "team" ? (
        <StoryChat storyId={storyId} userId={userId} />
      ) : (
        <StoryVoicePanel storyId={storyId} userId={userId} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  modeRow: {
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  modeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  modeBtnActive: { backgroundColor: colors.primary },
  modeText: { ...typography.caption, color: colors.textSecondary, fontWeight: "600" },
  modeTextActive: { color: colors.text },
});
