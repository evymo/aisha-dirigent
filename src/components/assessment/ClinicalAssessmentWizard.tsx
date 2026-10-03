/**
 * OperationalAssessmentWizard
 * 
 * Full-featured assessment wizard that combines:
 * - DimensionalAssessment UI component
 * - useOperationalAssessment persistence hook
 * - Navigation integration
 * 
 * Use cases:
 * - Standalone page (/member/assessment)
 * - Embedded in onboarding flow
 * - Periodic re-assessment
 */

import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { DimensionalAssessment } from "@/components/assessment/DimensionalAssessment";
import { AssessmentSummary } from "@/components/assessment/AssessmentSummary";
import { useOperationalAssessment } from "@/hooks/useOperationalAssessment";
import { getTagById } from "@/components/assessment/tagDatabase";
import type { Dimension, FollowUpResponse, LongevityScore, TagSelection } from "@/components/assessment/types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeError } from "@/lib/security/safeLogger";

interface OperationalAssessmentWizardProps {
  /** Assessment type for categorization */
  assessmentType?: "onboarding" | "periodic" | "followup";
  /** Callback after successful completion */
  onComplete?: (score: LongevityScore) => void;
  /** Callback on skip/cancel */
  onSkip?: () => void;
  /** Show skip button */
  showSkip?: boolean;
  /** Custom title */
  title?: string;
  /** Custom description */
  description?: string;
  /** Embedded mode (no card wrapper) */
  embedded?: boolean;
}

/**
 * Main wizard component with persistence
 */
export function OperationalAssessmentWizard({
  assessmentType = "onboarding",
  onComplete,
  onSkip,
  showSkip = false,
  title,
  description,
  embedded = false,
}: OperationalAssessmentWizardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  
  // Persistence hook
  const {
    currentAssessmentId,
    startAssessment,
    saveDimension,
    completeAssessment,
    isCreating,
  } = useOperationalAssessment();

  // Local state
  const [phase, setPhase] = useState<"loading" | "assessment" | "summary">("loading");
  const [finalScore, setFinalScore] = useState<LongevityScore | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialize assessment on mount
  useEffect(() => {
    const init = async () => {
      try {
        // Start new assessment session
        await startAssessment(assessmentType);
        setPhase("assessment");
      } catch (err) {
        setError(t("assessment.wizard.errors.initFailed"));
        safeError("OperationalAssessmentWizard.init", err);
      }
    };

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is stable from react-i18next
  }, [assessmentType, startAssessment]);

  // Handle dimension completion (save to DB incrementally)
  const handleDimensionComplete = useCallback(async (
    dimension: Dimension,
    selectedTags: TagSelection[],
    followUps: FollowUpResponse[]
  ) => {
    if (!currentAssessmentId) return;

    // Calculate dimension score
    const dimensionScore = calculateDimensionScoreFromTags(dimension, selectedTags);

    try {
      await saveDimension(currentAssessmentId, dimensionScore, {
        tagSelections: selectedTags,
        followUps,
      });
    } catch (err) {
      safeError("OperationalAssessmentWizard.saveDimension", err);
      // Don't block UI, continue assessment
    }
  }, [currentAssessmentId, saveDimension]);

  // Handle assessment completion
  const handleComplete = useCallback(async (score: LongevityScore) => {
    if (!currentAssessmentId) {
      toast.error(t("common.error"), {
        description: t("assessment.wizard.errors.notInitialized"),
      });
      return;
    }

    try {
      await completeAssessment(currentAssessmentId, score);
      setFinalScore(score);
      setPhase("summary");

      toast.success(t("assessment.wizard.completed"), {
        description: t("assessment.wizard.yourScore", { score: Math.round(score.overall) }),
      });

      if (onComplete) {
        onComplete(score);
      }
    } catch (err) {
      safeError("OperationalAssessmentWizard.handleComplete", err);
      toast.error(t("assessment.wizard.errors.saveTitle"), {
        description: t("assessment.wizard.errors.saveFailed"),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is stable from react-i18next
  }, [currentAssessmentId, completeAssessment, onComplete]);

  // Handle retake
  const handleRetake = useCallback(async () => {
    setFinalScore(null);
    setPhase("loading");
    
    try {
      await startAssessment(assessmentType);
      setPhase("assessment");
    } catch (err) {
      setError(t("assessment.wizard.errors.retakeFailed"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is stable from react-i18next
  }, [assessmentType, startAssessment]);

  // Handle continue after summary
  const handleContinue = useCallback(() => {
    if (onComplete && finalScore) {
      onComplete(finalScore);
    } else {
      navigate("/member");
    }
  }, [finalScore, onComplete, navigate]);

  // Error state - check BEFORE loading to show errors even during init
  if (error) {
    return (
      <WizardWrapper embedded={embedded} title={title} description={description}>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <AlertCircle className="h-12 w-12 text-destructive mb-4" />
          <p className="text-lg font-medium mb-2">{t("common.somethingWentWrong")}</p>
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button onClick={() => window.location.reload()}>
            {t("common.tryAgain")}
          </Button>
        </div>
      </WizardWrapper>
    );
  }

  // Loading state
  if (phase === "loading" || isCreating) {
    return (
      <WizardWrapper embedded={embedded} title={title} description={description}>
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
          <p className="text-muted-foreground">{t("assessment.wizard.preparing")}</p>
        </div>
      </WizardWrapper>
    );
  }

  // Summary phase
  if (phase === "summary" && finalScore) {
    return (
      <WizardWrapper embedded={embedded} title={title} description={description}>
        <AssessmentSummary
          score={finalScore}
          onRetake={handleRetake}
          onContinue={handleContinue}
          showActions={true}
        />
      </WizardWrapper>
    );
  }

  // Assessment phase
  return (
    <WizardWrapper 
      embedded={embedded} 
      title={title ?? t("assessment.wizard.title")} 
      description={description ?? t("assessment.wizard.description")}
    >
      <DimensionalAssessment
        onComplete={(score, _selectedTags) => handleComplete(score)}
        onDimensionComplete={handleDimensionComplete}
        showSkipButton={showSkip}
        onSkip={onSkip}
        onCancel={onSkip}
      />
    </WizardWrapper>
  );
}

// Helper wrapper component
function WizardWrapper({
  children,
  embedded,
  title,
  description,
}: {
  children: React.ReactNode;
  embedded: boolean;
  title?: string;
  description?: string;
}) {
  if (embedded) {
    return <>{children}</>;
  }

  return (
    <Card className="w-full max-w-3xl mx-auto">
      {(title || description) && (
        <CardHeader className="text-center">
          {title && <CardTitle className="text-2xl">{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// Helper: Calculate dimension score from tags
function calculateDimensionScoreFromTags(
  dimension: Dimension,
  selectedTags: TagSelection[]
): {
  dimension: Dimension;
  rawScore: number;
  normalizedScore: number;
  tagCount: number;
  hasNegativeIndicators: boolean;
  operationalFlags: string[];
} {
  // Get intensity tag (primary score)
  const intensityTag = selectedTags.find(t => t.category === "intensity");
  let rawScore = intensityTag?.score ?? 5;

  // Adjust for symptom tags
  const symptomTags = selectedTags.filter(t => t.category === "symptom");
  for (const symptom of symptomTags) {
    const tag = getTagById(symptom.tagId);
    if (tag?.inverseScore) {
      // Negative symptom reduces score
      rawScore = Math.max(0, rawScore - 0.5);
    } else {
      // Positive symptom increases score
      rawScore = Math.min(10, rawScore + 0.25);
    }
  }

  // Check for negative indicators
  const hasNegativeIndicators = symptomTags.some(t => {
    const tag = getTagById(t.tagId);
    return tag?.inverseScore === true;
  });

  // Operational flags (very low scores)
  const operationalFlags: string[] = [];
  if (rawScore <= 3) {
    operationalFlags.push(`low_${dimension.toLowerCase()}`);
  }

  return {
    dimension,
    rawScore,
    normalizedScore: rawScore * 10,
    tagCount: selectedTags.length,
    hasNegativeIndicators,
    operationalFlags,
  };
}

/**
 * Compact previous score display component
 */
export function PreviousScoreIndicator() {
  const { latestAssessment, isLoadingLatest } = useOperationalAssessment();
  const { t } = useTranslation();

  if (isLoadingLatest) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{t("assessment.wizard.loadingPrevious")}</span>
      </div>
    );
  }

  if (!latestAssessment) {
    return null;
  }

  const score = latestAssessment.overall_score ?? 0;
  const trend = latestAssessment.trend_vs_baseline;

  return (
    <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
      <div className="flex flex-col">
        <span className="text-xs text-muted-foreground">
          {t("assessment.previousScore")}
        </span>
        <span className={cn(
          "text-lg font-bold",
          score >= 70 ? "text-green-600" :
          score >= 50 ? "text-yellow-600" :
          "text-red-600"
        )}>
          {Math.round(score)}%
        </span>
      </div>
      
      {trend !== null && trend !== undefined && (
        <div className={cn(
          "flex items-center gap-1 text-sm",
          trend > 0 ? "text-green-600" : trend < 0 ? "text-red-600" : "text-muted-foreground"
        )}>
          <TrendingUp className={cn(
            "h-4 w-4",
            trend < 0 && "rotate-180"
          )} />
          <span>{trend > 0 ? "+" : ""}{Math.round(trend)}%</span>
        </div>
      )}
    </div>
  );
}
