/**
 * Studies screen — the member's enrolled studies + discoverable active studies.
 * Studies are "clusters / areas of interest": each bundles scheduled
 * questionnaires + real health data into cohort metrics.
 */
import { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { Stack, router } from "expo-router";
import { FlaskConical, ChevronRight, Users } from "lucide-react-native";
import { useAuth, useActiveStudies, useMyStudyRegistrations, useTranslation } from "@/hooks";
import { colors, spacing, typography } from "@/theme";
import type { StudySummary, StudyRegistration } from "@/types/schemas";

function statusColor(status: string): string {
  if (["enrolled", "active"].includes(status)) return colors.success;
  if (["pending", "screening"].includes(status)) return colors.warning;
  if (status === "withdrawn") return colors.error;
  return colors.textMuted;
}

function RegistrationCard({ reg, statusText }: { reg: StudyRegistration; statusText: string }) {
  return (
    <TouchableOpacity
      testID={`study-reg-${reg.study_id}`}
      style={styles.card}
      onPress={() => router.push(`/study/${reg.study_id}`)}
    >
      <FlaskConical size={18} color={colors.primary} />
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={1}>{reg.study_name}</Text>
        <View style={[styles.badge, { backgroundColor: `${statusColor(reg.status)}22` }]}>
          <Text style={[styles.badgeText, { color: statusColor(reg.status) }]}>{statusText}</Text>
        </View>
      </View>
      <ChevronRight size={18} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

function StudyCard({ study }: { study: StudySummary }) {
  const target = study.target_registration ?? 0;
  const current = study.current_registration ?? 0;
  const pct = target > 0 ? Math.min(Math.round((current / target) * 100), 100) : 0;
  return (
    <TouchableOpacity
      testID={`study-card-${study.id}`}
      style={styles.card}
      onPress={() => router.push(`/study/${study.id}`)}
    >
      <FlaskConical size={18} color={colors.textSecondary} />
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={1}>{study.name}</Text>
        {study.target_condition ? (
          <Text style={styles.cardMeta} numberOfLines={1}>{study.target_condition}</Text>
        ) : null}
        {target > 0 && (
          <View style={styles.enrollRow}>
            <Users size={11} color={colors.textMuted} />
            <Text style={styles.cardMeta}>{current}/{target} ({pct}%)</Text>
          </View>
        )}
      </View>
      <ChevronRight size={18} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

export default function StudiesScreen() {
  const { t, locale } = useTranslation();
  const { user } = useAuth();
  const { data: studies, isLoading: studiesLoading, refetch: refetchStudies } = useActiveStudies(locale);
  const { data: registrations, refetch: refetchRegs } = useMyStudyRegistrations(user?.id);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchStudies(), refetchRegs()]);
    setRefreshing(false);
  }, [refetchStudies, refetchRegs]);

  const regs = registrations ?? [];
  const enrolledStudyIds = new Set(regs.map((r) => r.study_id));
  const discoverable = (studies ?? []).filter((s) => !enrolledStudyIds.has(s.id));

  return (
    <>
      <Stack.Screen options={{ title: t("studies.list_title") }} />
      <ScrollView
        testID="studies-screen"
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {regs.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("studies.my_studies")}</Text>
            {regs.map((r) => (
              <RegistrationCard
                key={r.id}
                reg={r}
                statusText={t(`studies.status.${r.status}`) !== `studies.status.${r.status}`
                  ? t(`studies.status.${r.status}`)
                  : r.status}
              />
            ))}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("studies.discover")}</Text>
          {studiesLoading ? (
            <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
          ) : discoverable.length === 0 ? (
            <Text style={styles.empty}>{t("studies.none_available")}</Text>
          ) : (
            discoverable.map((s) => <StudyCard key={s.id} study={s} />)
          )}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  section: { marginBottom: spacing.lg },
  sectionTitle: {
    ...typography.label,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.xs,
  },
  cardBody: { flex: 1, gap: 2 },
  cardTitle: { ...typography.body, color: colors.text, fontWeight: "600" },
  cardMeta: { ...typography.caption, color: colors.textMuted },
  enrollRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  badge: { alignSelf: "flex-start", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, marginTop: 2 },
  badgeText: { fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  empty: { ...typography.bodySmall, color: colors.textMuted, textAlign: "center", paddingVertical: spacing.lg },
});
