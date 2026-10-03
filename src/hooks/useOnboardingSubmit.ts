import { useMutation } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { getUser as getKcUser } from "@/integrations/auth/oidc-client";
import { safeError } from "@/lib/security/safeLogger";

interface OnboardingSubmitParams {
  overall_feeling: number;
  energy_perception: number;
  physical_confidence: number;
  mental_wellbeing: number;
  sleep_satisfaction: number;
  primary_concern: string;
  main_goal: string;
  timeframe_expectation: string;
  mentor_preference: string;
  communication_style: string;
  age_range: string;
  has_chronic_condition: boolean;
  condition_brief: string;
  secondary_concerns: string[];
}

export function useOnboardingSubmit() {
  return useMutation({
    mutationFn: async (params: OnboardingSubmitParams) => {
      const user = await getKcUser();
      
      if (!user) {
        throw new Error("No authenticated user");
      }

      const { error } = await aisha.rpc("submit_onboarding_response_audited", {
        p_age_range: params.age_range,
        p_communication_style: params.communication_style,
        p_condition_brief: params.condition_brief ?? "",
        p_energy_perception: params.energy_perception,
        p_has_chronic_condition: params.has_chronic_condition,
        p_main_goal: params.main_goal,
        p_mental_wellbeing: params.mental_wellbeing,
        p_mentor_preference: params.mentor_preference,
        p_overall_feeling: params.overall_feeling,
        p_physical_confidence: params.physical_confidence,
        p_primary_concern: params.primary_concern,
        p_secondary_concerns: params.secondary_concerns
,
        p_sleep_satisfaction: params.sleep_satisfaction,
        p_timeframe_expectation: params.timeframe_expectation
    });

      if (error) throw new Error(error.message);
    },
    onError: (error) => {
      safeError("member.onboarding.submitFailed", error);
    },
  });
}
