import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { DIMENSION_INFO } from "./types";
import { DimensionIcon } from "./DimensionIcon";
import type { IntensitySelectorProps } from "./types";

/**
 * IntensitySelector Component
 * 
 * A horizontal selector for intensity levels (5 options from excellent to poor).
 * Used as the primary question in each dimension of the assessment.
 * 
 * Features:
 * - Visual score indicators (colored circles)
 * - Keyboard navigation
 * - Responsive layout
 * - Accessibility support
 */
export function IntensitySelector({
  dimension,
  tags,
  selectedTagId,
  onSelect,
  disabled = false,
}: IntensitySelectorProps) {
  const { t } = useTranslation();
  const dimensionInfo = DIMENSION_INFO[dimension];
  
  // Sort intensity tags by score (highest first)
  const sortedTags = [...tags]
    .filter(t => t.category === "intensity")
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const handleKeyDown = (e: React.KeyboardEvent, currentIndex: number) => {
    if (disabled) return;
    
    let newIndex = currentIndex;
    
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        newIndex = Math.min(currentIndex + 1, sortedTags.length - 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        newIndex = Math.max(currentIndex - 1, 0);
        break;
      case "Home":
        e.preventDefault();
        newIndex = 0;
        break;
      case "End":
        e.preventDefault();
        newIndex = sortedTags.length - 1;
        break;
      default:
        return;
    }
    
    if (newIndex !== currentIndex) {
      onSelect(sortedTags[newIndex].id);
    }
  };

  const getScoreColor = (score: number | null) => {
    if (score === null) return "bg-gray-300";
    if (score >= 8) return "bg-green-500";
    if (score >= 6) return "bg-lime-500";
    if (score >= 4) return "bg-yellow-500";
    if (score >= 2) return "bg-orange-500";
    return "bg-red-500";
  };

  const getScoreBorderColor = (score: number | null, isSelected: boolean) => {
    if (!isSelected) return "border-gray-200 dark:border-gray-700";
    if (score === null) return "border-gray-500";
    if (score >= 8) return "border-green-500";
    if (score >= 6) return "border-lime-500";
    if (score >= 4) return "border-yellow-500";
    if (score >= 2) return "border-orange-500";
    return "border-red-500";
  };

  return (
    <div className="w-full">
      {/* Dimension header */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <DimensionIcon name={dimensionInfo.icon} className="h-6 w-6" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t(dimensionInfo.nameKey)}
          </h3>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t(dimensionInfo.descriptionKey)}
        </p>
      </div>

      {/* Intensity selector */}
      <div 
        className="grid grid-cols-5 gap-2 sm:gap-3"
        role="radiogroup"
        aria-label={t("assessment.intensity.title")}
      >
        {sortedTags.map((tag, index) => {
          const isSelected = selectedTagId === tag.id;
          
          return (
            <button
              key={tag.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              onClick={() => onSelect(tag.id)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              tabIndex={isSelected || (index === 0 && !selectedTagId) ? 0 : -1}
              className={cn(
                // Base styles
                "relative flex flex-col items-center p-3 rounded-xl border-2 transition-all duration-200",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary",
                
                // Border color based on selection and score
                getScoreBorderColor(tag.score, isSelected),
                
                // Background on selection
                isSelected && "bg-gray-50 dark:bg-gray-800",
                !isSelected && "bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800",
                
                // Disabled state
                disabled && "opacity-50 cursor-not-allowed",
                !disabled && "cursor-pointer",
              )}
            >
              {/* Score circle */}
              <div 
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center mb-2",
                  "text-white font-bold text-lg",
                  getScoreColor(tag.score),
                  isSelected && "ring-2 ring-offset-2 ring-current"
                )}
              >
                {tag.score ?? "?"}
              </div>
              
              {/* Label */}
              <span 
                className={cn(
                  "text-xs sm:text-sm text-center font-medium leading-tight",
                  isSelected ? "text-gray-900 dark:text-gray-100" : "text-gray-600 dark:text-gray-400"
                )}
              >
                {t(tag.labelKey)}
              </span>
              
              {/* Selection indicator */}
              {isSelected && (
                <div className="absolute -top-1 -right-1 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                  <svg 
                    className="w-3 h-3 text-primary-foreground" 
                    fill="currentColor" 
                    viewBox="0 0 20 20"
                  >
                    <path 
                      fillRule="evenodd" 
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" 
                      clipRule="evenodd" 
                    />
                  </svg>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Operational instrument reference (if available) */}
      {dimensionInfo.validatedInstrument && (
        <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
          {dimensionInfo.validatedInstrument}
        </p>
      )}
    </div>
  );
}
