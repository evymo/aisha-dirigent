/**
 * Zod schemas for shipments
 * 
 * @module lib/schemas/shipmentSchemas
 */

import { z } from "zod";

/**
 * Schema for shipping address
 */
export const shippingAddressSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  pickupPointId: z.number().optional(),
  pickupPointName: z.string().optional(),
}).nullable();

/**
 * Schema for order profile
 */
export const orderProfileSchema = z.object({
  display_name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
}).nullable();

/**
 * Schema for order item
 */
export const orderItemSchema = z.object({
  id: z.string(),
  quantity: z.number(),
  product: z.object({
    name: z.string(),
    weight: z.number().optional(),
  }).nullable(),
});

/**
 * Schema for shipment order from RPC
 */
export const shipmentOrderRpcSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  status: z.string(),
  total: z.number(),
  created_at: z.string(),
  shipped_at: z.string().nullable(),
  delivered_at: z.string().nullable(),
  shipping_method: z.string().nullable(),
  packeta_packet_id: z.string().nullable(),
  packeta_barcode: z.string().nullable(),
  packeta_branch_id: z.number().nullable(),
  tracking_url: z.string().nullable(),
  shipping_address: shippingAddressSchema,
  profile: orderProfileSchema.optional(),
  order_items: z.array(orderItemSchema).optional().default([]),
});

export const shipmentOrderRpcArraySchema = z.array(shipmentOrderRpcSchema);

export type ShipmentOrderRpc = z.infer<typeof shipmentOrderRpcSchema>;
