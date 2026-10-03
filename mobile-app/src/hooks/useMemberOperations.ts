/**
 * Member operations hooks — appointments, orders, cart, vouchers, wearables.
 *
 * Mobile surfaces operational backend capability through RPCs only. RLS and
 * SECURITY DEFINER functions decide visibility; the app renders returned rows.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/config/api";
import {
  appointmentSchema,
  cartItemSchema,
  orderSchema,
  voucherSchema,
  wearableConnectionSchema,
} from "@/types/schemas";
import { safeError } from "@/lib/security/safeLogger";
import type { Appointment, CartItem, Order, Voucher, WearableConnection } from "@/types/schemas";

function parseArray<T>(
  data: unknown,
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
): T[] {
  if (!Array.isArray(data)) return [];
  return data.reduce<T[]>((acc, item) => {
    const result = schema.safeParse(item);
    if (result.success && result.data !== undefined) acc.push(result.data);
    return acc;
  }, []);
}

export function useMyAppointments(userId: string | undefined) {
  return useQuery<Appointment[]>({
    queryKey: ["my-appointments", userId],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_my_appointments");
      if (error) {
        safeError("useMyAppointments.fetch", error);
        throw error;
      }
      return parseArray<Appointment>(data, appointmentSchema);
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useMyOrders(userId: string | undefined) {
  return useQuery<Order[]>({
    queryKey: ["my-orders", userId],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_my_orders_audited");
      if (error) {
        safeError("useMyOrders.fetch", error);
        throw error;
      }
      return parseArray<Order>(data, orderSchema);
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useMyCart(userId: string | undefined) {
  return useQuery<CartItem[]>({
    queryKey: ["my-cart", userId],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_my_cart");
      if (error) {
        safeError("useMyCart.fetch", error);
        throw error;
      }
      return parseArray<CartItem>(data, cartItemSchema);
    },
    enabled: !!userId,
    staleTime: 30 * 1000,
  });
}

export function useMyVouchers(userId: string | undefined, limit = 10) {
  return useQuery<Voucher[]>({
    queryKey: ["my-vouchers", userId, limit],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_my_vouchers", { p_limit: limit });
      if (error) {
        safeError("useMyVouchers.fetch", error);
        throw error;
      }
      return parseArray<Voucher>(data, voucherSchema);
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useMyWearableConnections(userId: string | undefined) {
  return useQuery<WearableConnection[]>({
    queryKey: ["my-wearable-connections", userId],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_my_wearable_connections");
      if (error) {
        safeError("useMyWearableConnections.fetch", error);
        throw error;
      }
      return parseArray<WearableConnection>(data, wearableConnectionSchema);
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}
