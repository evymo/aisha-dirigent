/**
 * Questionnaire detail screen — step-by-step block-based UI.
 */
import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowRight, Check, ChevronLeft } from "lucide-react-native";
import {
  useQuestionnaireBlocks,
  useSubmitQuestionnaire,
  type QuestionBlock,
} from "@/hooks/useQuestionnaires";
import { useTranslation } from "@/hooks";
import { colors, spacing, typography } from "@/theme";
import { safeError } from "@/lib/security/safeLogger";

function BlockInput({
  block,
  onChange,
  value,
}: {
  block: QuestionBlock;
  onChange: (value: unknown) => void;
  value: unknown;
}) {
  switch (block.questionType) {
    case "text":
    case "textarea":
      return (
        <TextInput
          style={[styles.input, block.questionType === "textarea" && styles.textArea]}
          value={(value as string) ?? ""}
          onChangeText={onChange}
          placeholder={block.label}
          placeholderTextColor={colors.textMuted}
          multiline={block.questionType === "textarea"}
          numberOfLines={block.questionType === "textarea" ? 4 : 1}
        />
      );

    case "number":
    case "scale":
      return (
        <TextInput
          style={styles.input}
          value={value != null ? String(value) : ""}
          onChangeText={(text) => {
            const num = parseInt(text, 10);
            onChange(isNaN(num) ? null : num);
          }}
          keyboardType="numeric"
          placeholder={block.label}
          placeholderTextColor={colors.textMuted}
        />
      );

    // Single-choice: select, radio, and boolean (true/false rendered as options).
    case "select":
    case "radio":
    case "boolean":
      return (
        <View style={styles.optionsContainer}>
          {block.options.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[
                styles.optionButton,
                value === opt.value && styles.optionSelected,
              ]}
              onPress={() => onChange(opt.value)}
            >
              <Text
                style={[
                  styles.optionText,
                  value === opt.value && styles.optionTextSelected,
                ]}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      );

    // Multi-choice: checkbox and tags both collect an array of values.
    case "checkbox":
    case "tags":
      return (
        <View style={styles.optionsContainer}>
          {block.options.map((opt) => {
            const selected = Array.isArray(value) && (value as string[]).includes(opt.value);
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.optionButton, selected && styles.optionSelected]}
                onPress={() => {
                  const current = Array.isArray(value) ? (value as string[]) : [];
                  onChange(
                    selected
                      ? current.filter((v) => v !== opt.value)
                      : [...current, opt.value]
                  );
                }}
              >
                <Text
                  style={[styles.optionText, selected && styles.optionTextSelected]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      );

    case "date":
      return (
        <TextInput
          style={styles.input}
          value={(value as string) ?? ""}
          onChangeText={onChange}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.textMuted}
        />
      );

    // Unknown/not-yet-specialized types (e.g. feeling_preset) degrade to a text
    // input so the question still captures an answer instead of disappearing.
    default:
      return (
        <TextInput
          style={styles.input}
          value={(value as string) ?? ""}
          onChangeText={onChange}
          placeholder={block.label}
          placeholderTextColor={colors.textMuted}
        />
      );
  }
}

export default function QuestionnaireScreen() {
  // `reg` = study_registration_id, forwarded from the study screen so the
  // submission is tied to its cluster (scheduling/eligibility + study reward).
  const { id, reg } = useLocalSearchParams<{ id: string; reg?: string }>();
  const { t, locale } = useTranslation();
  const [currentStep, setCurrentStep] = useState(1);
  const [responses, setResponses] = useState<Record<string, unknown>>({});

  const { data: blocks, isLoading } = useQuestionnaireBlocks(id, locale);
  const { mutate: submitResponse, isPending: isSubmitting } = useSubmitQuestionnaire();

  // Group blocks by step_number
  const { totalSteps, currentBlocks } = useMemo(() => {
    const grouped = (blocks ?? []).reduce<Record<number, QuestionBlock[]>>((acc, block) => {
      const step = block.stepNumber;
      if (!acc[step]) acc[step] = [];
      acc[step].push(block);
      return acc;
    }, {});

    const nums = Object.keys(grouped)
      .map(Number)
      .sort((a, b) => a - b);

    return {
      steps: grouped,
      stepNumbers: nums,
      totalSteps: nums.length,
      currentBlocks: grouped[nums[currentStep - 1]] ?? [],
    };
  }, [blocks, currentStep]);

  const handleNext = useCallback(() => {
    // Validate required fields for current step
    const missing = currentBlocks.filter(
      (b) => b.required && (responses[b.blockCode] == null || responses[b.blockCode] === "")
    );
    if (missing.length > 0) {
      Alert.alert(t("errors.title"), t("errors.validation"));
      return;
    }

    if (currentStep < totalSteps) {
      setCurrentStep((prev) => prev + 1);
    }
  }, [currentBlocks, currentStep, responses, t, totalSteps]);

  const handlePrev = useCallback(() => {
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1);
    }
  }, [currentStep]);

  const handleSubmit = useCallback(() => {
    if (!id) return;
    submitResponse(
      { questionnaireId: id, responses, studyRegistrationId: reg },
      {
        onError: (error) => {
          safeError("questionnaire.submit.failed", error);
          Alert.alert(t("errors.title"), t("errors.generic"));
        },
        onSuccess: () => {
          router.back();
        },
      }
    );
  }, [id, reg, responses, submitResponse, t]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (totalSteps === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>{t("errors.not_found")}</Text>
      </View>
    );
  }

  const isLastStep = currentStep === totalSteps;

  return (
    <View style={styles.container}>
      {/* Progress bar */}
      <View style={styles.progressContainer}>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${(currentStep / totalSteps) * 100}%` },
            ]}
          />
        </View>
        <Text style={styles.progressText}>
          {currentStep} / {totalSteps}
        </Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        {currentBlocks.map((block) => (
          <View key={block.id} style={styles.blockContainer}>
            <Text style={styles.blockLabel}>
              {block.label}
              {block.required && <Text style={styles.required}> *</Text>}
            </Text>
            <BlockInput
              block={block}
              value={responses[block.blockCode]}
              onChange={(val) =>
                setResponses((prev) => ({ ...prev, [block.blockCode]: val }))
              }
            />
          </View>
        ))}
      </ScrollView>

      {/* Navigation */}
      <View style={styles.navBar}>
        <TouchableOpacity
          style={[styles.navButton, currentStep === 1 && styles.navButtonDisabled]}
          onPress={handlePrev}
          disabled={currentStep === 1}
        >
          <ChevronLeft size={20} color={currentStep === 1 ? colors.textMuted : colors.text} />
          <Text style={[styles.navText, currentStep === 1 && styles.navTextDisabled]}>
            {t("common.back")}
          </Text>
        </TouchableOpacity>

        {isLastStep ? (
          <TouchableOpacity
            style={[styles.submitButton, isSubmitting && styles.navButtonDisabled]}
            onPress={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <>
                <Check size={20} color={colors.text} />
                <Text style={styles.submitText}>{t("common.save")}</Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
            <Text style={styles.navText}>{t("questionnaire.next")}</Text>
            <ArrowRight size={20} color={colors.text} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
  },
  progressContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    gap: spacing.sm,
  },
  progressTrack: {
    flex: 1,
    height: 4,
    backgroundColor: colors.surfaceLight,
    borderRadius: 2,
  },
  progressFill: {
    height: 4,
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  progressText: {
    ...typography.caption,
    minWidth: 40,
    textAlign: "right",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    gap: spacing.lg,
  },
  blockContainer: {
    gap: spacing.sm,
  },
  blockLabel: {
    ...typography.label,
  },
  required: {
    color: colors.error,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    color: colors.text,
    fontSize: 16,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: "top",
  },
  optionsContainer: {
    gap: spacing.sm,
  },
  optionButton: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  optionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + "15",
  },
  optionText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  optionTextSelected: {
    color: colors.primary,
    fontWeight: "600",
  },
  navBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  navButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    padding: spacing.sm,
  },
  navButtonDisabled: {
    opacity: 0.4,
  },
  navText: {
    ...typography.body,
    fontWeight: "600",
  },
  navTextDisabled: {
    color: colors.textMuted,
  },
  nextButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  submitButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.success,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  submitText: {
    ...typography.body,
    fontWeight: "600",
    color: colors.text,
  },
});
