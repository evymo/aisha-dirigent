/**
 * Home screen — gamification, my stories, reminders, active studies.
 */
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { Star, Flame, Trophy, BookOpen, Bell, FlaskConical, LayoutDashboard } from "lucide-react-native";
import { useAuth, useDashboard, useGamificationStats, useProjects, useTranslation } from "@/hooks";
import { colors, spacing, typography } from "@/theme";
import { useState } from "react";
import type { ProjectSummary } from "@/types/schemas";

function GamificationCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Star;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <View style={styles.gamCard}>
      <Icon size={20} color={color} />
      <Text style={[styles.gamValue, { color }]}>{value}</Text>
      <Text style={styles.gamLabel}>{label}</Text>
    </View>
  );
}

function StoryRow({ story }: { story: ProjectSummary }) {
  return (
    <TouchableOpacity
      style={styles.storyRow}
      onPress={() => router.push(`/project/${story.id}`)}
    >
      <View style={styles.storyInfo}>
        <Text style={styles.storyTitle} numberOfLines={1}>{story.title}</Text>
        {story.last_entry_preview ? (
          <Text style={styles.storyPreview} numberOfLines={1}>{story.last_entry_preview}</Text>
        ) : (
          <Text style={styles.storyMeta}>{story.status}</Text>
        )}
      </View>
      {story.unread_count > 0 && (
        <View style={styles.unreadBadge}>
          <Text style={styles.unreadText}>{story.unread_count}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: dashboard, refetch: refetchDash } = useDashboard(user?.id);
  const { data: stats, refetch: refetchStats } = useGamificationStats(user?.id);
  const { data: stories, refetch: refetchStories } = useProjects(user?.id);
  const [refreshing, setRefreshing] = useState(false);

  const allStories = stories ?? [];
  const recentStories = [...allStories]
    .sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at))
    .slice(0, 5);

  const reminders = dashboard?.todays_reminders ?? [];
  const studies = dashboard?.active_studies ?? [];

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchDash(), refetchStats(), refetchStories()]);
    setRefreshing(false);
  };

  return (
    <ScrollView
      testID="home-screen"
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
    >
      <Text style={styles.greeting}>{t("home.title")}</Text>

      {/* Gamification strip */}
      <View style={styles.gamRow}>
        <GamificationCard icon={Star} label={t("home.points")} value={stats?.total_points ?? 0} color="#F59E0B" />
        <GamificationCard icon={Flame} label={t("home.streak")} value={stats?.current_streak ?? 0} color="#EF4444" />
        <GamificationCard icon={Trophy} label={t("home.rank")} value={stats?.weekly_rank ? `#${stats.weekly_rank}` : "-"} color="#8B5CF6" />
      </View>

      {/* My stories */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("home.my_stories")}</Text>
        {recentStories.length === 0 ? (
          <Text style={styles.emptyText}>{t("home.no_stories")}</Text>
        ) : (
          <>
            {recentStories.map((s) => (
              <StoryRow key={s.id} story={s} />
            ))}
            {allStories.length > 5 && (
              <TouchableOpacity onPress={() => router.push("/(tabs)/projects")}>
                <Text style={styles.viewAll}>{t("home.view_all_stories")}</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>

      {/* Today's reminders */}
      {reminders.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("home.reminders")}</Text>
          {reminders.map((r) => (
            <View key={r.id} style={styles.reminderRow}>
              <Bell size={14} color={r.completed ? colors.textMuted : colors.warning} />
              <Text style={[styles.reminderText, r.completed && styles.reminderDone]} numberOfLines={1}>
                {r.title}
              </Text>
              {r.time && <Text style={styles.reminderTime}>{r.time}</Text>}
            </View>
          ))}
        </View>
      )}

      {/* Active studies */}
      {studies.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("home.active_studies")}</Text>
          {studies.map((s) => (
            <TouchableOpacity
              key={s.id}
              style={styles.studyRow}
              onPress={() => router.push("/studies")}
            >
              <FlaskConical size={14} color={colors.primary} />
              <Text style={styles.studyText} numberOfLines={1}>{s.title}</Text>
              {s.pending_questionnaires > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadText}>{s.pending_questionnaires}</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Quick actions */}
      <View style={styles.actions}>
        <TouchableOpacity testID="home-action-stories" style={styles.actionButton} onPress={() => router.push("/(tabs)/projects")}>
          <BookOpen size={18} color={colors.primary} />
          <Text style={styles.actionLabel}>{t("home.action_stories")}</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="home-action-leaderboard" style={styles.actionButton} onPress={() => router.push("/leaderboard")}>
          <Trophy size={18} color="#F59E0B" />
          <Text style={styles.actionLabel}>{t("home.action_leaderboard")}</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="home-action-studies" style={styles.actionButton} onPress={() => router.push("/studies")}>
          <FlaskConical size={18} color={colors.success} />
          <Text style={styles.actionLabel}>{t("home.action_studies")}</Text>
        </TouchableOpacity>
        {/*
          The extranet's way in. Landing routing sends a non-admin straight to
          the brief, but admin/staff always start on these tabs and nothing here
          linked to /porada — so the people who run the platform were the ones
          who could not open its extranet at all, short of a deep link. Labelled
          with the surface's own title: no new i18n key, no locale to drift.
        */}
        <TouchableOpacity testID="home-action-porada" style={styles.actionButton} onPress={() => router.push("/porada")}>
          <LayoutDashboard size={18} color={colors.primary} />
          <Text style={styles.actionLabel} numberOfLines={1}>{t("extranet.porada.title")}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  greeting: { ...typography.h2, marginBottom: spacing.lg },
  // Gamification row
  gamRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg },
  gamCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: "center",
    gap: 4,
  },
  gamValue: { ...typography.h2 },
  gamLabel: { ...typography.caption, fontSize: 11 },
  // Sections
  section: { marginBottom: spacing.lg },
  sectionTitle: { ...typography.h3, marginBottom: spacing.sm },
  emptyText: { ...typography.bodySmall, color: colors.textMuted, textAlign: "center", paddingVertical: spacing.md },
  // Stories
  storyRow: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  storyInfo: { flex: 1 },
  storyTitle: { ...typography.bodySmall, color: colors.text },
  storyPreview: { ...typography.caption, color: colors.textMuted, fontSize: 11 },
  storyMeta: { ...typography.caption, textTransform: "capitalize", fontSize: 11 },
  unreadBadge: {
    backgroundColor: colors.warning,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  unreadText: { color: "#000", fontSize: 11, fontWeight: "700" },
  viewAll: { ...typography.bodySmall, color: colors.primary, marginTop: spacing.sm, textAlign: "center" },
  // Reminders
  reminderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  reminderText: { ...typography.bodySmall, flex: 1, color: colors.text },
  reminderDone: { textDecorationLine: "line-through", color: colors.textMuted },
  reminderTime: { ...typography.caption, color: colors.textSecondary, fontSize: 11 },
  // Studies
  studyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  studyText: { ...typography.bodySmall, flex: 1, color: colors.text },
  // Quick actions
  actions: { flexDirection: "row", gap: spacing.sm },
  actionButton: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.sm,
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionLabel: { ...typography.caption, fontWeight: "600", color: colors.text, fontSize: 11 },
});
