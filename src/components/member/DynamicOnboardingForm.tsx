import { useState, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Heart, CheckCircle2, ChevronRight, ChevronLeft, Activity, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { QuestionBlockRenderer } from "@/components/questionnaire/QuestionBlockRenderer";
import {
  useQuestionnaireBlocks,
  groupBlocksByStep,
  getStepNumbers,
  type ValidatedQuestionnaireBlock,
} from "@/hooks/useQuestionnaireBlocks";
import { useCombinedStudyConsents } from "@/hooks/useCombinedStudyConsents";
import { DynamicConsentCheckboxes } from "@/components/onboarding/DynamicConsentCheckboxes";
import { OperationalAssessmentWizard } from "@/components/assessment/OperationalAssessmentWizard";
import type { LongevityScore } from "@/components/assessment/types";
import {
  useCheckUmbrellaRegistration,
  useCreateStudyRegistration,
  useSubmitOnboardingResponse,
  useSubmitOnboardingConsents,
} from "@/hooks/useDynamicOnboarding";

const EMPTY_BLOCKS: ValidatedQuestionnaireBlock[] = [];

/** Step metadata for UI (icons, i18n keys) */
const STEP_META: Record<number, { titleKey: string; descriptionKey: string; icon: typeof Heart }> =
  {
    1: {
      titleKey: "onboarding.step1.title",
      descriptionKey: "onboarding.step1.description",
      icon: Heart,
    },
    2: {
      titleKey: "onboarding.step2.title",
      descriptionKey: "onboarding.step2.description",
      icon: Heart,
    },
    3: {
      titleKey: "onboarding.step3.title",
      descriptionKey: "onboarding.step3.description",
      icon: Heart,
    },
    4: {
      titleKey: "onboarding.step4.title",
      descriptionKey: "onboarding.step4.description",
      icon: Heart,
    },
    5: {
      titleKey: "onboarding.step5.title",
      descriptionKey: "onboarding.step5.description",
      icon: Activity,
    },
  };

interface DynamicOnboardingFormProps {
  onComplete?: () => void;
  /** Optional study ID to enroll in (from invitation or direct link) */
  targetStudyId?: string;
}

/**
 * Dynamic onboarding form that loads question blocks from DB.
 * Handles dual registration (umbrella + child study) via create_study_registration_audited RPC.
 * If user came via invitation, claim_invitation already handled registration.
 */
export function DynamicOnboardingForm({ onComplete, targetStudyId }: DynamicOnboardingFormProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [currentStep, setCurrentStep] = useState(1);
  const [responses, setResponses] = useState<Record<string, unknown>>({});
  const [acceptedConsents, setAcceptedConsents] = useState<Record<string, boolean>>({});
  const [longevityScore, setLongevityScore] = useState<LongevityScore | null>(null);
  const [assessmentCompleted, setAssessmentCompleted] = useState(false);

  // Hooks for data fetching
  const { data: umbrellaCheck, isLoading: umbrellaLoading } = useCheckUmbrellaRegistration();

  // Mutations
  const createRegistrationMutation = useCreateStudyRegistration();
  const submitOnboardingMutation = useSubmitOnboardingResponse();
  const submitConsentsMutation = useSubmitOnboardingConsents();

  const isSubmitting =
    createRegistrationMutation.isPending ||
    submitOnboardingMutation.isPending ||
    submitConsentsMutation.isPending;

  // Determine target study from props or URL params
  const effectiveStudyId = targetStudyId ?? searchParams.get("study") ?? undefined;

  // Fetch all onboarding blocks from DB (dynamic)
  const {
    data: blocks = [],
    isLoading: blocksLoading,
    error: blocksError,
  } = useQuestionnaireBlocks("ONBOARDING");

  // Fetch dynamic consents for the study
  const { data: consents = [], isLoading: consentsLoading } =
    useCombinedStudyConsents(effectiveStudyId);

  // Group blocks by step (from questionnaire_blocks.step_number)
  const blocksByStep = useMemo(() => groupBlocksByStep(blocks), [blocks]);
  const stepNumbers = useMemo(() => getStepNumbers(blocks), [blocks]);

  // Total steps = question steps + operational assessment (step 5)
  const questionSteps = stepNumbers.length > 0 ? stepNumbers : [1, 2, 3, 4];
  const totalSteps = Math.max(...questionSteps, 4) + 1; // +1 for operational assessment

  // Current step blocks
  const currentStepBlocks = useMemo(
    () => blocksByStep.get(currentStep) ?? EMPTY_BLOCKS,
    [blocksByStep, currentStep]
  );
  const stepMeta = STEP_META[currentStep] || STEP_META[1];
  const StepIcon = stepMeta.icon;

  // Update response
  const handleResponseChange = useCallback((blockCode: string, value: unknown) => {
    setResponses((prev) => ({ ...prev, [blockCode]: value }));
  }, []);

  // Update consent
  const handleConsentChange = useCallback((consentKey: string, accepted: boolean) => {
    setAcceptedConsents((prev) => ({ ...prev, [consentKey]: accepted }));
  }, []);

  // Navigation
  const nextStep = () => setCurrentStep((prev) => Math.min(prev + 1, totalSteps));
  const prevStep = () => setCurrentStep((prev) => Math.max(prev - 1, 1));

  // Check if current step is valid (required fields filled)
  const isCurrentStepValid = useMemo(() => {
    const requiredBlocks = currentStepBlocks.filter((b) => b.is_required);
    return requiredBlocks.every((b) => {
      const val = responses[b.block_code];
      if (val === undefined || val === null || val === "") return false;
      if (Array.isArray(val) && val.length === 0) return false;
      return true;
    });
  }, [currentStepBlocks, responses]);

  // Check if consents are valid (all required consents accepted)
  const areConsentsValid = useMemo(() => {
    const requiredConsents = consents.filter((c) => c.isRequired);
    return requiredConsents.every((c) => acceptedConsents[c.consentKey] === true);
  }, [consents, acceptedConsents]);

  // Submit onboarding with dual registration logic
  const handleSubmit = async () => {
    try {
      // Step 1: Handle study registration if not already enrolled via invitation
      if (!umbrellaCheck?.has_registration && effectiveStudyId) {
        await createRegistrationMutation.mutateAsync({
          studyId: effectiveStudyId,
          initialStatus: "screening",
        });
      }

      // Step 2: Build onboarding data from responses
      const onboardingData = {
        overall_feeling: (responses.overall_feeling as number) ?? 5,
        energy_perception: (responses.energy_perception as number) ?? 5,
        physical_confidence: (responses.physical_confidence as number) ?? 5,
        mental_wellbeing: (responses.mental_wellbeing as number) ?? 5,
        sleep_satisfaction: (responses.sleep_satisfaction as number) ?? 5,
        primary_concern: (responses.primary_concern as string) ?? "",
        main_goal: (responses.main_goal as string) ?? "",
        timeframe_expectation: (responses.timeframe_expectation as string) ?? "3_months",
        mentor_preference: (responses.mentor_preference as string) ?? "no_preference",
        communication_style: (responses.communication_style as string) ?? "moderate",
        age_range: (responses.age_range as string) ?? "26-35",
        has_chronic_condition: (responses.has_chronic_condition as boolean) ?? false,
        condition_brief: (responses.condition_brief as string) ?? "",
        secondary_concerns: (responses.secondary_concerns as string[]) ?? [],
      };

      // Step 3: Submit onboarding response
      await submitOnboardingMutation.mutateAsync(onboardingData);

      // Step 4: Submit consents if any were accepted
      const acceptedConsentKeys = Object.entries(acceptedConsents)
        .filter(([, v]) => v)
        .map(([k]) => k);

      if (acceptedConsentKeys.length > 0 && effectiveStudyId) {
        await submitConsentsMutation.mutateAsync({
          consentTypes: acceptedConsentKeys,
          studyId: effectiveStudyId,
          version: "1.0",
        });
      }

      toast.success(t("onboarding.toasts.success.title"), {
        description: t("onboarding.toasts.success.description"),
      });

      if (onComplete) {
        onComplete();
      } else {
        navigate("/member");
      }
    } catch {
      toast.error(t("onboarding.toasts.error.title"), {
        description: t("onboarding.toasts.error.description"),
      });
    }
  };

  // Assessment handlers
  const handleAssessmentComplete = (score: LongevityScore) => {
    setLongevityScore(score);
    setAssessmentCompleted(true);
  };

  const handleSkipAssessment = () => {
    setAssessmentCompleted(true);
  };

  // Loading state
  if (blocksLoading || umbrellaLoading || consentsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Error state
  if (blocksError) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-destructive">{t("errors.genericError")}</p>
        </CardContent>
      </Card>
    );
  }

  const isLastQuestionStep = currentStep === totalSteps - 1;
  const isOperationalStep = currentStep === totalSteps;

  return (
    <div className="space-y-6">
      {/* Progress indicator */}
      <div className="flex justify-between items-center mb-8">
        {Array.from({ length: totalSteps }, (_, i) => i + 1).map((step) => (
          <div key={step} className="flex items-center">
            <div
              className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center font-semibold transition-colors",
                currentStep >= step
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {currentStep > step ? <CheckCircle2 className="w-5 h-5" /> : step}
            </div>
            {step < totalSteps && (
              <div
                className={cn(
                  "h-1 w-8 sm:w-16 mx-1 transition-colors",
                  currentStep > step ? "bg-primary" : "bg-muted"
                )}
              />
            )}
          </div>
        ))}
      </div>

      {/* Question steps */}
      {!isOperationalStep && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <StepIcon className="w-6 h-6 text-primary" />
              {t(stepMeta.titleKey)}
            </CardTitle>
            <CardDescription>{t(stepMeta.descriptionKey)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            {currentStepBlocks.length > 0 ? (
              currentStepBlocks.map((block) => (
                <QuestionBlockRenderer
                  key={block.id}
                  block={block}
                  value={responses[block.block_code]}
                  onChange={(value) => handleResponseChange(block.block_code, value)}
                />
              ))
            ) : (
              <p className="text-muted-foreground text-center py-4">{t("onboarding.noBlocks")}</p>
            )}

            {/* Show consents on last question step */}
            {isLastQuestionStep && consents.length > 0 && effectiveStudyId && (
              <div className="pt-6 border-t">
                <DynamicConsentCheckboxes
                  studyId={effectiveStudyId}
                  acceptedConsents={acceptedConsents}
                  onConsentChange={handleConsentChange}
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 5: Operational Assessment */}
      {isOperationalStep && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-6 h-6 text-primary" />
              {t("onboarding.step5.title")}
            </CardTitle>
            <CardDescription>{t("onboarding.step5.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            {!assessmentCompleted ? (
              <OperationalAssessmentWizard
                assessmentType="onboarding"
                onComplete={handleAssessmentComplete}
                onSkip={handleSkipAssessment}
                showSkip={true}
                embedded={true}
              />
            ) : (
              <div className="text-center py-8">
                <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
                <h3 className="text-xl font-semibold mb-2">{t("onboarding.step5.completed")}</h3>
                {longevityScore && (
                  <p className="text-muted-foreground">
                    {t("onboarding.step5.score")}{" "}
                    <span className="font-bold text-primary">
                      {Math.round(longevityScore.overall)}%
                    </span>
                  </p>
                )}
                <p className="text-sm text-muted-foreground mt-4">{t("onboarding.step5.ready")}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Navigation buttons */}
      <div className="flex justify-between gap-4 pt-6">
        {currentStep > 1 && !isOperationalStep && (
          <Button type="button" variant="outline" onClick={prevStep}>
            <ChevronLeft className="w-4 h-4 mr-2" />
            {t("onboarding.buttons.back")}
          </Button>
        )}
        {!isOperationalStep ? (
          <Button
            type="button"
            onClick={nextStep}
            className="ml-auto"
            disabled={!isCurrentStepValid || (isLastQuestionStep && !areConsentsValid)}
          >
            {t("onboarding.buttons.next")}
            <ChevronRight className="w-4 h-4 ml-2" />
          </Button>
        ) : assessmentCompleted ? (
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="ml-auto"
          >
            {isSubmitting ? t("onboarding.buttons.submitting") : t("onboarding.buttons.finish")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
