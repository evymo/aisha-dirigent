/**
 * Manufacturing protocol types and utilities.
 *
 * Models the two-part manufacturing protocol structure:
 * - Part A: Order confirmation (customer-facing)
 * - Part B: Production protocol (manufacturing-facing, with GS1 data)
 *
 * Based on the RTNT Výrobní protokol template.
 *
 * @module lib/constants/manufacturingProtocol
 */

import { z } from "zod";

// =====================================================
// Part A — Order Confirmation
// =====================================================

/**
 * Zod schema for Part A of the manufacturing protocol.
 *
 * This part reflects the order confirmation that the member signs,
 * listing ordered products, quantities, and consent acknowledgements.
 */
export const orderConfirmationSchema = z.object({
  /** Protocol sequence number (e.g. "VP-2026-00123") */
  protocolNumber: z.string(),
  /** Date of order confirmation */
  confirmationDate: z.string(),
  /** Member ID (user_id) */
  memberId: z.string().uuid(),
  /** Member display name (for document rendering; NOT stored in logs) */
  memberDisplayName: z.string().optional(),
  /** Ordered product items */
  items: z.array(
    z.object({
      /** Product slug */
      slug: z.string(),
      /** Product commercial name */
      productName: z.string(),
      /** Internal R&D code */
      internalCode: z.string(),
      /** GTIN-14 */
      gtin: z.string(),
      /** Ordered quantity */
      quantity: z.number().int().positive(),
      /** Unit price in CZK (before VAT) */
      unitPriceCzk: z.number().nonnegative(),
    })
  ),
  /** Total order amount in CZK (before VAT) */
  totalCzk: z.number().nonnegative(),
  /** Shipping method (packeta_pickup, packeta_home, personal_pickup) */
  shippingMethod: z.string(),
  /** Consent record IDs (references to audit_journal entries) */
  consentRecordIds: z.array(z.string().uuid()).optional(),
  /** Consent types acknowledged at checkout */
  consentsAcknowledged: z.array(z.string()),
});

export type OrderConfirmation = z.infer<typeof orderConfirmationSchema>;

// =====================================================
// Part B — Production Protocol
// =====================================================

/**
 * Zod schema for Part B of the manufacturing protocol.
 *
 * This part is filled during production, capturing GS1 data,
 * batch details, quality control results, and traceability info.
 */
export const productionProtocolSchema = z.object({
  /** Protocol number (matches Part A) */
  protocolNumber: z.string(),
  /** Linked batch ID from production_batches */
  batchId: z.string().uuid().optional(),
  /** Batch code (e.g. "RTN33-2026-001") */
  batchCode: z.string().optional(),
  /** GS1 traceability data */
  gs1Data: z
    .object({
      /** GTIN-14 product code */
      gtin: z.string().length(14),
      /** Batch/lot number */
      batchLot: z.string(),
      /** Production date (ISO or YYMMDD) */
      productionDate: z.string(),
      /** Expiration date (ISO or YYMMDD) */
      expiryDate: z.string(),
      /** Serial number */
      serialNumber: z.string().optional(),
      /** Consumer product variant */
      consumerVariant: z.string().optional(),
      /** Certification reference */
      certificationRef: z.string().optional(),
    })
    .optional(),
  /** Quality control check */
  qualityControl: z
    .object({
      /** QC approved flag */
      approved: z.boolean(),
      /** QC approval timestamp */
      approvedAt: z.string().optional(),
      /** QC inspector initials / identifier */
      inspector: z.string().optional(),
      /** QC notes (non-sensitive) */
      notes: z.string().optional(),
    })
    .optional(),
  /** Raw material lot reference */
  rawMaterialLot: z.string().optional(),
  /** Supplier information (non-sensitive) */
  supplierInfo: z.string().optional(),
  /** Production yield percentage */
  yieldPercent: z.number().min(0).max(100).optional(),
});

export type ProductionProtocol = z.infer<typeof productionProtocolSchema>;

// =====================================================
// Complete Manufacturing Protocol
// =====================================================

/**
 * Zod schema for the complete manufacturing protocol document.
 *
 * Combines Part A (order confirmation) and Part B (production protocol)
 * into a single auditable document.
 */
export const manufacturingProtocolSchema = z.object({
  /** Document version */
  version: z.string().default("1.0"),
  /** Part A — Order Confirmation */
  partA: orderConfirmationSchema,
  /** Part B — Production Protocol (filled during production) */
  partB: productionProtocolSchema.optional(),
  /** Document status */
  status: z.enum([
    "draft",
    "confirmed",
    "in_production",
    "quality_check",
    "released",
    "delivered",
  ]),
  /** Creation timestamp */
  createdAt: z.string(),
  /** Last update timestamp */
  updatedAt: z.string().optional(),
});

export type ManufacturingProtocol = z.infer<
  typeof manufacturingProtocolSchema
>;

// =====================================================
// Protocol Number Generator
// =====================================================

/**
 * Generate a protocol number from order ID and date.
 *
 * Format: `VP-{YYYY}-{orderId_short}`
 *
 * @param orderId - UUID of the order
 * @param date - Optional date (defaults to now)
 * @returns Protocol number string
 *
 * @example
 * ```ts
 * generateProtocolNumber("a1b2c3d4-...", new Date("2026-01-15"))
 * // => "VP-2026-A1B2C3D4"
 * ```
 */
export function generateProtocolNumber(
  orderId: string,
  date?: Date
): string {
  const year = (date ?? new Date()).getFullYear();
  const shortId = orderId.split("-")[0].toUpperCase();
  return `VP-${year}-${shortId}`;
}
