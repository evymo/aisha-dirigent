/**
 * Hook for managing voucher application during checkout.
 *
 * Encapsulates voucher code state, validation, application and discount calculation.
 *
 * @example
 * ```ts
 * const { voucherCode, setVoucherCode, appliedVoucher, voucherDiscount, handleApplyVoucher, handleRemoveVoucher, isValidating } = useCheckoutVoucher({ items, convertFromBase, preferredCurrency });
 * ```
 */

import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useValidateVoucher } from "@/hooks/useVoucher";
import { toast } from "sonner";
import type { ProductVoucher } from "@/services/voucherService";

interface CartItem {
  product_id: string;
  product?: { price: number } | null;
}

interface UseCheckoutVoucherParams {
  /** Cart items to validate voucher against */
  convertFromBase: (amount: number, currency: string) => number;
  /** Cart items array */
  items: CartItem[];
  /** User's preferred currency code */
  preferredCurrency: string;
}

interface UseCheckoutVoucherResult {
  /** Currently applied voucher, or null */
  appliedVoucher: ProductVoucher | null;
  /** Apply the current voucher code */
  handleApplyVoucher: () => Promise<void>;
  /** Remove the applied voucher */
  handleRemoveVoucher: () => void;
  /** Whether voucher validation is in progress */
  isValidating: boolean;
  /** Set the voucher code input value */
  setVoucherCode: (code: string) => void;
  /** Current voucher code input value */
  voucherCode: string;
  /** Calculated discount amount in preferred currency */
  voucherDiscount: number;
}

/**
 * Manages voucher logic for the checkout flow.
 *
 * Handles voucher code input, validation against cart items,
 * applying/removing vouchers, and calculating the discount amount.
 */
export function useCheckoutVoucher({
  convertFromBase,
  items,
  preferredCurrency,
}: UseCheckoutVoucherParams): UseCheckoutVoucherResult {
  const { t } = useTranslation();

  const validateVoucher = useValidateVoucher();

  const [voucherCode, setVoucherCode] = useState("");
  const [appliedVoucher, setAppliedVoucher] = useState<ProductVoucher | null>(null);

  const voucherDiscount = useMemo(() => {
    if (!appliedVoucher || !appliedVoucher.product_id) return 0;
    const cartItem = items.find(item => item.product_id === appliedVoucher.product_id);
    if (!cartItem || !cartItem.product) return 0;
    const productPrice = cartItem.product.price;
    return convertFromBase(productPrice, preferredCurrency);
  }, [appliedVoucher, items, preferredCurrency, convertFromBase]);

  const handleApplyVoucher = useCallback(async () => {
    if (!voucherCode.trim()) return;

    try {
      const voucher = await validateVoucher.mutateAsync(voucherCode);
      const isProductInCart = items.some(item => item.product_id === voucher.product_id);

      if (!isProductInCart) {
        toast.error(t("checkout.voucher.invalidProduct"), {
          description: t("checkout.voucher.invalidProductDesc"),
        });
        return;
      }

      setAppliedVoucher(voucher);
      toast.success(t("checkout.voucher.applied"), {
        description: t("checkout.voucher.appliedDesc"),
      });
    } catch {
      toast.error(t("checkout.voucher.invalid"), {
        description: t("checkout.voucher.invalidDesc"),
      });
    }
  }, [voucherCode, validateVoucher, items, t]);

  const handleRemoveVoucher = useCallback(() => {
    setAppliedVoucher(null);
    setVoucherCode("");
  }, []);

  return {
    appliedVoucher,
    handleApplyVoucher,
    handleRemoveVoucher,
    isValidating: validateVoucher.isPending,
    setVoucherCode,
    voucherCode,
    voucherDiscount,
  };
}
