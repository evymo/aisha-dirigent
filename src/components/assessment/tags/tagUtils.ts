/**
 * Operational Tags — Combined exports & utility functions
 *
 * Aggregates all dimension tags into unified collections and provides
 * query utilities for tag lookup, filtering by category, and follow-up resolution.
 */

import type { OperationalTag, Dimension } from '../types';

import { VIT_TAGS, ENE_TAGS } from './vitalityEnergyTags';
import { SLP_TAGS, PHY_TAGS } from './sleepPhysicalTags';
import { MET_TAGS, IMM_TAGS } from './metabolicImmunityTags';
import { PSY_TAGS, COG_TAGS, MOO_TAGS } from './psycheCognitionMoodTags';
import { FOLLOW_UP_TAGS, FOLLOW_UP_TAG_ID_SET, FOLLOW_UP_TAGS_BY_DIMENSION } from './followUpTags';

// ============================================================================
// COMBINED EXPORTS
// ============================================================================

export const TAGS_BY_DIMENSION: Record<Dimension, OperationalTag[]> = {
  VIT: [...VIT_TAGS, ...FOLLOW_UP_TAGS_BY_DIMENSION.VIT],
  ENE: [...ENE_TAGS, ...FOLLOW_UP_TAGS_BY_DIMENSION.ENE],
  SLP: [...SLP_TAGS, ...FOLLOW_UP_TAGS_BY_DIMENSION.SLP],
  PHY: [...PHY_TAGS, ...FOLLOW_UP_TAGS_BY_DIMENSION.PHY],
  MET: [...MET_TAGS, ...FOLLOW_UP_TAGS_BY_DIMENSION.MET],
  IMM: [...IMM_TAGS, ...FOLLOW_UP_TAGS_BY_DIMENSION.IMM],
  PSY: [...PSY_TAGS, ...FOLLOW_UP_TAGS_BY_DIMENSION.PSY],
  COG: [...COG_TAGS, ...FOLLOW_UP_TAGS_BY_DIMENSION.COG],
  MOO: [...MOO_TAGS, ...FOLLOW_UP_TAGS_BY_DIMENSION.MOO],
};

/**
 * All operational tags in a flat array
 */
export const ALL_TAGS: OperationalTag[] = [
  ...VIT_TAGS,
  ...ENE_TAGS,
  ...SLP_TAGS,
  ...PHY_TAGS,
  ...MET_TAGS,
  ...IMM_TAGS,
  ...PSY_TAGS,
  ...COG_TAGS,
  ...MOO_TAGS,
  ...FOLLOW_UP_TAGS,
];

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get tags for a specific dimension
 */
export function getTagsForDimension(dimension: Dimension): OperationalTag[] {
  return TAGS_BY_DIMENSION[dimension] ?? [];
}

/**
 * Get intensity tags for a dimension (single select options)
 */
export function getIntensityTags(dimension: Dimension): OperationalTag[] {
  return getTagsForDimension(dimension).filter(t => t.category === 'intensity');
}

/**
 * Get pattern tags for a dimension
 */
export function getPatternTags(dimension: Dimension): OperationalTag[] {
  return getTagsForDimension(dimension).filter(t => t.category === 'pattern');
}

/**
 * Get symptom tags for a dimension (multi select options)
 */
export function getSymptomTags(dimension: Dimension): OperationalTag[] {
  return getTagsForDimension(dimension).filter(t => t.category === 'symptom');
}

/**
 * Get context tags for a dimension
 */
export function getContextTags(dimension: Dimension): OperationalTag[] {
  return getTagsForDimension(dimension).filter(
    t => t.category === 'context' && !FOLLOW_UP_TAG_ID_SET.has(t.id)
  );
}

/**
 * Find a tag by ID
 */
export function getTagById(tagId: string): OperationalTag | undefined {
  return ALL_TAGS.find(t => t.id === tagId);
}

/**
 * Get all follow-up trigger IDs from selected tags
 */
export function getTriggeredFollowUps(selectedTagIds: string[]): string[] {
  const triggers: Set<string> = new Set();
  
  for (const tagId of selectedTagIds) {
    const tag = getTagById(tagId);
    if (tag?.followUpTrigger) {
      tag.followUpTrigger.forEach(t => triggers.add(t));
    }
  }
  
  return Array.from(triggers);
}
