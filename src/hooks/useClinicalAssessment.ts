/**
 * Hook for Operational Assessment persistence
 * 
 * Handles saving/loading assessments to/from Supabase via RPC (audited).
 * Follows RPC-only pattern per project architecture guidelines.
 */

import { useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { aisha } from '@/integrations/db/client';
import { useSession } from '@/hooks/useSession';
import { safeError } from '@/lib/security/safeLogger';
import type { Database } from '@/integrations/db/types';
import type { 
  LongevityScore, 
  DimensionScore, 
  Dimension,
  FollowUpResponse,
  TagSelection 
} from '@/components/assessment/types';

// Types from Supabase RPC
type LatestAssessmentRow = Database["public"]["Functions"]["get_my_latest_operational_assessment_audited"]["Returns"][number];
type AssessmentHistoryRow = Database["public"]["Functions"]["get_my_operational_assessments_audited"]["Returns"][number];

// Query keys
const ASSESSMENT_KEYS = {
  latest: ['operational-assessment', 'latest'] as const,
  history: (limit: number) => ['operational-assessment', 'history', limit] as const,
  inProgress: ['operational-assessment', 'in-progress'] as const,
};

const DIMENSION_VALUES: Dimension[] = ['VIT', 'ENE', 'SLP', 'PHY', 'MET', 'IMM', 'PSY', 'COG', 'MOO'];

/**
 * Represents a operational assessment record.
 */
export interface AssessmentRecord {
  /** Unique identifier for the assessment */
  id: string;
  /** Type of assessment (e.g., 'initial', 'follow_up') */
  assessment_type: string;
  /** Current status of the assessment */
  status: 'in_progress' | 'completed' | 'abandoned';
  /** Calculated overall score (0-100) */
  overall_score: number | null;
  /** Operational interpretation of the results */
  interpretation: string | null;
  /** Trend compared to baseline assessment */
  trend_vs_baseline: number | null;
  /** List of alert flags raised during assessment */
  alert_flags: string[];
  /** Whether any critical flags were raised */
  has_critical_flags: boolean;
  /** Timestamp when the assessment was completed */
  completed_at: string | null;
  /** Detailed scores and flags for each dimension */
  dimensions: Array<{
    /** The dimension being assessed */
    dimension: Dimension;
    /** Raw score for the dimension */
    rawScore: number;
    /** Normalized score (0-100) */
    normalizedScore: number;
    /** Number of tags selected */
    tagCount: number;
    /** Whether negative indicators were present */
    hasNegativeIndicators: boolean;
    /** Specific operational flags for this dimension */
    operationalFlags: string[];
  }>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

const isDimension = (value: unknown): value is Dimension =>
  typeof value === 'string' && DIMENSION_VALUES.includes(value as Dimension);

const parseAssessmentDimensions = (value: unknown): AssessmentRecord['dimensions'] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry): AssessmentRecord['dimensions'][number] | null => {
      if (!isRecord(entry)) return null;

      const dimension = entry.dimension;
      if (!isDimension(dimension)) return null;

      const rawScore = entry.rawScore;
      const normalizedScore = entry.normalizedScore;
      const tagCount = entry.tagCount;
      const hasNegativeIndicators = entry.hasNegativeIndicators;
      const operationalFlagsRaw = entry.operationalFlags;

      if (
        typeof rawScore !== 'number' ||
        typeof normalizedScore !== 'number' ||
        typeof tagCount !== 'number' ||
        typeof hasNegativeIndicators !== 'boolean'
      ) {
        return null;
      }

      const operationalFlags = Array.isArray(operationalFlagsRaw)
        ? operationalFlagsRaw.filter((flag): flag is string => typeof flag === 'string')
        : [];

      return {
        dimension,
        rawScore,
        normalizedScore,
        tagCount,
        hasNegativeIndicators,
        operationalFlags,
      };
    })
    .filter(
      (entry): entry is AssessmentRecord['dimensions'][number] => entry !== null
    );
};

const toAssessmentRecord = (row: LatestAssessmentRow): AssessmentRecord => {
  const status = row.status;
  const normalizedStatus: AssessmentRecord['status'] =
    status === 'in_progress' || status === 'completed' || status === 'abandoned'
      ? status
      : 'completed';

  const alertFlags = Array.isArray(row.alert_flags)
    ? row.alert_flags.filter((flag): flag is string => typeof flag === 'string')
    : [];

  return {
    id: row.id,
    assessment_type: typeof row.assessment_type === 'string' ? row.assessment_type : 'unknown',
    status: normalizedStatus,
    overall_score: typeof row.overall_score === 'number' ? row.overall_score : null,
    interpretation: typeof row.interpretation === 'string' ? row.interpretation : null,
    trend_vs_baseline: typeof row.trend_vs_baseline === 'number' ? row.trend_vs_baseline : null,
    alert_flags: alertFlags,
    has_critical_flags: row.has_critical_flags === true,
    completed_at: typeof row.completed_at === 'string' ? row.completed_at : null,
    dimensions: parseAssessmentDimensions(row.dimensions),
  };
};

/**
 * Hook for managing operational assessment lifecycle.
 * Handles creating, saving dimensions, completing, and fetching assessments.
 * Uses audited RPC functions for all operations.
 *
 * @returns Object containing assessment state, actions, and queries.
 */
export function useOperationalAssessment() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const [currentAssessmentId, setCurrentAssessmentId] = useState<string | null>(null);

  // Create new assessment
  const createAssessmentMutation = useMutation({
    mutationFn: async (type: string = 'onboarding'): Promise<string> => {
      const { data, error } = await aisha.rpc('create_operational_assessment', {
        p_assessment_type: type,
      });

      if (error) {
        safeError('useOperationalAssessment.createAssessment', error);
        throw new Error(error.message);
      }

      return data as string;
    },
    onSuccess: (assessmentId) => {
      setCurrentAssessmentId(assessmentId);
    },
  });

  // Save dimension score
  const saveDimensionMutation = useMutation({
    mutationFn: async ({
      assessmentId,
      dimensionScore,
      tagSelections,
      followUps,
    }: {
      assessmentId: string;
      dimensionScore: DimensionScore;
      tagSelections?: TagSelection[];
      followUps?: FollowUpResponse[];
    }) => {
      const tagIds = (tagSelections ?? []).map((tag) => tag.tagId);
      const followUpAnswers = (followUps ?? []).map((followUp) => ({
        tagId: followUp.tagId,
        response: followUp.response,
        parentTagId: followUp.parentTagId,
      }));

      const { data, error } = await aisha.rpc('save_operational_assessment_dimension', {
        p_assessment_id: assessmentId,
        p_dimension: dimensionScore.dimension,
        p_follow_up_answers: followUpAnswers
,
        p_has_negative_indicators: dimensionScore.hasNegativeIndicators,
        p_normalized_score: dimensionScore.normalizedScore,
        p_operational_flags: dimensionScore.operationalFlags,
        p_raw_score: dimensionScore.rawScore,
        p_tag_count: dimensionScore.tagCount,
        p_tag_ids: tagIds
    });

      if (error) {
        safeError('useOperationalAssessment.saveDimension', error);
        throw new Error(error.message);
      }

      return data;
    },
  });

  // Complete assessment
  const completeAssessmentMutation = useMutation({
    mutationFn: async ({
      assessmentId,
      score,
    }: {
      assessmentId: string;
      score: LongevityScore;
    }) => {
      const { data, error } = await aisha.rpc('complete_operational_assessment', {
        p_alert_flags: score.alertFlags,
        p_assessment_id: assessmentId,
        p_has_critical_flags: score.alertFlags.length > 0
,
        p_interpretation: score.interpretation,
        p_overall_score: score.overall
    });

      if (error) {
        safeError('useOperationalAssessment.completeAssessment', error);
        throw new Error(error.message);
      }

      return data;
    },
    onSuccess: () => {
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ASSESSMENT_KEYS.latest });
      queryClient.invalidateQueries({ queryKey: ['operational-assessment', 'history'] });
      setCurrentAssessmentId(null);
    },
  });

  // Get latest completed assessment (audited)
  const latestAssessmentQuery = useQuery({
    queryKey: ASSESSMENT_KEYS.latest,
    queryFn: async (): Promise<AssessmentRecord | null> => {
      const { data, error } = await aisha.rpc('get_my_latest_operational_assessment_audited');

      if (error) {
        safeError('useOperationalAssessment.getLatestAssessment', error);
        throw new Error(error.message);
      }

      // Handle empty result
      if (!data || (Array.isArray(data) && data.length === 0)) {
        return null;
      }

      // RPC returns array, take first item
      const record = Array.isArray(data) ? data[0] : data;
      if (!record) return null;
      return toAssessmentRecord(record);
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Get assessment history (audited)
  const useAssessmentHistory = (limit: number = 10) => {
    return useQuery({
      queryKey: ASSESSMENT_KEYS.history(limit),
      queryFn: async () => {
        const { data, error } = await aisha.rpc('get_my_operational_assessments_audited', {
          p_limit: limit,
        });

        if (error) {
          safeError('useOperationalAssessment.getAssessmentHistory', error);
          throw new Error(error.message);
        }

        return (data ?? []) as AssessmentHistoryRow[];
      },
      enabled: !!user?.id,
      staleTime: 5 * 60 * 1000,
    });
  };

  // Start new assessment
  const startAssessment = useCallback(async (type: string = 'onboarding') => {
    return createAssessmentMutation.mutateAsync(type);
  }, [createAssessmentMutation]);

  // Save dimension during assessment
  const saveDimension = useCallback(async (
    assessmentId: string,
    dimensionScore: DimensionScore,
    options?: {
      tagSelections?: TagSelection[];
      followUps?: FollowUpResponse[];
    }
  ) => {
    return saveDimensionMutation.mutateAsync({
      assessmentId,
      dimensionScore,
      tagSelections: options?.tagSelections,
      followUps: options?.followUps,
    });
  }, [saveDimensionMutation]);

  // Complete the assessment
  const completeAssessment = useCallback(async (
    assessmentId: string,
    score: LongevityScore
  ) => {
    return completeAssessmentMutation.mutateAsync({ assessmentId, score });
  }, [completeAssessmentMutation]);

  return {
    // Current session
    currentAssessmentId,
    setCurrentAssessmentId,
    
    // Actions
    startAssessment,
    saveDimension,
    completeAssessment,
    
    // Queries
    latestAssessment: latestAssessmentQuery.data,
    isLoadingLatest: latestAssessmentQuery.isLoading,
    useAssessmentHistory,
    
    // Mutation states
    isCreating: createAssessmentMutation.isPending,
    isSaving: saveDimensionMutation.isPending,
    isCompleting: completeAssessmentMutation.isPending,
    
    // Errors
    createError: createAssessmentMutation.error,
    saveError: saveDimensionMutation.error,
    completeError: completeAssessmentMutation.error,
  };
}

/**
 * Helper to convert frontend `LongevityScore` object to database-ready format.
 *
 * @param score - The score object to convert.
 * @returns Object formatted for DB insertion.
 */
export function scoreToDbFormat(score: LongevityScore) {
  return {
    overall: score.overall,
    interpretation: score.interpretation,
    alertFlags: score.alertFlags,
    hasCriticalFlags: score.alertFlags.length > 0,
    dimensions: score.dimensions.map(d => ({
      dimension: d.dimension,
      rawScore: d.rawScore,
      normalizedScore: d.normalizedScore,
      tagCount: d.tagCount,
      hasNegativeIndicators: d.hasNegativeIndicators,
      operationalFlags: d.operationalFlags,
    })),
  };
}

/**
 * Helper to convert database `AssessmentRecord` to frontend `LongevityScore` format.
 *
 * @param record - The DB record to convert.
 * @returns The formatted score object.
 */
export function dbToScoreFormat(record: AssessmentRecord): LongevityScore {
  return {
    overall: record.overall_score ?? 0,
    interpretation: (record.interpretation as LongevityScore['interpretation']) ?? 'average',
    trendVsBaseline: record.trend_vs_baseline ?? undefined,
    alertFlags: record.alert_flags as Dimension[],
    assessmentDate: record.completed_at ? new Date(record.completed_at) : new Date(),
    dimensions: record.dimensions.map(d => ({
      dimension: d.dimension,
      rawScore: d.rawScore,
      normalizedScore: d.normalizedScore,
      tagCount: d.tagCount,
      hasNegativeIndicators: d.hasNegativeIndicators,
      operationalFlags: d.operationalFlags,
    })),
  };
}
