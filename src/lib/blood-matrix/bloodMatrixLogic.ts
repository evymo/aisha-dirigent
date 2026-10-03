/**
 * Domain logic for blood drop matrix (3x3) scoring and recommendations.
 *
 * This module is UI-agnostic and can be reused by StoryLoop forms, renderers,
 * and future AI/reporting flows.
 */

/**
 * Allowed matrix cell keys.
 */
export const BLOOD_MATRIX_CELL_KEYS = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
] as const;

export type BloodMatrixCellKey = (typeof BLOOD_MATRIX_CELL_KEYS)[number];

/**
 * Allowed severity grades in each cell.
 */
export const BLOOD_MATRIX_GRADES = ["0", "I", "II", "III"] as const;

export type BloodMatrixGrade = (typeof BLOOD_MATRIX_GRADES)[number];

/**
 * Supported source types for the analysis.
 */
export type BloodMatrixAnalysisSource = "manual" | "ai_photo" | "hybrid";

/**
 * Product recommendation priority.
 */
export type BloodMatrixProductPriority = "core" | "support" | "optional";

/**
 * Generic product codes (non-brand specific).
 */
export const BLOOD_MATRIX_PRODUCT_CODES = [
  "hydration_electrolytes",
  "omega3",
  "phosphatidylcholine",
  "probiotic",
  "digestive_enzymes",
  "berberine_oregano",
  "liver_support",
  "nac",
  "magnesium",
  "vitamin_d3_k2",
  "zinc_selenium",
  "fiber_prebiotic",
  "antiparasitic_botanicals",
] as const;

export type BloodMatrixProductCode = (typeof BLOOD_MATRIX_PRODUCT_CODES)[number];

/**
 * Generic protocol step keys.
 */
export const BLOOD_MATRIX_PROTOCOL_STEP_KEYS = [
  "hydration",
  "gut_support",
  "microbial_balance",
  "liver_detox",
  "membrane_rebuild",
] as const;

export type BloodMatrixProtocolStepKey = (typeof BLOOD_MATRIX_PROTOCOL_STEP_KEYS)[number];

/**
 * Computed severity level.
 */
export type BloodMatrixSeverityLevel = "low" | "moderate" | "elevated" | "high";

/**
 * Single matrix cell observation.
 */
export interface BloodMatrixCellObservation {
  grade: BloodMatrixGrade;
  note?: string;
}

/**
 * Complete 3x3 matrix map keyed by fixed numeric string keys.
 */
export type BloodMatrixMap = Record<BloodMatrixCellKey, BloodMatrixCellObservation>;

/**
 * Aggregated recommendation for one product.
 */
export interface BloodMatrixProductRecommendation {
  code: BloodMatrixProductCode;
  priority: BloodMatrixProductPriority;
  reason_cell_keys: BloodMatrixCellKey[];
}

/**
 * Computed severity payload.
 */
export interface BloodMatrixSeverityResult {
  level: BloodMatrixSeverityLevel;
  protocol_steps: 1 | 2 | 3 | 5;
  recommended_days_min: number;
  recommended_days_max: number;
}

/**
 * Full matrix assessment result.
 */
export interface BloodMatrixAssessment {
  counts: {
    I: number;
    II: number;
    III: number;
  };
  weighted_score: number;
  flagged_cell_keys: BloodMatrixCellKey[];
  severity: BloodMatrixSeverityResult;
  protocol_step_keys: BloodMatrixProtocolStepKey[];
  product_recommendations: BloodMatrixProductRecommendation[];
  severe_parasite_signal: boolean;
}

/**
 * Optional helper input for AI prompt generation.
 */
export interface BloodMatrixAiPromptInput {
  matrix: BloodMatrixMap;
  summary_note?: string;
  analysis_source?: BloodMatrixAnalysisSource;
}

const CELL_PRODUCT_MAP: Record<
  BloodMatrixCellKey,
  ReadonlyArray<{ code: BloodMatrixProductCode; priority: BloodMatrixProductPriority }>
> = {
  "1": [
    { code: "hydration_electrolytes", priority: "core" },
    { code: "omega3", priority: "support" },
    { code: "phosphatidylcholine", priority: "support" },
  ],
  "2": [
    { code: "probiotic", priority: "core" },
    { code: "berberine_oregano", priority: "support" },
    { code: "fiber_prebiotic", priority: "support" },
  ],
  "3": [
    { code: "berberine_oregano", priority: "core" },
    { code: "probiotic", priority: "support" },
    { code: "hydration_electrolytes", priority: "support" },
  ],
  "4": [
    { code: "liver_support", priority: "core" },
    { code: "nac", priority: "support" },
    { code: "hydration_electrolytes", priority: "support" },
  ],
  "5": [
    { code: "omega3", priority: "core" },
    { code: "phosphatidylcholine", priority: "core" },
    { code: "magnesium", priority: "support" },
    { code: "vitamin_d3_k2", priority: "optional" },
  ],
  "6": [
    { code: "antiparasitic_botanicals", priority: "core" },
    { code: "zinc_selenium", priority: "support" },
    { code: "probiotic", priority: "support" },
  ],
  "7": [
    { code: "hydration_electrolytes", priority: "core" },
    { code: "omega3", priority: "support" },
    { code: "magnesium", priority: "support" },
  ],
  "8": [],
  "9": [
    { code: "antiparasitic_botanicals", priority: "core" },
    { code: "probiotic", priority: "support" },
    { code: "zinc_selenium", priority: "support" },
    { code: "liver_support", priority: "support" },
  ],
};

const PRIORITY_WEIGHT: Record<BloodMatrixProductPriority, number> = {
  core: 3,
  support: 2,
  optional: 1,
};

const WEIGHT_BY_GRADE: Record<BloodMatrixGrade, number> = {
  "0": 0,
  I: 1,
  II: 2,
  III: 3,
};

/**
 * Example prefilled matrix used for quick input from sample photo analysis.
 */
export const BLOOD_MATRIX_AI_PRESET: BloodMatrixMap = {
  "1": { grade: "0", note: "" },
  "2": { grade: "I", note: "mild_bacterial_load" },
  "3": { grade: "II", note: "mycotic_biofilm" },
  "4": { grade: "II", note: "active_fibrin" },
  "5": { grade: "III", note: "echinocyte_pattern" },
  "6": { grade: "II", note: "protozoa_activity" },
  "7": { grade: "I", note: "mild_aggregation" },
  "8": { grade: "0", note: "" },
  "9": { grade: "III", note: "helminth_egg_signal" },
};

/**
 * Create empty 3x3 matrix with grade 0 in all cells.
 */
export function createEmptyBloodMatrixMap(): BloodMatrixMap {
  return BLOOD_MATRIX_CELL_KEYS.reduce<BloodMatrixMap>((acc, key) => {
    acc[key] = { grade: "0", note: "" };
    return acc;
  }, {} as BloodMatrixMap);
}

function resolveSeverity(gradeThreeCount: number): BloodMatrixSeverityResult {
  if (gradeThreeCount >= 6) {
    return {
      level: "high",
      protocol_steps: 5,
      recommended_days_min: 30,
      recommended_days_max: 60,
    };
  }

  if (gradeThreeCount >= 4) {
    return {
      level: "elevated",
      protocol_steps: 3,
      recommended_days_min: 21,
      recommended_days_max: 42,
    };
  }

  if (gradeThreeCount >= 2) {
    return {
      level: "moderate",
      protocol_steps: 2,
      recommended_days_min: 14,
      recommended_days_max: 28,
    };
  }

  return {
    level: "low",
    protocol_steps: 1,
    recommended_days_min: 7,
    recommended_days_max: 14,
  };
}

/**
 * Compute matrix severity, generic protocol steps, and product recommendations.
 */
export function buildBloodMatrixAssessment(matrix: BloodMatrixMap): BloodMatrixAssessment {
  const counts = {
    I: 0,
    II: 0,
    III: 0,
  };

  const flaggedCellKeys: BloodMatrixCellKey[] = [];
  let weightedScore = 0;

  const aggregate = new Map<
    BloodMatrixProductCode,
    { priority: BloodMatrixProductPriority; reasonCellKeys: Set<BloodMatrixCellKey> }
  >();

  for (const key of BLOOD_MATRIX_CELL_KEYS) {
    const observation = matrix[key];
    const grade = observation?.grade ?? "0";
    weightedScore += WEIGHT_BY_GRADE[grade];

    if (grade === "I" || grade === "II" || grade === "III") {
      counts[grade] += 1;
      flaggedCellKeys.push(key);
    }

    if (grade === "0") {
      continue;
    }

    for (const item of CELL_PRODUCT_MAP[key]) {
      const existing = aggregate.get(item.code);
      if (!existing) {
        aggregate.set(item.code, {
          priority: item.priority,
          reasonCellKeys: new Set([key]),
        });
        continue;
      }

      if (PRIORITY_WEIGHT[item.priority] > PRIORITY_WEIGHT[existing.priority]) {
        existing.priority = item.priority;
      }
      existing.reasonCellKeys.add(key);
    }
  }

  const severity = resolveSeverity(counts.III);

  const protocolStepKeys = BLOOD_MATRIX_PROTOCOL_STEP_KEYS.slice(
    0,
    severity.protocol_steps
  ) as BloodMatrixProtocolStepKey[];

  const productRecommendations = Array.from(aggregate.entries())
    .map(([code, payload]) => ({
      code,
      priority: payload.priority,
      reason_cell_keys: Array.from(payload.reasonCellKeys).sort() as BloodMatrixCellKey[],
    }))
    .sort((a, b) => {
      const priorityDiff = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return a.code.localeCompare(b.code);
    });

  return {
    counts,
    weighted_score: weightedScore,
    flagged_cell_keys: flaggedCellKeys,
    severity,
    protocol_step_keys: protocolStepKeys,
    product_recommendations: productRecommendations,
    severe_parasite_signal:
      matrix["6"]?.grade === "III" || matrix["9"]?.grade === "III",
  };
}

/**
 * Generate a compact AI prompt from matrix grades/notes.
 */
export function createBloodMatrixAiPrompt({
  matrix,
  summary_note,
  analysis_source = "manual",
}: BloodMatrixAiPromptInput): string {
  const rowSummary = BLOOD_MATRIX_CELL_KEYS.map((key) => {
    const item = matrix[key];
    const note = item.note?.trim();
    return note ? `${key}:${item.grade} (${note})` : `${key}:${item.grade}`;
  }).join("; ");

  const summaryPart = summary_note?.trim()
    ? `\nPoznámka terapeuta: ${summary_note.trim()}`
    : "";

  return (
    "Vyhodnoť nález živé kapky krve (3x3 matice) pro orientační doporučení " +
    `doplnků stravy. Zdroj: ${analysis_source}.\n` +
    `Matice: ${rowSummary}` +
    `${summaryPart}\n` +
    "Vrať stručné shrnutí rizik, priority intervencí a bezpečný 4-8týdenní plán."
  );
}
