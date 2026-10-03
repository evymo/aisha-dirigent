import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import type { OperationalTagCardProps } from "./types";

/**
 * OperationalTagCard Component
 * 
 * A selectable card representing a operational tag with label and optional score indicator.
 * Used in the dimensional assessment flow for intensity, pattern, and symptom selection.
 */
export function OperationalTagCard({
  tag,
  selected,
  onToggle,
  disabled = false,
  size = "md",
}: OperationalTagCardProps) {
  const { t } = useTranslation();
  const sizeClasses = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-5 py-3 text-base",
  };

  const handleClick = () => {
    if (!disabled) {
      onToggle(tag.id);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === "Enter" || e.key === " ") && !disabled) {
      e.preventDefault();
      onToggle(tag.id);
    }
  };

  // Determine visual style based on tag type
  const isIntensity = tag.category === "intensity";
  const isNegative = tag.inverseScore;
  const isPositive = tag.category === "symptom" && !tag.inverseScore && tag.score === null;

  return (
    <button
      type="button"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      disabled={disabled}
      className={cn(
        // Base styles
        "relative rounded-lg border-2 transition-all duration-200",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        "focus-visible:ring-primary",
        sizeClasses[size],
        
        // Default state
        !selected && !disabled && [
          "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50",
          "dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600 dark:hover:bg-gray-750",
        ],
        
        // Selected state - intensity tags have score-based colors
        selected && isIntensity && tag.score !== null && [
          tag.score >= 7 && "border-green-500 bg-green-50 text-green-900 dark:bg-green-900/30 dark:text-green-100",
          tag.score >= 4 && tag.score < 7 && "border-yellow-500 bg-yellow-50 text-yellow-900 dark:bg-yellow-900/30 dark:text-yellow-100",
          tag.score < 4 && "border-red-500 bg-red-50 text-red-900 dark:bg-red-900/30 dark:text-red-100",
        ],
        
        // Selected state - symptom/pattern tags
        selected && !isIntensity && [
          isNegative && "border-orange-400 bg-orange-50 text-orange-900 dark:bg-orange-900/30 dark:text-orange-100",
          isPositive && "border-blue-400 bg-blue-50 text-blue-900 dark:bg-blue-900/30 dark:text-blue-100",
          !isNegative && !isPositive && "border-primary bg-primary/10 text-primary-foreground dark:bg-primary/20",
        ],
        
        // Disabled state
        disabled && "opacity-50 cursor-not-allowed",
        
        // Cursor
        !disabled && "cursor-pointer"
      )}
      aria-pressed={selected}
      aria-disabled={disabled}
    >
      {/* Score indicator for intensity tags */}
      {isIntensity && tag.score !== null && (
        <span 
          className={cn(
            "absolute -top-1 -right-1 w-5 h-5 rounded-full text-[10px] font-bold",
            "flex items-center justify-center",
            tag.score >= 7 && "bg-green-500 text-white",
            tag.score >= 4 && tag.score < 7 && "bg-yellow-500 text-white",
            tag.score < 4 && "bg-red-500 text-white"
          )}
        >
          {tag.score}
        </span>
      )}
      
      {/* Tag label */}
      <span className="font-medium">{t(tag.labelKey)}</span>
      
      {/* Selection checkmark for non-intensity tags */}
      {selected && !isIntensity && (
        <span className="ml-2 inline-flex items-center">
          <svg 
            className="w-4 h-4" 
            fill="currentColor" 
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path 
              fillRule="evenodd" 
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" 
              clipRule="evenodd" 
            />
          </svg>
        </span>
      )}
    </button>
  );
}
