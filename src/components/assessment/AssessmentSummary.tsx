import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Target, ChevronsUp, ChevronUp, ArrowRight, ChevronDown, ChevronsDown } from "lucide-react";
import { DIMENSION_INFO } from "./types";
import { DimensionIcon } from "./DimensionIcon";
import { 
  getScoreInterpretation, 
  getScoreColorClass, 
  getScoreBgClass,
  getTrendInterpretation,
  getTrendColorClass,
  getTrendArrow,
  getPriorityDimensions,
  hasCriticalFlags 
} from "./scoreCalculator";
import type { LongevityScore } from "./types";

interface AssessmentSummaryProps {
  score: LongevityScore;
  onRetake?: () => void;
  onContinue?: () => void;
  showActions?: boolean;
}

const TREND_ARROW_ICONS: Record<string, React.ElementType> = {
  "chevrons-up": ChevronsUp,
  "chevron-up": ChevronUp,
  "arrow-right": ArrowRight,
  "chevron-down": ChevronDown,
  "chevrons-down": ChevronsDown,
};

/**
 * AssessmentSummary Component
 * 
 * Displays the results of a dimensional assessment including:
 * - Overall Longevity Score
 * - Per-dimension breakdown (radar chart style visual)
 * - Trend vs baseline (if available)
 * - Priority areas for improvement
 * - Operational flags for physician review
 */
export function AssessmentSummary({
  score,
  onRetake,
  onContinue,
  showActions = true,
}: AssessmentSummaryProps) {
  const priorityDimensions = getPriorityDimensions(score);
  const hasCritical = hasCriticalFlags(score);
  const { t } = useTranslation();

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      {/* Overall Score Card */}
      <div className={cn(
        "p-6 rounded-xl border-2 text-center",
        getScoreBgClass(score.overall),
        score.overall >= 60 ? "border-green-300 dark:border-green-700" :
        score.overall >= 40 ? "border-yellow-300 dark:border-yellow-700" :
        "border-red-300 dark:border-red-700"
      )}>
        <h2 className="text-lg font-medium text-gray-600 dark:text-gray-400 mb-2">
          {t("assessment.yourLongevityScore")}
        </h2>
        
        <div className={cn(
          "text-6xl font-bold mb-2",
          getScoreColorClass(score.overall)
        )}>
          {Math.round(score.overall)}%
        </div>
        
        <div className={cn(
          "text-xl font-semibold",
          getScoreColorClass(score.overall)
        )}>
          {getScoreInterpretation(score.overall)}
        </div>

        {/* Trend indicator */}
        {score.trendVsBaseline !== undefined && (
          <div className={cn(
            "mt-4 flex items-center justify-center gap-2",
            getTrendColorClass(score.trendVsBaseline)
          )}>
            {(() => {
              const IconComp = TREND_ARROW_ICONS[getTrendArrow(score.trendVsBaseline)] ?? ArrowRight;
              return <IconComp className="h-6 w-6" />;
            })()}
            <span className="text-sm font-medium">
              {score.trendVsBaseline > 0 ? "+" : ""}{Math.round(score.trendVsBaseline)}%
              {" "}({getTrendInterpretation(score.trendVsBaseline)})
            </span>
          </div>
        )}
      </div>

      {/* Dimension Breakdown */}
      <div className="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
        <h3 className="text-lg font-semibold mb-4">{t("assessment.dimensionOverview")}</h3>
        
        <div className="space-y-3">
          {score.dimensions.map(dimScore => {
            const info = DIMENSION_INFO[dimScore.dimension];
            
            return (
              <div key={dimScore.dimension} className="flex items-center gap-3">
                {/* Icon */}
                <span className="w-8 flex-shrink-0" title={t(info.nameKey)}>
                  <DimensionIcon name={info.icon} className="h-6 w-6" />
                </span>
                
                {/* Name */}
                <span className="w-28 text-sm font-medium text-gray-700 dark:text-gray-300 flex-shrink-0">
                  {t(info.nameKey)}
                </span>
                
                {/* Progress bar */}
                <div className="flex-1 h-3 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div 
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      dimScore.normalizedScore >= 70 && "bg-green-500",
                      dimScore.normalizedScore >= 50 && dimScore.normalizedScore < 70 && "bg-lime-500",
                      dimScore.normalizedScore >= 30 && dimScore.normalizedScore < 50 && "bg-yellow-500",
                      dimScore.normalizedScore < 30 && "bg-red-500"
                    )}
                    style={{ width: `${dimScore.normalizedScore}%` }}
                  />
                </div>
                
                {/* Score */}
                <span className={cn(
                  "w-12 text-right text-sm font-semibold",
                  getScoreColorClass(dimScore.normalizedScore)
                )}>
                  {Math.round(dimScore.normalizedScore)}%
                </span>
                
                {/* Alert indicator */}
                {dimScore.normalizedScore < 40 && (
                  <AlertTriangle className="h-4 w-4 text-red-500" aria-label={t("assessment.needsAttention")} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Priority Areas */}
      {priorityDimensions.length > 0 && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-xl p-6 border border-yellow-200 dark:border-yellow-800">
          <h3 className="text-lg font-semibold text-yellow-800 dark:text-yellow-200 mb-3 flex items-center gap-2">
            <Target className="h-5 w-5" />
            {t("assessment.priorityAreasForImprovement")}
          </h3>
          
          <ul className="space-y-2">
            {priorityDimensions.map(dim => {
              const info = DIMENSION_INFO[dim];
              const dimScore = score.dimensions.find(d => d.dimension === dim);
              
              return (
                <li key={dim} className="flex items-center gap-2">
                  <DimensionIcon name={info.icon} className="h-5 w-5" />
                  <span className="font-medium text-yellow-900 dark:text-yellow-100">
                    {t(info.nameKey)}
                  </span>
                  <span className="text-sm text-yellow-700 dark:text-yellow-300">
                    ({Math.round(dimScore?.normalizedScore ?? 0)}%)
                  </span>
                </li>
              );
            })}
          </ul>
          
          <p className="mt-3 text-sm text-yellow-700 dark:text-yellow-300">
            {t("assessment.focusOnAreasForImprovement")}
          </p>
        </div>
      )}

      {/* Critical Alert */}
      {hasCritical && (
        <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-6 border border-red-200 dark:border-red-800">
          <h3 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            {t("assessment.medicalConsultationRecommendation")}
          </h3>
          <p className="text-sm text-red-700 dark:text-red-300">
            {t("assessment.medicalConsultationDescription")}
          </p>
        </div>
      )}

      {/* Assessment Date */}
      <div className="text-center text-sm text-gray-500 dark:text-gray-400">
        {t("assessment.assessmentDate")}: {score.assessmentDate.toLocaleDateString('cs-CZ', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </div>

      {/* Actions */}
      {showActions && (
        <div className="flex justify-center gap-4 pt-4">
          {onRetake && (
            <button
              onClick={onRetake}
              className="px-6 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 
                         bg-gray-100 dark:bg-gray-800 rounded-lg 
                         hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              {t("assessment.retakeAssessment")}
            </button>
          )}
          
          {onContinue && (
            <button
              onClick={onContinue}
              className="px-6 py-2 text-sm font-medium text-white 
                         bg-primary rounded-lg hover:bg-primary/90 transition-colors"
            >
              {t("common.continue")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
