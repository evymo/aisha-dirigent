import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { getTriggeredFollowUps, getTagById } from "./tagDatabase";
import type { OperationalTag, Dimension, TagSelection } from "./types";

interface ConditionalQuestionPanelProps {
  dimension: Dimension;
  /** Currently selected tags that may trigger follow-ups */
  selectedTags: TagSelection[];
  /** Callback when a follow-up tag is selected/deselected */
  onFollowUpSelect: (tagId: string, selected: boolean) => void;
  /** Follow-up responses keyed by follow-up tag ID */
  followUpResponses: Record<string, boolean | undefined>;
  className?: string;
}

/**
 * ConditionalQuestionPanel Component
 * 
 * Displays follow-up questions based on user's previous tag selections.
 * 
 * Example: If user selects "Chronická únava" in ENE dimension,
 * this panel will display relevant follow-up questions like:
 * - "Jak dlouho trváte únavu?"
 * - "Je únava spojená s nějakou aktivitou?"
 * 
 * This enables the "tag chaining" concept where tags can trigger
 * deeper operational inquiries without overwhelming the initial assessment.
 */
export function ConditionalQuestionPanel({
  dimension,
  selectedTags,
  onFollowUpSelect,
  followUpResponses,
  className,
}: ConditionalQuestionPanelProps) {
  const { t } = useTranslation();
  
  // Get all tag IDs from selections
  const selectedTagIds = selectedTags.map(s => s.tagId);
  
  // Get triggered follow-up IDs based on selected tags
  const triggeredFollowUpIds = getTriggeredFollowUps(selectedTagIds);
  
  // Convert IDs to OperationalTag objects, filter nulls
  const triggeredFollowUpTags: OperationalTag[] = triggeredFollowUpIds
    .map(id => getTagById(id))
    .filter((tag): tag is OperationalTag => tag !== undefined);

  // Remove duplicates (same follow-up might be triggered by multiple tags)
  const uniqueFollowUps = Array.from(
    new Map(triggeredFollowUpTags.map(tag => [tag.id, tag])).values()
  );

  // Filter to only show follow-ups relevant to current dimension
  const relevantFollowUps = uniqueFollowUps.filter(
    tag => tag.dimension === dimension
  );

  // Don't render if no follow-ups are triggered
  if (relevantFollowUps.length === 0) {
    return null;
  }

  return (
    <div className={cn(
      "bg-blue-50 dark:bg-blue-900/20 rounded-xl p-5 border border-blue-200 dark:border-blue-800",
      className
    )}>
      <div className="flex items-center gap-2 mb-4">
        <Search className="h-5 w-5 text-blue-700 dark:text-blue-300" />
        <h4 className="font-semibold text-blue-900 dark:text-blue-100">
          {t("assessment.followUp.title")}
        </h4>
      </div>
      
      <p className="text-sm text-blue-700 dark:text-blue-300 mb-4">
        {t("assessment.followUp.description")}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {relevantFollowUps.map(followUp => (
          <FollowUpQuestion
            key={followUp.id}
            tag={followUp}
            response={followUpResponses[followUp.id]}
            onSelect={(selected) => onFollowUpSelect(followUp.id, selected)}
          />
        ))}
      </div>
    </div>
  );
}

interface FollowUpQuestionProps {
  tag: OperationalTag;
  response: boolean | undefined;
  onSelect: (selected: boolean) => void;
}

/**
 * Individual follow-up question component
 * Designed as a simple Yes/No card for quick response
 */
function FollowUpQuestion({ tag, response, onSelect }: FollowUpQuestionProps) {
  const { t } = useTranslation();
  
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">
        {t(tag.labelKey)}
      </p>
      
      <div className="flex gap-2">
        <button
          onClick={() => onSelect(true)}
          className={cn(
            "flex-1 py-2 px-3 text-sm font-medium rounded-md transition-all",
            response === true
              ? "bg-blue-600 text-white" 
              : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-blue-100 dark:hover:bg-blue-900/30"
          )}
        >
          {t("assessment.followUp.yes")}
        </button>
        <button
          onClick={() => onSelect(false)}
          className={cn(
            "flex-1 py-2 px-3 text-sm font-medium rounded-md transition-all",
            response === false
              ? "bg-gray-600 text-white" 
              : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
          )}
        >
          {t("assessment.followUp.no")}
        </button>
      </div>
    </div>
  );
}
