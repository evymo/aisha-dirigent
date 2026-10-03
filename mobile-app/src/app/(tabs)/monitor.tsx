/**
 * Profile screen — token balance, membership, profile completeness, links.
 */
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from "react-native";
import { router } from "expo-router";
import {
  User,
  Coins,
  Crown,
  BarChart3,
  Trophy,
  Bell,
  Settings,
  LogOut,
  HeartPulse,
  ShieldCheck,
  Gauge,
  ClipboardList,
} from "lucide-react-native";
import { useAuth, useMembership, useProfileCompleteness, useUnreadNotificationCount, useTranslation } from "@/hooks";
import { colors, spacing, typography } from "@/theme";
import { useState } from "react";

const TOKEN_TYPES = [
  { key: "tokens_aisha", label: "AISHA", color: colors.primary },
  { key: "tokens_governance", label: "Governance", color: "#8B5CF6" },
  { key: "tokens_impact", label: "Impact", color: "#10B981" },
  { key: "tokens_data", label: "Data", color: "#F59E0B" },
] as const;

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const { data: membership, refetch: refetchMembership } = useMembership(user?.id);
  const { data: completeness, refetch: refetchCompleteness } = useProfileCompleteness(user?.id);
  const { data: unreadCount } = useUnreadNotificationCount(user?.id);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchMembership(), refetchCompleteness()]);
    setRefreshing(false);
  };

  const isAdmin = (user?.roles ?? []).some((r) => ["admin", "staff"].includes(r));
  const displayName = user?.fullName ?? user?.email ?? "Member";
  const percent = completeness
    ? Math.round(
        [completeness.has_display_name, completeness.has_umbrella_registration, completeness.is_complete]
          .filter(Boolean).length / 3 * 100
      )
    : 0;

  return (
    <ScrollView
      testID="profile-screen"
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
    >
      {/* Avatar + name */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <User size={32} color={colors.primary} />
        </View>
        <Text style={styles.name}>{displayName}</Text>
        {membership?.subscription_tier && (
          <View style={styles.tierBadge}>
            <Crown size={14} color="#F59E0B" />
            <Text style={styles.tierText}>{membership.subscription_tier}</Text>
          </View>
        )}
      </View>

      {/* Token balance strip */}
      <View style={styles.tokenRow}>
        {TOKEN_TYPES.map(({ key, label, color }) => (
          <View key={key} style={styles.tokenCard}>
            <Coins size={16} color={color} />
            <Text style={[styles.tokenValue, { color }]}>
              {membership?.[key] ?? 0}
            </Text>
            <Text style={styles.tokenLabel}>{label}</Text>
          </View>
        ))}
      </View>

      {/* Profile completeness */}
      <View style={styles.completenessCard}>
        <View style={styles.completenessHeader}>
          <BarChart3 size={16} color={colors.primary} />
          <Text style={styles.completenessTitle}>{t("profile.completeness")}</Text>
          <Text style={styles.completenessPercent}>{percent}%</Text>
        </View>
        <View style={styles.progressBarBg}>
          <View style={[styles.progressBarFill, { width: `${Math.min(percent, 100)}%` }]} />
        </View>
      </View>

      {/* Links */}
      <View style={styles.links}>
        <TouchableOpacity
          testID="profile-link-health"
          style={styles.linkRow}
          onPress={() => router.push("/health")}
        >
          <HeartPulse size={18} color={colors.error} />
          <Text style={styles.linkLabel}>{t("profile.health")}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="profile-link-privacy"
          style={styles.linkRow}
          onPress={() => router.push("/privacy")}
        >
          <ShieldCheck size={18} color={colors.primary} />
          <Text style={styles.linkLabel}>{t("profile.privacy")}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="profile-link-operations"
          style={styles.linkRow}
          onPress={() => router.push("/operations")}
        >
          <ClipboardList size={18} color={colors.success} />
          <Text style={styles.linkLabel}>{t("profile.operations")}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="profile-link-leaderboard"
          style={styles.linkRow}
          onPress={() => router.push("/leaderboard")}
        >
          <Trophy size={18} color={colors.primary} />
          <Text style={styles.linkLabel}>{t("profile.leaderboard")}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="profile-link-notifications"
          style={styles.linkRow}
          onPress={() => router.push("/notifications")}
        >
          <Bell size={18} color={colors.primary} />
          <Text style={styles.linkLabel}>{t("profile.notifications")}</Text>
          {(unreadCount ?? 0) > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unreadCount}</Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          testID="profile-link-settings"
          style={styles.linkRow}
          onPress={() => router.push("/settings")}
        >
          <Settings size={18} color={colors.textSecondary} />
          <Text style={styles.linkLabel}>{t("profile.settings")}</Text>
        </TouchableOpacity>

        {isAdmin && (
          <TouchableOpacity
            testID="profile-link-admin"
            style={styles.linkRow}
            onPress={() => router.push("/admin")}
          >
            <Gauge size={18} color={colors.warning} />
            <Text style={styles.linkLabel}>{t("profile.admin")}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Logout */}
      <TouchableOpacity
        testID="profile-logout-btn"
        style={styles.logoutButton}
        onPress={signOut}
      >
        <LogOut size={18} color={colors.error} />
        <Text style={styles.logoutLabel}>{t("profile.logout")}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  // Header
  header: { alignItems: "center", marginBottom: spacing.lg },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  name: { ...typography.h2 },
  tierBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: spacing.xs,
    backgroundColor: `${colors.warning}20`,
    borderRadius: 12,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  tierText: { fontSize: 12, fontWeight: "600", color: "#F59E0B" },
  // Token row
  tokenRow: { flexDirection: "row", gap: spacing.xs, marginBottom: spacing.lg },
  tokenCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.sm,
    alignItems: "center",
    gap: 2,
  },
  tokenValue: { ...typography.body, fontWeight: "700", fontSize: 16 },
  tokenLabel: { ...typography.caption, fontSize: 10 },
  // Completeness
  completenessCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  completenessHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  completenessTitle: { ...typography.bodySmall, fontWeight: "600", flex: 1, color: colors.text },
  completenessPercent: { ...typography.body, fontWeight: "700", color: colors.primary },
  progressBarBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  progressBarFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  // Links
  links: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: spacing.lg,
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  linkLabel: { ...typography.body, flex: 1, color: colors.text },
  badge: {
    backgroundColor: colors.error,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  badgeText: { fontSize: 11, fontWeight: "700", color: "#fff" },
  // Logout
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.error,
  },
  logoutLabel: { ...typography.body, fontWeight: "600", color: colors.error },
});
