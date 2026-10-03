/**
 * Stories screen — auto-populated Kanban board.
 *
 * Sectioned by workflow status (kanban_stories_view → swimlanes). Cards surface
 * what AISHA is doing now (current_agent_slug / run status, last event). Long-press
 * a card to move it; legal targets come from get_allowed_kanban_transitions and the
 * move is validated server-side by update_story_status_audited.
 */
import { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  TouchableOpacity,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { Star, Bot, GitBranch } from "lucide-react-native";
import { fetchAllowedTransitions, useKanbanBoard, useMoveStoryStatus, useTranslation } from "@/hooks";
import { colors, spacing, typography } from "@/theme";
import type { KanbanStory } from "@/types/schemas";

function statusColor(raw: string | null): string {
  return raw && raw.startsWith("#") ? raw : colors.primary;
}

function StoryCard({
  story,
  statusLabel,
  onMove,
}: {
  story: KanbanStory;
  statusLabel: string;
  onMove: (s: KanbanStory) => void;
}) {
  const runningAgent = story.current_agent_slug && story.current_run_status !== "completed";
  return (
    <TouchableOpacity
      testID={`kanban-card-${story.story_id}`}
      style={styles.card}
      onPress={() => router.push(`/project/${story.story_id}`)}
      onLongPress={() => onMove(story)}
      delayLongPress={300}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={1}>{story.title}</Text>
        {story.is_starred && <Star size={14} color={colors.warning} fill={colors.warning} />}
      </View>

      {story.current_agent_slug ? (
        <View style={styles.agentRow}>
          <Bot size={12} color={runningAgent ? colors.success : colors.textMuted} />
          <Text style={[styles.agentText, runningAgent && { color: colors.success }]} numberOfLines={1}>
            {story.current_agent_slug}
            {story.current_run_status ? ` · ${story.current_run_status}` : ""}
          </Text>
        </View>
      ) : null}

      <View style={styles.cardFooter}>
        <Text style={styles.metaText}>
          {new Date(story.last_event_at ?? story.last_activity_at).toLocaleDateString()}
        </Text>
        {story.cost_to_date_usd > 0 && (
          <Text style={styles.cost}>${story.cost_to_date_usd.toFixed(2)}</Text>
        )}
        {story.default_branch ? (
          <View style={styles.branchRow}>
            <GitBranch size={11} color={colors.textMuted} />
            <Text style={styles.metaText} numberOfLines={1}>{story.default_branch}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.statusHint}>{statusLabel}</Text>
    </TouchableOpacity>
  );
}

export default function ProjectsScreen() {
  const { t } = useTranslation();
  const { columns, isLoading, refetch } = useKanbanBoard();
  const move = useMoveStoryStatus();
  const [refreshing, setRefreshing] = useState(false);

  const statusLabel = useCallback(
    (status: string, labelKey: string | null): string => {
      const viaKanban = t(`kanban.statuses.${status}`);
      if (viaKanban !== `kanban.statuses.${status}`) return viaKanban;
      if (labelKey) {
        const viaBackendKey = t(labelKey);
        if (viaBackendKey !== labelKey) return viaBackendKey;
      }
      return status.replace(/_/g, " ");
    },
    [t],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleMove = useCallback(
    async (story: KanbanStory) => {
      try {
        const targets = (await fetchAllowedTransitions(story.story_id)).map((row) => row.to_status);
        if (targets.length === 0) {
          Alert.alert(t("kanban.move_title"), t("kanban.no_moves"));
          return;
        }
        Alert.alert(
          t("kanban.move_title"),
          `${story.title}`,
          [
            ...targets.map((to) => ({
              text: statusLabel(to, null),
              onPress: () => {
                move.mutate(
                  { storyId: story.story_id, toStatus: to },
                  { onError: (e: unknown) => Alert.alert(t("errors.title"), e instanceof Error ? e.message : String(e)) },
                );
              },
            })),
            { text: t("common.cancel"), style: "cancel" as const },
          ],
        );
      } catch (e: unknown) {
        Alert.alert(t("errors.title"), e instanceof Error ? e.message : String(e));
      }
    },
    [t, move, statusLabel],
  );

  const sections = columns.map((col) => ({
    key: col.status,
    title: statusLabel(col.status, col.labelKey),
    color: statusColor(col.color),
    count: col.stories.length,
    data: col.stories,
  }));

  return (
    <SectionList
      testID="projects-screen"
      style={styles.container}
      contentContainerStyle={styles.content}
      sections={sections}
      keyExtractor={(item) => item.story_id}
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <View style={[styles.statusDot, { backgroundColor: section.color }]} />
          <Text style={styles.sectionTitle}>{section.title}</Text>
          <Text style={styles.sectionCount}>{section.count}</Text>
        </View>
      )}
      renderItem={({ item, section }) => (
        <StoryCard story={item} statusLabel={section.title} onMove={handleMove} />
      )}
      stickySectionHeadersEnabled={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
      ListEmptyComponent={
        isLoading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 60 }} />
        ) : (
          <Text style={styles.empty}>{t("stories.empty")}</Text>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.xs },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    backgroundColor: colors.background,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  sectionTitle: { ...typography.label, textTransform: "uppercase", letterSpacing: 1, flex: 1 },
  sectionCount: { ...typography.caption, color: colors.textMuted },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, marginBottom: spacing.xs },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardTitle: { ...typography.h3, flex: 1 },
  agentRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.xs },
  agentText: { ...typography.caption, color: colors.textMuted, flex: 1 },
  cardFooter: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs },
  branchRow: { flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 1 },
  metaText: { ...typography.caption },
  cost: { ...typography.caption, color: colors.success, fontWeight: "600" },
  statusHint: { ...typography.caption, color: colors.textMuted, marginTop: 4, fontSize: 10 },
  empty: { ...typography.bodySmall, textAlign: "center", marginTop: spacing.xxl, color: colors.textMuted },
});
