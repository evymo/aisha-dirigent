/**
 * Complete shipping method selection for checkout.
 *
 * Shows all available shipping categories (pickup, Z-BOX, home delivery,
 * personal pickup) with dynamic pricing from the Packeta edge function.
 * The billing address (country + postal code) is set in the contact section
 * above, so available methods are already loaded when this section renders.
 *
 * For home delivery, displays the billing address with an option to
 * deliver to a different address via a toggle.
 *
 * @module pages/checkout/CheckoutShippingSection
 */

import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Loader2, MapPin, Box, Truck, Store } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import type { AvailableMethodsResponse, ShippingCarrier, ShippingPoint } from "@/lib/schemas/shippingCheckoutSchemas";
import type { ShippingMethod } from "@/lib/schemas/shippingCheckoutSchemas";
import {
  ShippingCategoryCard,
  PickupPointSelector,
  ZBoxSelector,
  CarrierSelector,
  HomeDeliveryForm,
  FreeShippingProgress,
} from "./shipping";

interface CheckoutShippingSectionProps {
  /** Available methods data from edge function */
  availableMethods: AvailableMethodsResponse | undefined;
  /** Billing address from the contact section above */
  billingAddress: { address: string; city: string; country: string; postalCode: string };
  /** Selected carrier for home delivery */
  carrier: ShippingCarrier | null;
  /** Separate delivery address (used when useDifferentDeliveryAddress is true) */
  deliveryAddress: { address: string; city: string; country: string; postalCode: string };
  /** Form errors */
  formErrors: Record<string, string>;
  /** Currency format function */
  formatCurrency: (amount: number, currency: string) => string;
  /** Whether available methods are loading */
  loadingMethods: boolean;
  /** Handler for carrier change */
  onCarrierChange: (carrier: ShippingCarrier) => void;
  /** Handler for delivery address field change */
  onDeliveryAddressChange: (field: string, value: string) => void;
  /** Handler for pickup point selection */
  onPickupPointChange: (point: ShippingPoint) => void;
  /** Handler for shipping method change */
  onShippingMethodChange: (method: ShippingMethod) => void;
  /** Handler for toggling different delivery address */
  onUseDifferentDeliveryAddressChange: (value: boolean) => void;
  /** Order subtotal (for free shipping progress) */
  orderSubtotal: number;
  /** ISO 4217 currency code */
  preferredCurrency: string;
  /** Selected pickup point or Z-BOX */
  selectedPoint: ShippingPoint | null;
  /** Currently selected shipping method */
  shippingMethod: ShippingMethod;
  /** Whether user wants to deliver to a different address */
  useDifferentDeliveryAddress: boolean;
}

/**
 * Complete shipping section for checkout page.
 */
export function CheckoutShippingSection({
  availableMethods,
  billingAddress,
  carrier,
  deliveryAddress,
  formErrors,
  formatCurrency,
  loadingMethods,
  onCarrierChange,
  onDeliveryAddressChange,
  onPickupPointChange,
  onShippingMethodChange,
  onUseDifferentDeliveryAddressChange,
  orderSubtotal,
  preferredCurrency,
  selectedPoint,
  shippingMethod,
  useDifferentDeliveryAddress,
}: CheckoutShippingSectionProps) {
  const { t } = useTranslation();

  const costs = useMemo(() => availableMethods?.costs ?? {}, [availableMethods?.costs]);

  // Resolve the cheapest pickup cost (packeta_pickup or carrier_pickup)
  const pickupCost = useMemo(() => {
    const pp = costs.packeta_pickup ?? 0;
    const cp = costs.carrier_pickup ?? 0;
    return Math.min(pp > 0 ? pp : Infinity, cp > 0 ? cp : Infinity);
  }, [costs.packeta_pickup, costs.carrier_pickup]);

  const zboxCost = costs.packeta_zbox ?? 0;

  const homeCost = useMemo(() => {
    const ph = costs.packeta_home ?? 0;
    const ch = costs.carrier_home ?? 0;
    return Math.min(ph > 0 ? ph : Infinity, ch > 0 ? ch : Infinity);
  }, [costs.packeta_home, costs.carrier_home]);

  const isFreeShipping = useMemo(() => {
    const threshold = availableMethods?.freeShippingThreshold;
    if (threshold == null) return false;
    return orderSubtotal >= threshold;
  }, [availableMethods?.freeShippingThreshold, orderSubtotal]);

  const isPickupCategory = shippingMethod === "packeta_pickup" || shippingMethod === "carrier_pickup";
  const isHomeCategory = shippingMethod === "packeta_home" || shippingMethod === "carrier_home";

  const handlePickupSelect = useCallback(
    (point: ShippingPoint) => {
      onPickupPointChange(point);
      // Determine if this is a Packeta branch or carrier PUDO
      onShippingMethodChange("packeta_pickup");
    },
    [onPickupPointChange, onShippingMethodChange],
  );

  const handleZBoxSelect = useCallback(
    (point: ShippingPoint) => {
      onPickupPointChange(point);
      onShippingMethodChange("packeta_zbox");
    },
    [onPickupPointChange, onShippingMethodChange],
  );

  // Format the billing address as a readable string
  const billingAddressSummary = useMemo(() => {
    const parts = [
      billingAddress.address,
      billingAddress.city,
      billingAddress.postalCode,
    ].filter(Boolean);
    if (parts.length === 0) return null;
    const countryLabel = t(`checkout.countries.${billingAddress.country}`, billingAddress.country);
    return `${parts.join(", ")} — ${countryLabel}`;
  }, [billingAddress, t]);

  return (
    <>
      {/* Free shipping progress */}
      <FreeShippingProgress
        formatCurrency={formatCurrency}
        freeShippingThreshold={availableMethods?.freeShippingThreshold ?? null}
        orderSubtotal={orderSubtotal}
        preferredCurrency={preferredCurrency}
      />

      {/* Shipping Method Selection */}
      <div>
        <h2 className="font-medium text-lg mb-4">{t("checkout.shippingMethod")}</h2>

        {loadingMethods ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-3">
            {/* Pickup Points */}
            {(availableMethods?.pickupPoints?.length ?? 0) > 0 && (
              <ShippingCategoryCard
                cost={Number.isFinite(pickupCost) ? pickupCost : 0}
                description={t("checkout.shipping.pickupDesc")}
                formatCurrency={formatCurrency}
                icon={<MapPin className="h-5 w-5" />}
                isFree={isFreeShipping}
                isSelected={isPickupCategory}
                onClick={() => onShippingMethodChange("packeta_pickup")}
                preferredCurrency={preferredCurrency}
                title={t("checkout.shipping.pickup")}
              >
                <PickupPointSelector
                  onSelect={handlePickupSelect}
                  points={availableMethods?.pickupPoints ?? []}
                  selectedPoint={isPickupCategory ? selectedPoint : null}
                  totalCount={availableMethods?.totalBranchCount}
                />
              </ShippingCategoryCard>
            )}

            {/* Z-BOXes */}
            {(availableMethods?.zboxes?.length ?? 0) > 0 && (
              <ShippingCategoryCard
                cost={zboxCost}
                description={t("checkout.shipping.zboxDesc")}
                formatCurrency={formatCurrency}
                icon={<Box className="h-5 w-5" />}
                isFree={isFreeShipping}
                isSelected={shippingMethod === "packeta_zbox"}
                onClick={() => onShippingMethodChange("packeta_zbox")}
                preferredCurrency={preferredCurrency}
                title={t("checkout.shipping.zbox")}
              >
                <ZBoxSelector
                  onSelect={handleZBoxSelect}
                  points={availableMethods?.zboxes ?? []}
                  selectedPoint={shippingMethod === "packeta_zbox" ? selectedPoint : null}
                  totalCount={availableMethods?.totalZboxCount}
                />
              </ShippingCategoryCard>
            )}

            {/* Home Delivery */}
            <ShippingCategoryCard
              cost={Number.isFinite(homeCost) ? homeCost : 0}
              description={t("checkout.shipping.homeDeliveryDesc")}
              formatCurrency={formatCurrency}
              icon={<Truck className="h-5 w-5" />}
              isFree={isFreeShipping}
              isSelected={isHomeCategory}
              onClick={() => onShippingMethodChange("packeta_home")}
              preferredCurrency={preferredCurrency}
              title={t("checkout.shipping.homeDelivery")}
            >
              <div className="space-y-4">
                {/* Carrier selection (if multiple available) */}
                {(availableMethods?.carriers?.length ?? 0) > 1 && (
                  <CarrierSelector
                    carriers={availableMethods?.carriers ?? []}
                    onSelect={onCarrierChange}
                    selectedCarrier={carrier}
                  />
                )}

                {/* Billing address summary */}
                {billingAddressSummary && !useDifferentDeliveryAddress && (
                  <div className="p-3 bg-muted/50 rounded-lg border">
                    <p className="text-sm text-muted-foreground">{t("checkout.shipping.deliveringTo")}</p>
                    <p className="text-sm font-medium">{billingAddressSummary}</p>
                  </div>
                )}

                {/* Toggle for different delivery address */}
                <div className="flex items-center space-x-2">
                  <Checkbox
                    checked={useDifferentDeliveryAddress}
                    id="different-delivery-address"
                    onCheckedChange={(checked) => onUseDifferentDeliveryAddressChange(checked === true)}
                  />
                  <Label className="text-sm font-normal cursor-pointer" htmlFor="different-delivery-address">
                    {t("checkout.shipping.deliverToDifferentAddress")}
                  </Label>
                </div>

                {/* Override delivery address form */}
                {useDifferentDeliveryAddress && (
                  <HomeDeliveryForm
                    country={deliveryAddress.country}
                    formErrors={formErrors}
                    onFormChange={onDeliveryAddressChange}
                    values={{
                      address: deliveryAddress.address,
                      city: deliveryAddress.city,
                      postalCode: deliveryAddress.postalCode,
                    }}
                  />
                )}
              </div>
            </ShippingCategoryCard>

            {/* Personal Pickup */}
            {availableMethods?.personalPickupAvailable && (
              <ShippingCategoryCard
                cost={0}
                description={t("checkout.shipping.personalPickupDesc")}
                formatCurrency={formatCurrency}
                icon={<Store className="h-5 w-5" />}
                isFree={true}
                isSelected={shippingMethod === "personal_pickup"}
                onClick={() => onShippingMethodChange("personal_pickup")}
                preferredCurrency={preferredCurrency}
                title={t("checkout.shipping.personalPickup")}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}
