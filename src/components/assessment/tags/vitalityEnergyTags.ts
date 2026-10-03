/**
 * Operational Tags — Vitality (VIT) & Energy (ENE) dimensions
 *
 * VIT: Overall State & Vitality (SF-12)
 * ENE: Energy & Fatigue (FACIT-F)
 */

import type { OperationalTag } from '../types';

// ============================================================================
// DIMENSION A: VITALITA (VIT) - Overall State & Vitality
// ============================================================================

export const VIT_TAGS: OperationalTag[] = [
  // Intensity (single select)
  { 
    id: 'vit_excellent', 
    dimension: 'VIT', 
    category: 'intensity',
    labelKey: 'assessment.tags.vit_excellent', 
    score: 10,
    operationalMapping: ['SF-12_GH'],
  },
  { 
    id: 'vit_very_good', 
    dimension: 'VIT', 
    category: 'intensity',
    labelKey: 'assessment.tags.vit_very_good', 
    score: 8,
  },
  { 
    id: 'vit_good', 
    dimension: 'VIT', 
    category: 'intensity',
    labelKey: 'assessment.tags.vit_good', 
    score: 6,
  },
  { 
    id: 'vit_fair', 
    dimension: 'VIT', 
    category: 'intensity',
    labelKey: 'assessment.tags.vit_fair', 
    score: 4,
  },
  { 
    id: 'vit_poor', 
    dimension: 'VIT', 
    category: 'intensity',
    labelKey: 'assessment.tags.vit_poor', 
    score: 2,
    followUpTrigger: ['vit_limitation_details'],
  },

  // Statement tags (V2 dotazník - subjektivní tvrzení)
  { 
    id: 'vit_desire_for_life', 
    dimension: 'VIT', 
    category: 'pattern',
    labelKey: 'assessment.tags.vit_desire_for_life', 
    score: null,
    metadata: { severity: 'mild' },
  },
  { 
    id: 'vit_feel_vital', 
    dimension: 'VIT', 
    category: 'pattern',
    labelKey: 'assessment.tags.vit_feel_vital', 
    score: null,
  },
  { 
    id: 'vit_low_desire', 
    dimension: 'VIT', 
    category: 'pattern',
    labelKey: 'assessment.tags.vit_low_desire', 
    score: null,
    inverseScore: true,
  },

  // Descriptors (multi select)
  { 
    id: 'vit_alive', 
    dimension: 'VIT', 
    category: 'symptom',
    labelKey: 'assessment.tags.vit_alive', 
    score: null,
  },
  { 
    id: 'vit_functioning', 
    dimension: 'VIT', 
    category: 'symptom',
    labelKey: 'assessment.tags.vit_functioning', 
    score: null,
  },
  { 
    id: 'vit_limited', 
    dimension: 'VIT', 
    category: 'symptom',
    labelKey: 'assessment.tags.vit_limited', 
    score: null,
    inverseScore: true,
    followUpTrigger: ['vit_limitation_details'],
  },
  { 
    id: 'vit_struggling', 
    dimension: 'VIT', 
    category: 'symptom',
    labelKey: 'assessment.tags.vit_struggling', 
    score: null,
    inverseScore: true,
    operationalMapping: ['SF-12_PF'],
  },
];

// ============================================================================
// DIMENSION B: ENERGIE (ENE) - Energy & Fatigue
// ============================================================================

export const ENE_TAGS: OperationalTag[] = [
  // Intensity levels
  { 
    id: 'ene_high', 
    dimension: 'ENE', 
    category: 'intensity',
    labelKey: 'assessment.tags.ene_high', 
    score: 9,
    operationalMapping: ['FACIT-F_HI1'],
  },
  { 
    id: 'ene_stable', 
    dimension: 'ENE', 
    category: 'intensity',
    labelKey: 'assessment.tags.ene_stable', 
    score: 7,
  },
  { 
    id: 'ene_variable', 
    dimension: 'ENE', 
    category: 'intensity',
    labelKey: 'assessment.tags.ene_variable', 
    score: 5,
  },
  { 
    id: 'ene_low', 
    dimension: 'ENE', 
    category: 'intensity',
    labelKey: 'assessment.tags.ene_low', 
    score: 3,
    operationalMapping: ['FACIT-F_HI7'],
  },
  { 
    id: 'ene_depleted', 
    dimension: 'ENE', 
    category: 'intensity',
    labelKey: 'assessment.tags.ene_depleted', 
    score: 1,
    followUpTrigger: ['ene_depletion_duration', 'ene_depletion_cause'],
  },

  // Pattern tags (single select)
  { 
    id: 'ene_pattern_morning', 
    dimension: 'ENE', 
    category: 'pattern',
    labelKey: 'assessment.tags.ene_pattern_morning', 
    score: null,
  },
  { 
    id: 'ene_pattern_afternoon', 
    dimension: 'ENE', 
    category: 'pattern',
    labelKey: 'assessment.tags.ene_pattern_afternoon', 
    score: null,
    operationalMapping: ['FACIT-F_An2'],
  },
  { 
    id: 'ene_pattern_evening', 
    dimension: 'ENE', 
    category: 'pattern',
    labelKey: 'assessment.tags.ene_pattern_evening', 
    score: null,
  },
  { 
    id: 'ene_pattern_postmeal', 
    dimension: 'ENE', 
    category: 'pattern',
    labelKey: 'assessment.tags.ene_pattern_postmeal', 
    score: null,
    followUpTrigger: ['met_blood_sugar'],
  },
  { 
    id: 'ene_pattern_constant', 
    dimension: 'ENE', 
    category: 'pattern',
    labelKey: 'assessment.tags.ene_pattern_constant', 
    score: null,
  },

  // Statement tags (V2 - Zotavení po zátěži)
  { 
    id: 'ene_fast_recovery', 
    dimension: 'ENE', 
    category: 'pattern',
    labelKey: 'assessment.tags.ene_fast_recovery', 
    score: null,
  },

  // Symptom/manifestation tags (multi select)
  { 
    id: 'ene_need_rest', 
    dimension: 'ENE', 
    category: 'symptom',
    labelKey: 'assessment.tags.ene_need_rest', 
    score: null,
    inverseScore: true,
    metadata: { severity: 'moderate' },
  },
  { 
    id: 'ene_caffeine_dependent', 
    dimension: 'ENE', 
    category: 'symptom',
    labelKey: 'assessment.tags.ene_caffeine_dependent', 
    score: null,
    inverseScore: true,
  },
  { 
    id: 'ene_hard_wakeup', 
    dimension: 'ENE', 
    category: 'symptom',
    labelKey: 'assessment.tags.ene_hard_wakeup', 
    score: null,
    inverseScore: true,
    followUpTrigger: ['slp_quality'],
  },
  { 
    id: 'ene_slow_recovery', 
    dimension: 'ENE', 
    category: 'symptom',
    labelKey: 'assessment.tags.ene_slow_recovery', 
    score: null,
    inverseScore: true,
    operationalMapping: ['FACIT-F_An1'],
  },
  { 
    id: 'ene_frequent_fatigue', 
    dimension: 'ENE', 
    category: 'symptom',
    labelKey: 'assessment.tags.ene_frequent_fatigue', 
    score: null,
    inverseScore: true,
    operationalMapping: ['FACIT-F_HI6'],
  },
  { 
    id: 'ene_no_issues', 
    dimension: 'ENE', 
    category: 'symptom',
    labelKey: 'assessment.tags.ene_no_issues', 
    score: null,
  },
];
