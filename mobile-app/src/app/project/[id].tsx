/**
 * Story detail — thread view (entries + compose) with an auto-populated Timeline tab.
 * Story = thread, entries = posts. Timeline = story_timeline (agent runs, deploys,
 * blue/green switches) — read-only, populated automatically by the backend.
 */
import { useCallback, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import {
  FileText,
  Heart,
  MessageSquare,
  AlertTriangle,
  Pin,
  Send,
  Settings2,
  Bot,
  GitBranch,
  Rocket,
  Activity,
} from "lucide-react-native";
import { useProjectDetail, useTranslation, useAddEntry, useStoryTimeline, useAuth } from "@/hooks";
import { StoryChatPanel } from "@/components/StoryChatPanel";
import { projectDetailSchema } from "@/types/schemas";
import { colors, spacing, typography } from "@/theme";
import type { StoryEntry, StoryTimelineEvent } from "@/types/schemas";

const ENTRY_ICONS: Record<string, typeof FileText> = {
  note: FileText,
  health_event: Heart,
  message: MessageSquare,
  lab_result: FileText,
  alert: AlertTriangle,
  system_check_in: Settings2,
  system_lab_result: FileText,
  document: FileText,
};

function parseDetail(data: unknown) {
  const result = projectDetailSchema.safeParse(data);
  return result.success ? result.data : null;
}

function EntryCard({ entry }: { entry: StoryEntry }) {
  const IconComp = ENTRY_ICONS[entry.entry_type] ?? FileText;
  const isSystem = entry.entry_type.startsWith("system_");

  return (
    <View style={[styles.entryCard, isSystem && styles.entrySystem]}>
      <View style={styles.entryHeader}>
        <IconComp size={14} color={isSystem ? colors.textMuted : colors.primary} />
        <Text style={styles.entryType}>{entry.entry_type.replace(/_/g, " ")}</Text>
        {entry.is_pinned && <Pin size={12} color={colors.warning} />}
        <Text style={styles.entryTime}>
          {new Date(entry.created_at).toLocaleDateString()}
        </Text>
      </View>
      {entry.content && (
        <Text style={styles.entryContent}>{entry.content}</Text>
      )}
      {entry.created_by_name && (
        <Text style={styles.entryAuthor}>{entry.created_by_name}</Text>
      )}
    </View>
  );
}

function timelineIcon(kind: string): typeof Activity {
  if (kind === "rollback") return GitBranch;
  if (kind === "bg_switch") return Rocket;
  return Bot;
}

function payloadHighlights(payload: Record<string, unknown> | null): string[] {
  if (!payload) return [];
  const keys = ["deployment_url", "preview_url", "commit_sha", "branch", "environment", "provider", "error", "reason"];
  return keys.flatMap((key) => {
    const value = payload[key];
    return typeof value === "string" && value.length > 0 ? [`${key.replace(/_/g, " ")}: ${value}`] : [];
  });
}

function TimelineCard({ event }: { event: StoryTimelineEvent }) {
  const IconComp = timelineIcon(event.event_kind);
  const isError = event.status === "error" || event.status === "failed";
  const headline = event.operation || event.trace_event_type || event.event_kind;
  const highlights = payloadHighlights(event.payload);
  return (
    <View style={styles.entryCard}>
      <View style={styles.entryHeader}>
        <IconComp size={14} color={isError ? colors.error : colors.primary} />
        <Text style={styles.entryType}>{headline}</Text>
        <Text style={styles.entryTime}>{new Date(event.ts).toLocaleString()}</Text>
      </View>
      <View style={styles.tlMetaRow}>
        {event.agent_slug ? <Text style={styles.tlMeta}>{event.agent_slug}</Text> : null}
        {event.status ? (
          <Text style={[styles.tlMeta, isError && { color: colors.error }]}>{event.status}</Text>
        ) : null}
        {event.app_name ? <Text style={styles.tlMeta}>{event.app_name}</Text> : null}
        {typeof event.duration_ms === "number" ? (
          <Text style={styles.tlMeta}>{event.duration_ms} ms</Text>
        ) : null}
        {event.cost_usd && event.cost_usd > 0 ? (
          <Text style={[styles.tlMeta, { color: colors.success }]}>${event.cost_usd.toFixed(4)}</Text>
        ) : null}
        {event.files_changed && event.files_changed.length > 0 ? (
          <Text style={styles.tlMeta}>{event.files_changed.length} files</Text>
        ) : null}
        {event.run_id ? <Text style={styles.tlMeta}>run {event.run_id.slice(0, 8)}</Text> : null}
      </View>
      {event.files_changed && event.files_changed.length > 0 ? (
        <View style={styles.fileList}>
          {event.files_changed.slice(0, 3).map((file) => (
            <Text key={file} style={styles.fileItem} numberOfLines={1}>{file}</Text>
          ))}
        </View>
      ) : null}
      {highlights.length > 0 ? (
        <View style={styles.fileList}>
          {highlights.slice(0, 4).map((item) => (
            <Text key={item} style={styles.payloadItem} numberOfLines={1}>{item}</Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: rawData, isLoading, refetch } = useProjectDetail(id);
  const { mutate: addEntry, isPending } = useAddEntry();
  const [tab, setTab] = useState<"thread" | "timeline" | "chat">("thread");
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const listRef = useRef<FlatList>(null);

  const {
    data: timeline = [],
    isLoading: timelineLoading,
    refetch: refetchTimeline,
  } = useStoryTimeline(tab === "timeline" ? id : undefined);

  const detail = parseDetail(rawData);
  const entries = detail?.entries ?? [];

  // pinned first, then by created_at desc
  const sorted = [...entries].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    return b.created_at.localeCompare(a.created_at);
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await (tab === "timeline" ? refetchTimeline() : refetch());
    setRefreshing(false);
  }, [tab, refetch, refetchTimeline]);

  const handleSend = () => {
    const text = message.trim();
    if (!text || !id) return;
    addEntry(
      { storyId: id, entryType: "message", content: text },
      { onSuccess: () => listRef.current?.scrollToOffset({ offset: 0, animated: true }) },
    );
    setMessage("");
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!detail) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>{t("errors.not_found")}</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={100}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={2}>{detail.title}</Text>
        <Text style={styles.statusText}>{detail.status}</Text>
        <View style={styles.tabs}>
          {(["thread", "timeline", "chat"] as const).map((key) => (
            <TouchableOpacity
              key={key}
              testID={`story-tab-${key}`}
              style={[styles.tab, tab === key && styles.tabActive]}
              onPress={() => setTab(key)}
            >
              <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>
                {t(`story.tab_${key}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {tab === "chat" ? (
        <StoryChatPanel storyId={id} userId={user?.id} />
      ) : tab === "timeline" ? (
        <FlatList
          data={timeline}
          keyExtractor={(e) => e.event_id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            timelineLoading ? (
              <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
            ) : (
              <View style={styles.emptyContainer}>
                <Activity size={32} color={colors.textMuted} />
                <Text style={styles.emptyText}>{t("story.no_timeline")}</Text>
              </View>
            )
          }
          renderItem={({ item }) => <TimelineCard event={item} />}
        />
      ) : (
        <>
          <FlatList
            ref={listRef}
            data={sorted}
            keyExtractor={(e) => e.id}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <MessageSquare size={32} color={colors.textMuted} />
                <Text style={styles.emptyText}>{t("story.no_entries")}</Text>
              </View>
            }
            renderItem={({ item }) => <EntryCard entry={item} />}
          />

          {/* Compose bar */}
          <View style={styles.composeBar}>
            <TextInput
              style={styles.composeInput}
              value={message}
              onChangeText={setMessage}
              placeholder={t("story.compose_placeholder")}
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={4000}
            />
            <TouchableOpacity
              style={[styles.sendButton, (!message.trim() || isPending) && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={!message.trim() || isPending}
            >
              <Send size={18} color={message.trim() && !isPending ? colors.text : colors.textMuted} />
            </TouchableOpacity>
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background },
  emptyContainer: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxl },
  emptyText: { ...typography.body, color: colors.textMuted },

  // Header
  header: { padding: spacing.md, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  title: { ...typography.h2 },
  statusText: { ...typography.caption, textTransform: "capitalize", color: colors.textSecondary },
  tabs: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.sm },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  tabActive: { backgroundColor: colors.primary },
  tabText: { ...typography.caption, color: colors.textSecondary, fontWeight: "600" },
  tabTextActive: { color: colors.text },

  // Entries feed
  list: { flex: 1 },
  listContent: { padding: spacing.md },
  entryCard: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  entrySystem: { opacity: 0.7 },
  entryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  entryType: { ...typography.caption, textTransform: "capitalize", fontWeight: "600", flex: 1 },
  entryTime: { ...typography.caption, fontSize: 11 },
  entryContent: { ...typography.bodySmall, color: colors.text, marginTop: 4 },
  entryAuthor: { ...typography.caption, color: colors.textMuted, marginTop: 4 },

  // Timeline
  tlMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: 2 },
  tlMeta: { ...typography.caption, fontSize: 11, color: colors.textMuted },
  fileList: { marginTop: spacing.xs, gap: 2 },
  fileItem: { ...typography.caption, color: colors.textSecondary, fontSize: 11 },
  payloadItem: { ...typography.caption, color: colors.textMuted, fontSize: 11 },

  // Compose bar
  composeBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    gap: spacing.xs,
  },
  composeInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.text,
    maxHeight: 100,
    fontSize: 15,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: { backgroundColor: colors.surface },
});
