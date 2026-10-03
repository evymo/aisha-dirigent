/**
 * Voucher input and display section for the checkout order summary.
 *
 * Renders either an applied voucher badge with remove button,
 * or a voucher code input with apply button.
 */

import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Tag, X } from "lucide-react";
import type { ProductVoucher } from "@/services/voucherService";

interface CheckoutVoucherSectionProps {
  /** Currently applied voucher, or null */
  appliedVoucher: ProductVoucher | null;
  /** Whether validation is in progress */
  isValidating: boolean;
  /** Apply voucher handler */
  onApplyVoucher: () => void;
  /** Remove voucher handler */
  onRemoveVoucher: () => void;
  /** Update voucher code handler */
  onVoucherCodeChange: (code: string) => void;
  /** Current voucher code input value */
  voucherCode: string;
}

/**
 * Voucher section for checkout order summary.
 *
 * Shows applied voucher badge or code input field.
 */
export function CheckoutVoucherSection({
  appliedVoucher,
  isValidating,
  onApplyVoucher,
  onRemoveVoucher,
  onVoucherCodeChange,
  voucherCode,
}: CheckoutVoucherSectionProps) {
  const { t } = useTranslation();

  if (appliedVoucher) {
    return (
      <div className="flex items-center justify-between p-3 bg-primary/10 rounded-lg border border-primary/20">
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-primary" />
          <div>
            <p className="text-sm font-medium">{appliedVoucher.code}</p>
            <p className="text-xs text-muted-foreground">{t("checkout.voucher.applied")}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemoveVoucher}
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Input
        placeholder={t("checkout.voucher.placeholder")}
        value={voucherCode}
        onChange={(e) => onVoucherCodeChange(e.target.value)}
        className="bg-background"
      />
      <Button
        variant="outline"
        onClick={onApplyVoucher}
        disabled={!voucherCode.trim() || isValidating}
      >
        {isValidating ? <Loader2 className="h-4 w-4 animate-spin" /> : t("checkout.voucher.apply")}
      </Button>
    </div>
  );
}
