/**
 * Operational Tag Database
 *
 * Barrel re-export from domain-grouped sub-modules in `./tags/`.
 * Based on validated operational instruments (SF-12, FACIT-F, PSQI, HADS, PSS-10, MoCA).
 *
 * @see tags/vitalityEnergyTags.ts — VIT & ENE dimensions
 * @see tags/sleepPhysicalTags.ts — SLP & PHY dimensions
 * @see tags/metabolicImmunityTags.ts — MET & IMM dimensions
 * @see tags/psycheCognitionMoodTags.ts — PSY, COG & MOO dimensions
 * @see tags/followUpTags.ts — Context / follow-up questions
 * @see tags/tagUtils.ts — Combined collections & utility functions
 */

export {
  VIT_TAGS,
  ENE_TAGS,
  SLP_TAGS,
  PHY_TAGS,
  MET_TAGS,
  IMM_TAGS,
  PSY_TAGS,
  COG_TAGS,
  MOO_TAGS,
  FOLLOW_UP_TAGS,
  FOLLOW_UP_TAG_ID_SET,
  FOLLOW_UP_TAGS_BY_DIMENSION,
  TAGS_BY_DIMENSION,
  ALL_TAGS,
  getTagsForDimension,
  getIntensityTags,
  getPatternTags,
  getSymptomTags,
  getContextTags,
  getTagById,
  getTriggeredFollowUps,
} from './tags';
