import { z } from "zod";
import type { UseFormReturn } from "react-hook-form";

// Schema factory to use translation function
export const createOnboardingSchema = (t: (key: string) => string) => z.object({
  // Feelings (most important!)
  overall_feeling: z.number().min(0).max(10),
  energy_perception: z.number().min(0).max(10),
  physical_confidence: z.number().min(0).max(10),
  mental_wellbeing: z.number().min(0).max(10),
  sleep_satisfaction: z.number().min(0).max(10),

  // Priorities
  primary_concern: z.string().min(10, t("onboarding.validation.primaryConcernMin")),
  main_goal: z.string().min(10, t("onboarding.validation.mainGoalMin")),
  timeframe_expectation: z.enum(["asap", "1_month", "3_months", "6_months", "1_year"]),

  // Mentor preferences
  mentor_preference: z.enum(["male", "female", "no_preference"]),
  communication_style: z.enum(["frequent", "moderate", "minimal"]),

  // Basic context
  age_range: z.enum(["18-25", "26-35", "36-45", "46-55", "56-65", "65+"]),
  has_chronic_condition: z.boolean(),
  condition_brief: z.string().optional(),
});

export type OnboardingData = z.infer<ReturnType<typeof createOnboardingSchema>>;

export interface OnboardingStepProps {
  form: UseFormReturn<OnboardingData>;
}

export type FeelingsStepProps = OnboardingStepProps;

export interface ConcernsStepProps extends OnboardingStepProps {
  selectedConcernTags: string[];
  toggleConcernTag: (tag: string) => void;
  selectedGoalTags: string[];
  toggleGoalTag: (tag: string) => void;
}

export type PreferencesStepProps = OnboardingStepProps;

// Tags are defined as keys for translation lookup
export const CONCERN_TAG_KEYS = [
  "chronicFatigue",
  "jointPain",
  "sleepProblems",
  "stressAnxiety",
  "digestiveIssues",
  "lowImmunity",
  "headaches",
  "lowMotivation",
] as const;

export const GOAL_TAG_KEYS = [
  "moreEnergy",
  "lessPain",
  "betterSleep",
  "strongerImmunity",
  "reduceStress",
  "loseWeight",
  "gainMuscle",
  "feelBetter",
] as const;

export const ONBOARDING_STEPS = [
  { id: 1, titleKey: "onboarding.steps.feelings", icon: "Heart" },
  { id: 2, titleKey: "onboarding.steps.concerns", icon: "Sparkles" },
  { id: 3, titleKey: "onboarding.steps.preferences", icon: "Users" },
  { id: 4, titleKey: "onboarding.steps.assessment", icon: "Activity" },
] as const;

export const TIMEFRAME_OPTIONS = ["asap", "1_month", "3_months", "6_months", "1_year"] as const;
export const AGE_RANGES = ["18-25", "26-35", "36-45", "46-55", "56-65", "65+"] as const;
export const COMMUNICATION_STYLES = ["frequent", "moderate", "minimal"] as const;
export const MENTOR_PREFERENCES = ["male", "female", "no_preference"] as const;
