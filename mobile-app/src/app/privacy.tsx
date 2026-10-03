/**
 * Privacy & Compliance — the member's consents, data-sharing grants,
 * compliance summary and registered devices. Read-only overview (GDPR-friendly).
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
import { ShieldCheck, Users, Smartphone, CheckCircle, XCircle } from "lucide-react-native";
import { useAuth, useTranslation } from "@/hooks";
import {
  useMyConsents,
  useMyDataSharingConsents,
  useMyComplianceSummary,
  useMyMobileSessions,
} from "@/hooks/usePrivacy";
import { colors, spacing, typography } from "@/theme";

export default function PrivacyScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const compliance = useMyComplianceSummary(user?.id);
  const consents = useMyConsents(user?.id);
  const sharing = useMyDataSharingConsents(user?.id);
  const sessions = useMyMobileSessions(user?.id);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([compliance.refetch(), consents.refetch(), sharing.refetch(), sessions.refetch()]);
    setRefreshing(false);
  }, [compliance, consents, sharing, sessions]);

  const c = compliance.data;
  const loading = compliance.isLoading && consents.isLoading;

  return (
    <>
      <Stack.Screen options={{ title: t("privacy.title") }} />
      <ScrollView
        testID="privacy-screen"
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
        ) : null}

        {/* Compliance summary */}
        {c ? (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <ShieldCheck size={18} color={colors.primary} />
              <Text style={styles.cardTitle}>{t("privacy.compliance")}</Text>
              {c.is_eligible_for_discount ? (
                <View style={styles.discountBadge}>
                  <Text style={styles.discountText}>{t("privacy.discount_eligible")}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{Math.round(c.compliance_score)}%</Text>
                <Text style={styles.statLabel}>{t("privacy.score")}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{c.total_completed}/{c.total_required}</Text>
                <Text style={styles.statLabel}>{t("privacy.completed")}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{c.current_streak}</Text>
                <Text style={styles.statLabel}>{t("privacy.streak")}</Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* Consents */}
        <Text style={styles.sectionTitle}>{t("privacy.consents")}</Text>
        {(consents.data ?? []).length === 0 ? (
          <Text style={styles.empty}>{t("privacy.no_consents")}</Text>
        ) : (
          (consents.data ?? []).map((cn) => {
            const active = cn.granted && !cn.revoked_at;
            return (
              <View key={cn.id} style={styles.row}>
                {active ? <CheckCircle size={16} color={colors.success} /> : <XCircle size={16} color={colors.textMuted} />}
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{cn.consent_type.replace(/_/g, " ")}</Text>
                  {cn.version ? <Text style={styles.rowMeta}>v{cn.version}</Text> : null}
                </View>
                <Text style={[styles.rowState, { color: active ? colors.success : colors.textMuted }]}>
                  {active ? t("privacy.granted") : t("privacy.revoked")}
                </Text>
              </View>
            );
          })
        )}

        {/* Data sharing */}
        <Text style={styles.sectionTitle}>{t("privacy.data_sharing")}</Text>
        {(sharing.data ?? []).length === 0 ? (
          <Text style={styles.empty}>{t("privacy.no_sharing")}</Text>
        ) : (
          (sharing.data ?? []).map((s) => {
            const active = !!s.granted_at && !s.revoked_at;
            return (
              <View key={s.id} style={styles.row}>
                <Users size={16} color={active ? colors.primary : colors.textMuted} />
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{s.partner_name ?? t("privacy.partner")}</Text>
                  {s.expires_at ? (
                    <Text style={styles.rowMeta}>{t("privacy.expires")}: {new Date(s.expires_at).toLocaleDateString()}</Text>
                  ) : null}
                </View>
                <Text style={[styles.rowState, { color: active ? colors.primary : colors.textMuted }]}>
                  {active ? t("privacy.granted") : t("privacy.revoked")}
                </Text>
              </View>
            );
          })
        )}

        {/* Devices / sessions */}
        <Text style={styles.sectionTitle}>{t("privacy.devices")}</Text>
        {(sessions.data ?? []).length === 0 ? (
          <Text style={styles.empty}>{t("privacy.no_devices")}</Text>
        ) : (
          (sessions.data ?? []).map((s) => (
            <View key={s.id} style={styles.row}>
              <Smartphone size={16} color={colors.textSecondary} />
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{s.device_model ?? s.device_platform ?? t("privacy.device")}</Text>
                <Text style={styles.rowMeta}>
                  {s.app_version ? `v${s.app_version}` : ""}
                  {s.last_active_at ? ` · ${new Date(s.last_active_at).toLocaleDateString()}` : ""}
                </Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, marginBottom: spacing.md },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
  cardTitle: { ...typography.label, textTransform: "uppercase", letterSpacing: 1, flex: 1 },
  discountBadge: { backgroundColor: `${colors.success}22`, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  discountText: { color: colors.success, fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  statsRow: { flexDirection: "row", justifyContent: "space-around" },
  stat: { alignItems: "center" },
  statValue: { ...typography.h2, color: colors.text },
  statLabel: { ...typography.caption, color: colors.textMuted },
  sectionTitle: { ...typography.label, textTransform: "uppercase", letterSpacing: 1, marginTop: spacing.lg, marginBottom: spacing.sm },
  empty: { ...typography.bodySmall, color: colors.textMuted, paddingVertical: spacing.sm },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: 10, padding: spacing.md, marginBottom: spacing.xs,
  },
  rowBody: { flex: 1 },
  rowTitle: { ...typography.bodySmall, color: colors.text, fontWeight: "600", textTransform: "capitalize" },
  rowMeta: { ...typography.caption, color: colors.textMuted },
  rowState: { ...typography.caption, fontWeight: "700", textTransform: "uppercase" },
});
