/**
 * Operational Tags — Barrel export
 *
 * Re-exports all tag arrays, utilities and follow-up data
 * from the domain-grouped sub-modules.
 */

export { VIT_TAGS, ENE_TAGS } from './vitalityEnergyTags';
export { SLP_TAGS, PHY_TAGS } from './sleepPhysicalTags';
export { MET_TAGS, IMM_TAGS } from './metabolicImmunityTags';
export { PSY_TAGS, COG_TAGS, MOO_TAGS } from './psycheCognitionMoodTags';
export { FOLLOW_UP_TAGS, FOLLOW_UP_TAG_ID_SET, FOLLOW_UP_TAGS_BY_DIMENSION } from './followUpTags';
export {
  TAGS_BY_DIMENSION,
  ALL_TAGS,
  getTagsForDimension,
  getIntensityTags,
  getPatternTags,
  getSymptomTags,
  getContextTags,
  getTagById,
  getTriggeredFollowUps,
} from './tagUtils';
