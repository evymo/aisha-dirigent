import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { MapPin, Package, CheckCircle, Loader2 } from "lucide-react";
import type { PacketaPickupPoint } from "./checkoutTypes";
import type { ShippingMethod } from "@/hooks";

interface CheckoutShippingSectionProps {
  shippingMethod: ShippingMethod;
  onShippingMethodChange: (method: ShippingMethod) => void;
  shippingCosts: { packeta_pickup: number; packeta_home: number; personal_pickup: number };
  loadingShippingCosts: boolean;
  formatCurrency: (amount: number, currency: string) => string;
  preferredCurrency: string;
  formData: { address: string; city: string; postalCode: string; country: string };
  onFormChange: (field: string, value: string) => void;
  formErrors: Record<string, string>;
  pickupPoints: PacketaPickupPoint[];
  loadingPickupPoints: boolean;
  selectedPickupPoint: PacketaPickupPoint | null;
  onSelectPickupPoint: (point: PacketaPickupPoint) => void;
}

/**
 * Shipping method selection, pickup point, and delivery address sections.
 */
export function CheckoutShippingSection({
  shippingMethod,
  onShippingMethodChange,
  shippingCosts,
  loadingShippingCosts,
  formatCurrency,
  preferredCurrency,
  formData,
  onFormChange,
  formErrors,
  pickupPoints,
  loadingPickupPoints,
  selectedPickupPoint,
  onSelectPickupPoint,
}: CheckoutShippingSectionProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* Shipping Method Selection */}
      <div>
        <h2 className="font-medium text-lg mb-4">{t("checkout.shippingMethod")}</h2>
        <RadioGroup
          value={shippingMethod}
          onValueChange={(value) => onShippingMethodChange(value as ShippingMethod)}
          className="space-y-3"
        >
          <div className="flex items-center space-x-3 p-4 border rounded-lg cursor-pointer hover:bg-muted/50">
            <RadioGroupItem value="packeta_pickup" id="packeta_pickup" />
            <Label htmlFor="packeta_pickup" className="flex-1 cursor-pointer">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-primary" />
                  <span>{t("checkout.shipping.packetaPickup")}</span>
                </div>
                <span className="font-medium">
                  {loadingShippingCosts
                    ? t("common.loading")
                    : formatCurrency(shippingCosts.packeta_pickup ?? 0, preferredCurrency)}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {t("checkout.shipping.packetaPickupDesc")}
              </p>
            </Label>
          </div>

          <div className="flex items-center space-x-3 p-4 border rounded-lg cursor-pointer hover:bg-muted/50">
            <RadioGroupItem value="packeta_home" id="packeta_home" />
            <Label htmlFor="packeta_home" className="flex-1 cursor-pointer">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary" />
                  <span>{t("checkout.shipping.packetaHome")}</span>
                </div>
                <span className="font-medium">
                  {loadingShippingCosts
                    ? t("common.loading")
                    : formatCurrency(shippingCosts.packeta_home ?? 0, preferredCurrency)}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {t("checkout.shipping.packetaHomeDesc")}
              </p>
            </Label>
          </div>

          <div className="flex items-center space-x-3 p-4 border rounded-lg cursor-pointer hover:bg-muted/50">
            <RadioGroupItem value="personal_pickup" id="personal_pickup" />
            <Label htmlFor="personal_pickup" className="flex-1 cursor-pointer">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  <span>{t("checkout.shipping.personalPickup")}</span>
                </div>
                <span className="font-medium">{t("checkout.shipping.free")}</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {t("checkout.shipping.personalPickupDesc")}
              </p>
            </Label>
          </div>
        </RadioGroup>
      </div>

      {/* Packeta Pickup Point Selection */}
      {shippingMethod === "packeta_pickup" && (
        <div>
          <h2 className="font-medium text-lg mb-4">{t("checkout.selectPickupPoint")}</h2>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="country">{t("checkout.country")}</Label>
              <select
                id="country"
                name="country"
                value={formData.country}
                onChange={(e) => onFormChange("country", e.target.value)}
                className="w-full h-10 px-3 rounded-md border border-input bg-background"
              >
                <option value="CZ">{t("checkout.countries.CZ")}</option>
                <option value="SK">{t("checkout.countries.SK")}</option>
                <option value="DE">{t("checkout.countries.DE")}</option>
                <option value="AT">{t("checkout.countries.AT")}</option>
                <option value="PL">{t("checkout.countries.PL")}</option>
              </select>
            </div>

            {loadingPickupPoints ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : pickupPoints.length > 0 ? (
              <div className="max-h-64 overflow-y-auto border rounded-lg divide-y">
                {pickupPoints.map((point) => (
                  <div
                    key={point.id}
                    onClick={() => onSelectPickupPoint(point)}
                    className={`p-3 cursor-pointer hover:bg-muted/50 transition-colors ${
                      selectedPickupPoint?.id === point.id ? "bg-primary/10 border-l-4 border-l-primary" : ""
                    }`}
                  >
                    <div className="font-medium">{point.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {point.street}, {point.city} {point.zip}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                {t("checkout.noPickupPoints")}
              </div>
            )}

            {selectedPickupPoint && (
              <div className="p-4 bg-primary/10 rounded-lg border border-primary/20">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  <span className="font-medium">{t("checkout.selectedPickupPoint")}</span>
                </div>
                <div className="text-sm">
                  <strong>{selectedPickupPoint.name}</strong><br />
                  {selectedPickupPoint.street}, {selectedPickupPoint.city} {selectedPickupPoint.zip}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Home Delivery Address */}
      {shippingMethod === "packeta_home" && (
        <div>
          <h2 className="font-medium text-lg mb-4">{t("checkout.shippingAddress")}</h2>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="address">{t("checkout.address")}</Label>
              <Input
                id="address"
                name="address"
                value={formData.address}
                onChange={(e) => onFormChange("address", e.target.value)}
                className={formErrors.address ? "border-destructive" : ""}
              />
              {formErrors.address && (
                <p className="text-sm text-destructive">{t("checkout.validation.addressRequired")}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="city">{t("checkout.city")}</Label>
                <Input
                  id="city"
                  name="city"
                  value={formData.city}
                  onChange={(e) => onFormChange("city", e.target.value)}
                  className={formErrors.city ? "border-destructive" : ""}
                />
                {formErrors.city && (
                  <p className="text-sm text-destructive">{t("checkout.validation.cityRequired")}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="postalCode">{t("checkout.postalCode")}</Label>
                <Input
                  id="postalCode"
                  name="postalCode"
                  value={formData.postalCode}
                  onChange={(e) => onFormChange("postalCode", e.target.value)}
                  className={formErrors.postalCode ? "border-destructive" : ""}
                />
                {formErrors.postalCode && (
                  <p className="text-sm text-destructive">{t("checkout.validation.postalCodeInvalid")}</p>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="country">{t("checkout.country")}</Label>
              <select
                id="country"
                name="country"
                value={formData.country}
                onChange={(e) => onFormChange("country", e.target.value)}
                className="w-full h-10 px-3 rounded-md border border-input bg-background"
              >
                <option value="CZ">{t("checkout.countries.CZ")}</option>
                <option value="SK">{t("checkout.countries.SK")}</option>
                <option value="DE">{t("checkout.countries.DE")}</option>
                <option value="AT">{t("checkout.countries.AT")}</option>
                <option value="PL">{t("checkout.countries.PL")}</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
