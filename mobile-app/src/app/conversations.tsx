/**
 * Conversations list screen — shows all chat conversations with AISHA.
 * Navigates to individual chat when tapped.
 */
import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from "react-native";
import { router } from "expo-router";
import { MessageSquare, Plus } from "lucide-react-native";
import { useAuth, useConversations, useTranslation } from "@/hooks";
import { colors, spacing, typography } from "@/theme";
import type { ChatConversation } from "@/types/schemas";

function ConversationCard({ conversation }: { conversation: ChatConversation }) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() =>
        router.push({
          pathname: "/chat",
          params: { conversationId: conversation.id },
        })
      }
    >
      <View style={styles.cardIcon}>
        <MessageSquare size={20} color={colors.primary} />
      </View>
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {conversation.title ?? `Chat #${conversation.id.slice(0, 8)}`}
        </Text>
        <View style={styles.cardMeta}>
          {conversation.last_message_at && (
            <Text style={styles.metaText}>
              {new Date(conversation.last_message_at).toLocaleDateString()}
            </Text>
          )}
          <Text style={styles.metaText}>
            {conversation.message_count} msgs
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function ConversationsScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: conversations, isLoading, refetch } = useConversations(user?.id);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t("projects.conversations")}</Text>
        <TouchableOpacity
          style={styles.newButton}
          onPress={() => router.push("/chat")}
        >
          <Plus size={18} color={colors.text} />
          <Text style={styles.newButtonText}>{t("chat.new_conversation")}</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        contentContainerStyle={styles.list}
        data={conversations}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ConversationCard conversation={item} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          !isLoading ? (
            <Text style={styles.empty}>{t("projects.no_conversations")}</Text>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { ...typography.h2 },
  newButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  newButtonText: { color: colors.text, fontSize: 13, fontWeight: "600" },
  list: { padding: spacing.md, gap: spacing.sm },
  card: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: `${colors.primary}20`,
    alignItems: "center",
    justifyContent: "center",
  },
  cardContent: { flex: 1, gap: 4 },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
  cardMeta: { flexDirection: "row", gap: spacing.sm },
  metaText: { ...typography.caption },
  empty: { ...typography.body, color: colors.textMuted, textAlign: "center", marginTop: spacing.xl },
});
