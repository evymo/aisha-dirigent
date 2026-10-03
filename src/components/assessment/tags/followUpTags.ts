/**
 * Operational Tags — Follow-up / Context questions
 *
 * These tags are triggered by `followUpTrigger` arrays on dimension tags.
 * They collect additional operational context when a concerning pattern is detected.
 */

import type { OperationalTag, Dimension } from '../types';

// ============================================================================
// FOLLOW-UP / CONTEXT TAGS
// ============================================================================

export const FOLLOW_UP_TAGS: OperationalTag[] = [
  {
    id: "vit_limitation_details",
    dimension: "VIT",
    category: "context",
    labelKey: "assessment.tags.vit_limitation_details",
    score: null,
  },
  {
    id: "ene_depletion_duration",
    dimension: "ENE",
    category: "context",
    labelKey: "assessment.tags.ene_depletion_duration",
    score: null,
  },
  {
    id: "ene_depletion_cause",
    dimension: "ENE",
    category: "context",
    labelKey: "assessment.tags.ene_depletion_cause",
    score: null,
  },
  {
    id: "slp_quality",
    dimension: "SLP",
    category: "context",
    labelKey: "assessment.tags.slp_quality",
    score: null,
  },
  {
    id: "slp_issues",
    dimension: "SLP",
    category: "context",
    labelKey: "assessment.tags.slp_issues",
    score: null,
  },
  {
    id: "slp_duration",
    dimension: "SLP",
    category: "context",
    labelKey: "assessment.tags.slp_duration",
    score: null,
  },
  {
    id: "slp_apnea_diagnosed",
    dimension: "SLP",
    category: "context",
    labelKey: "assessment.tags.slp_apnea_diagnosed",
    score: null,
  },
  {
    id: "phy_pain_location",
    dimension: "PHY",
    category: "context",
    labelKey: "assessment.tags.phy_pain_location",
    score: null,
  },
  {
    id: "phy_pain_frequency",
    dimension: "PHY",
    category: "context",
    labelKey: "assessment.tags.phy_pain_frequency",
    score: null,
  },
  {
    id: "phy_headache_type",
    dimension: "PHY",
    category: "context",
    labelKey: "assessment.tags.phy_headache_type",
    score: null,
  },
  {
    id: "met_issues",
    dimension: "MET",
    category: "context",
    labelKey: "assessment.tags.met_issues",
    score: null,
  },
  {
    id: "met_diagnosed",
    dimension: "MET",
    category: "context",
    labelKey: "assessment.tags.met_diagnosed",
    score: null,
  },
  {
    id: "met_food_triggers",
    dimension: "MET",
    category: "context",
    labelKey: "assessment.tags.met_food_triggers",
    score: null,
  },
  {
    id: "met_blood_sugar",
    dimension: "MET",
    category: "context",
    labelKey: "assessment.tags.met_blood_sugar",
    score: null,
  },
  {
    id: "imm_conditions",
    dimension: "IMM",
    category: "context",
    labelKey: "assessment.tags.imm_conditions",
    score: null,
  },
  {
    id: "imm_illness_type",
    dimension: "IMM",
    category: "context",
    labelKey: "assessment.tags.imm_illness_type",
    score: null,
  },
  {
    id: "imm_allergy_type",
    dimension: "IMM",
    category: "context",
    labelKey: "assessment.tags.imm_allergy_type",
    score: null,
  },
  {
    id: "imm_autoimmune_diagnosis",
    dimension: "IMM",
    category: "context",
    labelKey: "assessment.tags.imm_autoimmune_diagnosis",
    score: null,
  },
  {
    id: "psy_support_needed",
    dimension: "PSY",
    category: "context",
    labelKey: "assessment.tags.psy_support_needed",
    score: null,
  },
  {
    id: "psy_stress_source",
    dimension: "PSY",
    category: "context",
    labelKey: "assessment.tags.psy_stress_source",
    score: null,
  },
  {
    id: "cog_impairment_details",
    dimension: "COG",
    category: "context",
    labelKey: "assessment.tags.cog_impairment_details",
    score: null,
  },
  {
    id: "cog_medical_evaluation",
    dimension: "COG",
    category: "context",
    labelKey: "assessment.tags.cog_medical_evaluation",
    score: null,
  },
  {
    id: "cog_fog_frequency",
    dimension: "COG",
    category: "context",
    labelKey: "assessment.tags.cog_fog_frequency",
    score: null,
  },
  {
    id: "moo_support_needed",
    dimension: "MOO",
    category: "context",
    labelKey: "assessment.tags.moo_support_needed",
    score: null,
  },
];

export const FOLLOW_UP_TAG_ID_SET = new Set(FOLLOW_UP_TAGS.map(tag => tag.id));

export const FOLLOW_UP_TAGS_BY_DIMENSION: Record<Dimension, OperationalTag[]> = {
  VIT: FOLLOW_UP_TAGS.filter(tag => tag.dimension === "VIT"),
  ENE: FOLLOW_UP_TAGS.filter(tag => tag.dimension === "ENE"),
  SLP: FOLLOW_UP_TAGS.filter(tag => tag.dimension === "SLP"),
  PHY: FOLLOW_UP_TAGS.filter(tag => tag.dimension === "PHY"),
  MET: FOLLOW_UP_TAGS.filter(tag => tag.dimension === "MET"),
  IMM: FOLLOW_UP_TAGS.filter(tag => tag.dimension === "IMM"),
  PSY: FOLLOW_UP_TAGS.filter(tag => tag.dimension === "PSY"),
  COG: FOLLOW_UP_TAGS.filter(tag => tag.dimension === "COG"),
  MOO: FOLLOW_UP_TAGS.filter(tag => tag.dimension === "MOO"),
};
