/**
 * Questionnaire list screen — shows pending and completed questionnaires.
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
import { CheckCircle2, Circle, Clock } from "lucide-react-native";
import { useQuestionnaires, useTranslation } from "@/hooks";
import { colors, spacing, typography } from "@/theme";
import type { Questionnaire } from "@/hooks/useQuestionnaires";

const STATUS_ICON = {
  completed: { color: colors.success, Icon: CheckCircle2 },
  expired: { color: colors.textMuted, Icon: Clock },
  pending: { color: colors.warning, Icon: Circle },
} as const;

function QuestionnaireCard({ item }: { item: Questionnaire }) {
  const { t } = useTranslation();
  const iconInfo = STATUS_ICON[item.status] ?? STATUS_ICON.pending;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/questionnaire/${item.id}`)}
      disabled={item.status === "expired"}
    >
      <iconInfo.Icon size={20} color={iconInfo.color} />
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.cardStatus}>
          {t(`questionnaire.status_${item.status}`)}
          {item.completed_at && (
            <Text style={styles.cardDate}>
              {" "}
              {new Date(item.completed_at).toLocaleDateString()}
            </Text>
          )}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function QuestionnairesScreen() {
  const { t } = useTranslation();
  const { data: questionnaires, isLoading, refetch } = useQuestionnaires();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={questionnaires}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <QuestionnaireCard item={item} />}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
        />
      }
      ListEmptyComponent={
        !isLoading ? (
          <Text style={styles.empty}>{t("questionnaire.empty")}</Text>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    ...typography.body,
    fontWeight: "600",
  },
  cardStatus: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
  cardDate: {
    color: colors.textMuted,
  },
  empty: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.xxl,
  },
});
