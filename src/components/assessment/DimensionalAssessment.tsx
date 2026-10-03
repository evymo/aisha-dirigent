import { useState, useCallback, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { IntensitySelector } from "./IntensitySelector";
import { DimensionTagGrid } from "./DimensionTagGrid";
import { ConditionalQuestionPanel } from "./ConditionalQuestionPanel";
import { createFollowUpTracker } from "./followUpTracker";
import { TAGS_BY_DIMENSION, getIntensityTags, getPatternTags, getSymptomTags, getContextTags, getTagById, getTriggeredFollowUps } from "./tagDatabase";
import { calculateLongevityScore } from "./scoreCalculator";
import { DIMENSIONS, DIMENSION_INFO } from "./types";
import { DimensionIcon } from "./DimensionIcon";
import type { 
  Dimension, 
  DimensionalAssessmentProps, 
  AssessmentState,
  TagSelection,
  FollowUpResponse,
} from "./types";

/**
 * DimensionalAssessment Component
 * 
 * A multi-step wizard for comprehensive health assessment across 9 operational dimensions.
 * Each step focuses on one dimension (VIT, ENE, SLP, PHY, MET, IMM, PSY, COG, MOO).
 * 
 * Features:
 * - Progressive disclosure of questions
 * - Intensity + pattern + symptom selection per dimension
 * - Real-time score preview
 * - Navigation with validation
 * - Responsive design
 */
export function DimensionalAssessment({
  onComplete,
  onDimensionComplete,
  onCancel,
  onSkip: _onSkip,
  showSkipButton: _showSkipButton,
  initialState,
  baselineScore,
}: DimensionalAssessmentProps) {
  const { t } = useTranslation();
  const followUpTracker = useMemo(() => createFollowUpTracker(), []);

  const parseFollowUpResponses = useCallback((answers?: Record<string, string | string[]>) => {
    if (!answers) return {};
    const responses: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(answers)) {
      if (typeof value !== "string") continue;
      const normalized = value.trim().toLowerCase();
      if (normalized === "yes") responses[key] = true;
      if (normalized === "no") responses[key] = false;
    }
    return responses;
  }, []);

  const initialFollowUpResponses = useMemo(
    () => parseFollowUpResponses(initialState?.conditionalAnswers),
    [initialState?.conditionalAnswers, parseFollowUpResponses]
  );

  // Initialize state
  const [state, setState] = useState<AssessmentState>(() => ({
    currentStep: initialState?.currentStep ?? 0,
    selectedTags: initialState?.selectedTags ?? {
      VIT: [],
      ENE: [],
      SLP: [],
      PHY: [],
      MET: [],
      IMM: [],
      PSY: [],
      COG: [],
      MOO: [],
    },
    conditionalAnswers: initialState?.conditionalAnswers ?? {},
    startedAt: initialState?.startedAt ?? new Date(),
    lastInteractionAt: new Date(),
  }));
  const [followUpResponses, setFollowUpResponses] = useState<Record<string, boolean>>(initialFollowUpResponses);

  useEffect(() => {
    for (const [tagId, response] of Object.entries(initialFollowUpResponses)) {
      const tag = getTagById(tagId);
      if (!tag) continue;
      followUpTracker.setResponse(tagId, response, tag.dimension, tagId);
    }
  }, [followUpTracker, initialFollowUpResponses]);

  // Current dimension based on step
  const currentDimension = DIMENSIONS[state.currentStep] as Dimension;
  // dimensionInfo available via DIMENSION_INFO[currentDimension] if needed
  const totalSteps = DIMENSIONS.length;
  const progress = ((state.currentStep + 1) / totalSteps) * 100;

  // Get tags for current dimension
  const intensityTags = getIntensityTags(currentDimension);
  const patternTags = getPatternTags(currentDimension);
  const symptomTags = getSymptomTags(currentDimension);
  const contextTags = getContextTags(currentDimension);

  // Selected tags for current dimension - wrapped in useMemo for stable reference
  const selectedTagsForDimension = useMemo(
    () => state.selectedTags[currentDimension] || [],
    [state.selectedTags, currentDimension]
  );
  const selectedIntensityTag = selectedTagsForDimension.find(id => 
    intensityTags.some(t => t.id === id)
  );
  const selectedTagSelections = useMemo((): TagSelection[] => {
    return selectedTagsForDimension
      .map((tagId): TagSelection | null => {
        const tag = getTagById(tagId);
        if (!tag) return null;
        return {
          tagId,
          dimension: tag.dimension,
          category: tag.category,
          score: tag.score,
          inverseScore: tag.inverseScore,
        };
      })
      .filter((tag): tag is TagSelection => tag !== null);
  }, [selectedTagsForDimension]);

  // Calculate current score preview
  const currentScore = useMemo(() => 
    calculateLongevityScore(state.selectedTags, baselineScore),
    [state.selectedTags, baselineScore]
  );

  // Handle tag toggle
  const handleTagToggle = useCallback((tagId: string) => {
    setState(prev => {
      const currentSelected = prev.selectedTags[currentDimension] || [];
      const isSelected = currentSelected.includes(tagId);

      // Check if it's an intensity tag (single select within intensity)
      const isIntensityTag = intensityTags.some(t => t.id === tagId);
      
      let newSelected: string[];
      
      if (isIntensityTag) {
        // For intensity: replace any existing intensity selection
        const withoutIntensity = currentSelected.filter(
          id => !intensityTags.some(t => t.id === id)
        );
        newSelected = isSelected ? withoutIntensity : [...withoutIntensity, tagId];
      } else {
        // For other tags: toggle
        newSelected = isSelected
          ? currentSelected.filter(id => id !== tagId)
          : [...currentSelected, tagId];
      }

      return {
        ...prev,
        selectedTags: {
          ...prev.selectedTags,
          [currentDimension]: newSelected,
        },
        lastInteractionAt: new Date(),
      };
    });
  }, [currentDimension, intensityTags]);

  // Handle intensity selection (convenience wrapper)
  const handleIntensitySelect = useCallback((tagId: string) => {
    handleTagToggle(tagId);
  }, [handleTagToggle]);

  const resolveParentTagId = useCallback((followUpId: string) => {
    for (const tagId of selectedTagsForDimension) {
      const tag = getTagById(tagId);
      if (tag?.followUpTrigger?.includes(followUpId)) {
        return tagId;
      }
    }
    return selectedTagsForDimension[0] ?? followUpId;
  }, [selectedTagsForDimension]);

  const handleFollowUpSelect = useCallback((followUpId: string, selected: boolean) => {
    const parentTagId = resolveParentTagId(followUpId);
    followUpTracker.setResponse(followUpId, selected, currentDimension, parentTagId);
    setFollowUpResponses(prev => ({
      ...prev,
      [followUpId]: selected,
    }));
    setState(prev => ({
      ...prev,
      selectedTags: {
        ...prev.selectedTags,
        [currentDimension]: selected
          ? Array.from(new Set([...(prev.selectedTags[currentDimension] ?? []), followUpId]))
          : (prev.selectedTags[currentDimension] ?? []).filter(id => id !== followUpId),
      },
      conditionalAnswers: {
        ...prev.conditionalAnswers,
        [followUpId]: selected ? "yes" : "no",
      },
      lastInteractionAt: new Date(),
    }));
  }, [currentDimension, followUpTracker, resolveParentTagId]);

  const getDimensionFollowUps = useCallback((dimension: Dimension): FollowUpResponse[] => {
    return followUpTracker.getResponsesForDimension(dimension);
  }, [followUpTracker]);

  useEffect(() => {
    const triggeredFollowUps = new Set(getTriggeredFollowUps(selectedTagsForDimension));
    const staleFollowUps = Object.keys(followUpResponses).filter((id) => {
      const tag = getTagById(id);
      if (!tag || tag.dimension !== currentDimension) return false;
      return !triggeredFollowUps.has(id);
    });

    if (staleFollowUps.length === 0) return;

    setFollowUpResponses((prev) => {
      const next = { ...prev };
      for (const id of staleFollowUps) {
        delete next[id];
      }
      return next;
    });

    setState((prev) => {
      const updatedSelected = (prev.selectedTags[currentDimension] ?? []).filter(
        (id) => !staleFollowUps.includes(id)
      );
      const updatedConditionalAnswers = { ...prev.conditionalAnswers };
      for (const id of staleFollowUps) {
        delete updatedConditionalAnswers[id];
      }
      return {
        ...prev,
        selectedTags: {
          ...prev.selectedTags,
          [currentDimension]: updatedSelected,
        },
        conditionalAnswers: updatedConditionalAnswers,
      };
    });
  }, [currentDimension, followUpResponses, selectedTagsForDimension]);

  // Navigation
  const canGoBack = state.currentStep > 0;
  const canGoNext = selectedIntensityTag !== undefined; // At minimum, intensity must be selected
  const isLastStep = state.currentStep === totalSteps - 1;

  const handleBack = () => {
    if (canGoBack) {
      setState(prev => ({ ...prev, currentStep: prev.currentStep - 1 }));
    }
  };

  const handleNext = () => {
    if (!canGoNext) return;

    if (onDimensionComplete) {
      onDimensionComplete(currentDimension, selectedTagSelections, getDimensionFollowUps(currentDimension));
    }

    if (isLastStep) {
      // Complete assessment
      onComplete(currentScore, state.selectedTags);
    } else {
      // Go to next step
      setState(prev => ({ ...prev, currentStep: prev.currentStep + 1 }));
    }
  };

  const handleSkipDimension = () => {
    // Allow skipping if intensity is selected (minimum requirement)
    if (onDimensionComplete) {
      onDimensionComplete(currentDimension, selectedTagSelections, getDimensionFollowUps(currentDimension));
    }

    if (isLastStep) {
      onComplete(currentScore, state.selectedTags);
    } else {
      setState(prev => ({ ...prev, currentStep: prev.currentStep + 1 }));
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Header with progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
            {t("assessment.step", { current: state.currentStep + 1, total: totalSteps })}
          </span>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {t("assessment.completed", { percent: Math.round(progress) })}
          </span>
        </div>
        <Progress value={progress} className="h-2" />
        
        {/* Step indicators */}
        <div className="flex justify-between mt-3 px-1">
          {DIMENSIONS.map((dim, index) => {
            const info = DIMENSION_INFO[dim];
            const isActive = index === state.currentStep;
            const isCompleted = index < state.currentStep;
            const hasSelection = (state.selectedTags[dim]?.length || 0) > 0;
            
            return (
              <div
                key={dim}
                className={cn(
                  "flex flex-col items-center",
                  isActive && "scale-110"
                )}
                title={t(info.nameKey)}
              >
                <span 
                  className={cn(
                    "transition-opacity",
                    isActive ? "opacity-100" : "opacity-40",
                    isCompleted && hasSelection && "opacity-80"
                  )}
                >
                  <DimensionIcon name={info.icon} className="h-5 w-5" />
                </span>
                {isCompleted && hasSelection && (
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-1" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Current dimension content */}
      <div className="space-y-6 bg-white dark:bg-gray-900 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-800">
        {/* Intensity selector (primary question) */}
        <IntensitySelector
          dimension={currentDimension}
          tags={TAGS_BY_DIMENSION[currentDimension]}
          selectedTagId={selectedIntensityTag || null}
          onSelect={handleIntensitySelect}
        />

        {/* Pattern tags (if available) */}
        {patternTags.length > 0 && (
          <DimensionTagGrid
            dimension={currentDimension}
            tags={patternTags}
            selectedTagIds={selectedTagsForDimension}
            onTagToggle={handleTagToggle}
            category="pattern"
            multiSelect={false} // Pattern is usually single select
          />
        )}

        {/* Context tags (if available, e.g., sleep duration) */}
        {contextTags.length > 0 && (
          <DimensionTagGrid
            dimension={currentDimension}
            tags={contextTags}
            selectedTagIds={selectedTagsForDimension}
            onTagToggle={handleTagToggle}
            category="context"
            multiSelect={false}
          />
        )}

        {/* Symptom tags */}
        {symptomTags.length > 0 && (
          <DimensionTagGrid
            dimension={currentDimension}
            tags={symptomTags}
            selectedTagIds={selectedTagsForDimension}
            onTagToggle={handleTagToggle}
            category="symptom"
            multiSelect={true}
          />
        )}

        <ConditionalQuestionPanel
          dimension={currentDimension}
          selectedTags={selectedTagSelections}
          followUpResponses={followUpResponses}
          onFollowUpSelect={handleFollowUpSelect}
        />
      </div>

      {/* Score preview (optional, shows during assessment) */}
      {state.currentStep > 0 && (
        <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600 dark:text-gray-400">
              {t("assessment.currentScore")}:
            </span>
            <span className={cn(
              "font-semibold",
              currentScore.overall >= 60 ? "text-green-600" : 
              currentScore.overall >= 40 ? "text-yellow-600" : "text-red-600"
            )}>
              {Math.round(currentScore.overall)}%
            </span>
          </div>
        </div>
      )}

      {/* Navigation buttons */}
      <div className="flex items-center justify-between mt-6">
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={onCancel}
            size="sm"
          >
            {t("assessment.cancel")}
          </Button>
          
          {canGoBack && (
            <Button
              variant="ghost"
              onClick={handleBack}
              size="sm"
            >
              <ArrowLeft className="h-3.5 w-3.5 mr-1" />{t("assessment.back")}
            </Button>
          )}
        </div>

        <div className="flex gap-2">
          {!isLastStep && (
            <Button
              variant="ghost"
              onClick={handleSkipDimension}
              size="sm"
              disabled={!selectedIntensityTag}
            >
              {t("assessment.skipDetails")}
            </Button>
          )}
          
          <Button
            onClick={handleNext}
            disabled={!canGoNext}
            size="sm"
          >
            {isLastStep ? <>{t("assessment.finish")} <Check className="h-3.5 w-3.5 ml-1" /></> : <>{t("assessment.next")} <ArrowRight className="h-3.5 w-3.5 ml-1" /></>}
          </Button>
        </div>
      </div>
    </div>
  );
}
