/**
 * Operational Tags — Sleep (SLP) & Physical Body (PHY) dimensions
 *
 * SLP: Sleep Quality & Regeneration (PSQI)
 * PHY: Physical Body & Pain (SF-12)
 */

import type { OperationalTag } from '../types';

// ============================================================================
// DIMENSION C: SPÁNEK (SLP) - Sleep Quality & Regeneration
// ============================================================================

export const SLP_TAGS: OperationalTag[] = [
  // Quality intensity
  { 
    id: 'slp_excellent', 
    dimension: 'SLP', 
    category: 'intensity',
    labelKey: 'assessment.tags.slp_excellent', 
    score: 9,
    operationalMapping: ['PSQI_QUAL'],
  },
  { 
    id: 'slp_good', 
    dimension: 'SLP', 
    category: 'intensity',
    labelKey: 'assessment.tags.slp_good', 
    score: 7,
  },
  { 
    id: 'slp_average', 
    dimension: 'SLP', 
    category: 'intensity',
    labelKey: 'assessment.tags.slp_average', 
    score: 5,
  },
  { 
    id: 'slp_poor', 
    dimension: 'SLP', 
    category: 'intensity',
    labelKey: 'assessment.tags.slp_poor', 
    score: 3,
    followUpTrigger: ['slp_issues'],
  },
  { 
    id: 'slp_very_poor', 
    dimension: 'SLP', 
    category: 'intensity',
    labelKey: 'assessment.tags.slp_very_poor', 
    score: 1,
    followUpTrigger: ['slp_issues', 'slp_duration'],
  },

  // Statement tags (V2 - Spánek a regenerace)
  { 
    id: 'slp_easy_falling', 
    dimension: 'SLP', 
    category: 'pattern',
    labelKey: 'assessment.tags.slp_easy_falling', 
    score: null,
  },
  { 
    id: 'slp_feel_rested', 
    dimension: 'SLP', 
    category: 'pattern',
    labelKey: 'assessment.tags.slp_feel_rested', 
    score: null,
  },
  { 
    id: 'slp_hard_falling', 
    dimension: 'SLP', 
    category: 'pattern',
    labelKey: 'assessment.tags.slp_hard_falling', 
    score: null,
    inverseScore: true,
    followUpTrigger: ['slp_issues'],
  },

  // Duration context (single select)
  { 
    id: 'slp_under_6h', 
    dimension: 'SLP', 
    category: 'context',
    labelKey: 'assessment.tags.slp_under_6h', 
    score: null,
    metadata: { duration: 'chronic' },
  },
  { 
    id: 'slp_6_7h', 
    dimension: 'SLP', 
    category: 'context',
    labelKey: 'assessment.tags.slp_6_7h', 
    score: null,
  },
  { 
    id: 'slp_7_8h', 
    dimension: 'SLP', 
    category: 'context',
    labelKey: 'assessment.tags.slp_7_8h', 
    score: null,
  },
  { 
    id: 'slp_over_8h', 
    dimension: 'SLP', 
    category: 'context',
    labelKey: 'assessment.tags.slp_over_8h', 
    score: null,
  },

  // Issues (multi select)
  { 
    id: 'slp_falling_asleep', 
    dimension: 'SLP', 
    category: 'symptom',
    labelKey: 'assessment.tags.slp_falling_asleep', 
    score: null,
    inverseScore: true,
    operationalMapping: ['PSQI_LAT'],
    metadata: { severity: 'moderate' },
  },
  { 
    id: 'slp_waking_up', 
    dimension: 'SLP', 
    category: 'symptom',
    labelKey: 'assessment.tags.slp_waking_up', 
    score: null,
    inverseScore: true,
    operationalMapping: ['PSQI_DIST'],
  },
  { 
    id: 'slp_not_rested', 
    dimension: 'SLP', 
    category: 'symptom',
    labelKey: 'assessment.tags.slp_not_rested', 
    score: null,
    inverseScore: true,
  },
  { 
    id: 'slp_irregular', 
    dimension: 'SLP', 
    category: 'symptom',
    labelKey: 'assessment.tags.slp_irregular', 
    score: null,
    inverseScore: true,
  },
  { 
    id: 'slp_snoring', 
    dimension: 'SLP', 
    category: 'symptom',
    labelKey: 'assessment.tags.slp_snoring', 
    score: null,
    inverseScore: true,
    followUpTrigger: ['slp_apnea_diagnosed'],
  },
  { 
    id: 'slp_no_issues', 
    dimension: 'SLP', 
    category: 'symptom',
    labelKey: 'assessment.tags.slp_no_issues', 
    score: null,
  },
];

// ============================================================================
// DIMENSION D: FYZICKÉ TĚLO (PHY) - Physical Body & Pain
// ============================================================================

export const PHY_TAGS: OperationalTag[] = [
  // Overall physical condition
  { 
    id: 'phy_excellent', 
    dimension: 'PHY', 
    category: 'intensity',
    labelKey: 'assessment.tags.phy_excellent', 
    score: 9,
  },
  { 
    id: 'phy_good', 
    dimension: 'PHY', 
    category: 'intensity',
    labelKey: 'assessment.tags.phy_good', 
    score: 7,
  },
  { 
    id: 'phy_average', 
    dimension: 'PHY', 
    category: 'intensity',
    labelKey: 'assessment.tags.phy_average', 
    score: 5,
  },
  { 
    id: 'phy_limited', 
    dimension: 'PHY', 
    category: 'intensity',
    labelKey: 'assessment.tags.phy_limited', 
    score: 3,
  },
  { 
    id: 'phy_poor', 
    dimension: 'PHY', 
    category: 'intensity',
    labelKey: 'assessment.tags.phy_poor', 
    score: 1,
  },

  // Statement tags (V2 - Fyzické tělo)
  { 
    id: 'phy_pain_frequency_rare', 
    dimension: 'PHY', 
    category: 'pattern',
    labelKey: 'assessment.tags.phy_pain_frequency_rare', 
    score: null,
  },
  { 
    id: 'phy_pain_frequency_often', 
    dimension: 'PHY', 
    category: 'pattern',
    labelKey: 'assessment.tags.phy_pain_frequency_often', 
    score: null,
    inverseScore: true,
  },
  { 
    id: 'phy_good_flexibility', 
    dimension: 'PHY', 
    category: 'pattern',
    labelKey: 'assessment.tags.phy_good_flexibility', 
    score: null,
  },
  { 
    id: 'phy_limited_flexibility', 
    dimension: 'PHY', 
    category: 'pattern',
    labelKey: 'assessment.tags.phy_limited_flexibility', 
    score: null,
    inverseScore: true,
  },

  // Pain locations (multi select)
  { 
    id: 'phy_pain_joints', 
    dimension: 'PHY', 
    category: 'symptom',
    labelKey: 'assessment.tags.phy_pain_joints', 
    score: null,
    inverseScore: true,
    followUpTrigger: ['phy_pain_location', 'phy_pain_frequency'],
  },
  { 
    id: 'phy_pain_muscles', 
    dimension: 'PHY', 
    category: 'symptom',
    labelKey: 'assessment.tags.phy_pain_muscles', 
    score: null,
    inverseScore: true,
  },
  { 
    id: 'phy_pain_back', 
    dimension: 'PHY', 
    category: 'symptom',
    labelKey: 'assessment.tags.phy_pain_back', 
    score: null,
    inverseScore: true,
    followUpTrigger: ['phy_pain_location', 'phy_pain_frequency'],
  },
  { 
    id: 'phy_pain_head', 
    dimension: 'PHY', 
    category: 'symptom',
    labelKey: 'assessment.tags.phy_pain_head', 
    score: null,
    inverseScore: true,
    followUpTrigger: ['phy_headache_type', 'phy_pain_frequency'],
  },

  // Mobility & function (multi select)
  { 
    id: 'phy_stiffness', 
    dimension: 'PHY', 
    category: 'symptom',
    labelKey: 'assessment.tags.phy_stiffness', 
    score: null,
    inverseScore: true,
    metadata: { severity: 'moderate' },
  },
  { 
    id: 'phy_limited_mobility', 
    dimension: 'PHY', 
    category: 'symptom',
    labelKey: 'assessment.tags.phy_limited_mobility', 
    score: null,
    inverseScore: true,
  },
  { 
    id: 'phy_weakness', 
    dimension: 'PHY', 
    category: 'symptom',
    labelKey: 'assessment.tags.phy_weakness', 
    score: null,
    inverseScore: true,
  },
  { 
    id: 'phy_no_issues', 
    dimension: 'PHY', 
    category: 'symptom',
    labelKey: 'assessment.tags.phy_no_issues', 
    score: null,
  },
];
