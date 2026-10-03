/**
 * Chat thread screen — a single AISHA conversation.
 *
 * Reached from the conversations list (with a `conversationId`) or from the
 * "chat" deep link / "new conversation" action (no id — the first send creates
 * the conversation server-side and this screen adopts the minted id).
 *
 * Pure wire-up over the existing useAishaChat hooks (useChatMessages +
 * useSendMessage); the same bubble/compose pattern as AishaStoryChat.
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
import { Stack, useLocalSearchParams } from "expo-router";
import Markdown from "react-native-markdown-display";
import { Sparkles, Send } from "lucide-react-native";
import { useChatMessages, useSendMessage, useTranslation } from "@/hooks";
import { colors, spacing, typography } from "@/theme";
import type { ChatMessage } from "@/types/schemas";

interface ChatRow {
  key: string;
  role: "user" | "assistant" | "system";
  content: string;
  streaming?: boolean;
}

export default function ChatScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ conversationId?: string }>();

  // A new conversation starts with no id; the server mints one on first send
  // and useSendMessage surfaces it — adopt it so history keeps loading.
  const [conversationId, setConversationId] = useState<string | undefined>(
    typeof params.conversationId === "string" ? params.conversationId : undefined,
  );

  const { data: messages = [], isLoading } = useChatMessages(conversationId);
  const { mutate: send, isPending, streamingContent, isError, error, reset } =
    useSendMessage();
  const [draft, setDraft] = useState("");
  // The in-flight user message, echoed optimistically until the send settles.
  const [sentContent, setSentContent] = useState<string | null>(null);

  // newest-first for an inverted list (index 0 renders at the bottom). Order:
  // persisted history, then the optimistic user bubble, then the live reply —
  // so the reply sits below the user's message.
  const rows = useMemo<ChatRow[]>(() => {
    const base: ChatRow[] = (messages as ChatMessage[]).map((m) => ({
      key: m.id,
      role: m.role,
      content: m.content,
    }));
    const ordered = [...base].reverse();
    if (isPending && sentContent) {
      ordered.unshift({ key: "__pending_user__", role: "user", content: sentContent });
    }
    if (isPending && streamingContent) {
      ordered.unshift({
        key: "__streaming__",
        role: "assistant",
        content: streamingContent,
        streaming: true,
      });
    }
    return ordered;
  }, [messages, isPending, streamingContent, sentContent]);

  const handleSend = useCallback(() => {
    const content = draft.trim();
    if (!content) return;
    reset(); // drop any prior error state before a fresh attempt
    setSentContent(content);
    setDraft(""); // clear the composer while in flight; restored on failure
    send(
      { conversationId, content },
      {
        onSuccess: (data) => {
          if (!conversationId && data.conversationId) {
            setConversationId(data.conversationId);
          }
          setSentContent(null);
        },
        onError: () => {
          // Keep the message recoverable: drop the optimistic echo and put the
          // text back in the composer so the user can retry.
          setSentContent(null);
          setDraft(content);
        },
      },
    );
  }, [draft, send, conversationId, reset]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={140}
    >
      <Stack.Screen options={{ title: t("chat.title") }} />
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
                  <Markdown style={mdStyles}>
                    {item.content || (item.streaming ? "…" : "")}
                  </Markdown>
                )}
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator color={colors.primary} style={styles.spinner} />
          ) : (
            <View style={styles.welcome}>
              <Sparkles size={28} color={colors.primary} />
              <Text style={styles.welcomeText}>{t("chat.empty")}</Text>
            </View>
          )
        }
      />
      {isError ? (
        <TouchableOpacity
          style={styles.errorBar}
          onPress={handleSend}
          testID="chat-error-retry"
        >
          <Text style={styles.errorText} numberOfLines={2}>
            {(error as Error)?.message || t("common.error")}
          </Text>
          <Text style={styles.errorRetry}>{t("common.retry")}</Text>
        </TouchableOpacity>
      ) : null}
      <View style={styles.composeBar}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={t("chat.placeholder")}
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={4000}
          editable={!isPending}
        />
        <TouchableOpacity
          testID="chat-send"
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
  container: { flex: 1, backgroundColor: colors.background },
  list: { flex: 1 },
  listContent: { padding: spacing.md, gap: spacing.xs },
  spinner: { marginTop: 40 },
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
    flexDirection: "row",
    alignItems: "flex-end",
    padding: spacing.sm,
    gap: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.text,
    maxHeight: 100,
    fontSize: 15,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: { backgroundColor: colors.surface },
  errorBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 10,
    backgroundColor: `${colors.error}22`,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.error,
  },
  errorText: { ...typography.caption, color: colors.error, flex: 1 },
  errorRetry: { color: colors.primary, fontSize: 13, fontWeight: "600" },
});

const mdStyles = {
  body: { color: colors.text, fontSize: 14 },
  code_inline: { backgroundColor: colors.background, color: colors.primary, paddingHorizontal: 4, borderRadius: 4 },
  fence: { backgroundColor: colors.background, color: colors.text, borderRadius: 8, padding: spacing.sm },
  link: { color: colors.primary },
} as const;
