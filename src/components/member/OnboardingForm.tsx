import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RatingButtons } from "@/components/ui/rating-buttons";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useOnboardingSubmit } from "@/hooks/useOnboardingSubmit";
import { Heart, Sparkles, Moon, Zap, Users, CheckCircle2, ChevronRight, ChevronLeft, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { OperationalAssessmentWizard } from "@/components/assessment/OperationalAssessmentWizard";
import type { LongevityScore } from "@/components/assessment/types";
import { createOnboardingSchema, CONCERN_TAG_KEYS, GOAL_TAG_KEYS, type OnboardingData } from "./onboardingFormTypes";

interface OnboardingFormProps {
  onComplete?: () => void;
}

/**
 * Modern onboarding form focused on how user FEELS
 * Not a medical interrogation - a welcoming conversation
 */
export function OnboardingForm({ onComplete }: OnboardingFormProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const onboardingSubmit = useOnboardingSubmit();
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedConcernTags, setSelectedConcernTags] = useState<string[]>([]);
  const [selectedGoalTags, setSelectedGoalTags] = useState<string[]>([]);
  const [longevityScore, setLongevityScore] = useState<LongevityScore | null>(null);
  const [assessmentCompleted, setAssessmentCompleted] = useState(false);

  // Create schema with translation function
  const onboardingSchema = createOnboardingSchema(t);

  const form = useForm<OnboardingData>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      overall_feeling: 5,
      energy_perception: 5,
      physical_confidence: 5,
      mental_wellbeing: 5,
      sleep_satisfaction: 5,
      primary_concern: "",
      main_goal: "",
      timeframe_expectation: "3_months",
      mentor_preference: "no_preference",
      communication_style: "moderate",
      age_range: "26-35",
      has_chronic_condition: false,
      condition_brief: "",
    },
  });

  const toggleConcernTag = (tag: string) => {
    setSelectedConcernTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const toggleGoalTag = (tag: string) => {
    setSelectedGoalTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const onSubmit = async (data: OnboardingData) => {
    onboardingSubmit.mutate(
      {
        overall_feeling: data.overall_feeling,
        energy_perception: data.energy_perception,
        physical_confidence: data.physical_confidence,
        mental_wellbeing: data.mental_wellbeing,
        sleep_satisfaction: data.sleep_satisfaction,
        primary_concern: data.primary_concern,
        main_goal: data.main_goal,
        timeframe_expectation: data.timeframe_expectation,
        mentor_preference: data.mentor_preference,
        communication_style: data.communication_style,
        age_range: data.age_range,
        has_chronic_condition: data.has_chronic_condition,
        condition_brief: data.condition_brief ?? "",
        secondary_concerns: selectedConcernTags,
      },
      {
        onSuccess: () => {
          toast.success(t("onboarding.toasts.success.title"), {
            description: t("onboarding.toasts.success.description"),
          });

          if (onComplete) {
            onComplete();
          } else {
            navigate("/member");
          }
        },
        onError: () => {
          toast.error(t("onboarding.toasts.error.title"), {
            description: t("onboarding.toasts.error.description"),
          });
        },
      }
    );
  };

  const isSubmitting = onboardingSubmit.isPending;

  const nextStep = () => {
    setCurrentStep(prev => Math.min(prev + 1, 5));
  };

  const prevStep = () => {
    setCurrentStep(prev => Math.max(prev - 1, 1));
  };

  const handleAssessmentComplete = (score: LongevityScore) => {
    setLongevityScore(score);
    setAssessmentCompleted(true);
    // Don't call nextStep() - step 5 is the last step, user will click Finish
  };

  const handleSkipAssessment = () => {
    setAssessmentCompleted(true);
    // Don't call nextStep() - step 5 is the last step, user will click Finish
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Progress indicator */}
        <div className="flex justify-between items-center mb-8">
          {[1, 2, 3, 4, 5].map((step) => (
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
              {step < 5 && (
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

        {/* Step 1: How you feel */}
        {currentStep === 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Heart className="w-6 h-6 text-primary" />
                {t("onboarding.step1.title")}
              </CardTitle>
              <CardDescription>
                {t("onboarding.step1.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
              <FormField
                control={form.control}
                name="overall_feeling"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">{t("onboarding.step1.overallFeeling.label")}</FormLabel>
                    <FormDescription>{t("onboarding.step1.overallFeeling.description")}</FormDescription>
                    <FormControl>
                      <RatingButtons
                        value={field.value}
                        onChange={field.onChange}
                        min={0}
                        max={10}
                        labels={{
                          low: t("onboarding.step1.overallFeeling.low"),
                          high: t("onboarding.step1.overallFeeling.high"),
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="energy_perception"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base flex items-center gap-2">
                      <Zap className="w-4 h-4 text-accent" />
                      {t("onboarding.step1.energy.label")}
                    </FormLabel>
                    <FormDescription>{t("onboarding.step1.energy.description")}</FormDescription>
                    <FormControl>
                      <RatingButtons
                        value={field.value}
                        onChange={field.onChange}
                        min={0}
                        max={10}
                        labels={{
                          low: t("onboarding.step1.energy.low"),
                          high: t("onboarding.step1.energy.high"),
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="physical_confidence"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">{t("onboarding.step1.physicalConfidence.label")}</FormLabel>
                    <FormDescription>{t("onboarding.step1.physicalConfidence.description")}</FormDescription>
                    <FormControl>
                      <RatingButtons
                        value={field.value}
                        onChange={field.onChange}
                        min={0}
                        max={10}
                        labels={{
                          low: t("onboarding.step1.physicalConfidence.low"),
                          high: t("onboarding.step1.physicalConfidence.high"),
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="mental_wellbeing"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-secondary" />
                      {t("onboarding.step1.mentalWellbeing.label")}
                    </FormLabel>
                    <FormDescription>{t("onboarding.step1.mentalWellbeing.description")}</FormDescription>
                    <FormControl>
                      <RatingButtons
                        value={field.value}
                        onChange={field.onChange}
                        min={0}
                        max={10}
                        labels={{
                          low: t("onboarding.step1.mentalWellbeing.low"),
                          high: t("onboarding.step1.mentalWellbeing.high"),
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="sleep_satisfaction"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base flex items-center gap-2">
                      <Moon className="w-4 h-4 text-muted-foreground" />
                      {t("onboarding.step1.sleep.label")}
                    </FormLabel>
                    <FormDescription>{t("onboarding.step1.sleep.description")}</FormDescription>
                    <FormControl>
                      <RatingButtons
                        value={field.value}
                        onChange={field.onChange}
                        min={0}
                        max={10}
                        labels={{
                          low: t("onboarding.step1.sleep.low"),
                          high: t("onboarding.step1.sleep.high"),
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>
        )}

        {/* Step 2: What bothers you */}
        {currentStep === 2 && (
          <Card>
            <CardHeader>
              <CardTitle>{t("onboarding.step2.title")}</CardTitle>
              <CardDescription>
                {t("onboarding.step2.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label className="text-base mb-3 block">{t("onboarding.step2.quickTags")}</Label>
                <div className="flex flex-wrap gap-2">
                  {CONCERN_TAG_KEYS.map((tagKey) => (
                    <Badge
                      key={tagKey}
                      variant={selectedConcernTags.includes(tagKey) ? "default" : "outline"}
                      className="cursor-pointer py-2 px-4 text-sm hover:scale-105 transition-transform"
                      onClick={() => toggleConcernTag(tagKey)}
                    >
                      {t(`onboarding.concernTags.${tagKey}`)}
                    </Badge>
                  ))}
                </div>
              </div>

              <Separator />

              <FormField
                control={form.control}
                name="primary_concern"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">{t("onboarding.step2.primaryConcern.label")}</FormLabel>
                    <FormDescription>
                      {t("onboarding.step2.description")}
                    </FormDescription>
                    <FormControl>
                      <Textarea
                        placeholder={t("onboarding.step2.primaryConcern.placeholder")}
                        className="resize-none min-h-[120px]"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="has_chronic_condition"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">{t("onboarding.step2.chronicCondition.label")}</FormLabel>
                    </div>
                    <FormControl>
                      <div className="flex gap-4">
                        <Label
                          className={cn(
                            "cursor-pointer px-4 py-2 rounded-md transition-colors",
                            field.value ? "bg-muted" : "bg-primary text-primary-foreground"
                          )}
                        >
                          <input
                            type="radio"
                            checked={!field.value}
                            onChange={() => field.onChange(false)}
                            className="sr-only"
                          />
                          {t("onboarding.step2.chronicCondition.no")}
                        </Label>
                        <Label
                          className={cn(
                            "cursor-pointer px-4 py-2 rounded-md transition-colors",
                            field.value ? "bg-primary text-primary-foreground" : "bg-muted"
                          )}
                        >
                          <input
                            type="radio"
                            checked={field.value}
                            onChange={() => field.onChange(true)}
                            className="sr-only"
                          />
                          {t("onboarding.step2.chronicCondition.yes")}
                        </Label>
                      </div>
                    </FormControl>
                  </FormItem>
                )}
              />

              {form.watch("has_chronic_condition") && (
                <FormField
                  control={form.control}
                  name="condition_brief"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("onboarding.step2.chronicCondition.details")}</FormLabel>
                      <FormControl>
                        <Input placeholder={t("onboarding.step2.chronicCondition.detailsPlaceholder")} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </CardContent>
          </Card>
        )}

        {/* Step 3: Your goals */}
        {currentStep === 3 && (
          <Card>
            <CardHeader>
              <CardTitle>{t("onboarding.step3.title")}</CardTitle>
              <CardDescription>
                {t("onboarding.step3.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label className="text-base mb-3 block">{t("onboarding.step3.quickTags")}</Label>
                <div className="flex flex-wrap gap-2">
                  {GOAL_TAG_KEYS.map((tagKey) => (
                    <Badge
                      key={tagKey}
                      variant={selectedGoalTags.includes(tagKey) ? "default" : "outline"}
                      className="cursor-pointer py-2 px-4 text-sm hover:scale-105 transition-transform"
                      onClick={() => toggleGoalTag(tagKey)}
                    >
                      {t(`onboarding.goalTags.${tagKey}`)}
                    </Badge>
                  ))}
                </div>
              </div>

              <Separator />

              <FormField
                control={form.control}
                name="main_goal"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">{t("onboarding.step3.mainGoal.label")}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t("onboarding.step3.mainGoal.placeholder")}
                        className="resize-none min-h-[100px]"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="timeframe_expectation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">{t("onboarding.step3.timeframe.label")}</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="grid grid-cols-2 sm:grid-cols-3 gap-3"
                      >
                        <Label
                          htmlFor="asap"
                          className={cn(
                            "cursor-pointer rounded-lg border-2 p-4 text-center transition-colors",
                            field.value === "asap" ? "border-primary bg-primary/5" : "border-muted"
                          )}
                        >
                          <RadioGroupItem value="asap" id="asap" className="sr-only" />
                          <div className="font-semibold">{t("onboarding.step3.timeframe.asap")}</div>
                        </Label>
                        <Label
                          htmlFor="1_month"
                          className={cn(
                            "cursor-pointer rounded-lg border-2 p-4 text-center transition-colors",
                            field.value === "1_month" ? "border-primary bg-primary/5" : "border-muted"
                          )}
                        >
                          <RadioGroupItem value="1_month" id="1_month" className="sr-only" />
                          <div className="font-semibold">{t("onboarding.step3.timeframe.oneMonth")}</div>
                        </Label>
                        <Label
                          htmlFor="3_months"
                          className={cn(
                            "cursor-pointer rounded-lg border-2 p-4 text-center transition-colors",
                            field.value === "3_months" ? "border-primary bg-primary/5" : "border-muted"
                          )}
                        >
                          <RadioGroupItem value="3_months" id="3_months" className="sr-only" />
                          <div className="font-semibold">{t("onboarding.step3.timeframe.threeMonths")}</div>
                        </Label>
                        <Label
                          htmlFor="6_months"
                          className={cn(
                            "cursor-pointer rounded-lg border-2 p-4 text-center transition-colors",
                            field.value === "6_months" ? "border-primary bg-primary/5" : "border-muted"
                          )}
                        >
                          <RadioGroupItem value="6_months" id="6_months" className="sr-only" />
                          <div className="font-semibold">{t("onboarding.step3.timeframe.sixMonths")}</div>
                        </Label>
                        <Label
                          htmlFor="1_year"
                          className={cn(
                            "cursor-pointer rounded-lg border-2 p-4 text-center transition-colors",
                            field.value === "1_year" ? "border-primary bg-primary/5" : "border-muted"
                          )}
                        >
                          <RadioGroupItem value="1_year" id="1_year" className="sr-only" />
                          <div className="font-semibold">{t("onboarding.step3.timeframe.oneYear")}</div>
                        </Label>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>
        )}

        {/* Step 4: Preferences */}
        {currentStep === 4 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-6 h-6 text-primary" />
                {t("onboarding.step4.title")}
              </CardTitle>
              <CardDescription>
                {t("onboarding.step4.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="age_range"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">{t("onboarding.step4.ageRange.label")}</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="grid grid-cols-2 sm:grid-cols-3 gap-3"
                      >
                        {["18-25", "26-35", "36-45", "46-55", "56-65", "65+"].map((range) => (
                          <Label
                            key={range}
                            htmlFor={range}
                            className={cn(
                              "cursor-pointer rounded-lg border-2 p-4 text-center transition-colors",
                              field.value === range ? "border-primary bg-primary/5" : "border-muted"
                            )}
                          >
                            <RadioGroupItem value={range} id={range} className="sr-only" />
                            <div className="font-semibold">{range}</div>
                          </Label>
                        ))}
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="mentor_preference"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">{t("onboarding.step4.mentorPreference.label")}</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="grid grid-cols-3 gap-3"
                      >
                        <Label
                          htmlFor="male"
                          className={cn(
                            "cursor-pointer rounded-lg border-2 p-4 text-center transition-colors",
                            field.value === "male" ? "border-primary bg-primary/5" : "border-muted"
                          )}
                        >
                          <RadioGroupItem value="male" id="male" className="sr-only" />
                          <div className="font-semibold">{t("onboarding.step4.mentorPreference.male")}</div>
                        </Label>
                        <Label
                          htmlFor="female"
                          className={cn(
                            "cursor-pointer rounded-lg border-2 p-4 text-center transition-colors",
                            field.value === "female" ? "border-primary bg-primary/5" : "border-muted"
                          )}
                        >
                          <RadioGroupItem value="female" id="female" className="sr-only" />
                          <div className="font-semibold">{t("onboarding.step4.mentorPreference.female")}</div>
                        </Label>
                        <Label
                          htmlFor="no_preference"
                          className={cn(
                            "cursor-pointer rounded-lg border-2 p-4 text-center transition-colors",
                            field.value === "no_preference" ? "border-primary bg-primary/5" : "border-muted"
                          )}
                        >
                          <RadioGroupItem value="no_preference" id="no_preference" className="sr-only" />
                          <div className="font-semibold">{t("onboarding.step4.mentorPreference.noPreference")}</div>
                        </Label>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="communication_style"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">{t("onboarding.step4.communication.label")}</FormLabel>
                    <FormDescription>
                      {t("onboarding.step4.communication.description")}
                    </FormDescription>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="grid grid-cols-3 gap-3"
                      >
                        <Label
                          htmlFor="minimal"
                          className={cn(
                            "cursor-pointer rounded-lg border-2 p-4 text-center transition-colors",
                            field.value === "minimal" ? "border-primary bg-primary/5" : "border-muted"
                          )}
                        >
                          <RadioGroupItem value="minimal" id="minimal" className="sr-only" />
                          <div className="font-semibold">{t("onboarding.step4.communication.minimal")}</div>
                          <div className="text-xs text-muted-foreground mt-1">{t("onboarding.step4.communication.minimalDesc")}</div>
                        </Label>
                        <Label
                          htmlFor="moderate"
                          className={cn(
                            "cursor-pointer rounded-lg border-2 p-4 text-center transition-colors",
                            field.value === "moderate" ? "border-primary bg-primary/5" : "border-muted"
                          )}
                        >
                          <RadioGroupItem value="moderate" id="moderate" className="sr-only" />
                          <div className="font-semibold">{t("onboarding.step4.communication.moderate")}</div>
                          <div className="text-xs text-muted-foreground mt-1">{t("onboarding.step4.communication.moderateDesc")}</div>
                        </Label>
                        <Label
                          htmlFor="frequent"
                          className={cn(
                            "cursor-pointer rounded-lg border-2 p-4 text-center transition-colors",
                            field.value === "frequent" ? "border-primary bg-primary/5" : "border-muted"
                          )}
                        >
                          <RadioGroupItem value="frequent" id="frequent" className="sr-only" />
                          <div className="font-semibold">{t("onboarding.step4.communication.frequent")}</div>
                          <div className="text-xs text-muted-foreground mt-1">{t("onboarding.step4.communication.frequentDesc")}</div>
                        </Label>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>
        )}

        {/* Step 5: Operational Assessment */}
        {currentStep === 5 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-6 h-6 text-primary" />
                {t("onboarding.step5.title")}
              </CardTitle>
              <CardDescription>
                {t("onboarding.step5.description")}
              </CardDescription>
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
                  <h3 className="text-xl font-semibold mb-2">
                    {t("onboarding.step5.completed")}
                  </h3>
                  {longevityScore && (
                    <p className="text-muted-foreground">
                      {t("onboarding.step5.score")} <span className="font-bold text-primary">{Math.round(longevityScore.overall)}%</span>
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground mt-4">
                    {t("onboarding.step5.ready")}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Navigation buttons */}
        <div className="flex justify-between gap-4 pt-6">
          {currentStep > 1 && currentStep !== 5 && (
            <Button type="button" variant="outline" onClick={prevStep}>
              <ChevronLeft className="w-4 h-4 mr-2" />
              {t("onboarding.buttons.back")}
            </Button>
          )}
          {currentStep < 5 ? (
            <Button type="button" onClick={nextStep} className="ml-auto">
              {t("onboarding.buttons.next")}
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          ) : assessmentCompleted ? (
            <Button type="submit" disabled={isSubmitting} className="ml-auto">
              {isSubmitting ? t("onboarding.buttons.submitting") : t("onboarding.buttons.finish")}
            </Button>
          ) : null}
        </div>
      </form>
    </Form>
  );
}
