/**
 * Health screen — check-in trends + history + log a new check-in.
 *
 * Surfaces the existing health RPCs: check-ins, trends, labs, dosing logs,
 * and ongoing symptoms. Charts use victory-native with its Skia peer.
 */
import { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Stack } from "expo-router";
import { CartesianChart, Line } from "victory-native";
import { Activity, HeartPulse, Moon, Smile, TestTube2, Pill, AlertCircle, Footprints } from "lucide-react-native";
import { useAuth, useTranslation } from "@/hooks";
import { useTrackingCheckIns, useCreateTrackingCheckIn } from "@/hooks/useTrackingCheckIns";
import {
  useHealthTrends,
  useMyDosingLogs,
  useMyLabResults,
  useMyOngoingSymptoms,
} from "@/hooks/useHealthDepth";
import { colors, spacing, typography } from "@/theme";
import type { DosingLog, LabResult, OngoingSymptom, TrackingCheckIn } from "@/types/schemas";

type MetricKey = "pain_level" | "energy_level" | "mood_level" | "sleep_quality";

const METRICS: { key: MetricKey; labelKey: string; color: string; Icon: typeof Activity }[] = [
  { key: "pain_level", labelKey: "health.pain", color: colors.error, Icon: HeartPulse },
  { key: "energy_level", labelKey: "health.energy", color: colors.success, Icon: Activity },
  { key: "mood_level", labelKey: "health.mood", color: colors.primary, Icon: Smile },
  { key: "sleep_quality", labelKey: "health.sleep", color: "#8B5CF6", Icon: Moon },
];

type ChartDatum = Record<MetricKey, number> & { index: number };

/** A 0–10 trend row rendered as plain bars (height ∝ value). */
function TrendRow({
  label,
  color,
  Icon,
  values,
}: {
  label: string;
  color: string;
  Icon: typeof Activity;
  values: (number | null)[];
}) {
  const latest = [...values].reverse().find((v) => v != null) ?? null;
  return (
    <View style={styles.trendRow}>
      <View style={styles.trendHead}>
        <Icon size={14} color={color} />
        <Text style={styles.trendLabel}>{label}</Text>
        <Text style={[styles.trendLatest, { color }]}>{latest != null ? latest : "–"}</Text>
      </View>
      <View style={styles.bars}>
        {values.map((v, i) => (
          <View key={i} style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                { backgroundColor: color, height: `${v != null ? Math.max((v / 10) * 100, 4) : 0}%` },
              ]}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

function CheckInChart({ data }: { data: ChartDatum[] }) {
  if (data.length < 2) return null;
  return (
    <View style={styles.chartCard} testID="health-victory-chart">
      <CartesianChart data={data} xKey="index" yKeys={["pain_level", "energy_level", "mood_level", "sleep_quality"]}>
        {({ points }) => (
          <>
            {METRICS.map((m) => (
              <Line key={m.key} points={points[m.key]} color={m.color} strokeWidth={2} />
            ))}
          </>
        )}
      </CartesianChart>
    </View>
  );
}

function Scale({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number) => void;
}) {
  return (
    <View style={styles.scaleBlock}>
      <Text style={styles.scaleLabel}>{label}</Text>
      <View style={styles.scaleRow}>
        {Array.from({ length: 11 }, (_, n) => (
          <TouchableOpacity
            key={n}
            style={[styles.scaleChip, value === n && styles.scaleChipActive]}
            onPress={() => onChange(n)}
          >
            <Text style={[styles.scaleChipText, value === n && styles.scaleChipTextActive]}>{n}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function HistoryRow({ checkIn }: { checkIn: TrackingCheckIn }) {
  const parts = [
    checkIn.pain_level != null ? `P${checkIn.pain_level}` : null,
    checkIn.energy_level != null ? `E${checkIn.energy_level}` : null,
    checkIn.mood_level != null ? `M${checkIn.mood_level}` : null,
    checkIn.sleep_quality != null ? `S${checkIn.sleep_quality}` : null,
  ].filter(Boolean);
  return (
    <View style={styles.histRow}>
      <Text style={styles.histDate}>{new Date(checkIn.created_at).toLocaleDateString()}</Text>
      <Text style={styles.histMeta}>{parts.join("  ·  ") || checkIn.check_in_type}</Text>
    </View>
  );
}

function LabRow({ lab }: { lab: LabResult }) {
  const markers = [
    lab.crp != null ? `CRP ${lab.crp}` : null,
    lab.glucose != null ? `Glu ${lab.glucose}` : null,
    lab.vitamin_d != null ? `D ${lab.vitamin_d}` : null,
  ].filter(Boolean);
  return (
    <View style={styles.dataRow}>
      <TestTube2 size={16} color={colors.primary} />
      <View style={styles.dataBody}>
        <Text style={styles.dataTitle}>{lab.lab_name ?? lab.status ?? "Lab result"}</Text>
        <Text style={styles.dataMeta}>{lab.test_date ? new Date(lab.test_date).toLocaleDateString() : markers.join("  ·  ")}</Text>
      </View>
      {markers.length > 0 ? <Text style={styles.dataSide} numberOfLines={1}>{markers.join("  ·  ")}</Text> : null}
    </View>
  );
}

function DosingRow({ log }: { log: DosingLog }) {
  const dose = [log.dose_count, log.dose_amount, log.dose_unit].filter((v) => v != null && v !== "").join(" ");
  return (
    <View style={styles.dataRow}>
      <Pill size={16} color={colors.success} />
      <View style={styles.dataBody}>
        <Text style={styles.dataTitle}>{dose || "Dose"}</Text>
        <Text style={styles.dataMeta}>{new Date(log.logged_at).toLocaleString()}</Text>
      </View>
      {log.taken_with_food != null ? (
        <Text style={styles.dataSide}>{log.taken_with_food ? "food" : "fasted"}</Text>
      ) : null}
    </View>
  );
}

function SymptomRow({ symptom }: { symptom: OngoingSymptom }) {
  return (
    <View style={styles.dataRow}>
      <AlertCircle size={16} color={colors.warning} />
      <View style={styles.dataBody}>
        <Text style={styles.dataTitle}>{symptom.state_name ?? symptom.state_name_key ?? "Symptom"}</Text>
        <Text style={styles.dataMeta}>
          {symptom.duration_hours != null ? `${Math.round(symptom.duration_hours)}h` : ""}
          {symptom.started_at ? ` · ${new Date(symptom.started_at).toLocaleDateString()}` : ""}
        </Text>
      </View>
      {symptom.severity != null ? <Text style={styles.dataSide}>{symptom.severity}/10</Text> : null}
    </View>
  );
}

export default function HealthScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: checkIns, isLoading, refetch } = useTrackingCheckIns(user?.id, 14);
  const healthTrends = useHealthTrends(user?.id, "steps", "daily", 30);
  const labs = useMyLabResults(user?.id, 5);
  const dosing = useMyDosingLogs(user?.id, 5);
  const symptoms = useMyOngoingSymptoms(user?.id, 5);
  const create = useCreateTrackingCheckIn();

  const [refreshing, setRefreshing] = useState(false);
  const [pain, setPain] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [mood, setMood] = useState<number | null>(null);
  const [sleep, setSleep] = useState<number | null>(null);
  const [notes, setNotes] = useState("");

  const list = checkIns ?? [];
  const chrono = [...list].reverse(); // oldest → newest for the trend
  const chartData: ChartDatum[] = chrono.map((c, index) => ({
    index,
    pain_level: c.pain_level ?? 0,
    energy_level: c.energy_level ?? 0,
    mood_level: c.mood_level ?? 0,
    sleep_quality: c.sleep_quality ?? 0,
  }));
  const latestSteps = [...(healthTrends.data?.trends ?? [])].reverse().find((row) => row.avg_value != null);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetch(), healthTrends.refetch(), labs.refetch(), dosing.refetch(), symptoms.refetch()]);
    setRefreshing(false);
  }, [refetch, healthTrends, labs, dosing, symptoms]);

  const canSubmit = pain != null || energy != null || mood != null || sleep != null;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    create.mutate(
      { pain_level: pain, energy_level: energy, mood_level: mood, sleep_quality: sleep, notes: notes.trim() || null },
      {
        onSuccess: () => {
          setPain(null); setEnergy(null); setMood(null); setSleep(null); setNotes("");
          Alert.alert(t("health.logged"), t("health.logged_desc"));
        },
        onError: (e: unknown) => Alert.alert(t("errors.title"), e instanceof Error ? e.message : String(e)),
      },
    );
  }, [canSubmit, create, pain, energy, mood, sleep, notes, t]);

  return (
    <>
      <Stack.Screen options={{ title: t("health.title") }} />
      <ScrollView
        testID="health-screen"
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {/* Trends */}
        <Text style={styles.sectionTitle}>{t("health.trends")}</Text>
        {isLoading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginVertical: spacing.lg }} />
        ) : chrono.length === 0 ? (
          <Text style={styles.empty}>{t("health.no_data")}</Text>
        ) : (
          <View style={styles.trendCard}>
            <CheckInChart data={chartData} />
            {METRICS.map((m) => (
              <TrendRow
                key={m.key}
                label={t(m.labelKey)}
                color={m.color}
                Icon={m.Icon}
                values={chrono.map((c) => c[m.key])}
              />
            ))}
            {latestSteps ? (
              <View style={styles.stepsRow}>
                <Footprints size={14} color={colors.textSecondary} />
                <Text style={styles.stepsText}>{t("health.steps_30d")}</Text>
                <Text style={styles.stepsValue}>{Math.round(latestSteps.avg_value ?? 0)}</Text>
              </View>
            ) : null}
          </View>
        )}

        {/* Log a check-in */}
        <Text style={styles.sectionTitle}>{t("health.log")}</Text>
        <View style={styles.formCard}>
          <Scale label={t("health.pain")} value={pain} onChange={setPain} />
          <Scale label={t("health.energy")} value={energy} onChange={setEnergy} />
          <Scale label={t("health.mood")} value={mood} onChange={setMood} />
          <Scale label={t("health.sleep")} value={sleep} onChange={setSleep} />
          <TextInput
            style={styles.notes}
            value={notes}
            onChangeText={setNotes}
            placeholder={t("health.notes_placeholder")}
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            testID="health-submit-btn"
            style={[styles.submit, (!canSubmit || create.isPending) && styles.submitDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit || create.isPending}
          >
            {create.isPending ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Text style={styles.submitText}>{t("health.submit")}</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* History */}
        {list.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>{t("health.history")}</Text>
            <View style={styles.histCard}>
              {list.map((c) => <HistoryRow key={c.id} checkIn={c} />)}
            </View>
          </>
        )}

        <Text style={styles.sectionTitle}>{t("health.labs")}</Text>
        {(labs.data ?? []).length === 0 ? (
          <Text style={styles.empty}>{t("health.no_labs")}</Text>
        ) : (
          <View style={styles.histCard}>{(labs.data ?? []).map((lab) => <LabRow key={lab.id} lab={lab} />)}</View>
        )}

        <Text style={styles.sectionTitle}>{t("health.dosing")}</Text>
        {(dosing.data ?? []).length === 0 ? (
          <Text style={styles.empty}>{t("health.no_dosing")}</Text>
        ) : (
          <View style={styles.histCard}>{(dosing.data ?? []).map((log) => <DosingRow key={log.id} log={log} />)}</View>
        )}

        <Text style={styles.sectionTitle}>{t("health.symptoms")}</Text>
        {(symptoms.data ?? []).length === 0 ? (
          <Text style={styles.empty}>{t("health.no_symptoms")}</Text>
        ) : (
          <View style={styles.histCard}>{(symptoms.data ?? []).map((symptom) => <SymptomRow key={symptom.id} symptom={symptom} />)}</View>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  sectionTitle: {
    ...typography.label, textTransform: "uppercase", letterSpacing: 1,
    marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  empty: { ...typography.bodySmall, color: colors.textMuted, textAlign: "center", paddingVertical: spacing.md },

  trendCard: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, gap: spacing.md },
  chartCard: { height: 180, marginBottom: spacing.xs },
  trendRow: { gap: 4 },
  trendHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  trendLabel: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  trendLatest: { ...typography.bodySmall, fontWeight: "700" },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: 40 },
  barTrack: { flex: 1, height: "100%", justifyContent: "flex-end", backgroundColor: colors.border, borderRadius: 2, overflow: "hidden" },
  barFill: { width: "100%", borderRadius: 2 },
  stepsRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.sm,
  },
  stepsText: { ...typography.caption, color: colors.textMuted, flex: 1 },
  stepsValue: { ...typography.bodySmall, color: colors.text, fontWeight: "700" },

  formCard: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, gap: spacing.sm },
  scaleBlock: { gap: 4 },
  scaleLabel: { ...typography.caption, color: colors.textSecondary },
  scaleRow: { flexDirection: "row", justifyContent: "space-between" },
  scaleChip: {
    width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surfaceLight,
  },
  scaleChipActive: { backgroundColor: colors.primary },
  scaleChipText: { fontSize: 11, color: colors.textSecondary },
  scaleChipTextActive: { color: colors.text, fontWeight: "700" },
  notes: {
    backgroundColor: colors.background, borderRadius: 8, padding: spacing.sm, marginTop: spacing.xs,
    color: colors.text, minHeight: 44, fontSize: 14,
  },
  submit: { backgroundColor: colors.primary, borderRadius: 12, padding: spacing.md, alignItems: "center", marginTop: spacing.xs },
  submitDisabled: { opacity: 0.5 },
  submitText: { ...typography.body, color: colors.text, fontWeight: "700" },

  histCard: { backgroundColor: colors.surface, borderRadius: 12, overflow: "hidden" },
  histRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  histDate: { ...typography.bodySmall, color: colors.text },
  histMeta: { ...typography.caption, color: colors.textMuted },
  dataRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  dataBody: { flex: 1, gap: 2 },
  dataTitle: { ...typography.bodySmall, color: colors.text, fontWeight: "600" },
  dataMeta: { ...typography.caption, color: colors.textMuted },
  dataSide: { ...typography.caption, color: colors.textSecondary, maxWidth: 120 },
});
