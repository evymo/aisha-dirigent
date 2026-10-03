/**
 * Notifications screen — in-app notification list with mark-read actions.
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
import { ChevronLeft, Bell, CheckCheck } from "lucide-react-native";
import {
  useAuth,
  useInAppNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useTranslation,
} from "@/hooks";
import { colors, spacing, typography } from "@/theme";
import type { Notification } from "@/types/schemas";

function NotificationCard({
  item,
  onRead,
}: {
  item: Notification;
  onRead: (id: string) => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.card, !item.is_read && styles.cardUnread]}
      onPress={() => {
        if (!item.is_read) onRead(item.id);
      }}
    >
      <View style={[styles.dot, !item.is_read && styles.dotUnread]} />
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {item.title}
        </Text>
        {item.message && (
          <Text style={styles.cardBody2} numberOfLines={2}>
            {item.message}
          </Text>
        )}
        <Text style={styles.cardDate}>
          {new Date(item.created_at).toLocaleDateString()}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: notifications, refetch, isLoading } = useInAppNotifications(user?.id);
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleRead = (id: string) => {
    markRead.mutate(id);
  };

  const handleMarkAll = () => {
    if (!user?.id) return;
    markAllRead.mutate();
  };

  const hasUnread = (notifications ?? []).some((n) => !n.is_read);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <ChevronLeft size={20} color={colors.textSecondary} />
        </TouchableOpacity>
        <Bell size={20} color={colors.primary} />
        <Text style={styles.title}>{t("notifications.title")}</Text>
        {hasUnread && (
          <TouchableOpacity testID="mark-all-read-btn" onPress={handleMarkAll}>
            <CheckCheck size={20} color={colors.primary} />
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        testID="notifications-list"
        data={notifications ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <NotificationCard item={item} onRead={handleRead} />}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          !isLoading ? (
            <Text style={styles.empty}>{t("notifications.empty")}</Text>
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
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
  },
  title: { ...typography.h2, flex: 1 },
  listContent: { paddingHorizontal: spacing.md, gap: spacing.xs, paddingBottom: 40 },
  // Card
  card: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.sm,
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  cardUnread: {
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "transparent", marginTop: 6 },
  dotUnread: { backgroundColor: colors.primary },
  cardBody: { flex: 1 },
  cardTitle: { ...typography.bodySmall, fontWeight: "600", color: colors.text },
  cardBody2: { ...typography.caption, marginTop: 2 },
  cardDate: { ...typography.caption, marginTop: 4, fontSize: 11 },
  empty: { ...typography.bodySmall, textAlign: "center", marginTop: spacing.xxl },
});
