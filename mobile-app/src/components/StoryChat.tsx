/**
 * StoryChat — per-story Matrix chat. Pure wire-up over the gateway-backed
 * Matrix hooks (no matrix-js-sdk): useMatrixRooms (get_story_matrix_rooms) →
 * useMatrixMessages (matrix-webhook get/send + realtime). matrixUserId from
 * useMatrixClient (matrix-token-exchange) is used to align own messages.
 */
import { useState, useCallback } from "react";
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
import { MessageSquare, Send } from "lucide-react-native";
import { useMatrixClient } from "@/hooks/useMatrixClient";
import { useMatrixRooms } from "@/hooks/useMatrixRooms";
import { useMatrixMessages } from "@/hooks/useMatrixMessages";
import { useTranslation } from "@/hooks";
import { colors, spacing, typography } from "@/theme";
import type { MatrixMessage } from "@/hooks/useMatrixMessages";

function Bubble({ msg, isMine }: { msg: MatrixMessage; isMine: boolean }) {
  return (
    <View style={[styles.bubbleRow, isMine ? styles.bubbleRowMine : styles.bubbleRowOther]}>
      <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleOther]}>
        {!isMine ? (
          <Text style={styles.sender} numberOfLines={1}>
            {msg.sender.replace(/^@/, "").split(":")[0]}
          </Text>
        ) : null}
        <Text style={styles.body}>{msg.body}</Text>
        <Text style={styles.time}>
          {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </Text>
      </View>
    </View>
  );
}

export function StoryChat({ storyId, userId }: { storyId: string; userId: string | undefined }) {
  const { t } = useTranslation();
  const { matrixUserId } = useMatrixClient(userId);
  const { generalRooms, rooms, isLoading: roomsLoading } = useMatrixRooms(userId, storyId);
  const room = generalRooms[0] ?? rooms[0] ?? null;
  const { messages, isLoading, sendMessage, isSending } = useMatrixMessages(
    room?.matrixRoomId ?? null,
    userId,
  );
  const [draft, setDraft] = useState("");

  const ordered = [...messages].reverse(); // newest first for an inverted list

  const handleSend = useCallback(() => {
    const body = draft.trim();
    if (!body) return;
    sendMessage.mutate({ body });
    setDraft("");
  }, [draft, sendMessage]);

  if (roomsLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!room) {
    return (
      <View style={styles.center}>
        <MessageSquare size={32} color={colors.textMuted} />
        <Text style={styles.empty}>{t("story.chat_no_room")}</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={120}
    >
      <FlatList
        inverted
        data={ordered}
        keyExtractor={(m) => m.eventId}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <Bubble msg={item} isMine={!!matrixUserId && item.sender === matrixUserId} />
        )}
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : (
            <Text style={styles.empty}>{t("story.chat_empty")}</Text>
          )
        }
      />
      <View style={styles.composeBar}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={t("story.chat_placeholder")}
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={4000}
        />
        <TouchableOpacity
          testID="story-chat-send"
          style={[styles.sendBtn, (!draft.trim() || isSending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!draft.trim() || isSending}
        >
          <Send size={18} color={draft.trim() && !isSending ? colors.text : colors.textMuted} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxl },
  empty: { ...typography.bodySmall, color: colors.textMuted, textAlign: "center" },
  list: { flex: 1 },
  listContent: { padding: spacing.md, gap: spacing.xs },
  bubbleRow: { flexDirection: "row", marginBottom: spacing.xs },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubbleRowOther: { justifyContent: "flex-start" },
  bubble: { maxWidth: "80%", borderRadius: 14, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  bubbleMine: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: colors.surface, borderBottomLeftRadius: 4 },
  sender: { ...typography.caption, color: colors.textSecondary, fontWeight: "700", marginBottom: 2 },
  body: { ...typography.bodySmall, color: colors.text },
  time: { ...typography.caption, color: colors.textMuted, fontSize: 10, marginTop: 2, alignSelf: "flex-end" },
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
