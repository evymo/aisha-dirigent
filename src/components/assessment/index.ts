/**
 * Operational Tag Assessment System (CTAS)
 * 
 * A sophisticated health assessment system using operationally-validated
 * tag-based questions mapped to standardized medical instruments.
 * 
 * Features:
 * - 9 health dimensions (VIT, ENE, SLP, PHY, MET, IMM, PSY, COG, MOO)
 * - Tag categories: intensity, pattern, symptom, context, followup
 * - Longevity Score calculation (0-100%)
 * - Conditional follow-up questions
 * - Operational validation mappings (SF-12, FACIT-F, PSQI, HADS, PSS-10, MoCA)
 * 
 * @see /docs/proposals/CLINICAL_TAG_ASSESSMENT_SYSTEM.md for full documentation
 */

// Types
export * from "./types";

// Tag Database
export {
  ALL_TAGS,
  getTagsForDimension,
  getIntensityTags,
  getPatternTags,
  getSymptomTags,
  getContextTags,
  getTagById,
  getTriggeredFollowUps,
  // Individual dimension exports
  VIT_TAGS,
  ENE_TAGS,
  SLP_TAGS,
  PHY_TAGS,
  MET_TAGS,
  IMM_TAGS,
  PSY_TAGS,
  COG_TAGS,
  MOO_TAGS,
} from "./tagDatabase";

// Score Calculator
export {
  calculateDimensionScore,
  calculateLongevityScore,
  getScoreInterpretation,
  getScoreColorClass,
  getScoreBgClass,
  getTrendInterpretation,
  getTrendColorClass,
  getTrendArrow,
  getPriorityDimensions,
  hasCriticalFlags,
} from "./scoreCalculator";

// Components
export { OperationalTagCard } from "./OperationalTagCard";
export { IntensitySelector } from "./IntensitySelector";
export { DimensionTagGrid } from "./DimensionTagGrid";
export { DimensionalAssessment } from "./DimensionalAssessment";
export { AssessmentSummary } from "./AssessmentSummary";
export { ConditionalQuestionPanel } from "./ConditionalQuestionPanel";

// Main Wizard (with persistence)
export { 
  OperationalAssessmentWizard,
  PreviousScoreIndicator,
} from "./OperationalAssessmentWizard";
