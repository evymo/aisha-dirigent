import { useCallback, useEffect, useState } from "react";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { shipmentOrderRpcArraySchema } from "@/lib/schemas/shipmentSchemas";
import { usePermissions } from "./usePermissions";
import { useSession } from "./useSession";

export interface ShipmentOrder {
  id: string;
  user_id: string;
  status: string;
  total: number;
  created_at: string;
  shipped_at: string | null;
  delivered_at: string | null;
  shipping_method: string | null;
  packeta_packet_id: string | null;
  packeta_barcode: string | null;
  packeta_branch_id: number | null;
  tracking_url: string | null;
  shipping_address: {
    firstName?: string;
    lastName?: string;
    address?: string;
    city?: string;
    postalCode?: string;
    country?: string;
    pickupPointId?: number;
    pickupPointName?: string;
  } | null;
  profile: {
    display_name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  order_items: {
    id: string;
    quantity: number;
    product: { name: string; weight?: number } | null;
  }[];
}

export type ShipmentStatus = "all" | "ready_to_ship" | "shipped" | "in_transit" | "delivered" | "returned";

/** Response shape returned by the `packeta-api` "create-packet" action. */
export interface PacketaCreateResponse {
  barcode: string;
  packetId: string;
  trackingUrl: string;
}

/** Response shape returned by the `packeta-api` "track" action. */
export interface PacketaTrackingResponse {
  status: string;
}

/**
 * Hook to fetch shipment orders from admin RPC
 */
export function useShipmentsAdmin() {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  const [orders, setOrders] = useState<ShipmentOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchOrders = useCallback(async () => {
    if (!isAdmin || !user) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);

      const { data: ordersData, error } = await aisha.rpc("get_shipments_admin_audited", {
        p_limit: 200
,
        p_status: undefined
    });

      if (error) throw new Error(error.message);

      // Validate with Zod
      const parsed = shipmentOrderRpcArraySchema.safeParse(ordersData);
      if (!parsed.success) {
        safeError("admin.shipments.validation", parsed.error);
        setOrders([]);
        return;
      }

      // Transform validated data to expected format
      const transformed: ShipmentOrder[] = parsed.data.map((order) => ({
        id: order.id,
        user_id: order.user_id,
        status: order.status,
        total: order.total,
        created_at: order.created_at,
        shipped_at: order.shipped_at,
        delivered_at: order.delivered_at,
        shipping_method: order.shipping_method,
        packeta_packet_id: order.packeta_packet_id,
        packeta_barcode: order.packeta_barcode,
        packeta_branch_id: order.packeta_branch_id,
        tracking_url: order.tracking_url,
        shipping_address: order.shipping_address,
        profile: order.profile ?? null,
        order_items: order.order_items,
      }));

      // Filter by shipment status (paid, processing, shipped, in_transit, delivered)
      const shipmentOrders = transformed.filter((o) =>
        ["paid", "processing", "shipped", "in_transit", "delivered"].includes(o.status)
      );

      setOrders(shipmentOrders);
    } catch (error) {
      safeError("admin.shipments.fetchFailed", error);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, user]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders, isAdmin, user]);

  return { orders, loading, refetch: fetchOrders };
}

/**
 * Create a Packeta shipment for an order
 */
export async function createPacketaShipment(order: ShipmentOrder): Promise<void> {
  const totalWeight = order.order_items.reduce((sum, item) => {
    return sum + (item.product?.weight || 0.5) * item.quantity;
  }, 0);

  const { data, error } = await aisha.functions.invoke("packeta-api", {
    body: {
      action: "create-packet",
      orderId: order.id,
      recipient: {
        name: `${order.shipping_address?.firstName || ""} ${order.shipping_address?.lastName || ""}`.trim(),
        email: order.profile?.email,
        phone: order.profile?.phone,
        street: order.shipping_address?.address,
        city: order.shipping_address?.city,
        zip: order.shipping_address?.postalCode,
        country: order.shipping_address?.country || "CZ",
      },
      weight: totalWeight,
      value: order.total,
      branchId: order.packeta_branch_id || order.shipping_address?.pickupPointId,
    },
  });

  if (error) {
    safeError("admin.shipments.createPacketaFailed", error);
    throw new Error(error.message);
  }

  const packet = data as unknown as PacketaCreateResponse;

  // Update order with Packeta info
  const { error: updateError } = await aisha.rpc("update_order_packeta_admin", {
    p_order_id: order.id,
    p_packeta_barcode: packet.barcode,
    p_packeta_packet_id: packet.packetId,
    p_status: "processing"
,
    p_tracking_url: packet.trackingUrl
    });

  if (updateError) {
    safeError("admin.shipments.updatePacketaFailed", updateError);
    throw updateError;
  }
}

/**
 * Mark an order as shipped
 */
export async function markOrderShipped(orderId: string): Promise<void> {
  const { error } = await aisha.rpc("mark_order_shipped_admin", {
    p_order_id: orderId,
  });

  if (error) {
    safeError("admin.shipments.markShippedFailed", error);
    throw new Error(error.message);
  }
}

/**
 * Get tracking status for a Packeta shipment
 */
export async function getPacketaTrackingStatus(packetId: string): Promise<{ status: string }> {
  const { data, error } = await aisha.functions.invoke("packeta-api", {
    body: {
      action: "track",
      packetId,
    },
  });

  if (error) {
    safeError("admin.shipments.trackingFailed", error);
    throw new Error(error.message);
  }

  return data as unknown as PacketaTrackingResponse;
}
