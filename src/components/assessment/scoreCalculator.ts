/**
 * Longevity Score Calculator
 * 
 * Calculates the overall Longevity Score based on selected tags across all dimensions.
 * Uses the operational methodology from the Longevity Operational Index (LCI).
 */

import { getTagById } from "./tagDatabase";
import type { 
  Dimension, 
  DimensionScore, 
  LongevityScore,
  OperationalTag 
} from "./types";
import { DIMENSIONS } from "./types";

/**
 * Calculate score for a single dimension
 */
export function calculateDimensionScore(
  dimension: Dimension,
  selectedTagIds: string[]
): DimensionScore {
  // dimensionTags available via TAGS_BY_DIMENSION[dimension] if needed
  const selectedTags = selectedTagIds
    .map(id => getTagById(id))
    .filter((t): t is OperationalTag => t !== undefined && t.dimension === dimension);

  // Find intensity score (primary score for dimension)
  const intensityTag = selectedTags.find(t => t.category === "intensity");
  let rawScore = intensityTag?.score ?? 5; // Default to average if not selected

  // Count negative and positive symptom indicators
  const negativeSymptoms = selectedTags.filter(
    t => t.category === "symptom" && t.inverseScore
  );
  const positiveSymptoms = selectedTags.filter(
    t => t.category === "symptom" && !t.inverseScore && t.score === null
  );

  // Adjust score based on symptoms
  // Each negative symptom reduces score by 0.5 (max -2.5)
  const negativeAdjustment = Math.min(negativeSymptoms.length * 0.5, 2.5);
  // Each positive symptom increases score by 0.25 (max +1.0)
  const positiveAdjustment = Math.min(positiveSymptoms.length * 0.25, 1.0);

  rawScore = Math.max(0, Math.min(10, rawScore - negativeAdjustment + positiveAdjustment));

  // Collect operational flags (tags that trigger follow-up questions)
  const operationalFlags = selectedTags
    .filter(t => t.followUpTrigger && t.followUpTrigger.length > 0)
    .map(t => t.id);

  return {
    dimension,
    rawScore,
    normalizedScore: rawScore * 10, // Convert to 0-100%
    tagCount: selectedTags.length,
    hasNegativeIndicators: negativeSymptoms.length > 0,
    operationalFlags,
  };
}

/**
 * Calculate the overall Longevity Score
 */
export function calculateLongevityScore(
  selectedTags: Record<Dimension, string[]>,
  baselineScore?: LongevityScore
): LongevityScore {
  // Calculate score for each dimension
  const dimensionScores: DimensionScore[] = DIMENSIONS.map(dim => 
    calculateDimensionScore(dim, selectedTags[dim] || [])
  );

  // Calculate overall score (weighted average)
  // All dimensions have equal weight for now
  const overall = dimensionScores.reduce(
    (sum, d) => sum + d.normalizedScore, 
    0
  ) / DIMENSIONS.length;

  // Determine interpretation
  let interpretation: "excellent" | "good" | "average" | "poor";
  if (overall >= 80) interpretation = "excellent";
  else if (overall >= 60) interpretation = "good";
  else if (overall >= 40) interpretation = "average";
  else interpretation = "poor";

  // Find dimensions requiring attention (below 40%)
  const alertFlags = dimensionScores
    .filter(d => d.normalizedScore < 40)
    .map(d => d.dimension);

  // Calculate trend vs baseline if provided
  let trendVsBaseline: number | undefined;
  if (baselineScore) {
    trendVsBaseline = overall - baselineScore.overall;
  }

  return {
    overall,
    dimensions: dimensionScores,
    interpretation,
    trendVsBaseline,
    alertFlags,
    assessmentDate: new Date(),
  };
}

/**
 * Get interpretation text for a score
 */
export function getScoreInterpretation(score: number): string {
  if (score >= 80) return "Výborný stav";
  if (score >= 60) return "Dobrý stav";
  if (score >= 40) return "Průměrný stav";
  return "Vyžaduje pozornost";
}

/**
 * Get interpretation text for trend
 */
export function getTrendInterpretation(trend: number): string {
  if (trend >= 20) return "Výrazné zlepšení";
  if (trend >= 10) return "Zlepšení";
  if (trend >= 5) return "Mírné zlepšení";
  if (trend > -5) return "Stabilní stav";
  if (trend >= -10) return "Mírné zhoršení";
  if (trend >= -20) return "Zhoršení";
  return "Výrazné zhoršení";
}

/**
 * Get color class for a score
 */
export function getScoreColorClass(score: number): string {
  if (score >= 80) return "text-green-600 dark:text-green-400";
  if (score >= 60) return "text-lime-600 dark:text-lime-400";
  if (score >= 40) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

/**
 * Get background color class for a score
 */
export function getScoreBgClass(score: number): string {
  if (score >= 80) return "bg-green-100 dark:bg-green-900/30";
  if (score >= 60) return "bg-lime-100 dark:bg-lime-900/30";
  if (score >= 40) return "bg-yellow-100 dark:bg-yellow-900/30";
  return "bg-red-100 dark:bg-red-900/30";
}

/**
 * Get trend color class
 */
export function getTrendColorClass(trend: number): string {
  if (trend >= 10) return "text-green-600 dark:text-green-400";
  if (trend >= 0) return "text-lime-600 dark:text-lime-400";
  if (trend >= -10) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

/**
 * Get trend arrow icon name (lucide-react compatible)
 */
export function getTrendArrow(trend: number): string {
  if (trend >= 10) return "chevrons-up";
  if (trend >= 5) return "chevron-up";
  if (trend > -5) return "arrow-right";
  if (trend >= -10) return "chevron-down";
  return "chevrons-down";
}

/**
 * Check if assessment has critical flags that need medical attention
 */
export function hasCriticalFlags(score: LongevityScore): boolean {
  // Critical if any dimension is below 20% or has multiple operational flags
  return score.dimensions.some(
    d => d.normalizedScore < 20 || d.operationalFlags.length >= 3
  );
}

/**
 * Get priority dimensions for intervention
 */
export function getPriorityDimensions(score: LongevityScore): Dimension[] {
  return score.dimensions
    .filter(d => d.normalizedScore < 50)
    .sort((a, b) => a.normalizedScore - b.normalizedScore)
    .slice(0, 3)
    .map(d => d.dimension);
}
