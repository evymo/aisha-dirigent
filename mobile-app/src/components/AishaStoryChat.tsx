/**
 * AishaStoryChat — story-scoped chat with the AISHA AI orchestrator.
 *
 * Pure wire-up over the existing useAishaChat hooks: finds (or lazily creates,
 * on first send) the story's conversation, streams responses via the ai-chat
 * edge function. Passing `storyId` is what makes AISHA story-specific — the
 * backend (svc-ai-chat) loads that story's story_rulesets + story_contexts.
 */
import { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import Markdown from "react-native-markdown-display";
import { Sparkles, Send, Layers, BookOpen } from "lucide-react-native";
import { useConversations, useChatMessages, useSendMessage, useTranslation } from "@/hooks";
import { useStoryRulesets, useStoryKnowledgeContext } from "@/hooks/useStoryContext";
import { colors, spacing, typography } from "@/theme";
import type { ChatMessage } from "@/types/schemas";

interface ChatRow {
  key: string;
  role: "user" | "assistant" | "system";
  content: string;
  streaming?: boolean;
}

export function AishaStoryChat({ storyId, userId }: { storyId: string; userId: string | undefined }) {
  const { t } = useTranslation();
  const { data: conversations } = useConversations(userId);
  const storyConv = useMemo(
    () => (conversations ?? []).find((c) => c.story_id === storyId) ?? null,
    [conversations, storyId],
  );
  const { data: messages = [], isLoading } = useChatMessages(storyConv?.id);
  const { mutate: send, isPending, streamingContent } = useSendMessage();
  const { data: rulesets } = useStoryRulesets(storyId);
  const { data: contextDocs } = useStoryKnowledgeContext(storyId);
  const activeRuleset = (rulesets ?? [])[0] ?? null;
  const contextCount = (contextDocs ?? []).length;
  const [draft, setDraft] = useState("");

  // newest-first for an inverted list; prepend the live streaming bubble
  const rows = useMemo<ChatRow[]>(() => {
    const base: ChatRow[] = (messages as ChatMessage[]).map((m) => ({
      key: m.id,
      role: m.role,
      content: m.content,
    }));
    const ordered = [...base].reverse();
    if (isPending && streamingContent) {
      ordered.unshift({ key: "__streaming__", role: "assistant", content: streamingContent, streaming: true });
    }
    return ordered;
  }, [messages, isPending, streamingContent]);

  const handleSend = useCallback(() => {
    const content = draft.trim();
    if (!content) return;
    send({ conversationId: storyConv?.id, content, storyId });
    setDraft("");
  }, [draft, send, storyConv?.id, storyId]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={140}
    >
      {activeRuleset || contextCount > 0 ? (
        <View style={styles.paramHeader}>
          {activeRuleset ? (
            <View style={styles.paramChip}>
              <Layers size={11} color={colors.primary} />
              <Text style={styles.paramText} numberOfLines={1}>
                {activeRuleset.context_profile ?? t("story.chat_ruleset")} · {activeRuleset.rule_count}
              </Text>
            </View>
          ) : null}
          {contextCount > 0 ? (
            <View style={styles.paramChip}>
              <BookOpen size={11} color={colors.textSecondary} />
              <Text style={styles.paramText}>
                {contextCount} {t("story.chat_context")}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
      <FlatList
        inverted
        data={rows}
        keyExtractor={(r) => r.key}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const isUser = item.role === "user";
          return (
            <View style={[styles.bubbleRow, isUser ? styles.rowUser : styles.rowAssistant]}>
              {!isUser ? <Sparkles size={14} color={colors.primary} style={styles.aiIcon} /> : null}
              <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
                {isUser ? (
                  <Text style={styles.userText}>{item.content}</Text>
                ) : (
                  <Markdown style={mdStyles}>{item.content || (item.streaming ? "…" : "")}</Markdown>
                )}
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : (
            <View style={styles.welcome}>
              <Sparkles size={28} color={colors.primary} />
              <Text style={styles.welcomeText}>{t("story.chat_aisha_welcome")}</Text>
            </View>
          )
        }
      />
      <View style={styles.composeBar}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={t("story.chat_aisha_placeholder")}
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={4000}
          editable={!isPending}
        />
        <TouchableOpacity
          testID="aisha-chat-send"
          style={[styles.sendBtn, (!draft.trim() || isPending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!draft.trim() || isPending}
        >
          {isPending ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <Send size={18} color={draft.trim() ? colors.text : colors.textMuted} />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  paramHeader: {
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    flexWrap: "wrap",
  },
  paramChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  paramText: { ...typography.caption, color: colors.textSecondary, fontSize: 10 },
  list: { flex: 1 },
  listContent: { padding: spacing.md, gap: spacing.xs },
  bubbleRow: { flexDirection: "row", marginBottom: spacing.xs, alignItems: "flex-end" },
  rowUser: { justifyContent: "flex-end" },
  rowAssistant: { justifyContent: "flex-start" },
  aiIcon: { marginRight: 4, marginBottom: 6 },
  bubble: { maxWidth: "82%", borderRadius: 14, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  bubbleUser: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleAssistant: { backgroundColor: colors.surface, borderBottomLeftRadius: 4 },
  userText: { ...typography.bodySmall, color: colors.text },
  welcome: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxl },
  welcomeText: { ...typography.bodySmall, color: colors.textMuted, textAlign: "center" },
  composeBar: {
    flexDirection: "row", alignItems: "flex-end", padding: spacing.sm, gap: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.background,
  },
  input: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 20, paddingHorizontal: spacing.md,
    paddingVertical: 10, color: colors.text, maxHeight: 100, fontSize: 15,
  },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  sendBtnDisabled: { backgroundColor: colors.surface },
});

const mdStyles = {
  body: { color: colors.text, fontSize: 14 },
  code_inline: { backgroundColor: colors.background, color: colors.primary, paddingHorizontal: 4, borderRadius: 4 },
  fence: { backgroundColor: colors.background, color: colors.text, borderRadius: 8, padding: spacing.sm },
  link: { color: colors.primary },
} as const;
