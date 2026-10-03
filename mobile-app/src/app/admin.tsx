/**
 * Admin / Operator — platform monitoring (API stats + AI agent metrics).
 * Role-gated: only surfaced for admin/staff (the underlying RPCs are
 * is_admin_or_staff-gated server-side too). Linked from Profile only when the
 * KC token carries an admin/staff role.
 *
 * Sentry issue drilldown is handled by the dedicated monitoring hooks through
 * the shared gateway function route table.
 */
import { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { Stack } from "expo-router";
import { Activity, Bot, AlertTriangle, Lock, Coins } from "lucide-react-native";
import { useAuth, useApiMetrics, useAgentStatuses, useTokenomicsOverview, useTranslation } from "@/hooks";
import { colors, spacing, typography } from "@/theme";

const ADMIN_ROLES = ["admin", "staff"];

function agentStatusColor(status: string): string {
  if (status === "running") return colors.success;
  if (status === "error") return colors.error;
  if (status === "disabled") return colors.textMuted;
  return colors.textSecondary;
}

function recordValue(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value === "number" || typeof value === "string") return String(value);
  return "—";
}

export default function AdminScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = (user?.roles ?? []).some((r) => ADMIN_ROLES.includes(r));

  const metrics = useApiMetrics(isAdmin ? user?.id : undefined);
  const agents = useAgentStatuses(isAdmin ? user?.id : undefined);
  const tokenomics = useTokenomicsOverview(isAdmin ? user?.id : undefined);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([metrics.refetch(), agents.refetch(), tokenomics.refetch()]);
    setRefreshing(false);
  }, [metrics, agents, tokenomics]);

  if (!isAdmin) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: t("admin.title") }} />
        <Lock size={32} color={colors.textMuted} />
        <Text style={styles.muted}>{t("admin.not_authorized")}</Text>
      </View>
    );
  }

  const m = metrics.data;

  return (
    <>
      <Stack.Screen options={{ title: t("admin.title") }} />
      <ScrollView
        testID="admin-screen"
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {/* API stats */}
        <Text style={styles.sectionTitle}>{t("admin.api_stats")}</Text>
        {metrics.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
        ) : m ? (
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{m.total_requests_24h}</Text>
              <Text style={styles.statLabel}>{t("admin.requests_24h")}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: m.error_rate_24h > 5 ? colors.error : colors.success }]}>
                {m.error_rate_24h.toFixed(1)}%
              </Text>
              <Text style={styles.statLabel}>{t("admin.error_rate")}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{Math.round(m.avg_response_ms)}ms</Text>
              <Text style={styles.statLabel}>{t("admin.avg_response")}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{m.active_users_24h}</Text>
              <Text style={styles.statLabel}>{t("admin.active_users")}</Text>
            </View>
          </View>
        ) : (
          <Text style={styles.muted}>{t("admin.no_data")}</Text>
        )}

        {/* Top endpoints */}
        {m && m.top_endpoints.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>{t("admin.top_endpoints")}</Text>
            <View style={styles.card}>
              {m.top_endpoints.slice(0, 8).map((e) => (
                <View key={e.name} style={styles.epRow}>
                  <Text style={styles.epName} numberOfLines={1}>{e.name}</Text>
                  <Text style={styles.epMeta}>{e.count} · {Math.round(e.avg_ms)}ms</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* AI agent metrics */}
        <Text style={styles.sectionTitle}>{t("admin.agents")}</Text>
        {agents.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
        ) : (agents.data ?? []).length === 0 ? (
          <Text style={styles.muted}>{t("admin.no_agents")}</Text>
        ) : (
          (agents.data ?? []).map((a) => (
            <View key={a.slug} style={styles.agentRow}>
              {a.status === "error" ? (
                <AlertTriangle size={16} color={colors.error} />
              ) : (
                <Bot size={16} color={agentStatusColor(a.status)} />
              )}
              <View style={styles.agentBody}>
                <Text style={styles.agentName}>{a.name}</Text>
                <Text style={styles.agentMeta}>
                  {a.model ?? "—"} · {a.total_runs_24h} {t("admin.runs")}
                </Text>
              </View>
              <Text style={[styles.agentStatus, { color: agentStatusColor(a.status) }]}>{a.status}</Text>
            </View>
          ))
        )}

        <Text style={styles.sectionTitle}>{t("admin.tokenomics")}</Text>
        {tokenomics.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
        ) : tokenomics.data ? (
          <View style={styles.card}>
            <View style={styles.epRow}>
              <View style={styles.metricHead}>
                <Coins size={14} color={colors.warning} />
                <Text style={styles.epName}>{t("admin.token_configs")}</Text>
              </View>
              <Text style={styles.epMeta}>{tokenomics.data.token_configs.length}</Text>
            </View>
            <View style={styles.epRow}>
              <Text style={styles.epName}>{t("admin.transaction_summary")}</Text>
              <Text style={styles.epMeta}>{tokenomics.data.transaction_summary.length}</Text>
            </View>
            {tokenomics.data.transaction_summary.slice(0, 5).map((row, index) => (
              <View key={index} style={styles.epRow}>
                <Text style={styles.epName} numberOfLines={1}>
                  {recordValue(row, "token_type")} · {recordValue(row, "transaction_type")}
                </Text>
                <Text style={styles.epMeta}>{recordValue(row, "amount")}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.muted}>{t("admin.no_data")}</Text>
        )}

        <View style={styles.footer}>
          <Activity size={12} color={colors.textMuted} />
          <Text style={styles.footerText}>{t("admin.footer_note")}</Text>
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background, gap: spacing.sm },
  muted: { ...typography.bodySmall, color: colors.textMuted, textAlign: "center", paddingVertical: spacing.sm },
  sectionTitle: { ...typography.label, textTransform: "uppercase", letterSpacing: 1, marginTop: spacing.lg, marginBottom: spacing.sm },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  statCard: { flex: 1, minWidth: "45%", backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, alignItems: "center" },
  statValue: { ...typography.h2, color: colors.text },
  statLabel: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.sm },
  epRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, gap: spacing.sm },
  metricHead: { flexDirection: "row", alignItems: "center", gap: 4, flex: 1 },
  epName: { ...typography.caption, color: colors.text, flex: 1 },
  epMeta: { ...typography.caption, color: colors.textMuted },
  agentRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: 10, padding: spacing.md, marginBottom: spacing.xs,
  },
  agentBody: { flex: 1 },
  agentName: { ...typography.bodySmall, color: colors.text, fontWeight: "600" },
  agentMeta: { ...typography.caption, color: colors.textMuted },
  agentStatus: { ...typography.caption, fontWeight: "700", textTransform: "uppercase" },
  footer: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.lg, justifyContent: "center" },
  footerText: { ...typography.caption, color: colors.textMuted, fontStyle: "italic" },
});
