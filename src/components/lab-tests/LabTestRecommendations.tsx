/**
 * Lab Test Recommendations Component
 *
 * Main component for displaying lab test recommendations based on
 * RTN products, health conditions, and AI analysis.
 *
 * @module components/lab-tests/LabTestRecommendations
 */

import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  FlaskConical,
  Sparkles,
  AlertCircle,
  Filter,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  getMandatoryPanels,
  getPanelsForConditions,
  panelToRecommendation,
  getProductName,
  formatPriceCZK,
} from "@/lib/lab-tests";
import type {
  RtnProduct,
  PanelRecommendation,
  LabTestRecommendation,
  TestPriority,
  SampleType,
} from "@/lib/lab-tests";
import { LabTestPanel } from "./LabTestPanel";
import { LabTestOrderSummary } from "./LabTestOrderSummary";

interface LabTestRecommendationsProps {
  products: RtnProduct[];
  conditions?: string[];
  aiRecommendations?: LabTestRecommendation[];
  isAiLoading?: boolean;
  onRequestAiRecommendations?: () => void;
  onSubmitOrder?: (tests: LabTestRecommendation[]) => void;
  onSaveForLater?: (tests: LabTestRecommendation[]) => void;
  className?: string;
}

type FilterPriority = "all" | TestPriority;
type FilterSample = "all" | SampleType;

export function LabTestRecommendations({
  products,
  conditions = [],
  aiRecommendations = [],
  isAiLoading = false,
  onRequestAiRecommendations,
  onSubmitOrder,
  onSaveForLater,
  className,
}: LabTestRecommendationsProps) {
  const { t } = useTranslation();

  // State
  const [selectedTestCodes, setSelectedTestCodes] = useState<Set<string>>(new Set());
  const [priorityFilter, setPriorityFilter] = useState<FilterPriority>("all");
  const [sampleFilter, setSampleFilter] = useState<FilterSample>("all");
  const [activeTab, setActiveTab] = useState<string>("panels");

  // Generate panel recommendations
  const panelRecommendations = useMemo((): PanelRecommendation[] => {
    const panels: PanelRecommendation[] = [];

    // Mandatory panels for selected products
    const mandatoryPanels = getMandatoryPanels(products);
    mandatoryPanels.forEach((panel) => {
      const productNames = products
        .filter((p) => panel.applicable_products.includes(p))
        .map((p) => getProductName(p, t))
        .join(", ");

      panels.push(
        panelToRecommendation(
          panel,
          `${t("labTests.ai.basedOn")} ${t("labTests.ai.products")}: ${productNames}`,
          t
        )
      );
    });

    // Condition-based panels
    if (conditions.length > 0) {
      const conditionPanels = getPanelsForConditions(conditions);
      conditionPanels.forEach((panel) => {
        // Avoid duplicates
        if (!panels.some((p) => p.panel_id === panel.id)) {
          panels.push(
            panelToRecommendation(
              panel,
              `${t("labTests.ai.basedOn")} ${t("labTests.ai.conditions")}`,
              t
            )
          );
        }
      });
    }

    return panels;
  }, [products, conditions, t]);

  // Get selected tests as full objects
  const selectedTests = useMemo((): LabTestRecommendation[] => {
    const allTests = panelRecommendations.flatMap((p) => p.tests);
    // Add AI recommendations
    allTests.push(...aiRecommendations);

    return allTests.filter((test) => selectedTestCodes.has(test.code));
  }, [panelRecommendations, aiRecommendations, selectedTestCodes]);

  // Handlers
  const handleTestToggle = useCallback((code: string) => {
    setSelectedTestCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback((_panelId: string, testCodes: string[]) => {
    setSelectedTestCodes((prev) => {
      const next = new Set(prev);
      testCodes.forEach((code) => next.add(code));
      return next;
    });
  }, []);

  const handleClearAll = useCallback(() => {
    setSelectedTestCodes(new Set());
  }, []);

  const handleSubmitOrder = useCallback(() => {
    if (onSubmitOrder) {
      onSubmitOrder(selectedTests);
    }
  }, [onSubmitOrder, selectedTests]);

  const handleSaveForLater = useCallback(() => {
    if (onSaveForLater) {
      onSaveForLater(selectedTests);
    }
  }, [onSaveForLater, selectedTests]);

  // Empty state
  if (products.length === 0) {
    return (
      <Card className={className}>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <FlaskConical className="h-16 w-16 text-muted-foreground/30 mb-4" />
          <p className="text-lg font-medium text-muted-foreground">
            {t("labTests.recommendations.empty")}
          </p>
          <p className="text-sm text-muted-foreground/70 mt-1">
            {t("labTests.ai.noData")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={cn("grid grid-cols-1 lg:grid-cols-3 gap-6", className)}>
      {/* Main content */}
      <div className="lg:col-span-2 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <FlaskConical className="h-6 w-6" />
              {t("labTests.recommendations.title")}
            </h2>
            <p className="text-muted-foreground mt-1">
              {t("labTests.recommendations.subtitle")}
            </p>
          </div>

          {/* Product badges */}
          <div className="flex flex-wrap gap-2">
            {products.map((product) => (
              <Badge key={product} variant="secondary">
                {getProductName(product, t)}
              </Badge>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              {t("labTests.actions.filterByPriority")}:
            </span>
            <Select
              value={priorityFilter}
              onValueChange={(v) => setPriorityFilter(v as FilterPriority)}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("common.all")}</SelectItem>
                <SelectItem value="required">{t("labTests.priority.required")}</SelectItem>
                <SelectItem value="recommended">{t("labTests.priority.recommended")}</SelectItem>
                <SelectItem value="conditional">{t("labTests.priority.conditional")}</SelectItem>
                <SelectItem value="optional">{t("labTests.priority.optional")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {t("labTests.actions.filterBySample")}:
            </span>
            <Select
              value={sampleFilter}
              onValueChange={(v) => setSampleFilter(v as FilterSample)}
            >
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("common.all")}</SelectItem>
                <SelectItem value="blood">{t("labTests.sampleType.blood")}</SelectItem>
                <SelectItem value="urine">{t("labTests.sampleType.urine")}</SelectItem>
                <SelectItem value="stool">{t("labTests.sampleType.stool")}</SelectItem>
                <SelectItem value="saliva">{t("labTests.sampleType.saliva")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="panels" className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4" />
              {t("labTests.panels.title")}
              <Badge variant="secondary" className="ml-1">
                {panelRecommendations.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="ai" className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              {t("labTests.ai.title")}
              {aiRecommendations.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {aiRecommendations.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Panels Tab */}
          <TabsContent value="panels" className="mt-4 space-y-4">
            {panelRecommendations.length === 0 ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {t("labTests.recommendations.empty")}
                </AlertDescription>
              </Alert>
            ) : (
              panelRecommendations.map((panel) => (
                <LabTestPanel
                  key={panel.panel_id}
                  panel={panel}
                  selectedTests={selectedTestCodes}
                  onTestToggle={handleTestToggle}
                  onSelectAll={handleSelectAll}
                  defaultExpanded={panel.is_mandatory}
                />
              ))
            )}
          </TabsContent>

          {/* AI Tab */}
          <TabsContent value="ai" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Sparkles className="h-5 w-5 text-primary" />
                  {t("labTests.ai.subtitle")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Alert className="mb-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {t("labTests.ai.disclaimer")}
                  </AlertDescription>
                </Alert>

                {isAiLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <span className="ml-3 text-muted-foreground">
                      {t("labTests.ai.analyzing")}
                    </span>
                  </div>
                ) : aiRecommendations.length > 0 ? (
                  <div className="space-y-2">
                    {aiRecommendations.map((test) => (
                      <div
                        key={test.code}
                        className={cn(
                          "flex items-center justify-between gap-3 p-3 rounded-lg border",
                          selectedTestCodes.has(test.code) && "border-primary bg-primary/5"
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm">{test.name}</p>
                          {test.reason && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {test.reason}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-sm font-medium">
                            {formatPriceCZK(test.price)}
                          </span>
                          <Button
                            variant={selectedTestCodes.has(test.code) ? "default" : "outline"}
                            size="sm"
                            onClick={() => handleTestToggle(test.code)}
                          >
                            {selectedTestCodes.has(test.code)
                              ? t("labTests.test.included")
                              : t("labTests.test.addToOrder")}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Sparkles className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                    <p className="text-sm text-muted-foreground mb-4">
                      {t("labTests.ai.noData")}
                    </p>
                    {onRequestAiRecommendations && (
                      <Button onClick={onRequestAiRecommendations}>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        {t("labTests.ai.regenerate")}
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Order summary sidebar */}
      <div className="lg:col-span-1">
        <LabTestOrderSummary
          selectedTests={selectedTests}
          onClearAll={handleClearAll}
          onSubmitOrder={onSubmitOrder ? handleSubmitOrder : undefined}
          onSaveForLater={onSaveForLater ? handleSaveForLater : undefined}
        />
      </div>
    </div>
  );
}
