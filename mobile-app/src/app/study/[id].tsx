/**
 * Study detail — overview, funding, consent acceptance, enrol, and the
 * member's scheduled questionnaires (due dates, rewards, status) once enrolled.
 */
import { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import {
  FlaskConical,
  CheckCircle,
  Clock,
  XCircle,
  Coins,
  FileText,
  ChevronRight,
  CheckSquare,
  Square,
} from "lucide-react-native";
import {
  useAuth,
  useStudyDetail,
  useMyStudyRegistrations,
  useStudyConsents,
  useCombinedConsentRequirements,
  useStudyQuestionnairesMobile,
  useEnrollInStudy,
  useSubmitStudyConsentAcceptance,
  useTranslation,
} from "@/hooks";
import { colors, spacing, typography } from "@/theme";
import type { StudyConsentItem, StudyQuestionnaireMobile } from "@/types/schemas";

function qStatusVisual(status: string): { color: string; Icon: typeof CheckCircle } {
  if (status === "completed") return { color: colors.success, Icon: CheckCircle };
  if (status === "expired") return { color: colors.error, Icon: XCircle };
  return { color: colors.warning, Icon: Clock };
}

function QuestionnaireRow({ q, statusText }: { q: StudyQuestionnaireMobile; statusText: string }) {
  const { color, Icon } = qStatusVisual(q.status);
  const tappable = q.can_submit && !!q.questionnaire_id;
  return (
    <TouchableOpacity
      testID={`study-q-${q.id}`}
      style={styles.qRow}
      disabled={!tappable}
      onPress={() => {
        if (!tappable) return;
        // Forward the registration so the response is tied to this cluster
        // (scheduling/eligibility checks + study-level reward in the submit RPC).
        const reg = q.study_registration_id;
        router.push(
          reg
            ? `/questionnaire/${q.questionnaire_id}?reg=${reg}`
            : `/questionnaire/${q.questionnaire_id}`,
        );
      }}
    >
      <Icon size={16} color={color} />
      <View style={styles.qBody}>
        <Text style={styles.qTitle} numberOfLines={1}>{q.title ?? statusText}</Text>
        <View style={styles.qMetaRow}>
          <Text style={[styles.qMeta, { color }]}>{statusText}</Text>
          {q.due_date ? (
            <Text style={styles.qMeta}>· {new Date(q.due_date).toLocaleDateString()}</Text>
          ) : null}
          {q.points_reward > 0 ? (
            <View style={styles.rewardChip}>
              <Coins size={10} color={colors.warning} />
              <Text style={styles.rewardText}>{q.points_reward}</Text>
            </View>
          ) : null}
        </View>
      </View>
      {tappable ? <ChevronRight size={16} color={colors.textMuted} /> : null}
    </TouchableOpacity>
  );
}

export default function StudyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useTranslation();
  const { user } = useAuth();
  const { data: study, isLoading, refetch: refetchStudy } = useStudyDetail(id, locale);
  const { data: registrations, refetch: refetchRegs } = useMyStudyRegistrations(user?.id);
  const { data: consents } = useStudyConsents(id, locale);
  const { data: consentRequirements } = useCombinedConsentRequirements(id, locale);
  const enroll = useEnrollInStudy();
  const submitConsent = useSubmitStudyConsentAcceptance();
  const [refreshing, setRefreshing] = useState(false);
  const [acceptedConsentKeys, setAcceptedConsentKeys] = useState<Set<string>>(new Set());

  const registration = (registrations ?? []).find((r) => r.study_id === id) ?? null;
  const isEnrolled = !!registration && registration.status !== "withdrawn";

  const { data: qResult, refetch: refetchQ } = useStudyQuestionnairesMobile(
    registration?.id,
    locale,
    isEnrolled,
  );

  const displayConsents = useMemo<StudyConsentItem[]>(() => {
    if ((consents ?? []).length > 0) return consents ?? [];
    return (consentRequirements ?? []).map((r) => ({
      id: r.id,
      consent_key: r.template_key,
      title: r.title,
      description: r.content,
      checkbox_label: null,
      is_required: r.is_required,
      display_order: r.sort_order,
      document_url: null,
      study_code: null,
      is_umbrella: r.study_id !== id,
    }));
  }, [consents, consentRequirements, id]);

  const requirementsByKey = useMemo(
    () => new Map((consentRequirements ?? []).map((r) => [r.template_key, r])),
    [consentRequirements],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchStudy(), refetchRegs(), refetchQ()]);
    setRefreshing(false);
  }, [refetchStudy, refetchRegs, refetchQ]);

  const toggleConsent = useCallback((consentKey: string) => {
    setAcceptedConsentKeys((prev) => {
      const next = new Set(prev);
      if (next.has(consentKey)) next.delete(consentKey);
      else next.add(consentKey);
      return next;
    });
  }, []);

  const handleEnroll = useCallback(async () => {
    if (!id) return;
    const requiredConsents = displayConsents.filter((c) => c.is_required);
    const missingRequired = requiredConsents.filter((c) => !acceptedConsentKeys.has(c.consent_key));
    if (missingRequired.length > 0) {
      Alert.alert(t("studies.consent_required_title"), t("studies.consent_required_desc"));
      return;
    }

    try {
      const toSubmit = displayConsents.filter((c) => c.is_required || acceptedConsentKeys.has(c.consent_key));
      const missingRequirement = toSubmit.find((c) => !requirementsByKey.has(c.consent_key));
      if (missingRequirement) {
        Alert.alert(t("errors.title"), t("studies.consent_contract_error"));
        return;
      }
      const signatureData = `mobile:${new Date().toISOString()}`;
      for (const consent of toSubmit) {
        const requirement = requirementsByKey.get(consent.consent_key);
        if (!requirement) continue;
        await submitConsent.mutateAsync({
          consentTemplateId: requirement.consent_template_id,
          granted: true,
          signatureData,
          studyId: requirement.study_id,
        });
      }
      await enroll.mutateAsync({ studyId: id });
      await Promise.all([refetchRegs(), refetchStudy()]);
      Alert.alert(t("studies.enroll_ok"), t("studies.enroll_ok_desc"));
    } catch (e: unknown) {
      Alert.alert(t("errors.title"), e instanceof Error ? e.message : String(e));
    }
  }, [
    id,
    displayConsents,
    acceptedConsentKeys,
    requirementsByKey,
    submitConsent,
    enroll,
    refetchRegs,
    refetchStudy,
    t,
  ]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: t("studies.detail_title") }} />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!study) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: t("studies.detail_title") }} />
        <Text style={styles.muted}>{t("errors.not_found")}</Text>
      </View>
    );
  }

  const fundingPct =
    study.funding_goal && study.funding_goal > 0
      ? Math.min(Math.round(((study.current_funding ?? 0) / study.funding_goal) * 100), 100)
      : null;
  const questionnaires = qResult?.questionnaires ?? [];
  const requiredConsentCount = displayConsents.filter((c) => c.is_required).length;
  const acceptedRequiredCount = displayConsents.filter(
    (c) => c.is_required && acceptedConsentKeys.has(c.consent_key),
  ).length;
  const canEnroll = requiredConsentCount === acceptedRequiredCount;
  const submitting = enroll.isPending || submitConsent.isPending;

  return (
    <>
      <Stack.Screen options={{ title: study.name }} />
      <ScrollView
        testID="study-detail-screen"
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <FlaskConical size={28} color={colors.primary} />
          <Text style={styles.title}>{study.name}</Text>
          {study.target_condition ? (
            <Text style={styles.subtitle}>{study.target_condition}</Text>
          ) : null}
          {isEnrolled && registration ? (
            <View style={styles.enrolledBadge}>
              <CheckCircle size={12} color={colors.success} />
              <Text style={styles.enrolledText}>
                {t(`studies.status.${registration.status}`) !== `studies.status.${registration.status}`
                  ? t(`studies.status.${registration.status}`)
                  : registration.status}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Funding */}
        {fundingPct !== null && (
          <View style={styles.fundingCard}>
            <Text style={styles.fundingLabel}>{t("studies.funding")}: {fundingPct}%</Text>
            <View style={styles.progressBg}>
              <View style={[styles.progressFill, { width: `${fundingPct}%` }]} />
            </View>
          </View>
        )}

        {/* Description */}
        {study.description ? <Text style={styles.description}>{study.description}</Text> : null}

        {isEnrolled ? (
          /* Scheduled questionnaires */
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("studies.questionnaires")}</Text>
            {qResult?.notice ? (
              <Text style={styles.muted}>{qResult.notice}</Text>
            ) : questionnaires.length === 0 ? (
              <Text style={styles.muted}>{t("studies.no_questionnaires")}</Text>
            ) : (
              questionnaires.map((q) => (
                <QuestionnaireRow
                  key={q.id}
                  q={q}
                  statusText={t(`studies.qstatus.${q.status}`) !== `studies.qstatus.${q.status}`
                    ? t(`studies.qstatus.${q.status}`)
                    : q.status}
                />
              ))
            )}
          </View>
        ) : (
          /* Consent acceptance + enrol */
          <View style={styles.section}>
            {displayConsents.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>{t("studies.consent")}</Text>
                {displayConsents.map((c) => {
                  const accepted = acceptedConsentKeys.has(c.consent_key);
                  return (
                    <TouchableOpacity
                      key={`${c.consent_key}:${c.id}`}
                      style={styles.consentRow}
                      onPress={() => toggleConsent(c.consent_key)}
                    >
                      <FileText size={14} color={colors.textSecondary} />
                      <View style={styles.consentBody}>
                        <Text style={styles.consentTitle}>{c.title ?? c.consent_key}</Text>
                        {c.description ? (
                          <Text style={styles.consentDesc} numberOfLines={3}>{c.description}</Text>
                        ) : null}
                        {c.checkbox_label ? (
                          <Text style={styles.checkboxLabel}>{c.checkbox_label}</Text>
                        ) : null}
                      </View>
                      {c.is_required ? (
                        <Text style={styles.required}>{t("studies.required")}</Text>
                      ) : null}
                      {accepted ? (
                        <CheckSquare size={18} color={colors.success} />
                      ) : (
                        <Square size={18} color={colors.textMuted} />
                      )}
                    </TouchableOpacity>
                  );
                })}
                <Text style={styles.consentNote}>
                  {requiredConsentCount > 0
                    ? `${acceptedRequiredCount}/${requiredConsentCount} ${t("studies.required_accepted")}`
                    : t("studies.consent_note")}
                </Text>
              </>
            )}
            <TouchableOpacity
              testID="study-enroll-btn"
              style={[styles.enrollButton, (!canEnroll || submitting) && styles.enrollButtonDisabled]}
              onPress={handleEnroll}
              disabled={!canEnroll || submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : (
                <Text style={styles.enrollButtonText}>{t("studies.enroll")}</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background },
  muted: { ...typography.bodySmall, color: colors.textMuted, paddingVertical: spacing.sm },

  header: { alignItems: "center", marginBottom: spacing.lg },
  title: { ...typography.h2, textAlign: "center", marginTop: spacing.sm },
  subtitle: { ...typography.bodySmall, color: colors.textSecondary, textAlign: "center", marginTop: spacing.xs },
  enrolledBadge: {
    flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.sm,
    backgroundColor: `${colors.success}22`, borderRadius: 12, paddingHorizontal: spacing.sm, paddingVertical: 3,
  },
  enrolledText: { fontSize: 11, fontWeight: "700", color: colors.success, textTransform: "uppercase" },

  fundingCard: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, marginBottom: spacing.md },
  fundingLabel: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },
  progressBg: { height: 6, borderRadius: 3, backgroundColor: colors.border },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },

  description: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing.lg, lineHeight: 20 },

  section: { marginBottom: spacing.lg },
  sectionTitle: { ...typography.label, textTransform: "uppercase", letterSpacing: 1, marginBottom: spacing.sm },

  qRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: 10, padding: spacing.md, marginBottom: spacing.xs,
  },
  qBody: { flex: 1, gap: 2 },
  qTitle: { ...typography.bodySmall, color: colors.text, fontWeight: "600" },
  qMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  qMeta: { ...typography.caption, color: colors.textMuted },
  rewardChip: { flexDirection: "row", alignItems: "center", gap: 2 },
  rewardText: { fontSize: 11, fontWeight: "700", color: colors.warning },

  consentRow: {
    flexDirection: "row", alignItems: "flex-start", gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: 10, padding: spacing.md, marginBottom: spacing.xs,
  },
  consentBody: { flex: 1, gap: 2 },
  consentTitle: { ...typography.bodySmall, color: colors.text, fontWeight: "600" },
  consentDesc: { ...typography.caption, color: colors.textMuted },
  checkboxLabel: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  required: { fontSize: 10, fontWeight: "700", color: colors.warning, textTransform: "uppercase" },
  consentNote: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs, fontStyle: "italic" },

  enrollButton: {
    backgroundColor: colors.primary, borderRadius: 12, padding: spacing.md,
    alignItems: "center", marginTop: spacing.md,
  },
  enrollButtonDisabled: { opacity: 0.6 },
  enrollButtonText: { ...typography.body, color: colors.text, fontWeight: "700" },
});
