import { BASE_CURRENCY_FALLBACK } from "@/lib/currency/constants";
import { useQuery, useMutation } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";
import type { Json } from "@/integrations/db/types";
const profilePrefillSchema = z.object({
  address: z.object({
    street: z.string().optional(),
    city: z.string().optional(),
    postalCode: z.string().optional(),
    country: z.string().optional(),
  }).nullable().optional(),
  display_name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
});

export type ProfilePrefill = z.infer<typeof profilePrefillSchema>;

// Packeta pickup point interface
export interface PacketaPickupPoint {
  id: number;
  name: string;
  city: string;
  street: string;
  zip: string;
  country: string;
  openingHours?: string;
}

interface CreateOrderParams {
  total: number;
  shippingAddress: Json;
  billingAddress: Json;
  shippingMethod?: string;
  packetaBranchId?: number | null;
  carrierId?: number | null;
  carrierName?: string | null;
  currency?: string;
  items: Array<{
    product_id: string;
    quantity: number;
    price_at_purchase: number;
  }>;
  paymentMethod?: string;
  voucherCode?: string;
}

interface CreateCheckoutSessionParams {
  orderId: string;
  successUrl: string;
  cancelUrl: string;
}

// Shipping method type — all 6 supported methods
export type ShippingMethod = "carrier_home" | "carrier_pickup" | "packeta_home" | "packeta_pickup" | "packeta_zbox" | "personal_pickup";

// Shipping costs interface
export interface ShippingCosts {
  carrier_home: number;
  carrier_pickup: number;
  packeta_home: number;
  packeta_pickup: number;
  packeta_zbox: number;
  personal_pickup: number;
}

/**
 * Hook for fetching shipping costs for all methods
 */
export function useShippingCosts(country: string | null, currency: string = BASE_CURRENCY_FALLBACK) {
  return useQuery({
    queryKey: ["shipping-costs", country, currency],
    queryFn: async (): Promise<ShippingCosts> => {
      if (!country) {
        return { carrier_home: 0, carrier_pickup: 0, packeta_home: 0, packeta_pickup: 0, packeta_zbox: 0, personal_pickup: 0 };
      }

      const methods: ShippingMethod[] = ["carrier_home", "carrier_pickup", "packeta_home", "packeta_pickup", "packeta_zbox", "personal_pickup"];
      const results = await Promise.all(
        methods.map(async (method) => {
          const { data, error } = await aisha.rpc("get_shipping_cost", {
            p_country: country,
            p_currency: currency,
            p_shipping_method: method,
          });
          if (error) {
            safeError("checkout.shippingCost.fetchFailed", error);
            return { method, cost: 0 };
          }
          return { method, cost: Number(data ?? 0) };
        })
      );

      return results.reduce<ShippingCosts>((acc, item) => {
        acc[item.method] = Number.isFinite(item.cost) ? item.cost : 0;
        return acc;
      }, { carrier_home: 0, carrier_pickup: 0, packeta_home: 0, packeta_pickup: 0, packeta_zbox: 0, personal_pickup: 0 });
    },
    enabled: !!country,
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Hook for fetching profile contact prefill data for checkout
 */
export function useCheckoutProfilePrefill(userId?: string) {
  return useQuery({
    queryKey: ["checkout-profile-prefill", userId],
    queryFn: async (): Promise<ProfilePrefill | null> => {
      const { data, error } = await aisha.rpc("get_my_profile_contact_prefill_audited");

      if (error) {
        safeError("checkout.profilePrefill.fetchFailed", error);
        throw new Error(error.message);
      }

      const profile = Array.isArray(data) ? data[0] : data;
      if (!profile) return null;

      const parsed = profilePrefillSchema.safeParse(profile);
      return parsed.success ? parsed.data : (profile as ProfilePrefill);
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook for loading Packeta pickup points
 */
export function usePacketaPickupPoints(country: string, enabled = true) {
  return useQuery({
    queryKey: ["packeta-pickup-points", country],
    queryFn: async (): Promise<PacketaPickupPoint[]> => {
      const { data, error } = await aisha.functions.invoke("packeta-api", {
        body: { action: "pickup-points", country: country.toUpperCase() },
      });

      if (error) {
        safeError("checkout.packetaPickupPoints.fetchFailed", error);
        throw new Error(error.message);
      }

      const response = data as { points?: PacketaPickupPoint[]; pickupPoints?: PacketaPickupPoint[] } | null;
      return response?.points || response?.pickupPoints || [];
    },
    enabled: enabled && !!country,
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Hook for creating an order with items
 */
export function useCreateOrder() {
  return useMutation({
    mutationFn: async (params: CreateOrderParams): Promise<string> => {
      const { data: orderId, error } = await aisha.rpc("create_order_with_items_audited", {
        p_billing_address: params.billingAddress,
        p_carrier_id: params.carrierId ?? undefined,
        p_carrier_name: params.carrierName ?? undefined,
        p_currency: params.currency ?? undefined,
        p_items: params.items,
        p_packeta_branch_id: params.packetaBranchId ?? undefined,
        p_payment_method: params.paymentMethod ?? "bank_transfer",
        p_product_id: params.items[0]?.product_id ?? "",
        p_quantity: params.items[0]?.quantity ?? 1,
        p_shipping_address: params.shippingAddress,
        p_shipping_method: params.shippingMethod ?? undefined,
        p_total: params.total,
        p_voucher_code: params.voucherCode
      });

      if (error) throw new Error(error.message);

      const resolvedOrderId = typeof orderId === "string" ? orderId : null;
      if (!resolvedOrderId) {
        throw new Error("Order creation failed");
      }

      return resolvedOrderId;
    },
    onError: (error) => {
      safeError("checkout.createOrder.failed", error);
    },
  });
}

/**
 * Hook for creating Stripe checkout session
 */
export function useCreateCheckoutSession() {
  return useMutation({
    mutationFn: async (params: CreateCheckoutSessionParams): Promise<{ url: string }> => {
      const { data, error } = await aisha.functions.invoke("create-checkout-session", {
        body: {
          orderId: params.orderId,
          successUrl: params.successUrl,
          cancelUrl: params.cancelUrl,
        },
      });

      if (error) throw new Error(error.message);

      const response = data as { url?: string } | null;
      if (!response?.url) {
        throw new Error("No checkout URL returned");
      }

      return { url: response.url };
    },
    onError: (error) => {
      safeError("checkout.createSession.failed", error);
    },
  });
}
