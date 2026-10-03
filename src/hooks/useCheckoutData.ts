import { useCallback, useEffect, useState } from "react";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import type { KcUser as User } from "@/integrations/auth/types";

// Zásilkovna Pickup Point interface
export interface PacketaPickupPoint {
  id: number;
  name: string;
  city: string;
  street: string;
  zip: string;
  country: string;
  openingHours?: string;
}

export type ShippingMethod = "packeta_pickup" | "packeta_home" | "personal_pickup";

// Shipping cost by method (EUR)
export const SHIPPING_COSTS: Record<ShippingMethod, number> = {
  packeta_pickup: 3.9,
  packeta_home: 5.9,
  personal_pickup: 0,
};

export interface ProfileContactPrefill {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
}

/**
 * Fetch contact info for checkout prefill via audited RPC
 */
export async function fetchProfileContactPrefill(
  user: User | null
): Promise<ProfileContactPrefill | null> {
  if (!user) return null;

  try {
    const { data, error } = await aisha.rpc("get_my_profile_contact_prefill_audited");
    if (error) throw new Error(error.message);

    const profile = (Array.isArray(data) ? data[0] : data) as {
      address?: { street?: string; city?: string; postalCode?: string; country?: string } | null;
      display_name?: string;
      email?: string;
      phone?: string;
    } | null;

    if (!profile) {
      return {
        firstName: "",
        lastName: "",
        email: user.email || "",
        phone: "",
        address: "",
        city: "",
        postalCode: "",
        country: "CZ",
      };
    }

    const displayName = profile.display_name || "";
    const nameParts = displayName.split(" ");
    const address = profile.address;

    return {
      firstName: nameParts[0] || "",
      lastName: nameParts.slice(1).join(" ") || "",
      email: profile.email || user.email || "",
      phone: profile.phone || "",
      address: address?.street || "",
      city: address?.city || "",
      postalCode: address?.postalCode || "",
      country: address?.country || "CZ",
    };
  } catch (error) {
    safeError("checkout.prefillProfile", error);
    return {
      firstName: "",
      lastName: "",
      email: user.email || "",
      phone: "",
      address: "",
      city: "",
      postalCode: "",
      country: "CZ",
    };
  }
}

/**
 * Hook to prefill checkout form data
 */
export function useCheckoutPrefill(user: User | null) {
  const [formData, setFormData] = useState<ProfileContactPrefill>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    postalCode: "",
    country: "CZ",
  });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!user) return;

      setIsLoading(true);
      const prefill = await fetchProfileContactPrefill(user);
      if (!cancelled && prefill) {
        setFormData(prefill);
      }
      setIsLoading(false);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return { formData, setFormData, isLoading };
}

/**
 * Fetch Zásilkovna pickup points
 */
export function usePacketaPickupPoints(country: string, shippingMethod: ShippingMethod) {
  const [pickupPoints, setPickupPoints] = useState<PacketaPickupPoint[]>([]);
  const [loadingPickupPoints, setLoadingPickupPoints] = useState(false);

  const loadPickupPoints = useCallback(async (countryCode: string) => {
    if (shippingMethod !== "packeta_pickup") return;

    setLoadingPickupPoints(true);
    try {
      const { data, error } = await aisha.functions.invoke("packeta-api", {
        body: { action: "pickup-points", country: countryCode.toUpperCase() },
      });

      if (error) throw new Error(error.message);
      const response = data as { points?: PacketaPickupPoint[]; pickupPoints?: PacketaPickupPoint[] } | null;
      setPickupPoints(response?.points || response?.pickupPoints || []);
    } catch (error) {
      safeError("checkout.loadPickupPoints", error);
      setPickupPoints([]);
    } finally {
      setLoadingPickupPoints(false);
    }
  }, [shippingMethod]);

  useEffect(() => {
    if (country && shippingMethod === "packeta_pickup") {
      loadPickupPoints(country);
    }
  }, [country, shippingMethod, loadPickupPoints]);

  return { pickupPoints, loadingPickupPoints };
}

/**
 * Create order with items via audited RPC
 */
import type { Json } from "@/integrations/db/types";

export interface CreateOrderParams {
  billingAddress: Json;
  currency?: string;
  items: Array<{
    product_id: string;
    quantity: number;
    price_at_purchase: number;
  }>;
  packetaBranchId?: number | null;
  paymentMethod?: string;
  shippingAddress: Json;
  shippingMethod?: string;
  total: number;
  voucherCode?: string;
}

export async function createOrderWithItems(params: CreateOrderParams): Promise<string> {
  const {
    billingAddress,
    currency,
    items,
    packetaBranchId,
    shippingAddress,
    shippingMethod,
    total,
    voucherCode,
  } = params;

  const { data: orderId, error } = await aisha.rpc("create_order_with_items_audited", {
    p_billing_address: billingAddress,
    p_currency: currency ?? undefined,
    p_items: items,
    p_packeta_branch_id: packetaBranchId ?? undefined,
    p_payment_method: params.paymentMethod ?? "bank_transfer",
    p_product_id: items[0]?.product_id ?? "",
    p_quantity: items[0]?.quantity ?? 1,
    p_shipping_address: shippingAddress,
    p_shipping_method: shippingMethod ?? undefined,
    p_total: total,
    p_voucher_code: voucherCode,
  });

  if (error) {
    safeError("checkout.createOrder", error);
    throw new Error(error.message);
  }

  const resolvedOrderId = typeof orderId === "string" ? orderId : null;
  if (!resolvedOrderId) {
    throw new Error("Order creation failed");
  }

  return resolvedOrderId;
}

/**
 * Create Stripe checkout session
 */
export interface CreateCheckoutSessionParams {
  orderId: string;
  successUrl: string;
  cancelUrl: string;
}

export async function createStripeCheckoutSession(
  params: CreateCheckoutSessionParams
): Promise<string> {
  const { data, error } = await aisha.functions.invoke("create-checkout-session", {
    body: params,
  });

  if (error) {
    safeError("checkout.createSession", error);
    throw new Error(error.message);
  }

  const response = data as { url?: string } | null;
  if (!response?.url) {
    throw new Error("No checkout URL returned");
  }

  return response.url;
}
