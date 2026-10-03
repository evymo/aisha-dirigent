/**
 * Lab Test Panel Component
 *
 * Displays a panel of lab tests with header, description, and expandable tests list.
 * Used to show baseline, follow-up, and condition-specific panels.
 *
 * @module components/lab-tests/LabTestPanel
 */

import React, { memo, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronUp,
  Clock,
  FlaskConical,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  formatPriceCZK,
  getTimingLabel,
} from "@/lib/lab-tests";
import type {
  PanelRecommendation,
  TestPriority,
} from "@/lib/lab-tests";
import { LabTestCard } from "./LabTestCard";

interface LabTestPanelProps {
  panel: PanelRecommendation;
  selectedTests?: Set<string>;
  onTestToggle?: (code: string) => void;
  onSelectAll?: (panelId: string, testCodes: string[]) => void;
  defaultExpanded?: boolean;
  className?: string;
}

const timingIcons: Record<string, React.ElementType> = {
  baseline: FlaskConical,
  month_3: Clock,
  month_6: Clock,
  on_indication: AlertCircle,
};

const priorityOrder: TestPriority[] = ["required", "recommended", "conditional", "optional"];

export const LabTestPanel = memo(function LabTestPanel({
  panel,
  selectedTests = new Set(),
  onTestToggle,
  onSelectAll,
  defaultExpanded = true,
  className,
}: LabTestPanelProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const TimingIcon = timingIcons[panel.timing] || Clock;
  const timingLabel = getTimingLabel(panel.timing, t);

  // Group tests by priority - use LabTestRecommendation directly (has `name` field)
  const testsByPriority = useMemo(() => {
    // Group by priority manually since we're using LabTestRecommendation, not EnrichedLabTest
    const groups: Record<TestPriority, typeof panel.tests> = {
      required: [],
      recommended: [],
      conditional: [],
      optional: [],
    };
    for (const test of panel.tests) {
      groups[test.priority].push(test);
    }
    return groups;
  }, [panel]);

  // Calculate selection stats
  const selectionStats = useMemo(() => {
    const totalTests = panel.tests.length;
    const selectedCount = panel.tests.filter((t) =>
      selectedTests.has(t.code)
    ).length;
    const selectedPrice = panel.tests
      .filter((t) => selectedTests.has(t.code))
      .reduce((sum, t) => sum + t.price, 0);

    return {
      total: totalTests,
      selected: selectedCount,
      selectedPrice,
      allSelected: selectedCount === totalTests,
      someSelected: selectedCount > 0 && selectedCount < totalTests,
    };
  }, [panel.tests, selectedTests]);

  const handleSelectAll = () => {
    if (onSelectAll) {
      const testCodes = panel.tests.map((t) => t.code);
      onSelectAll(panel.panel_id, testCodes);
    }
  };

  return (
    <Card className={cn("overflow-hidden", className)}>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {panel.is_mandatory ? (
                  <Badge variant="default" className="text-xs bg-red-600">
                    {t("labTests.panels.mandatory")}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">
                    {t("labTests.panels.onIndication")}
                  </Badge>
                )}
                <Badge
                  variant="secondary"
                  className="text-xs flex items-center gap-1"
                >
                  <TimingIcon className="h-3 w-3" />
                  {timingLabel}
                </Badge>
              </div>
              <CardTitle className="text-lg leading-snug">
                {panel.panel_name}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {panel.panel_description}
              </p>
            </div>

            <div className="text-right shrink-0">
              <p className="text-lg font-bold">
                {formatPriceCZK(panel.total_price)}
              </p>
              <p className="text-xs text-muted-foreground">
                {panel.tests.length} {t("labTests.order.testsCount", { count: panel.tests.length })}
              </p>
            </div>
          </div>

          {/* Selection indicator */}
          {onTestToggle && selectionStats.selected > 0 && (
            <div className="flex items-center gap-2 mt-2 text-sm text-primary">
              <CheckCircle2 className="h-4 w-4" />
              <span>
                {selectionStats.selected}/{selectionStats.total} vybrán •{" "}
                {formatPriceCZK(selectionStats.selectedPrice)}
              </span>
            </div>
          )}

          {/* Panel reason */}
          {panel.reason && (
            <div className="mt-3 p-3 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground">{panel.reason}</p>
            </div>
          )}
        </CardHeader>

        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="w-full border-t border-b rounded-none justify-between px-4 py-2"
          >
            <span className="text-sm">
              {isExpanded ? t("labTests.actions.hideDetails") : t("labTests.actions.viewDetails")}
            </span>
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-4">
            {/* Quick actions */}
            {onTestToggle && onSelectAll && (
              <div className="flex items-center justify-between mb-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSelectAll}
                  disabled={selectionStats.allSelected}
                >
                  {t("labTests.order.addAll")}
                </Button>
              </div>
            )}

            {/* Tests grouped by priority */}
            <div className="space-y-4">
              {priorityOrder.map((priority) => {
                const tests = testsByPriority[priority];
                if (tests.length === 0) return null;

                return (
                  <div key={priority}>
                    <h5 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                      {t(`labTests.priority.${priority}`)}
                      <Badge variant="outline" className="text-xs">
                        {tests.length}
                      </Badge>
                    </h5>
                    <div className="space-y-2">
                      {tests.map((test) => (
                        <LabTestCard
                          key={test.code}
                          test={test}
                          isSelected={selectedTests.has(test.code)}
                          onToggle={onTestToggle}
                          compact
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
});

LabTestPanel.displayName = "LabTestPanel";
