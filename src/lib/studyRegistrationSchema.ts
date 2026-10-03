import { z } from "zod";

/**
 * Schéma pro validaci hesla při registraci.
 * 
 * Vyžaduje:
 * - Délku 8-72 znaků
 * - Velké písmeno
 * - Malé písmeno
 * - Číslici
 */
const passwordSchema = z.string()
  .min(8, "Heslo musí mít alespoň 8 znaků / Password must be at least 8 characters")
  .max(72, "Heslo může mít maximálně 72 znaků / Password can have at most 72 characters")
  .regex(/[A-Z]/, "Heslo musí obsahovat velké písmeno / Password must contain uppercase letter")
  .regex(/[a-z]/, "Heslo musí obsahovat malé písmeno / Password must contain lowercase letter")
  .regex(/[0-9]/, "Heslo musí obsahovat číslo / Password must contain a number");

/**
 * Základní pole pro registraci do studie.
 * 
 * Sdílená mezi přihlášenými a novými uživateli.
 * Obsahuje osobní údaje, aktuální stav a typ členství.
 */
const baseStudyRegistrationFields = {
  // Basic info
  email: z.string().email("Neplatný email / Invalid email").max(255),
  dateOfBirth: z.date({
    required_error: "Datum narození je povinné / Date of birth is required",
  }),
  
  // Current state
  physicalState: z.number().min(1).max(10),
  mentalState: z.number().min(1).max(10),
  energyLevel: z.number().min(1).max(10),
  stressLevel: z.number().min(1).max(10),
  
  // Professional findings
  professionalFindings: z.string().max(2000).optional(),
  
  // Membership type
  membershipType: z.enum(["individual", "professional"]),
  
  note: z.string().max(2000).optional(),
  invitationCode: z.string().optional(),
};

/**
 * Schéma registrace pro NOVÉ uživatele.
 * 
 * Vyžaduje zadání a potvrzení hesla.
 */

// Schema for NEW users (password required)
const newUserStudyRegistrationSchema = z.object({
  ...baseStudyRegistrationFields,
  password: passwordSchema,
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Hesla se neshodují / Passwords do not match",
  path: ["confirmPassword"],
});

/**
 * Schéma registrace pro PŘIHLÁŠENÉ uživatele.
 * 
 * Heslo je volitelné (ignorováno).
 */

// Schema for LOGGED-IN users (password optional/ignored)
const loggedInStudyRegistrationSchema = z.object({
  ...baseStudyRegistrationFields,
  password: z.string().optional(),
  confirmPassword: z.string().optional(),
});

// Factory function to get the correct schema based on login state
export function getStudyRegistrationSchema(isLoggedIn: boolean) {
  return isLoggedIn ? loggedInStudyRegistrationSchema : newUserStudyRegistrationSchema;
}

// Default schema for type inference (backward compatibility)
export const studyRegistrationSchema = z.object({
  ...baseStudyRegistrationFields,
  password: passwordSchema.optional(),
  confirmPassword: z.string().optional(),
}).refine((data) => {
  // If password is provided, confirmPassword must match
  if (data.password && data.password !== data.confirmPassword) {
    return false;
  }
  return true;
}, {
  message: "Hesla se neshodují / Passwords don't match",
  path: ["confirmPassword"],
});

export const healthQuestionnaireSchema = z.object({
  // Pre-existing conditions
  hasPreExistingConditions: z.boolean(),
  preExistingConditionsDetails: z.string().max(2000).optional(),
  
  // Family history
  hasFamilyHistory: z.boolean(),
  familyHistoryDetails: z.string().max(2000).optional(),
  
  // Blood pressure
  lastBloodPressureDate: z.string().max(100).optional(),
  lastBloodPressureResult: z.string().max(100).optional(),
  
  // COVID vaccination
  covidVaccinationStatus: z.enum([
    "one_dose",
    "two_doses", 
    "three_doses",
    "unvaccinated",
    "other"
  ]),
  
  // Medications
  takingMedications: z.boolean(),
  medicationsList: z.string().max(2000).optional(),
  
  // Products
  productsList: z.string().max(2000).optional(),
  
  // Physical info
  gender: z.enum(["male", "female", "non_binary", "prefer_not_to_say"]),
  weight: z.number().min(20).max(500).optional(),
  height: z.number().min(50).max(300).optional(),
  
  // Work activity
  workActivity: z.enum(["none", "moderate", "high"]),
  
  // Exercise
  exercisesRegularly: z.boolean(),
  exerciseFrequency: z.enum([
    "never",
    "once_week",
    "2_3_week",
    "4_5_week",
    "6_7_week"
  ]).optional(),
  
  // Other activities
  leisureActivities: z.string().max(1000).optional(),
  
  // Diet
  onDietProgram: z.boolean(),
  dietDetails: z.string().max(1000).optional(),
  
  // Smoking
  smokes: z.boolean(),
  smokesPerDay: z.string().max(50).optional(),
  
  // Alcohol
  drinksAlcohol: z.boolean(),
  alcoholDetails: z.string().max(200).optional(),
  
  // Health conditions
  hasAsthma: z.boolean(),
  hasHighBloodPressure: z.enum(["yes", "no", "unknown"]),
  hasHeartCondition: z.boolean(),
  
  // Other conditions
  otherConditions: z.string().max(2000).optional(),
  
  // Past injuries/surgeries
  pastInjuriesSurgeries: z.string().max(2000).optional(),
  
  // Feedback
  questionnaireDifficulty: z.number().min(1).max(10).optional(),
  questionnaireFeedback: z.string().max(1000).optional(),
  referralSource: z.string().max(500).optional(),
});

export type StudyRegistrationData = z.infer<typeof studyRegistrationSchema>;
export type HealthQuestionnaireData = z.infer<typeof healthQuestionnaireSchema>;

// Factory function to get the correct full schema based on login state
export function getFullStudyRegistrationSchema(isLoggedIn: boolean) {
  return getStudyRegistrationSchema(isLoggedIn).and(healthQuestionnaireSchema);
}

// Use intersection to preserve the refine from studyRegistrationSchema (for backward compatibility)
export const fullStudyRegistrationSchema = studyRegistrationSchema.and(healthQuestionnaireSchema);
export type FullStudyRegistrationData = z.infer<typeof fullStudyRegistrationSchema>;

// Known questionnaire ID for study registration (must exist in questionnaires table)
export const STUDY_ENROLLMENT_QUESTIONNAIRE_ID = "00000000-0000-0000-0000-000000000001";

// Known questionnaire ID for qualification test results (must exist in questionnaires table)
export const QUALIFICATION_TEST_QUESTIONNAIRE_ID = "00000000-0000-0000-0000-000000000002";
