/**
 * Home delivery address form fields.
 *
 * Used when the user selects packeta_home or carrier_home shipping.
 *
 * @module pages/checkout/shipping/HomeDeliveryForm
 */

import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

interface HomeDeliveryFormProps {
  /** Country code for the select */
  country: string;
  /** Form errors keyed by field name */
  formErrors: Record<string, string>;
  /** Form field change handler */
  onFormChange: (field: string, value: string) => void;
  /** Form field values */
  values: {
    address: string;
    city: string;
    postalCode: string;
  };
}

const SUPPORTED_COUNTRIES = ["CZ", "SK", "DE", "AT", "PL"] as const;

/**
 * Address form fields for home delivery methods.
 */
export function HomeDeliveryForm({
  country,
  formErrors,
  onFormChange,
  values,
}: HomeDeliveryFormProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="shipping-address">{t("checkout.address")}</Label>
        <Input
          id="shipping-address"
          name="address"
          onChange={(e) => onFormChange("address", e.target.value)}
          value={values.address}
          className={formErrors.address ? "border-destructive" : ""}
        />
        {formErrors.address && (
          <p className="text-sm text-destructive">{t("checkout.validation.addressRequired")}</p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="shipping-city">{t("checkout.city")}</Label>
          <Input
            id="shipping-city"
            name="city"
            onChange={(e) => onFormChange("city", e.target.value)}
            value={values.city}
            className={formErrors.city ? "border-destructive" : ""}
          />
          {formErrors.city && (
            <p className="text-sm text-destructive">{t("checkout.validation.cityRequired")}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="shipping-postalCode">{t("checkout.postalCode")}</Label>
          <Input
            id="shipping-postalCode"
            name="postalCode"
            onChange={(e) => onFormChange("postalCode", e.target.value)}
            value={values.postalCode}
            className={formErrors.postalCode ? "border-destructive" : ""}
          />
          {formErrors.postalCode && (
            <p className="text-sm text-destructive">{t("checkout.validation.postalCodeInvalid")}</p>
          )}
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="shipping-country">{t("checkout.country")}</Label>
        <select
          id="shipping-country"
          name="country"
          onChange={(e) => onFormChange("country", e.target.value)}
          value={country}
          className="w-full h-10 px-3 rounded-md border border-input bg-background"
        >
          {SUPPORTED_COUNTRIES.map((cc) => (
            <option key={cc} value={cc}>
              {t(`checkout.countries.${cc}`)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
