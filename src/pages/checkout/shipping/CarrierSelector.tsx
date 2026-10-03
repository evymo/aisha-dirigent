/**
 * Carrier selector — list of home delivery carriers.
 *
 * Shows available HD carriers with max weight, requirements,
 * and allows user to select one.
 *
 * @module pages/checkout/shipping/CarrierSelector
 */

import { useTranslation } from "react-i18next";
import { Truck, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ShippingCarrier } from "@/lib/schemas/shippingCheckoutSchemas";

interface CarrierSelectorProps {
  /** Available carriers */
  carriers: ShippingCarrier[];
  /** Callback when a carrier is selected */
  onSelect: (carrier: ShippingCarrier) => void;
  /** Currently selected carrier */
  selectedCarrier: ShippingCarrier | null;
}

/**
 * List of home delivery carriers for user selection.
 */
export function CarrierSelector({
  carriers,
  onSelect,
  selectedCarrier,
}: CarrierSelectorProps) {
  const { t } = useTranslation();

  if (carriers.length === 0) {
    return (
      <div className="flex items-center gap-2 p-4 text-muted-foreground text-sm">
        <AlertCircle className="h-4 w-4 flex-shrink-0" />
        <span>{t("checkout.shipping.noCarriersAvailable")}</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground mb-2">
        {t("checkout.shipping.selectCarrier")}
      </p>
      <div className="border rounded-lg divide-y">
        {carriers.map((carrier) => (
          <button
            type="button"
            key={carrier.id}
            onClick={() => onSelect(carrier)}
            className={cn(
              "w-full text-left p-3 hover:bg-muted/50 transition-colors",
              selectedCarrier?.id === carrier.id && "bg-primary/5 border-l-4 border-l-primary",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <Truck className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div>
                  <span className="font-medium text-sm">{carrier.displayName}</span>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {t("checkout.shipping.maxWeight", { kg: carrier.maxWeight })}
                  </div>
                </div>
              </div>
              {carrier.disallowsCod && (
                <span className="text-xs text-muted-foreground">
                  {t("checkout.shipping.noCod")}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
