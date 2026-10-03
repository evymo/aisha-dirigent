/**
 * Operational Tag Assessment System (CTAS) Types
 * 
 * Based on validated operational instruments:
 * - SF-12/SF-36 (Quality of Life)
 * - FACIT-F (Fatigue)
 * - PSQI (Sleep Quality)
 * - HADS (Anxiety/Depression)
 * - PSS-10 (Perceived Stress)
 * - MoCA (Cognition)
 */

/**
 * Operational dimensions (Longevity Index domains)
 */
export type Dimension = 
  | 'VIT'  // Vitality - Overall state
  | 'ENE'  // Energy - Fatigue levels
  | 'SLP'  // Sleep - Quality & regeneration
  | 'PHY'  // Physical - Body condition, pain
  | 'MET'  // Metabolism - Digestion, stability
  | 'IMM'  // Immunity - Resilience, recovery
  | 'PSY'  // Psyche - Wellbeing, stress
  | 'COG'  // Cognition - Mental clarity, focus
  | 'MOO'; // Mood - Motivation, joy

/**
 * Tag categories for structured assessment
 */
export type TagCategory = 
  | 'intensity'  // Primary severity level (single select)
  | 'pattern'    // Temporal patterns (single/multi select)
  | 'symptom'    // Specific symptoms (multi select)
  | 'impact'     // Impact on daily life
  | 'context';   // Contextual information

/**
 * Tag severity metadata
 */
export type Severity = 'mild' | 'moderate' | 'severe';

/**
 * Tag duration metadata
 */
export type Duration = 'acute' | 'subacute' | 'chronic';

/**
 * Tag frequency metadata
 */
export type Frequency = 'daily' | 'weekly' | 'monthly' | 'occasionally';

/**
 * Operational tag structure
 */
export interface OperationalTag {
  /** Unique identifier */
  id: string;
  /** Operational dimension */
  dimension: Dimension;
  /** Tag category */
  category: TagCategory;
  /** i18n key for the tag label (resolved via t()) */
  labelKey: string;
  /** Score for intensity tags (0-10), null for descriptors */
  score: number | null;
  /** True if higher score means worse outcome (pain, fatigue) */
  inverseScore?: boolean;
  /** Mapping to validated operational instruments */
  operationalMapping?: string[];
  /** IDs of follow-up questions triggered by this tag */
  followUpTrigger?: string[];
  /** Additional metadata */
  metadata?: {
    severity?: Severity;
    duration?: Duration;
    frequency?: Frequency;
  };
}

/**
 * Conditional follow-up question
 */
export interface ConditionalQuestion {
  /** Unique identifier */
  id: string;
  /** Tag IDs that trigger this question */
  triggerTags: string[];
  /** i18n key for the question text (resolved via t()) */
  questionKey: string;
  /** Response type */
  type: 'tags' | 'text' | 'scale' | 'date';
  /** Available options for tag-type questions */
  options?: OperationalTag[];
  /** Whether answer is required */
  required: boolean;
}

/**
 * Dimension score result
 */
export interface DimensionScore {
  /** Dimension identifier */
  dimension: Dimension;
  /** Raw score (0-10) */
  rawScore: number;
  /** Normalized score (0-100%) */
  normalizedScore: number;
  /** Number of tags selected in this dimension */
  tagCount: number;
  /** Whether negative indicators are present */
  hasNegativeIndicators: boolean;
  /** Operational flags for physician review */
  operationalFlags: string[];
}

/**
 * Overall Longevity Score result
 */
export interface LongevityScore {
  /** Overall score (0-100%) */
  overall: number;
  /** Scores per dimension */
  dimensions: DimensionScore[];
  /** Interpretation label */
  interpretation: 'excellent' | 'good' | 'average' | 'poor';
  /** Percentage change from baseline */
  trendVsBaseline?: number;
  /** Dimensions requiring attention */
  alertFlags: Dimension[];
  /** Date of assessment */
  assessmentDate: Date;
}

/**
 * Assessment state for wizard
 */
export interface AssessmentState {
  /** Currently active step (0 = VIT, 8 = MOO) */
  currentStep: number;
  /** Selected tags per dimension */
  selectedTags: Record<Dimension, string[]>;
  /** Answers to conditional questions */
  conditionalAnswers: Record<string, string | string[]>;
  /** Current calculated score (updated after each dimension) */
  currentScore?: LongevityScore;
  /** Assessment started timestamp */
  startedAt: Date;
  /** Last interaction timestamp */
  lastInteractionAt: Date;
}

/**
 * Dimension metadata for display
 */
export interface DimensionInfo {
  id: Dimension;
  /** i18n key for dimension name (resolved via t()) */
  nameKey: string;
  /** i18n key for dimension description (resolved via t()) */
  descriptionKey: string;
  icon: string;
  validatedInstrument?: string;
}

/**
 * Tag selection with score (used in calculations)
 */
export interface TagSelection {
  tagId: string;
  dimension: Dimension;
  category: TagCategory;
  score: number | null;
  inverseScore?: boolean;
}

/**
 * Follow-up response payload
 */
export interface FollowUpResponse {
  tagId: string;
  response: boolean;
  dimension: Dimension;
  parentTagId: string;
}

/**
 * Props for OperationalTagCard component
 */
export interface OperationalTagCardProps {
  tag: OperationalTag;
  selected: boolean;
  onToggle: (tagId: string) => void;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Props for IntensitySelector component
 */
export interface IntensitySelectorProps {
  dimension: Dimension;
  tags: OperationalTag[];
  selectedTagId: string | null;
  onSelect: (tagId: string) => void;
  disabled?: boolean;
}

/**
 * Props for DimensionTagGrid component
 */
export interface DimensionTagGridProps {
  dimension: Dimension;
  tags: OperationalTag[];
  selectedTagIds: string[];
  onTagToggle: (tagId: string) => void;
  category?: TagCategory;
  multiSelect?: boolean;
  disabled?: boolean;
}

/**
 * Props for DimensionalAssessment wizard
 */
export interface DimensionalAssessmentProps {
  onComplete: (score: LongevityScore, selectedTags: Record<Dimension, string[]>) => void;
  onDimensionComplete?: (
    dimension: Dimension,
    selectedTags: TagSelection[],
    followUps: FollowUpResponse[]
  ) => void;
  onCancel?: () => void;
  onSkip?: () => void;
  showSkipButton?: boolean;
  initialState?: Partial<AssessmentState>;
  baselineScore?: LongevityScore;
}

/**
 * All dimensions in order
 */
export const DIMENSIONS: Dimension[] = ['VIT', 'ENE', 'SLP', 'PHY', 'MET', 'IMM', 'PSY', 'COG', 'MOO'];

/**
 * Dimension display information
 */
export const DIMENSION_INFO: Record<Dimension, DimensionInfo> = {
  VIT: {
    id: 'VIT',
    nameKey: 'assessment.dimensions.VIT.name',
    descriptionKey: 'assessment.dimensions.VIT.description',
    icon: 'sparkles',
    validatedInstrument: 'SF-12',
  },
  ENE: {
    id: 'ENE',
    nameKey: 'assessment.dimensions.ENE.name',
    descriptionKey: 'assessment.dimensions.ENE.description',
    icon: 'zap',
    validatedInstrument: 'FACIT-F',
  },
  SLP: {
    id: 'SLP',
    nameKey: 'assessment.dimensions.SLP.name',
    descriptionKey: 'assessment.dimensions.SLP.description',
    icon: 'moon',
    validatedInstrument: 'PSQI',
  },
  PHY: {
    id: 'PHY',
    nameKey: 'assessment.dimensions.PHY.name',
    descriptionKey: 'assessment.dimensions.PHY.description',
    icon: 'dumbbell',
  },
  MET: {
    id: 'MET',
    nameKey: 'assessment.dimensions.MET.name',
    descriptionKey: 'assessment.dimensions.MET.description',
    icon: 'flame',
  },
  IMM: {
    id: 'IMM',
    nameKey: 'assessment.dimensions.IMM.name',
    descriptionKey: 'assessment.dimensions.IMM.description',
    icon: 'shield',
  },
  PSY: {
    id: 'PSY',
    nameKey: 'assessment.dimensions.PSY.name',
    descriptionKey: 'assessment.dimensions.PSY.description',
    icon: 'heart-handshake',
    validatedInstrument: 'HADS',
  },
  COG: {
    id: 'COG',
    nameKey: 'assessment.dimensions.COG.name',
    descriptionKey: 'assessment.dimensions.COG.description',
    icon: 'brain',
    validatedInstrument: 'MoCA',
  },
  MOO: {
    id: 'MOO',
    nameKey: 'assessment.dimensions.MOO.name',
    descriptionKey: 'assessment.dimensions.MOO.description',
    icon: 'smile',
    validatedInstrument: 'PSS-10',
  },
};
