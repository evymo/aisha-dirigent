/**
 * Blood matrix domain exports.
 */

export {
  BLOOD_MATRIX_CELL_KEYS,
  BLOOD_MATRIX_GRADES,
  BLOOD_MATRIX_PRODUCT_CODES,
  BLOOD_MATRIX_PROTOCOL_STEP_KEYS,
  BLOOD_MATRIX_AI_PRESET,
  createEmptyBloodMatrixMap,
  buildBloodMatrixAssessment,
  createBloodMatrixAiPrompt,
} from "./bloodMatrixLogic";

export type {
  BloodMatrixCellKey,
  BloodMatrixGrade,
  BloodMatrixAnalysisSource,
  BloodMatrixProductPriority,
  BloodMatrixProductCode,
  BloodMatrixProtocolStepKey,
  BloodMatrixSeverityLevel,
  BloodMatrixCellObservation,
  BloodMatrixMap,
  BloodMatrixProductRecommendation,
  BloodMatrixSeverityResult,
  BloodMatrixAssessment,
  BloodMatrixAiPromptInput,
} from "./bloodMatrixLogic";
