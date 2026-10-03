/**
 * Lab Test Order Summary Component
 *
 * Displays a summary of selected tests with total price,
 * sample requirements, and fasting information.
 *
 * @module components/lab-tests/LabTestOrderSummary
 */

import React, { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Droplet,
  FlaskConical,
  Package,
  Pipette,
  Clock,
  CheckCircle,
  ShoppingCart,
  Trash2,
  Save,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  formatPriceCZK,
  getSampleTypeLabel,
  calculateTotalPrice,
  requiresFasting,
  getRequiredSampleTypes,
} from "@/lib/lab-tests";
import type { LabTestRecommendation, SampleType } from "@/lib/lab-tests";

interface LabTestOrderSummaryProps {
  selectedTests: LabTestRecommendation[];
  onClearAll?: () => void;
  onSubmitOrder?: () => void;
  onSaveForLater?: () => void;
  isSubmitting?: boolean;
  className?: string;
}

const sampleTypeIcons: Record<SampleType, React.ElementType> = {
  blood: Droplet,
  urine: FlaskConical,
  stool: Package,
  saliva: Pipette,
};

export const LabTestOrderSummary = memo(function LabTestOrderSummary({
  selectedTests,
  onClearAll,
  onSubmitOrder,
  onSaveForLater,
  isSubmitting = false,
  className,
}: LabTestOrderSummaryProps) {
  const { t } = useTranslation();

  const stats = useMemo(() => {
    return {
      count: selectedTests.length,
      totalPrice: calculateTotalPrice(selectedTests),
      needsFasting: requiresFasting(selectedTests),
      sampleTypes: getRequiredSampleTypes(selectedTests),
    };
  }, [selectedTests]);

  const isEmpty = selectedTests.length === 0;

  return (
    <Card className={cn("sticky top-4", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShoppingCart className="h-5 w-5" />
          {t("labTests.order.title")}
        </CardTitle>
      </CardHeader>

      <CardContent>
        {isEmpty ? (
          <div className="text-center py-6">
            <FlaskConical className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              {t("labTests.order.empty")}
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              {t("labTests.order.emptyDescription")}
            </p>
          </div>
        ) : (
          <>
            {/* Test list */}
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {selectedTests.map((test) => (
                <div
                  key={test.code}
                  className="flex items-center justify-between text-sm py-1.5 px-2 rounded bg-muted/30"
                >
                  <span className="truncate flex-1">{test.name}</span>
                  <span className="text-muted-foreground shrink-0 ml-2">
                    {formatPriceCZK(test.price)}
                  </span>
                </div>
              ))}
            </div>

            <Separator className="my-4" />

            {/* Stats */}
            <div className="space-y-3">
              {/* Count */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {t("labTests.order.testsCount", { count: stats.count })}
                </span>
                <span className="font-medium">{stats.count}</span>
              </div>

              {/* Sample types */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {t("labTests.order.sampleTypes")}
                </span>
                <div className="flex items-center gap-2">
                  {stats.sampleTypes.map((type) => {
                    const Icon = sampleTypeIcons[type];
                    return (
                      <Badge key={type} variant="outline" className="text-xs">
                        <Icon className="h-3 w-3 mr-1" />
                        {getSampleTypeLabel(type, t)}
                      </Badge>
                    );
                  })}
                </div>
              </div>

              {/* Fasting */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {t("labTests.instructions.fasting.title")}
                </span>
                {stats.needsFasting ? (
                  <Badge variant="outline" className="text-amber-600 border-amber-300">
                    <Clock className="h-3 w-3 mr-1" />
                    {t("labTests.order.fastingRequired")}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-green-600 border-green-300">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    {t("labTests.order.fastingNotRequired")}
                  </Badge>
                )}
              </div>

              <Separator />

              {/* Total price */}
              <div className="flex items-center justify-between">
                <span className="font-medium">{t("labTests.order.totalPrice")}</span>
                <span className="text-xl font-bold text-primary">
                  {formatPriceCZK(stats.totalPrice)}
                </span>
              </div>
            </div>
          </>
        )}
      </CardContent>

      {!isEmpty && (
        <CardFooter className="flex-col gap-2 pt-0">
          {onSubmitOrder && (
            <Button
              className="w-full"
              onClick={onSubmitOrder}
              disabled={isSubmitting}
            >
              <ShoppingCart className="h-4 w-4 mr-2" />
              {t("labTests.order.submitOrder")}
            </Button>
          )}

          <div className="flex gap-2 w-full">
            {onSaveForLater && (
              <Button
                variant="outline"
                className="flex-1"
                onClick={onSaveForLater}
                disabled={isSubmitting}
              >
                <Save className="h-4 w-4 mr-2" />
                {t("labTests.order.saveForLater")}
              </Button>
            )}
            {onClearAll && (
              <Button
                variant="ghost"
                className="flex-1 text-destructive hover:text-destructive"
                onClick={onClearAll}
                disabled={isSubmitting}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {t("labTests.order.removeAll")}
              </Button>
            )}
          </div>
        </CardFooter>
      )}
    </Card>
  );
});

LabTestOrderSummary.displayName = "LabTestOrderSummary";
