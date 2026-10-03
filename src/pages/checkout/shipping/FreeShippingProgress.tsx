/**
 * Free shipping progress bar component.
 *
 * Shows how close the user is to the free shipping threshold.
 *
 * @module pages/checkout/shipping/FreeShippingProgress
 */

import { useTranslation } from "react-i18next";
import { Progress } from "@/components/ui/progress";
import { Truck } from "lucide-react";
import { freeShippingRemaining, isFreeShipping } from "@/lib/schemas/shippingCheckoutSchemas";

interface FreeShippingProgressProps {
  /** Free shipping threshold (null = no free shipping available) */
  freeShippingThreshold: number | null;
  /** Current format function */
  formatCurrency: (amount: number, currency: string) => string;
  /** Current order subtotal */
  orderSubtotal: number;
  /** ISO 4217 currency code */
  preferredCurrency: string;
}

/**
 * Progress bar showing how close user is to free shipping.
 */
export function FreeShippingProgress({
  freeShippingThreshold,
  formatCurrency,
  orderSubtotal,
  preferredCurrency,
}: FreeShippingProgressProps) {
  const { t } = useTranslation();

  if (freeShippingThreshold == null || freeShippingThreshold <= 0) return null;

  const isFree = isFreeShipping(orderSubtotal, freeShippingThreshold);
  const remaining = freeShippingRemaining(orderSubtotal, freeShippingThreshold);
  const progressPct = Math.min(100, (orderSubtotal / freeShippingThreshold) * 100);

  if (isFree) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
        <Truck className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0" />
        <span className="text-sm font-medium text-green-700 dark:text-green-300">
          {t("checkout.shipping.freeShippingEarned")}
        </span>
      </div>
    );
  }

  return (
    <div className="p-3 rounded-lg bg-muted/50 border">
      <div className="flex items-center gap-2 mb-2">
        <Truck className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <span className="text-sm text-muted-foreground">
          {t("checkout.shipping.freeShippingRemaining", {
            amount: formatCurrency(remaining, preferredCurrency),
          })}
        </span>
      </div>
      <Progress value={progressPct} className="h-2" />
    </div>
  );
}
