import type { FullStudyRegistrationData } from "@/lib/studyRegistrationSchema";
import type { UseFormReturn } from "react-hook-form";
import type { Locale } from "date-fns";

export interface StudyConsentRequirementLocalized {
  id: string;
  consent_template_id: string;
  is_required: boolean;
  sort_order: number;
  template_key: string;
  title: string;
  content: string;
  version: string;
  requires_signature: boolean;
}

export interface RegistrationFormProps {
  form: UseFormReturn<FullStudyRegistrationData>;
  isLoggedIn: boolean;
}

export interface StepProps extends RegistrationFormProps {
  dateLocale: Locale;
}

export interface Step5Props extends RegistrationFormProps {
  consentRequirements: StudyConsentRequirementLocalized[] | undefined;
  consentRequirementsLoading: boolean;
  consentChecks: Record<string, boolean>;
  setConsentChecks: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  hasAllRequiredConsents: boolean;
}

export const ENROLLMENT_STEPS = [
  { id: 1, titleKey: "study.registration.steps.basicInfo" },
  { id: 2, titleKey: "study.registration.steps.currentState" },
  { id: 3, titleKey: "study.registration.steps.trackingHistory" },
  { id: 4, titleKey: "study.registration.steps.lifestyle" },
  { id: 5, titleKey: "study.registration.steps.complete" },
] as const;

export const getFieldsForStep = (step: number): (keyof FullStudyRegistrationData)[] => {
  switch (step) {
    case 1:
      return ["email", "dateOfBirth", "membershipType"];
    case 2:
      return ["physicalState", "mentalState", "energyLevel", "stressLevel", "professionalFindings"];
    case 3:
      return [
        "hasPreExistingConditions",
        "hasFamilyHistory",
        "covidVaccinationStatus",
        "takingMedications",
        "gender",
        "weight",
        "height",
      ];
    case 4:
      return [
        "workActivity",
        "exercisesRegularly",
        "onDietProgram",
        "smokes",
        "drinksAlcohol",
        "hasAsthma",
        "hasHighBloodPressure",
        "hasHeartCondition",
      ];
    default:
      return [];
  }
};
