/**
 * Lab Test Card Component
 *
 * Displays a single lab test with its details, price, and reason.
 * Used within test panels and recommendation lists.
 *
 * @module components/lab-tests/LabTestCard
 */

import React, { memo } from "react";
import { useTranslation } from "react-i18next";
import {
  Droplet,
  FlaskConical,
  Package,
  Pipette,
  Clock,
  Info,
  Plus,
  Check,
  Minus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  formatPriceCZK,
  getPriorityColorClass,
  getPriorityLabel,
  getSampleTypeLabel,
} from "@/lib/lab-tests";
import type {
  LabTestRecommendation,
  SampleType,
} from "@/lib/lab-tests";

interface LabTestCardProps {
  test: LabTestRecommendation;
  isSelected?: boolean;
  onToggle?: (code: string) => void;
  showReason?: boolean;
  compact?: boolean;
  className?: string;
}

const sampleTypeIcons: Record<SampleType, React.ElementType> = {
  blood: Droplet,
  urine: FlaskConical,
  stool: Package,
  saliva: Pipette,
};

export const LabTestCard = memo(function LabTestCard({
  test,
  isSelected = false,
  onToggle,
  showReason = true,
  compact = false,
  className,
}: LabTestCardProps) {
  const { t } = useTranslation();
  const [isReasonOpen, setIsReasonOpen] = React.useState(false);

  const SampleIcon = sampleTypeIcons[test.sample_type] || FlaskConical;
  const priorityLabel = getPriorityLabel(test.priority, t);
  const priorityClass = getPriorityColorClass(test.priority);
  const sampleLabel = getSampleTypeLabel(test.sample_type, t);

  const handleToggle = () => {
    if (onToggle) {
      onToggle(test.code);
    }
  };

  if (compact) {
    return (
      <div
        className={cn(
          "flex items-center justify-between gap-2 py-2 px-3 rounded-lg border bg-card",
          isSelected && "border-primary bg-primary/5",
          className
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <SampleIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium truncate">{test.name}</span>
          <Badge variant="outline" className={cn("text-xs shrink-0", priorityClass)}>
            {priorityLabel}
          </Badge>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-medium text-muted-foreground">
            {formatPriceCZK(test.price)}
          </span>
          {onToggle && (
            <Button
              variant={isSelected ? "default" : "outline"}
              size="icon"
              className="h-7 w-7"
              onClick={handleToggle}
            >
              {isSelected ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border bg-card transition-colors",
        isSelected && "border-primary bg-primary/5",
        className
      )}
    >
      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono text-muted-foreground">
                {test.code}
              </span>
              <Badge
                variant="outline"
                className={cn("text-xs", priorityClass)}
              >
                {priorityLabel}
              </Badge>
            </div>
            <h4 className="font-medium text-sm leading-snug">{test.name}</h4>
          </div>
          <div className="text-right shrink-0">
            <p className="font-semibold text-sm">
              {formatPriceCZK(test.price)}
            </p>
          </div>
        </div>

        {/* Metadata row */}
        <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5">
                  <SampleIcon className="h-3.5 w-3.5" />
                  <span>{sampleLabel}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t("labTests.test.sampleType")}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {test.requires_fasting && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                    <Clock className="h-3.5 w-3.5" />
                    <span>{t("labTests.test.requiresFasting")}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("labTests.instructions.fasting.description")}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          <span className="text-muted-foreground/70">{test.category}</span>
        </div>

        {/* Reason section */}
        {showReason && test.reason && (
          <Collapsible open={isReasonOpen} onOpenChange={setIsReasonOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 mt-3 text-xs text-primary hover:underline"
              >
                <Info className="h-3.5 w-3.5" />
                <span>{t("labTests.test.reason")}</span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <p className="mt-2 text-sm text-muted-foreground bg-muted/50 rounded-md p-3">
                {test.reason}
              </p>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      {/* Action footer */}
      {onToggle && (
        <div className="border-t px-4 py-2 bg-muted/30">
          <Button
            variant={isSelected ? "secondary" : "outline"}
            size="sm"
            className="w-full"
            onClick={handleToggle}
          >
            {isSelected ? (
              <>
                <Minus className="h-4 w-4 mr-2" />
                {t("labTests.test.removeFromOrder")}
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                {t("labTests.test.addToOrder")}
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
});

LabTestCard.displayName = "LabTestCard";
