import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { OperationalTagCard } from "./OperationalTagCard";
import type { DimensionTagGridProps } from "./types";

/**
 * DimensionTagGrid Component
 * 
 * A grid layout for selecting multiple tags within a category.
 * Used for pattern and symptom selection in the assessment flow.
 * 
 * Features:
 * - Flexible grid layout
 * - Single or multi-select modes
 * - Category-aware styling
 * - Responsive design
 */
export function DimensionTagGrid({
  dimension: _dimension,
  tags,
  selectedTagIds,
  onTagToggle,
  category,
  multiSelect = true,
  disabled = false,
}: DimensionTagGridProps) {
  const { t } = useTranslation();

  // Filter tags by category if specified
  const filteredTags = category 
    ? tags.filter(t => t.category === category)
    : tags.filter(t => t.category !== "intensity"); // Exclude intensity (handled by IntensitySelector)

  if (filteredTags.length === 0) {
    return null;
  }

  // Get category label
  const getCategoryLabel = () => {
    switch (category) {
      case "pattern":
        return t("assessment.dimension.patternPrompt");
      case "symptom":
        return t("assessment.dimension.symptomPrompt");
      case "context":
        return t("assessment.dimension.contextPrompt");
      default:
        return t("assessment.dimension.defaultPrompt");
    }
  };

  const getCategoryDescription = () => {
    if (multiSelect) {
      return t("assessment.dimension.multiSelectHint");
    }
    return t("assessment.dimension.singleSelectHint");
  };

  const handleTagToggle = (tagId: string) => {
    if (!multiSelect) {
      // Single select: if clicking selected, deselect; otherwise select new
      if (selectedTagIds.includes(tagId)) {
        onTagToggle(tagId); // This will deselect
      } else {
        // Deselect all others in this category first
        const otherSelectedInCategory = selectedTagIds.filter(id => {
          const tag = tags.find(t => t.id === id);
          return tag && tag.category === category;
        });
        
        // Toggle off all other selections in this category
        otherSelectedInCategory.forEach(id => {
          if (id !== tagId) {
            onTagToggle(id);
          }
        });
        
        // Select the new one
        onTagToggle(tagId);
      }
    } else {
      // Multi select: just toggle
      onTagToggle(tagId);
    }
  };

  return (
    <div className="w-full">
      {/* Category header */}
      <div className="mb-3">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {getCategoryLabel()}
        </h4>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {getCategoryDescription()}
        </p>
      </div>

      {/* Tag grid */}
      <div 
        className={cn(
          "flex flex-wrap gap-2",
          disabled && "pointer-events-none"
        )}
        role={multiSelect ? "group" : "radiogroup"}
        aria-label={getCategoryLabel()}
      >
        {filteredTags.map(tag => (
          <OperationalTagCard
            key={tag.id}
            tag={tag}
            selected={selectedTagIds.includes(tag.id)}
            onToggle={handleTagToggle}
            disabled={disabled}
            size="md"
          />
        ))}
      </div>
    </div>
  );
}
