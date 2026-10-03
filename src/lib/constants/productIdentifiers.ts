/**
 * Product identifiers and GS1 data.
 *
 * Centralizes GTIN, internal codes, and GS1 Application Identifiers (AI)
 * for product traceability, manufacturing protocols, and label generation.
 *
 * Demo product catalogue for the manufacturing/label features. Replace with
 * your own product registration data before going live.
 *
 * @module lib/constants/productIdentifiers
 */

import { z } from "zod";

// =====================================================
// GS1 Application Identifiers (AI)
// =====================================================

/**
 * GS1 Application Identifiers used in manufacturing protocols and labels.
 *
 * @see https://www.gs1.org/standards/barcodes/application-identifiers
 */
export const GS1_APPLICATION_IDENTIFIERS = {
  /** AI (01) — Global Trade Item Number (GTIN-14) */
  GTIN: "01",
  /** AI (10) — Batch/Lot Number */
  BATCH_LOT: "10",
  /** AI (11) — Production Date (YYMMDD) */
  PRODUCTION_DATE: "11",
  /** AI (13) — Packaging Date (YYMMDD) */
  PACKAGING_DATE: "13",
  /** AI (17) — Expiration Date (YYMMDD) */
  EXPIRY_DATE: "17",
  /** AI (21) — Serial Number */
  SERIAL_NUMBER: "21",
  /** AI (22) — Consumer Product Variant */
  CONSUMER_VARIANT: "22",
  /** AI (7230) — Certification Reference */
  CERTIFICATION_REF: "7230",
} as const;

// =====================================================
// Product Identifier Types
// =====================================================

/** Product identifier record for a single product */
export interface ProductIdentifier {
  /** Product slug matching the DB `products.slug` */
  readonly slug: string;
  /** Internal product code (e.g. DEMO-01) */
  readonly internalCode: string;
  /** Commercial product name */
  readonly commercialName: string;
  /** GTIN-14 (base) — from GS1 registration */
  readonly gtin: string;
  /** SKU code for inventory and orders */
  readonly sku: string;
  /** Country of origin ISO code */
  readonly countryOfOrigin: string;
  /** Product category for regulatory classification */
  readonly category: ProductCategory;
  /** Default shelf life in months from production date */
  readonly shelfLifeMonths: number;
  /** Package volume in ml */
  readonly volumeMl: number;
  /** Number of doses per package */
  readonly dosesPerPackage: number;
}

/** Regulatory product category */
export type ProductCategory =
  | "dietary_product"
  | "cosmetic"
  | "combination";

// =====================================================
// Product Identifier Constants
// =====================================================

/** GTIN base prefix for demo products. */
export const GTIN_PREFIX = "0000000000";

/**
 * All product identifiers indexed by slug. Demo data — replace with your own
 * GS1-registered product codes before going live.
 */
export const PRODUCT_IDENTIFIERS: Record<string, ProductIdentifier> = {
  retisin: {
    slug: "retisin",
    internalCode: "DEMO-01",
    commercialName: "Demo Product 1",
    gtin: "00000000000017",
    sku: "DEMO-01-30ML",
    countryOfOrigin: "CZ",
    category: "dietary_product",
    shelfLifeMonths: 24,
    volumeMl: 30,
    dosesPerPackage: 30,
  },
  floristen: {
    slug: "floristen",
    internalCode: "DEMO-02",
    commercialName: "Demo Product 2",
    gtin: "00000000000024",
    sku: "DEMO-02-30ML",
    countryOfOrigin: "CZ",
    category: "dietary_product",
    shelfLifeMonths: 24,
    volumeMl: 30,
    dosesPerPackage: 30,
  },
  lyastin: {
    slug: "lyastin",
    internalCode: "DEMO-03",
    commercialName: "Demo Product 3",
    gtin: "00000000000031",
    sku: "DEMO-03-30ML",
    countryOfOrigin: "CZ",
    category: "dietary_product",
    shelfLifeMonths: 24,
    volumeMl: 30,
    dosesPerPackage: 30,
  },
  "duo-sprej": {
    slug: "duo-sprej",
    internalCode: "DEMO-04",
    commercialName: "Demo Product 4",
    gtin: "00000000000048",
    sku: "DEMO-04-30ML",
    countryOfOrigin: "CZ",
    category: "combination",
    shelfLifeMonths: 18,
    volumeMl: 30,
    dosesPerPackage: 30,
  },
  silexil: {
    slug: "silexil",
    internalCode: "DEMO-05",
    commercialName: "Demo Product 5",
    gtin: "00000000000055",
    sku: "DEMO-05-30ML",
    countryOfOrigin: "CZ",
    category: "dietary_product",
    shelfLifeMonths: 24,
    volumeMl: 30,
    dosesPerPackage: 30,
  },
} as const;

// =====================================================
// GS1 Barcode Data Structure
// =====================================================

/**
 * Zod schema for a GS1-128 barcode data string.
 *
 * Used for encoding/decoding manufacturing protocol data
 * into a GS1-128 compatible barcode string.
 */
export const gs1BarcodeDataSchema = z.object({
  /** GTIN-14 product code */
  gtin: z.string().length(14),
  /** Batch/lot number */
  batchLot: z.string().max(20),
  /** Production date (YYMMDD) */
  productionDate: z.string().regex(/^\d{6}$/),
  /** Expiration date (YYMMDD) */
  expiryDate: z.string().regex(/^\d{6}$/),
  /** Serial number (unique per unit) */
  serialNumber: z.string().max(20).optional(),
  /** Consumer product variant code */
  consumerVariant: z.string().max(20).optional(),
  /** Certification reference (e.g. internal QC ref) */
  certificationRef: z.string().max(30).optional(),
});

export type GS1BarcodeData = z.infer<typeof gs1BarcodeDataSchema>;

/**
 * Encode GS1 barcode data into a GS1-128 element string.
 *
 * @param data - Validated GS1 barcode data
 * @returns GS1-128 formatted string
 *
 * @example
 * ```ts
 * const str = encodeGs1String({
 *   gtin: "00000000000017",
 *   batchLot: "2026-001",
 *   productionDate: "260115",
 *   expiryDate: "280115",
 *   serialNumber: "SN-000001",
 * });
 * // => "(01)00000000000017(10)2026-001(11)260115(17)280115(21)SN-000001"
 * ```
 */
export function encodeGs1String(data: GS1BarcodeData): string {
  const parts: string[] = [
    `(${GS1_APPLICATION_IDENTIFIERS.GTIN})${data.gtin}`,
    `(${GS1_APPLICATION_IDENTIFIERS.BATCH_LOT})${data.batchLot}`,
    `(${GS1_APPLICATION_IDENTIFIERS.PRODUCTION_DATE})${data.productionDate}`,
    `(${GS1_APPLICATION_IDENTIFIERS.EXPIRY_DATE})${data.expiryDate}`,
  ];

  if (data.serialNumber) {
    parts.push(
      `(${GS1_APPLICATION_IDENTIFIERS.SERIAL_NUMBER})${data.serialNumber}`
    );
  }

  if (data.consumerVariant) {
    parts.push(
      `(${GS1_APPLICATION_IDENTIFIERS.CONSUMER_VARIANT})${data.consumerVariant}`
    );
  }

  if (data.certificationRef) {
    parts.push(
      `(${GS1_APPLICATION_IDENTIFIERS.CERTIFICATION_REF})${data.certificationRef}`
    );
  }

  return parts.join("");
}

/**
 * Look up a product identifier by slug.
 *
 * @param slug - Product slug from the DB
 * @returns ProductIdentifier or undefined if not found
 */
export function getProductIdentifier(
  slug: string
): ProductIdentifier | undefined {
  return PRODUCT_IDENTIFIERS[slug];
}

/**
 * Look up a product identifier by internal R&D code.
 *
 * @param code - Internal code (e.g. "DEMO-01")
 * @returns ProductIdentifier or undefined if not found
 */
export function getProductByInternalCode(
  code: string
): ProductIdentifier | undefined {
  return Object.values(PRODUCT_IDENTIFIERS).find(
    (p) => p.internalCode === code
  );
}

/**
 * Look up a product identifier by GTIN.
 *
 * @param gtin - GTIN-14 code
 * @returns ProductIdentifier or undefined if not found
 */
export function getProductByGtin(
  gtin: string
): ProductIdentifier | undefined {
  return Object.values(PRODUCT_IDENTIFIERS).find((p) => p.gtin === gtin);
}
