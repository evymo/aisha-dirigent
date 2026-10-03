import { useTranslation } from "react-i18next";
import { Separator } from "@/components/ui/separator";
import { MapPin, Package, CheckCircle, CreditCard, Building2, Box, Truck, Store } from "lucide-react";
import type { ProductVoucher } from "@/services/voucherService";
import type { PacketaPickupPoint, PaymentMethodOption } from "./checkoutTypes";
import type { ShippingMethod } from "@/lib/schemas/shippingCheckoutSchemas";
import { CheckoutVoucherSection } from "./CheckoutVoucherSection";

interface CheckoutOrderSummaryProps {
  items: Array<{
    id: string;
    product_id: string;
    quantity: number;
    product?: { price: number; image_url?: string | null; slug?: string | null; name?: string | null };
  }>;
  getProductName: (product?: { slug?: string | null; name?: string | null }) => string;
  formatPrice: (amount: number) => string;
  formatCurrency: (amount: number, currency: string) => string;
  preferredCurrency: string;
  subtotalConverted: number;
  shippingCost: number;
  totalWithShipping: number;
  voucherDiscount: number;
  appliedVoucher: ProductVoucher | null;
  voucherCode: string;
  onVoucherCodeChange: (code: string) => void;
  onApplyVoucher: () => void;
  onRemoveVoucher: () => void;
  validateVoucherPending: boolean;
  shippingMethod: ShippingMethod;
  selectedPickupPoint: PacketaPickupPoint | null;
  paymentMethod: PaymentMethodOption;
}

/**
 * Order summary panel for the checkout page right column.
 */
export function CheckoutOrderSummary({
  items,
  getProductName,
  formatPrice,
  formatCurrency,
  preferredCurrency,
  subtotalConverted,
  shippingCost,
  totalWithShipping,
  voucherDiscount,
  appliedVoucher,
  voucherCode,
  onVoucherCodeChange,
  onApplyVoucher,
  onRemoveVoucher,
  validateVoucherPending,
  shippingMethod,
  selectedPickupPoint,
  paymentMethod,
}: CheckoutOrderSummaryProps) {
  const { t } = useTranslation();

  return (
    <div className="bg-card border border-border rounded-lg p-6 sticky top-32">
      <h2 className="font-serif text-xl font-bold mb-6">{t("checkout.orderSummary")}</h2>

      <div className="space-y-4 mb-6">
        {items.map((item) => (
          <div key={item.id} className="flex gap-4">
            <div className="w-16 h-16 bg-muted rounded-md overflow-hidden flex-shrink-0">
              <img
                src={item.product?.image_url || "/placeholder.svg"}
                alt={getProductName(item.product)}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-medium text-sm truncate">
                {getProductName(item.product)}
              </h4>
              <p className="text-xs text-muted-foreground">
                {t("cart.qty")}: {item.quantity}
              </p>
            </div>
            <div className="text-sm font-medium">
              {formatPrice((item.product?.price || 0) * item.quantity)}
            </div>
          </div>
        ))}
      </div>

      <Separator className="my-4" />

      {/* Voucher Input Section */}
      <div className="mb-4">
        <CheckoutVoucherSection
          appliedVoucher={appliedVoucher}
          isValidating={validateVoucherPending}
          onApplyVoucher={onApplyVoucher}
          onRemoveVoucher={onRemoveVoucher}
          onVoucherCodeChange={onVoucherCodeChange}
          voucherCode={voucherCode}
        />
      </div>

      <Separator className="my-4" />

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t("checkout.subtotal")}</span>
          <span>{formatCurrency(subtotalConverted, preferredCurrency)}</span>
        </div>

        {/* Voucher Discount */}
        {appliedVoucher && voucherDiscount > 0 && (
          <div className="flex justify-between text-primary font-medium">
            <span>{t("checkout.voucher.discount")}</span>
            <span>-{formatCurrency(voucherDiscount, preferredCurrency)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t("checkout.shipping.title")}</span>
          <span>
            {shippingCost === 0
              ? t("checkout.shipping.free")
              : formatCurrency(shippingCost, preferredCurrency)}
          </span>
        </div>
      </div>

      <Separator className="my-4" />

      <div className="flex justify-between items-center">
        <span className="text-lg font-medium">{t("cart.total")}</span>
        <span className="text-2xl font-bold">{formatCurrency(totalWithShipping, preferredCurrency)}</span>
      </div>

      {/* Shipping method badge */}
      <div className="mt-4 p-3 bg-muted/50 rounded-lg">
        <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
          {t("checkout.deliveryMethod")}
        </div>
        <div className="flex items-center gap-2">
          {(shippingMethod === "packeta_pickup" || shippingMethod === "carrier_pickup") && <MapPin className="h-4 w-4 text-primary" />}
          {shippingMethod === "packeta_zbox" && <Box className="h-4 w-4 text-primary" />}
          {(shippingMethod === "packeta_home" || shippingMethod === "carrier_home") && <Truck className="h-4 w-4 text-primary" />}
          {shippingMethod === "personal_pickup" && <Store className="h-4 w-4 text-primary" />}
          <span className="text-sm font-medium">
            {shippingMethod === "packeta_pickup" && t("checkout.shipping.packetaPickup")}
            {shippingMethod === "carrier_pickup" && t("checkout.shipping.carrierPickup")}
            {shippingMethod === "packeta_zbox" && t("checkout.shipping.zbox")}
            {shippingMethod === "packeta_home" && t("checkout.shipping.packetaHome")}
            {shippingMethod === "carrier_home" && t("checkout.shipping.carrierHome")}
            {shippingMethod === "personal_pickup" && t("checkout.shipping.personalPickup")}
          </span>
        </div>
        {selectedPickupPoint && (shippingMethod === "packeta_pickup" || shippingMethod === "carrier_pickup" || shippingMethod === "packeta_zbox") && (
          <div className="text-xs text-muted-foreground mt-1">
            {selectedPickupPoint.name}
          </div>
        )}
      </div>

      {/* Payment method badge */}
      <div className="mt-3 p-3 bg-muted/50 rounded-lg">
        <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
          {t("checkout.payment.title")}
        </div>
        <div className="flex items-center gap-2">
          {paymentMethod === "card"
            ? <CreditCard className="h-4 w-4 text-primary" />
            : <Building2 className="h-4 w-4 text-primary" />}
          <span className="text-sm font-medium">
            {paymentMethod === "card"
              ? t("checkout.payment.card")
              : t("checkout.payment.bankTransfer")}
          </span>
        </div>
      </div>
    </div>
  );
}
