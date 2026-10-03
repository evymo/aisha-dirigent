/**
 * Operational Tags — Metabolism (MET) & Immunity (IMM) dimensions
 *
 * MET: Digestion & Energy Stability
 * IMM: Immunity & Resilience
 */

import type { OperationalTag } from '../types';

// ============================================================================
// DIMENSION E: METABOLISMUS (MET) - Digestion & Energy Stability
// ============================================================================

export const MET_TAGS: OperationalTag[] = [
  // Digestion quality
  { 
    id: 'met_excellent', 
    dimension: 'MET', 
    category: 'intensity',
    labelKey: 'assessment.tags.met_excellent', 
    score: 9,
  },
  { 
    id: 'met_good', 
    dimension: 'MET', 
    category: 'intensity',
    labelKey: 'assessment.tags.met_good', 
    score: 7,
  },
  { 
    id: 'met_variable', 
    dimension: 'MET', 
    category: 'intensity',
    labelKey: 'assessment.tags.met_variable', 
    score: 5,
  },
  { 
    id: 'met_problematic', 
    dimension: 'MET', 
    category: 'intensity',
    labelKey: 'assessment.tags.met_problematic', 
    score: 3,
    followUpTrigger: ['met_issues'],
  },
  { 
    id: 'met_poor', 
    dimension: 'MET', 
    category: 'intensity',
    labelKey: 'assessment.tags.met_poor', 
    score: 1,
    followUpTrigger: ['met_issues', 'met_diagnosed'],
  },

  // Statement tags (V2 - Metabolismus)
  { 
    id: 'met_stable_energy', 
    dimension: 'MET', 
    category: 'pattern',
    labelKey: 'assessment.tags.met_stable_energy', 
    score: null,
  },
  { 
    id: 'met_regular_bowel', 
    dimension: 'MET', 
    category: 'pattern',
    labelKey: 'assessment.tags.met_regular_bowel', 
    score: null,
  },

  // Specific issues (multi select)
  { 
    id: 'met_bloating', 
    dimension: 'MET', 
    category: 'symptom',
    labelKey: 'assessment.tags.met_bloating', 
    score: null,
    inverseScore: true,
  },
  { 
    id: 'met_heaviness', 
    dimension: 'MET', 
    category: 'symptom',
    labelKey: 'assessment.tags.met_heaviness', 
    score: null,
    inverseScore: true,
  },
  { 
    id: 'met_heartburn', 
    dimension: 'MET', 
    category: 'symptom',
    labelKey: 'assessment.tags.met_heartburn', 
    score: null,
    inverseScore: true,
  },
  { 
    id: 'met_irregular_bowel', 
    dimension: 'MET', 
    category: 'symptom',
    labelKey: 'assessment.tags.met_irregular_bowel', 
    score: null,
    inverseScore: true,
  },
  { 
    id: 'met_food_sensitivity', 
    dimension: 'MET', 
    category: 'symptom',
    labelKey: 'assessment.tags.met_food_sensitivity', 
    score: null,
    inverseScore: true,
    followUpTrigger: ['met_food_triggers'],
  },

  // Energy stability patterns
  { 
    id: 'met_stable_appetite', 
    dimension: 'MET', 
    category: 'pattern',
    labelKey: 'assessment.tags.met_stable_appetite', 
    score: null,
  },
  { 
    id: 'met_energy_crash', 
    dimension: 'MET', 
    category: 'pattern',
    labelKey: 'assessment.tags.met_energy_crash', 
    score: null,
    inverseScore: true,
    followUpTrigger: ['met_blood_sugar'],
  },
  { 
    id: 'met_cravings', 
    dimension: 'MET', 
    category: 'pattern',
    labelKey: 'assessment.tags.met_cravings', 
    score: null,
    inverseScore: true,
  },
  { 
    id: 'met_no_issues', 
    dimension: 'MET', 
    category: 'symptom',
    labelKey: 'assessment.tags.met_no_issues', 
    score: null,
  },
];

// ============================================================================
// DIMENSION F: IMUNITA (IMM) - Immunity & Resilience
// ============================================================================

export const IMM_TAGS: OperationalTag[] = [
  // Overall immunity
  { 
    id: 'imm_strong', 
    dimension: 'IMM', 
    category: 'intensity',
    labelKey: 'assessment.tags.imm_strong', 
    score: 9,
  },
  { 
    id: 'imm_good', 
    dimension: 'IMM', 
    category: 'intensity',
    labelKey: 'assessment.tags.imm_good', 
    score: 7,
  },
  { 
    id: 'imm_average', 
    dimension: 'IMM', 
    category: 'intensity',
    labelKey: 'assessment.tags.imm_average', 
    score: 5,
  },
  { 
    id: 'imm_weak', 
    dimension: 'IMM', 
    category: 'intensity',
    labelKey: 'assessment.tags.imm_weak', 
    score: 3,
  },
  { 
    id: 'imm_very_weak', 
    dimension: 'IMM', 
    category: 'intensity',
    labelKey: 'assessment.tags.imm_very_weak', 
    score: 1,
    followUpTrigger: ['imm_conditions'],
  },

  // Statement tags (V2 - Imunita)
  { 
    id: 'imm_feel_resilient', 
    dimension: 'IMM', 
    category: 'pattern',
    labelKey: 'assessment.tags.imm_feel_resilient', 
    score: null,
  },

  // Frequency of illness (single select)
  { 
    id: 'imm_rarely_sick', 
    dimension: 'IMM', 
    category: 'pattern',
    labelKey: 'assessment.tags.imm_rarely_sick', 
    score: null,
  },
  { 
    id: 'imm_sometimes_sick', 
    dimension: 'IMM', 
    category: 'pattern',
    labelKey: 'assessment.tags.imm_sometimes_sick', 
    score: null,
  },
  { 
    id: 'imm_often_sick', 
    dimension: 'IMM', 
    category: 'pattern',
    labelKey: 'assessment.tags.imm_often_sick', 
    score: null,
    inverseScore: true,
    followUpTrigger: ['imm_illness_type'],
  },

  // Recovery (single select)
  { 
    id: 'imm_fast_recovery', 
    dimension: 'IMM', 
    category: 'pattern',
    labelKey: 'assessment.tags.imm_fast_recovery', 
    score: null,
  },
  { 
    id: 'imm_slow_recovery', 
    dimension: 'IMM', 
    category: 'pattern',
    labelKey: 'assessment.tags.imm_slow_recovery', 
    score: null,
    inverseScore: true,
  },

  // Conditions (multi select)
  { 
    id: 'imm_allergies', 
    dimension: 'IMM', 
    category: 'symptom',
    labelKey: 'assessment.tags.imm_allergies', 
    score: null,
    inverseScore: true,
    followUpTrigger: ['imm_allergy_type'],
  },
  { 
    id: 'imm_inflammation', 
    dimension: 'IMM', 
    category: 'symptom',
    labelKey: 'assessment.tags.imm_inflammation', 
    score: null,
    inverseScore: true,
  },
  { 
    id: 'imm_autoimmune', 
    dimension: 'IMM', 
    category: 'symptom',
    labelKey: 'assessment.tags.imm_autoimmune', 
    score: null,
    inverseScore: true,
    followUpTrigger: ['imm_autoimmune_diagnosis'],
  },
  { 
    id: 'imm_no_issues', 
    dimension: 'IMM', 
    category: 'symptom',
    labelKey: 'assessment.tags.imm_no_issues', 
    score: null,
  },
];
