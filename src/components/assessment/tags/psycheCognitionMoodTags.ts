/**
 * Operational Tags — Psyche (PSY), Cognition (COG) & Mood (MOO) dimensions
 *
 * PSY: Mental Wellbeing & Stress Management
 * COG: Mental Clarity & Focus
 * MOO: Mood & Motivation
 */

import type { OperationalTag } from '../types';

// ============================================================================
// DIMENSION G: PSYCHIKA (PSY) - Mental Wellbeing & Stress
// ============================================================================

export const PSY_TAGS: OperationalTag[] = [
  // Overall wellbeing
  { 
    id: 'psy_excellent', 
    dimension: 'PSY', 
    category: 'intensity',
    labelKey: 'assessment.tags.psy_excellent', 
    score: 9,
    operationalMapping: ['HADS_total'],
  },
  { 
    id: 'psy_good', 
    dimension: 'PSY', 
    category: 'intensity',
    labelKey: 'assessment.tags.psy_good', 
    score: 7,
  },
  { 
    id: 'psy_average', 
    dimension: 'PSY', 
    category: 'intensity',
    labelKey: 'assessment.tags.psy_average', 
    score: 5,
  },
  { 
    id: 'psy_strained', 
    dimension: 'PSY', 
    category: 'intensity',
    labelKey: 'assessment.tags.psy_strained', 
    score: 3,
  },
  { 
    id: 'psy_poor', 
    dimension: 'PSY', 
    category: 'intensity',
    labelKey: 'assessment.tags.psy_poor', 
    score: 1,
    followUpTrigger: ['psy_support_needed'],
  },

  // Statement tags (V2 - Psychika a stres)
  { 
    id: 'psy_handle_stress_well', 
    dimension: 'PSY', 
    category: 'pattern',
    labelKey: 'assessment.tags.psy_handle_stress_well', 
    score: null,
  },
  { 
    id: 'psy_frequent_tension', 
    dimension: 'PSY', 
    category: 'pattern',
    labelKey: 'assessment.tags.psy_frequent_tension', 
    score: null,
    inverseScore: true,
    followUpTrigger: ['psy_stress_source'],
  },

  // Stress related (single select)
  { 
    id: 'psy_low_stress', 
    dimension: 'PSY', 
    category: 'pattern',
    labelKey: 'assessment.tags.psy_low_stress', 
    score: null,
    operationalMapping: ['PSS-10'],
  },
  { 
    id: 'psy_moderate_stress', 
    dimension: 'PSY', 
    category: 'pattern',
    labelKey: 'assessment.tags.psy_moderate_stress', 
    score: null,
  },
  { 
    id: 'psy_high_stress', 
    dimension: 'PSY', 
    category: 'pattern',
    labelKey: 'assessment.tags.psy_high_stress', 
    score: null,
    inverseScore: true,
    followUpTrigger: ['psy_stress_source'],
  },
  { 
    id: 'psy_chronic_stress', 
    dimension: 'PSY', 
    category: 'pattern',
    labelKey: 'assessment.tags.psy_chronic_stress', 
    score: null,
    inverseScore: true,
    followUpTrigger: ['psy_stress_source', 'psy_support_needed'],
  },

  // Symptoms (multi select)
  { 
    id: 'psy_anxiety', 
    dimension: 'PSY', 
    category: 'symptom',
    labelKey: 'assessment.tags.psy_anxiety', 
    score: null,
    inverseScore: true,
    operationalMapping: ['HADS_A'],
  },
  { 
    id: 'psy_irritability', 
    dimension: 'PSY', 
    category: 'symptom',
    labelKey: 'assessment.tags.psy_irritability', 
    score: null,
    inverseScore: true,
  },
  { 
    id: 'psy_tension', 
    dimension: 'PSY', 
    category: 'symptom',
    labelKey: 'assessment.tags.psy_tension', 
    score: null,
    inverseScore: true,
  },
  { 
    id: 'psy_overwhelm', 
    dimension: 'PSY', 
    category: 'symptom',
    labelKey: 'assessment.tags.psy_overwhelm', 
    score: null,
    inverseScore: true,
  },
  { 
    id: 'psy_calm', 
    dimension: 'PSY', 
    category: 'symptom',
    labelKey: 'assessment.tags.psy_calm', 
    score: null,
  },
  { 
    id: 'psy_no_issues', 
    dimension: 'PSY', 
    category: 'symptom',
    labelKey: 'assessment.tags.psy_no_issues', 
    score: null,
  },
];

// ============================================================================
// DIMENSION H: KOGNICE (COG) - Mental Clarity & Focus
// ============================================================================

export const COG_TAGS: OperationalTag[] = [
  // Overall cognitive function
  { 
    id: 'cog_excellent', 
    dimension: 'COG', 
    category: 'intensity',
    labelKey: 'assessment.tags.cog_excellent', 
    score: 9,
  },
  { 
    id: 'cog_good', 
    dimension: 'COG', 
    category: 'intensity',
    labelKey: 'assessment.tags.cog_good', 
    score: 7,
  },
  { 
    id: 'cog_average', 
    dimension: 'COG', 
    category: 'intensity',
    labelKey: 'assessment.tags.cog_average', 
    score: 5,
  },
  { 
    id: 'cog_impaired', 
    dimension: 'COG', 
    category: 'intensity',
    labelKey: 'assessment.tags.cog_impaired', 
    score: 3,
    followUpTrigger: ['cog_impairment_details'],
  },
  { 
    id: 'cog_severely_impaired', 
    dimension: 'COG', 
    category: 'intensity',
    labelKey: 'assessment.tags.cog_severely_impaired', 
    score: 1,
    followUpTrigger: ['cog_impairment_details', 'cog_medical_evaluation'],
  },

  // Statement tags (V2 - Kognice)
  { 
    id: 'cog_good_concentration', 
    dimension: 'COG', 
    category: 'pattern',
    labelKey: 'assessment.tags.cog_good_concentration', 
    score: null,
  },
  { 
    id: 'cog_good_memory', 
    dimension: 'COG', 
    category: 'pattern',
    labelKey: 'assessment.tags.cog_good_memory', 
    score: null,
  },
  { 
    id: 'cog_feel_fresh', 
    dimension: 'COG', 
    category: 'pattern',
    labelKey: 'assessment.tags.cog_feel_fresh', 
    score: null,
  },

  // Specific issues (multi select)
  { 
    id: 'cog_brain_fog', 
    dimension: 'COG', 
    category: 'symptom',
    labelKey: 'assessment.tags.cog_brain_fog', 
    score: null,
    inverseScore: true,
    followUpTrigger: ['cog_fog_frequency'],
  },
  { 
    id: 'cog_concentration', 
    dimension: 'COG', 
    category: 'symptom',
    labelKey: 'assessment.tags.cog_concentration', 
    score: null,
    inverseScore: true,
    operationalMapping: ['MoCA_attention'],
  },
  { 
    id: 'cog_memory', 
    dimension: 'COG', 
    category: 'symptom',
    labelKey: 'assessment.tags.cog_memory', 
    score: null,
    inverseScore: true,
    operationalMapping: ['MoCA_memory'],
  },
  { 
    id: 'cog_mental_fatigue', 
    dimension: 'COG', 
    category: 'symptom',
    labelKey: 'assessment.tags.cog_mental_fatigue', 
    score: null,
    inverseScore: true,
  },
  { 
    id: 'cog_word_finding', 
    dimension: 'COG', 
    category: 'symptom',
    labelKey: 'assessment.tags.cog_word_finding', 
    score: null,
    inverseScore: true,
    operationalMapping: ['MoCA_language'],
  },

  // Positive indicators
  { 
    id: 'cog_sharp', 
    dimension: 'COG', 
    category: 'symptom',
    labelKey: 'assessment.tags.cog_sharp', 
    score: null,
  },
  { 
    id: 'cog_productive', 
    dimension: 'COG', 
    category: 'symptom',
    labelKey: 'assessment.tags.cog_productive', 
    score: null,
  },
  { 
    id: 'cog_no_issues', 
    dimension: 'COG', 
    category: 'symptom',
    labelKey: 'assessment.tags.cog_no_issues', 
    score: null,
  },
];

// ============================================================================
// DIMENSION I: NÁLADA (MOO) - Mood & Motivation
// ============================================================================

export const MOO_TAGS: OperationalTag[] = [
  // Overall mood
  { 
    id: 'moo_excellent', 
    dimension: 'MOO', 
    category: 'intensity',
    labelKey: 'assessment.tags.moo_excellent', 
    score: 9,
  },
  { 
    id: 'moo_good', 
    dimension: 'MOO', 
    category: 'intensity',
    labelKey: 'assessment.tags.moo_good', 
    score: 7,
  },
  { 
    id: 'moo_neutral', 
    dimension: 'MOO', 
    category: 'intensity',
    labelKey: 'assessment.tags.moo_neutral', 
    score: 5,
  },
  { 
    id: 'moo_low', 
    dimension: 'MOO', 
    category: 'intensity',
    labelKey: 'assessment.tags.moo_low', 
    score: 3,
    operationalMapping: ['HADS_D'],
  },
  { 
    id: 'moo_depressed', 
    dimension: 'MOO', 
    category: 'intensity',
    labelKey: 'assessment.tags.moo_depressed', 
    score: 1,
    followUpTrigger: ['moo_support_needed'],
  },

  // Statement tags (V2 - Nálada a motivace)
  { 
    id: 'moo_initiative', 
    dimension: 'MOO', 
    category: 'pattern',
    labelKey: 'assessment.tags.moo_initiative', 
    score: null,
  },
  { 
    id: 'moo_frequent_joy', 
    dimension: 'MOO', 
    category: 'pattern',
    labelKey: 'assessment.tags.moo_frequent_joy', 
    score: null,
  },
  { 
    id: 'moo_rare_joy', 
    dimension: 'MOO', 
    category: 'pattern',
    labelKey: 'assessment.tags.moo_rare_joy', 
    score: null,
    inverseScore: true,
  },

  // Stability (single select)
  { 
    id: 'moo_stable', 
    dimension: 'MOO', 
    category: 'pattern',
    labelKey: 'assessment.tags.moo_stable', 
    score: null,
  },
  { 
    id: 'moo_swings', 
    dimension: 'MOO', 
    category: 'pattern',
    labelKey: 'assessment.tags.moo_swings', 
    score: null,
    inverseScore: true,
  },

  // Motivation & joy (multi select)
  { 
    id: 'moo_motivated', 
    dimension: 'MOO', 
    category: 'symptom',
    labelKey: 'assessment.tags.moo_motivated', 
    score: null,
  },
  { 
    id: 'moo_low_motivation', 
    dimension: 'MOO', 
    category: 'symptom',
    labelKey: 'assessment.tags.moo_low_motivation', 
    score: null,
    inverseScore: true,
  },
  { 
    id: 'moo_joy', 
    dimension: 'MOO', 
    category: 'symptom',
    labelKey: 'assessment.tags.moo_joy', 
    score: null,
  },
  { 
    id: 'moo_anhedonia', 
    dimension: 'MOO', 
    category: 'symptom',
    labelKey: 'assessment.tags.moo_anhedonia', 
    score: null,
    inverseScore: true,
    operationalMapping: ['HADS_D_anhedonia'],
  },
  { 
    id: 'moo_purpose', 
    dimension: 'MOO', 
    category: 'symptom',
    labelKey: 'assessment.tags.moo_purpose', 
    score: null,
  },
  { 
    id: 'moo_hopeless', 
    dimension: 'MOO', 
    category: 'symptom',
    labelKey: 'assessment.tags.moo_hopeless', 
    score: null,
    inverseScore: true,
    followUpTrigger: ['moo_support_needed'],
  },
  { 
    id: 'moo_no_issues', 
    dimension: 'MOO', 
    category: 'symptom',
    labelKey: 'assessment.tags.moo_no_issues', 
    score: null,
  },
];
