/**
 * Leaderboard screen — token rankings with tabs per token type.
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
import { ChevronLeft, Trophy } from "lucide-react-native";
import { useLeaderboard, useMyLeaderboardPosition, useTranslation } from "@/hooks";
import { colors, spacing, typography } from "@/theme";
import type { LeaderboardEntry } from "@/types/schemas";

const RANK_ICONS: Record<number, string> = { 1: "🏆", 2: "🥈", 3: "🥉" };

const TOKEN_TABS = [
  { key: undefined as string | undefined, labelKey: "leaderboard.all_tokens" },
  { key: "governance", labelKey: "leaderboard.governance" },
  { key: "impact", labelKey: "leaderboard.impact" },
  { key: "data", labelKey: "leaderboard.data" },
] as const;

function LeaderboardRow({ entry }: { entry: LeaderboardEntry }) {
  const medal = RANK_ICONS[entry.rank];
  return (
    <View
      style={[
        styles.row,
        entry.is_current_user && styles.rowHighlight,
      ]}
    >
      <Text style={styles.rank}>{medal ?? `#${entry.rank}`}</Text>
      <Text style={styles.displayName} numberOfLines={1}>
        {entry.display_name}
      </Text>
      <Text style={styles.tokens}>{entry.total_tokens}</Text>
    </View>
  );
}

export default function LeaderboardScreen() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<string | undefined>(undefined);
  const { data: entries, refetch, isLoading } = useLeaderboard(activeTab);
  const { data: myPosition } = useMyLeaderboardPosition();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <ChevronLeft size={20} color={colors.textSecondary} />
        </TouchableOpacity>
        <Trophy size={20} color="#F59E0B" />
        <Text style={styles.title}>{t("leaderboard.title")}</Text>
      </View>

      {/* My position banner */}
      {myPosition && (
        <View style={styles.myBanner}>
          <Text style={styles.myBannerText}>
            {t("leaderboard.your_rank")}: #{myPosition.rank} — {myPosition.total_tokens} pts
          </Text>
        </View>
      )}

      {/* Token type tabs */}
      <View style={styles.tabs}>
        {TOKEN_TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key ?? "all"}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {t(tab.labelKey)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* List */}
      <FlatList
        testID="leaderboard-list"
        data={entries ?? []}
        keyExtractor={(item) => `${item.rank}-${item.display_name}`}
        renderItem={({ item }) => <LeaderboardRow entry={item} />}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          !isLoading ? <Text style={styles.empty}>{t("leaderboard.empty")}</Text> : null
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
  // My banner
  myBanner: {
    backgroundColor: `${colors.primary}20`,
    marginHorizontal: spacing.md,
    borderRadius: 10,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  myBannerText: { ...typography.bodySmall, fontWeight: "600", color: colors.primary, textAlign: "center" },
  // Tabs
  tabs: {
    flexDirection: "row",
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.xs,
    borderRadius: 8,
    backgroundColor: colors.surface,
    alignItems: "center",
  },
  tabActive: {
    backgroundColor: colors.primary,
  },
  tabText: { ...typography.caption, fontSize: 11 },
  tabTextActive: { color: "#fff", fontWeight: "700" },
  // List
  listContent: { paddingHorizontal: spacing.md, gap: spacing.xs, paddingBottom: 40 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  rowHighlight: {
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}10`,
  },
  rank: { width: 36, textAlign: "center", ...typography.body, fontWeight: "700" },
  displayName: { ...typography.body, flex: 1, color: colors.text },
  tokens: { ...typography.body, fontWeight: "700", color: colors.primary },
  empty: { ...typography.bodySmall, textAlign: "center", marginTop: spacing.xxl },
});
