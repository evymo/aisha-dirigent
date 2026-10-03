/**
 * Lab Test Recommendation Block for StoryLoop
 *
 * Displays lab test recommendations within the StoryLoop context,
 * integrated with story analysis and AI recommendations.
 *
 * @module components/storyloop/blocks/LabTestRecommendationBlock
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FlaskConical,
  Sparkles,
  ChevronDown,
  ChevronUp,
  ShoppingCart,
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
  getProductName,
  getPriorityLabel,
} from "@/lib/lab-tests";
import type {
  RtnProduct,
  LabTestRecommendation,
  PanelRecommendation,
} from "@/lib/lab-tests";

interface LabTestRecommendationMetadata {
  products: RtnProduct[];
  conditions?: string[];
  panels: PanelRecommendation[];
  ai_recommendations?: LabTestRecommendation[];
  selected_tests?: string[];
  total_price?: number;
  status?: "draft" | "ordered" | "completed";
}

interface LabTestRecommendationBlockProps {
  metadata: LabTestRecommendationMetadata;
  entryId: string;
  storyId: string;
  onSelectTests?: (tests: LabTestRecommendation[]) => void;
  onOrderTests?: () => void;
  isPartnerView?: boolean;
}

export function LabTestRecommendationBlock({
  metadata,
  entryId: _entryId,
  storyId: _storyId,
  onSelectTests,
  onOrderTests,
  isPartnerView: _isPartnerView = false,
}: LabTestRecommendationBlockProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(
    new Set(metadata.selected_tests || [])
  );

  // Calculate totals
  const allTests = metadata.panels.flatMap((p) => p.tests);
  const selectedTests = allTests.filter((t) => selectedCodes.has(t.code));
  const totalPrice = selectedTests.reduce((sum, t) => sum + t.price, 0);

  const handleTestToggle = (code: string) => {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    const allCodes = allTests.map((t) => t.code);
    setSelectedCodes(new Set(allCodes));
    if (onSelectTests) {
      onSelectTests(allTests);
    }
  };

  const statusColors = {
    draft: "bg-muted text-muted-foreground",
    ordered: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
    completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-primary/10">
              <FlaskConical className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                {t("labTests.recommendations.title")}
                {metadata.ai_recommendations && metadata.ai_recommendations.length > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    <Sparkles className="h-3 w-3 mr-1" />
                    AI
                  </Badge>
                )}
              </CardTitle>
              <div className="flex items-center gap-2 mt-1">
                {metadata.products.map((product) => (
                  <Badge key={product} variant="outline" className="text-xs">
                    {getProductName(product, t)}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          <div className="text-right">
            {metadata.status && (
              <Badge className={cn("text-xs mb-1", statusColors[metadata.status])}>
                {t(`storyloop.labStatus.${metadata.status}`)}
              </Badge>
            )}
            <p className="text-sm font-medium">
              {metadata.panels.length} {t("labTests.panels.title").toLowerCase()}
            </p>
          </div>
        </div>
      </CardHeader>

      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="w-full border-t rounded-none justify-between px-4 py-2"
          >
            <span className="text-sm flex items-center gap-2">
              {selectedCodes.size > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {selectedCodes.size} {t("labTests.order.testsCount", { count: selectedCodes.size })}
                </Badge>
              )}
              {selectedCodes.size > 0 && (
                <span className="font-medium text-primary">
                  {formatPriceCZK(totalPrice)}
                </span>
              )}
            </span>
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-4 space-y-4">
            {/* Quick actions */}
            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" onClick={handleSelectAll}>
                {t("labTests.order.addAll")}
              </Button>
              {onOrderTests && selectedCodes.size > 0 && (
                <Button size="sm" onClick={onOrderTests}>
                  <ShoppingCart className="h-4 w-4 mr-2" />
                  {t("labTests.order.submitOrder")}
                </Button>
              )}
            </div>

            {/* Panels */}
            {metadata.panels.map((panel) => (
              <div key={panel.panel_id} className="border rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-sm">{panel.panel_name}</h4>
                  <Badge variant={panel.is_mandatory ? "default" : "outline"} className="text-xs">
                    {panel.is_mandatory
                      ? t("labTests.panels.mandatory")
                      : t("labTests.panels.onIndication")}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  {panel.panel_description}
                </p>

                {/* Tests list */}
                <div className="space-y-1.5">
                  {panel.tests.map((test) => (
                    <div
                      key={test.code}
                      className={cn(
                        "flex items-center justify-between text-sm p-2 rounded cursor-pointer hover:bg-muted/50 transition-colors",
                        selectedCodes.has(test.code) && "bg-primary/5 border border-primary/20"
                      )}
                      onClick={() => handleTestToggle(test.code)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={selectedCodes.has(test.code)}
                          onChange={() => handleTestToggle(test.code)}
                          className="rounded border-gray-300"
                        />
                        <span className="truncate">{test.name}</span>
                        <Badge
                          variant="outline"
                          className={cn("text-xs shrink-0")}
                        >
                          {getPriorityLabel(test.priority, t)}
                        </Badge>
                      </div>
                      <span className="text-muted-foreground shrink-0 ml-2">
                        {formatPriceCZK(test.price)}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Panel total */}
                <div className="flex items-center justify-between mt-3 pt-2 border-t text-sm">
                  <span className="text-muted-foreground">
                    {panel.tests.length} {t("labTests.order.testsCount", { count: panel.tests.length })}
                  </span>
                  <span className="font-medium">
                    {formatPriceCZK(panel.total_price)}
                  </span>
                </div>
              </div>
            ))}

            {/* AI Recommendations */}
            {metadata.ai_recommendations && metadata.ai_recommendations.length > 0 && (
              <div className="border rounded-lg p-3 bg-gradient-to-br from-purple-50/50 to-blue-50/50 dark:from-purple-950/20 dark:to-blue-950/20">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <h4 className="font-medium text-sm">{t("labTests.ai.title")}</h4>
                </div>
                <div className="space-y-1.5">
                  {metadata.ai_recommendations.map((test) => (
                    <div
                      key={test.code}
                      className={cn(
                        "flex items-center justify-between text-sm p-2 rounded cursor-pointer hover:bg-white/50 dark:hover:bg-white/5 transition-colors",
                        selectedCodes.has(test.code) && "bg-white dark:bg-white/10 border border-primary/20"
                      )}
                      onClick={() => handleTestToggle(test.code)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedCodes.has(test.code)}
                            onChange={() => handleTestToggle(test.code)}
                            className="rounded border-gray-300"
                          />
                          <span className="truncate">{test.name}</span>
                        </div>
                        {test.reason && (
                          <p className="text-xs text-muted-foreground mt-0.5 ml-6">
                            {test.reason}
                          </p>
                        )}
                      </div>
                      <span className="text-muted-foreground shrink-0 ml-2">
                        {formatPriceCZK(test.price)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Total summary */}
            {selectedCodes.size > 0 && (
              <div className="flex items-center justify-between p-3 bg-primary/5 rounded-lg">
                <span className="font-medium">{t("labTests.order.totalPrice")}</span>
                <span className="text-lg font-bold text-primary">
                  {formatPriceCZK(totalPrice)}
                </span>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
