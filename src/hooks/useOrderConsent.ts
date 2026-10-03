/**
 * Hook for building order confirmation data enriched with product identifiers.
 *
 * Composes cart items with GTIN / internal R&D codes from
 * {@link module:lib/constants/productIdentifiers} and provides a ready-to-render
 * order confirmation data structure matching Part A of the manufacturing protocol.
 *
 * @module hooks/useOrderConsent
 * @example
 * ```tsx
 * const { orderItems, orderInterpolation } = useOrderConsent(cartItems);
 * ```
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { safeError } from "@/lib/security/safeLogger";

import { type CartItem } from "@/hooks/useCart";
import { useCompanyData, type ConsentInterpolation } from "@/hooks/useCompanyData";
import {
  getProductIdentifier,
  type ProductIdentifier,
} from "@/lib/constants/productIdentifiers";
import {
  generateProtocolNumber,
  orderConfirmationSchema,
  type OrderConfirmation,
} from "@/lib/constants/manufacturingProtocol";

// =====================================================
// Locale Mapping
// =====================================================

/** Maps i18n language codes to BCP-47 date locale tags. */
const DATE_LOCALE_MAP: Record<string, string> = {
  cs: "cs-CZ",
  en: "en-GB",
  de: "de-DE",
  fr: "fr-FR",
  ru: "ru-RU",
  th: "th-TH",
};

// =====================================================
// Types
// =====================================================

/** A cart item enriched with GTIN / internal code identifiers. */
export interface EnrichedOrderItem {
  /** Cart item ID */
  readonly cartItemId: string;
  /** Product slug */
  readonly slug: string;
  /** Localized display name */
  readonly displayName: string;
  /** Internal R&D code (e.g. DEMO-01) — undefined if product not in registry */
  readonly internalCode: string | undefined;
  /** GTIN-14 — undefined if product not in registry */
  readonly gtin: string | undefined;
  /** Quantity ordered */
  readonly quantity: number;
  /** Unit price */
  readonly unitPrice: number;
  /** Line total (quantity × unit price) */
  readonly lineTotal: number;
  /** Matched product identifier, if found */
  readonly identifier: ProductIdentifier | undefined;
}

/** Interpolation values for order-confirmation i18n templates. */
export interface OrderInterpolation extends ConsentInterpolation {
  readonly protocolNumber: string;
  readonly date: string;
  readonly timestamp: string;
}

/** Return type of the `useOrderConsent` hook. */
export interface UseOrderConsentReturn {
  /** Cart items enriched with product identifiers. */
  readonly orderItems: readonly EnrichedOrderItem[];
  /** Pre-built interpolation object for order-confirmation `t()` calls. */
  readonly orderInterpolation: OrderInterpolation;
  /** Order subtotal before shipping. */
  readonly subtotal: number;
  /**
   * Builds a schema-validated `OrderConfirmation` (Part A) from current cart state.
   *
   * @param memberId - Authenticated user UUID.
   * @param shippingMethod - Selected shipping method slug.
   * @param consentsAcknowledged - Array of acknowledged consent keys.
   * @returns Validated `OrderConfirmation` or null if cart is empty.
   */
  readonly buildOrderConfirmation: (
    memberId: string,
    shippingMethod: string,
    consentsAcknowledged: string[],
  ) => OrderConfirmation | null;
}

// =====================================================
// Hook
// =====================================================

/**
 * Enriches cart items with product identifiers and builds order-confirmation data.
 *
 * @param items - Current cart items from `useCart`.
 * @param orderId - Optional order ID for protocol number generation.
 * @returns Enriched items, interpolation values, and order confirmation skeleton.
 */
export function useOrderConsent(
  items: readonly CartItem[],
  orderId?: string,
): UseOrderConsentReturn {
  const { i18n } = useTranslation();
  const { consentInterpolation } = useCompanyData();

  const orderItems = useMemo<readonly EnrichedOrderItem[]>(
    () =>
      items.map((item) => {
        const identifier = getProductIdentifier(item.product.slug);
        return {
          cartItemId: item.id,
          slug: item.product.slug,
          displayName: item.product.name,
          internalCode: identifier?.internalCode,
          gtin: identifier?.gtin,
          quantity: item.quantity,
          unitPrice: item.product.price,
          lineTotal: item.quantity * item.product.price,
          identifier,
        };
      }),
    [items],
  );

  const subtotal = useMemo(
    () => orderItems.reduce((sum, item) => sum + item.lineTotal, 0),
    [orderItems],
  );

  const now = useMemo(() => new Date(), []);

  const protocolNumber = useMemo(
    () => generateProtocolNumber(orderId ?? "DRAFT", now),
    [orderId, now],
  );

  const orderInterpolation = useMemo<OrderInterpolation>(
    () => ({
      ...consentInterpolation,
      protocolNumber,
      date: now.toLocaleDateString(DATE_LOCALE_MAP[i18n.language] ?? "cs-CZ"),
      timestamp: now.toISOString(),
    }),
    [consentInterpolation, protocolNumber, now, i18n.language],
  );

  const buildOrderConfirmation = useMemo(
    () =>
      (
        memberId: string,
        shippingMethod: string,
        consentsAcknowledged: string[],
      ): OrderConfirmation | null => {
        if (items.length === 0) return null;

        const raw = {
          protocolNumber,
          confirmationDate: now.toISOString(),
          memberId,
          items: orderItems.map((item) => ({
            slug: item.slug,
            productName: item.displayName,
            internalCode: item.internalCode ?? "",
            gtin: item.gtin ?? "",
            quantity: item.quantity,
            unitPriceCzk: item.unitPrice,
          })),
          totalCzk: subtotal,
          shippingMethod,
          consentsAcknowledged,
        };

        const result = orderConfirmationSchema.safeParse(raw);
        if (!result.success) {
          safeError("order.confirmation.parseFailed", { issues: result.error.issues.length });
          return null;
        }
        return result.data;
      },
    [items.length, protocolNumber, now, orderItems, subtotal],
  );

  return useMemo(
    () => ({
      orderItems,
      orderInterpolation,
      subtotal,
      buildOrderConfirmation,
    }),
    [orderItems, orderInterpolation, subtotal, buildOrderConfirmation],
  );
}
