/**
 * Pocket Validator screen — interactive DoD checklist, compliance check,
 * effort estimation. The Dirigent's quick validation tool.
 */
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import {
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Gauge,
  Play,
  ShieldCheck,
} from "lucide-react-native";
import { useTranslation, useValidator } from "@/hooks";
import { colors, spacing, typography } from "@/theme";
import type { ChecklistItem } from "@/hooks/useValidator";

function CheckItem({ item }: { item: ChecklistItem }) {
  const iconColor =
    item.status === "pass"
      ? colors.success
      : item.status === "fail"
        ? colors.error
        : item.status === "running"
          ? colors.primary
          : colors.textMuted;

  return (
    <View style={styles.checkRow}>
      {item.status === "running" ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : item.status === "pass" ? (
        <CheckCircle2 size={20} color={iconColor} />
      ) : (
        <Circle size={20} color={iconColor} />
      )}
      <Text style={[styles.checkLabel, item.status === "fail" && styles.failText]}>
        {item.label}
      </Text>
    </View>
  );
}

export default function ValidatorScreen() {
  const { t } = useTranslation();
  const { checklist, compliance, effort, isRunning, onRefresh, refreshing, runValidation } =
    useValidator(null);

  const passCount = checklist.filter((c) => c.status === "pass").length;
  const totalCount = checklist.length;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
        />
      }
    >
      <Text style={styles.title}>{t("validator.title")}</Text>
      <Text style={styles.subtitle}>{t("validator.subtitle")}</Text>

      {/* Run Validation Button */}
      <TouchableOpacity
        style={[styles.runButton, isRunning && styles.runButtonDisabled]}
        onPress={runValidation}
        disabled={isRunning}
      >
        {isRunning ? (
          <ActivityIndicator size="small" color={colors.text} />
        ) : (
          <Play size={18} color={colors.text} />
        )}
        <Text style={styles.runButtonText}>
          {isRunning ? t("validator.running") : t("validator.run")}
        </Text>
      </TouchableOpacity>

      {/* Score Badge */}
      {compliance && (
        <View style={styles.scoreCard}>
          <ShieldCheck
            size={32}
            color={compliance.passed ? colors.success : colors.error}
          />
          <View>
            <Text style={styles.scoreValue}>
              {passCount}/{totalCount}
            </Text>
            <Text style={styles.scoreLabel}>
              {compliance.passed ? t("validator.passed") : t("validator.failed")}
            </Text>
          </View>
          {compliance.score > 0 && (
            <Text style={styles.scorePercent}>
              {Math.round(compliance.score)}%
            </Text>
          )}
        </View>
      )}

      {/* DoD Checklist */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <ClipboardCheck size={18} color={colors.primary} />
          <Text style={styles.sectionTitle}>{t("validator.dod_checklist")}</Text>
        </View>
        {checklist.map((item) => (
          <CheckItem key={item.key} item={item} />
        ))}
      </View>

      {/* Effort Estimation */}
      {effort && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Gauge size={18} color={colors.secondary} />
            <Text style={styles.sectionTitle}>{t("validator.effort")}</Text>
          </View>
          <View style={styles.effortGrid}>
            <View style={styles.effortItem}>
              <Text style={styles.effortValue}>{effort.complexity}</Text>
              <Text style={styles.effortLabel}>{t("validator.complexity")}</Text>
            </View>
            <View style={styles.effortItem}>
              <Text style={styles.effortValue}>
                {effort.hours_min}–{effort.hours_max}h
              </Text>
              <Text style={styles.effortLabel}>{t("validator.hours")}</Text>
            </View>
            <View style={styles.effortItem}>
              <Text style={styles.effortValue}>{effort.confidence}%</Text>
              <Text style={styles.effortLabel}>{t("validator.confidence")}</Text>
            </View>
          </View>
          {effort.notes && (
            <Text style={styles.effortNotes}>{effort.notes}</Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
  },
  title: {
    ...typography.h1,
    marginTop: spacing.sm,
  },
  subtitle: {
    ...typography.bodySmall,
    marginBottom: spacing.sm,
  },
  runButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  runButtonDisabled: {
    opacity: 0.6,
  },
  runButtonText: {
    ...typography.body,
    fontWeight: "600",
    color: colors.text,
  },
  scoreCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  scoreValue: {
    ...typography.h2,
  },
  scoreLabel: {
    ...typography.bodySmall,
  },
  scorePercent: {
    ...typography.h1,
    color: colors.primary,
    marginLeft: "auto",
  },
  section: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.sm,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    ...typography.h3,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  checkLabel: {
    ...typography.body,
    flex: 1,
  },
  failText: {
    color: colors.error,
  },
  effortGrid: {
    flexDirection: "row",
    gap: spacing.md,
  },
  effortItem: {
    flex: 1,
    alignItems: "center",
    backgroundColor: colors.surfaceLight,
    borderRadius: 8,
    padding: spacing.sm,
  },
  effortValue: {
    ...typography.h3,
    color: colors.primary,
  },
  effortLabel: {
    ...typography.caption,
  },
  effortNotes: {
    ...typography.bodySmall,
    fontStyle: "italic",
    marginTop: spacing.xs,
  },
});
