/**
 * "Můj styl s Aishou" — the user's own naturel profile (the ONLY surface that
 * renders it; everywhere else consumes just the DialogPolicy — E4/E5).
 * Explicit override is class A and always wins (S19/E3); learning can be
 * locked; "vypnout a smazat" (E7) removes the stored style entirely.
 */
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "@/hooks";
import { colors, spacing, typography } from "@/theme";
import { policyToWordKeys } from "@/naturel/policy";
import { useNaturel } from "@/naturel/NaturelProvider";
import type { ArchetypeKey } from "@/naturel/policy";

const AXES: Array<{ key: "initiative" | "choice" | "grain" | "closure" | "register"; nameKey: string; loKey: string; hiKey: string }> = [
  { key: "initiative", nameKey: "naturel.axes.initiative.name", loKey: "naturel.axes.initiative.lo", hiKey: "naturel.axes.initiative.hi" },
  { key: "choice", nameKey: "naturel.axes.choice.name", loKey: "naturel.axes.choice.lo", hiKey: "naturel.axes.choice.hi" },
  { key: "grain", nameKey: "naturel.axes.grain.name", loKey: "naturel.axes.grain.lo", hiKey: "naturel.axes.grain.hi" },
  { key: "closure", nameKey: "naturel.axes.closure.name", loKey: "naturel.axes.closure.lo", hiKey: "naturel.axes.closure.hi" },
  { key: "register", nameKey: "naturel.axes.register.name", loKey: "naturel.axes.register.lo", hiKey: "naturel.axes.register.hi" },
];

export default function NaturelStyleScreen() {
  const { t } = useTranslation();
  const { profile, policy, overrideChoiceAxis, overridePrefs, setLocked, reset } = useNaturel();

  if (!profile) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.overline}>{t("naturel.style.title")}</Text>
        <Text style={styles.question}>{t("naturel.style.emptyTitle")}</Text>
        <Text style={styles.footnote}>{t("naturel.style.emptyHint")}</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push("/naturel-calibration")}>
          <Text style={styles.primaryBtnText}>{t("naturel.style.startCalibration")}</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  const mix = Object.entries(profile.archetype?.mix ?? {}) as Array<[ArchetypeKey, number]>;
  const locked = profile.override?.locked ?? false;

  const confirmReset = () => {
    Alert.alert(t("naturel.style.resetTitle"), t("naturel.style.resetBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("naturel.style.resetConfirm"), style: "destructive", onPress: () => void reset() },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.overline}>
        {t("naturel.style.title")}
        {profile.archetype?.primary ? ` · ${t(`naturel.arch.${profile.archetype.primary}`)}` : ""}
        {profile.archetype?.secondary ? ` / ${t(`naturel.arch.${profile.archetype.secondary}`)}` : ""}
      </Text>

      {mix
        .sort((a, b) => b[1] - a[1])
        .map(([key, share]) => (
          <View key={key} style={styles.meterRow}>
            <Text style={styles.meterLabel}>{t(`naturel.arch.${key}`)}</Text>
            <View style={styles.meterTrack}>
              <View style={[styles.meterFill, { width: `${Math.round(share * 100)}%` }]} />
            </View>
            <Text style={styles.meterValue}>{Math.round(share * 100)} %</Text>
          </View>
        ))}

      <View style={styles.section}>
        {AXES.map((axis) => {
          const a = profile.axes?.[axis.key];
          if (!a) return null;
          return (
            <View key={axis.key} style={styles.axisBlock}>
              <Text style={styles.axisName}>
                {t(axis.nameKey)} · {t("naturel.style.confidence", { pct: Math.round((a.c ?? 0) * 100) })}
              </Text>
              <View style={styles.axisBand}>
                <View style={styles.axisLine} />
                <View style={styles.axisMid} />
                <View style={[styles.axisDot, { left: `${Math.round(50 + (a.v || 0) * 50)}%` }]} />
              </View>
              <View style={styles.axisPoles}>
                <Text style={styles.axisPole}>{t(axis.loKey)}</Text>
                <Text style={styles.axisPole}>{t(axis.hiKey)}</Text>
              </View>
            </View>
          );
        })}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("naturel.style.howNow")}</Text>
        {policyToWordKeys(policy).map((w) => (
          <Text key={w.key} style={styles.word}>
            → {t(w.key, w.params)}
          </Text>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("naturel.style.switchChoice")}</Text>
        <View style={styles.row}>
          <TouchableOpacity style={styles.chipBtn} onPress={() => void overrideChoiceAxis(-0.6)} testID="naturel-ovr-variants">
            <Text style={styles.chipText}>{t("naturel.style.variants")}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.chipBtn} onPress={() => void overrideChoiceAxis(0.1)}>
            <Text style={styles.chipText}>{t("naturel.style.recommendation")}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.chipBtn} onPress={() => void overrideChoiceAxis(0.7)}>
            <Text style={styles.chipText}>{t("naturel.style.steps")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.chipBtn}
            onPress={() => void overridePrefs({ cadence: profile.prefs?.cadence === "digest" ? "live" : "digest" })}
          >
            <Text style={styles.chipText}>
              {profile.prefs?.cadence === "digest" ? t("naturel.style.live") : t("naturel.style.digest")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.row}>
        <TouchableOpacity style={styles.ghostBtn} onPress={() => void setLocked(!locked)}>
          <Text style={styles.ghostBtnText}>{locked ? t("naturel.style.unlock") : t("naturel.style.lock")}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ghostBtn} onPress={() => router.push("/naturel-calibration")}>
          <Text style={styles.ghostBtnText}>{t("naturel.style.recalibrate")}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ghostBtn} onPress={confirmReset} testID="naturel-reset">
          <Text style={styles.ghostBtnText}>{t("naturel.style.reset")}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.footnote}>{t("naturel.style.privacy")}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg },
  overline: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: spacing.md,
  },
  question: { fontSize: typography.h3.fontSize, fontWeight: "700", color: colors.text, marginBottom: spacing.md },
  meterRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  meterLabel: { width: 110, color: colors.text, fontSize: 13.5, fontWeight: "600" },
  meterTrack: { flex: 1, height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: "hidden" },
  meterFill: { height: "100%", backgroundColor: colors.primary },
  meterValue: { width: 44, textAlign: "right", color: colors.textMuted, fontSize: 12, fontVariant: ["tabular-nums"] },
  section: { marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  sectionTitle: { color: colors.text, fontSize: 14, fontWeight: "700", marginBottom: spacing.sm },
  axisBlock: { marginBottom: spacing.md },
  axisName: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  axisBand: { height: 20, position: "relative" },
  axisLine: { position: "absolute", left: 0, right: 0, top: 9, height: 3, backgroundColor: colors.border, borderRadius: 2 },
  axisMid: { position: "absolute", left: "50%", top: 5, width: 2, height: 11, backgroundColor: colors.border },
  axisDot: { position: "absolute", top: 3, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary, marginLeft: -6 },
  axisPoles: { flexDirection: "row", justifyContent: "space-between" },
  axisPole: { color: colors.textMuted, fontSize: 11.5 },
  word: {
    color: colors.text,
    fontSize: 14,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  chipBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  chipText: { color: colors.text, fontSize: 13.5 },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    padding: spacing.md,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  primaryBtnText: { color: colors.background, fontWeight: "700", fontSize: 15 },
  ghostBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  ghostBtnText: { color: colors.textSecondary, fontSize: 13.5 },
  footnote: { color: colors.textMuted, fontSize: 12.5, marginTop: spacing.lg },
});
