/**
 * Zod schemas for smart shipping checkout
 *
 * Validates edge-function responses (available-methods) and defines
 * the 6-method shipping taxonomy used across checkout flow.
 *
 * @module lib/schemas/shippingCheckoutSchemas
 */

import { BASE_CURRENCY_FALLBACK } from "@/lib/currency/constants";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shipping method taxonomy
// ---------------------------------------------------------------------------

/**
 * All 6 supported shipping methods.
 *
 * - `personal_pickup` — pick up at our store
 * - `packeta_zbox` — Packeta Z-BOX (24/7 parcel locker)
 * - `packeta_pickup` — Packeta branch / pickup point
 * - `carrier_pickup` — external carrier PUDO (via Packeta)
 * - `packeta_home` — home delivery by Packeta
 * - `carrier_home` — home delivery by external carrier (via Packeta)
 */
export const shippingMethodSchema = z.enum([
  "carrier_home",
  "carrier_pickup",
  "packeta_home",
  "packeta_pickup",
  "packeta_zbox",
  "personal_pickup",
]);

export type ShippingMethod = z.infer<typeof shippingMethodSchema>;

/** Display-level category = visual grouping in checkout UI */
export const shippingCategorySchema = z.enum([
  "pickup",       // packeta_pickup + carrier_pickup
  "zbox",         // packeta_zbox
  "home_delivery", // packeta_home + carrier_home
  "personal",     // personal_pickup
]);

export type ShippingCategory = z.infer<typeof shippingCategorySchema>;

// ---------------------------------------------------------------------------
// Shipping point (pickup point / Z-BOX)
// ---------------------------------------------------------------------------

export const shippingPointPhotoSchema = z.object({
  normal: z.string(),
  thumbnail: z.string(),
});

export const shippingPointSchema = z.object({
  city: z.string(),
  codAllowed: z.boolean().optional(),
  country: z.string(),
  creditCardPayment: z.boolean(),
  distance: z.number().optional(),
  hasKeypad: z.boolean().optional(),
  id: z.number(),
  latitude: z.number(),
  longitude: z.number(),
  maxWeight: z.number(),
  name: z.string(),
  openingHours: z.string().optional(),
  photos: z.array(shippingPointPhotoSchema),
  street: z.string(),
  type: z.enum(["branch", "zbox"]),
  wheelchairAccessible: z.boolean(),
  zip: z.string(),
});

export type ShippingPoint = z.infer<typeof shippingPointSchema>;

// ---------------------------------------------------------------------------
// Carrier option (home delivery)
// ---------------------------------------------------------------------------

export const shippingCarrierSchema = z.object({
  country: z.string(),
  deliveryType: z.enum(["Box", "HD", "PP"]),
  disallowsCod: z.boolean(),
  displayName: z.string(),
  id: z.number(),
  maxWeight: z.number(),
  name: z.string(),
  requiresEmail: z.boolean(),
  requiresPhone: z.boolean(),
});

export type ShippingCarrier = z.infer<typeof shippingCarrierSchema>;

// ---------------------------------------------------------------------------
// Available methods response (from edge function)
// ---------------------------------------------------------------------------

export const availableMethodsResponseSchema = z.object({
  carrierPickupPoints: z.array(shippingPointSchema),
  carriers: z.array(shippingCarrierSchema),
  costs: z.record(z.string(), z.number()),
  freeShippingThreshold: z.number().nullable(),
  personalPickupAvailable: z.boolean(),
  pickupPoints: z.array(shippingPointSchema),
  totalBranchCount: z.number(),
  totalZboxCount: z.number(),
  zboxes: z.array(shippingPointSchema),
});

export type AvailableMethodsResponse = z.infer<typeof availableMethodsResponseSchema>;

// ---------------------------------------------------------------------------
// Request params (for the hook)
// ---------------------------------------------------------------------------

export const availableMethodsRequestSchema = z.object({
  country: z.string().min(2).max(3),
  currency: z.string().default(BASE_CURRENCY_FALLBACK),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  maxResults: z.number().min(1).max(50).default(20),
  orderSubtotal: z.number().default(0),
  postalCode: z.string().default(""),
  weightGrams: z.number().default(500),
});

export type AvailableMethodsRequest = z.infer<typeof availableMethodsRequestSchema>;

// ---------------------------------------------------------------------------
// Shipping selection state (used in checkout form)
// ---------------------------------------------------------------------------

export const shippingSelectionSchema = z.object({
  carrierId: z.number().nullable().default(null),
  carrierName: z.string().nullable().default(null),
  method: shippingMethodSchema,
  packetaBranchId: z.number().nullable().default(null),
  selectedPoint: shippingPointSchema.nullable().default(null),
  shippingCost: z.number().default(0),
});

export type ShippingSelection = z.infer<typeof shippingSelectionSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a ShippingMethod to its display category */
export function getShippingCategory(method: ShippingMethod): ShippingCategory {
  switch (method) {
    case "packeta_pickup":
    case "carrier_pickup":
      return "pickup";
    case "packeta_zbox":
      return "zbox";
    case "packeta_home":
    case "carrier_home":
      return "home_delivery";
    case "personal_pickup":
      return "personal";
  }
}

/** Check if free shipping applies */
export function isFreeShipping(
  orderSubtotal: number,
  freeShippingThreshold: number | null,
): boolean {
  if (freeShippingThreshold == null) return false;
  return orderSubtotal >= freeShippingThreshold;
}

/** Calculate remaining amount for free shipping */
export function freeShippingRemaining(
  orderSubtotal: number,
  freeShippingThreshold: number | null,
): number {
  if (freeShippingThreshold == null) return Infinity;
  const remaining = freeShippingThreshold - orderSubtotal;
  return remaining > 0 ? remaining : 0;
}
