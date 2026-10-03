/**
 * Hook for managing manufacturing protocol (Part B) data.
 *
 * Provides utilities for building production protocols, encoding GS1-128
 * barcode strings, and validating protocol data against Zod schemas.
 *
 * This hook is intended for admin / production-facing features.
 * Part A (order confirmation) is handled by {@link module:hooks/useOrderConsent}.
 *
 * @module hooks/useManufacturingProtocol
 * @example
 * ```tsx
 * const { buildProductionProtocol, encodeBarcode } = useManufacturingProtocol();
 * const protocol = buildProductionProtocol({ protocolNumber, gtin, batchLot, ... });
 * const gs1 = encodeBarcode(protocol.gs1Data);
 * ```
 */
import { useCallback, useMemo } from "react";

import { safeError } from "@/lib/security/safeLogger";
import {
  productionProtocolSchema,
  type ProductionProtocol,
} from "@/lib/constants/manufacturingProtocol";
import {
  encodeGs1String,
  getProductIdentifier,
  type ProductIdentifier,
} from "@/lib/constants/productIdentifiers";

// =====================================================
// Types
// =====================================================

/** Input for building a production protocol record. */
export interface ProductionProtocolInput {
  /** Protocol number (from Part A). */
  readonly protocolNumber: string;
  /** Product slug for identifier lookup. */
  readonly productSlug: string;
  /** Batch/lot number. */
  readonly batchLot: string;
  /** Production date (YYMMDD or ISO). */
  readonly productionDate: string;
  /** Expiry date (YYMMDD or ISO). */
  readonly expiryDate: string;
  /** Optional serial number. */
  readonly serialNumber?: string;
  /** Optional consumer variant code. */
  readonly consumerVariant?: string;
  /** Optional certification reference. */
  readonly certificationRef?: string;
  /** Optional batch ID (UUID from production_batches table). */
  readonly batchId?: string;
  /** Optional batch code (e.g. DEMO-01-2026-001). */
  readonly batchCode?: string;
  /** Optional raw material lot. */
  readonly rawMaterialLot?: string;
  /** Optional supplier info (non-sensitive only). */
  readonly supplierInfo?: string;
  /** Optional production yield percentage. */
  readonly yieldPercent?: number;
}

/** Quality control input for approving/rejecting a batch. */
export interface QualityControlInput {
  readonly approved: boolean;
  readonly inspector?: string;
  readonly notes?: string;
}

/** Return type of the `useManufacturingProtocol` hook. */
export interface UseManufacturingProtocolReturn {
  /**
   * Builds a validated production protocol (Part B) from input data.
   *
   * @returns Validated `ProductionProtocol` or `null` if validation fails.
   */
  readonly buildProductionProtocol: (
    input: ProductionProtocolInput,
    qc?: QualityControlInput,
  ) => ProductionProtocol | null;

  /**
   * Encodes GS1-128 barcode string from protocol GS1 data.
   *
   * @param gs1Data - GS1 data object from a production protocol.
   * @returns Encoded GS1-128 string.
   */
  readonly encodeBarcode: (gs1Data: {
    gtin: string;
    batchLot: string;
    productionDate: string;
    expiryDate: string;
    serialNumber?: string;
  }) => string;

  /**
   * Looks up product identifier by slug.
   *
   * @param slug - Product slug.
   * @returns Product identifier or undefined.
   */
  readonly getIdentifier: (slug: string) => ProductIdentifier | undefined;
}

// =====================================================
// Hook
// =====================================================

/**
 * Provides utilities for creating and validating manufacturing protocol Part B data.
 *
 * @returns Callbacks for building protocols, encoding barcodes, and looking up identifiers.
 */
export function useManufacturingProtocol(): UseManufacturingProtocolReturn {
  const buildProductionProtocol = useCallback(
    (
      input: ProductionProtocolInput,
      qc?: QualityControlInput,
    ): ProductionProtocol | null => {
      const identifier = getProductIdentifier(input.productSlug);
      const gtin = identifier?.gtin ?? "";

      const raw = {
        protocolNumber: input.protocolNumber,
        batchId: input.batchId,
        batchCode: input.batchCode,
        gs1Data: gtin
          ? {
              gtin,
              batchLot: input.batchLot,
              productionDate: input.productionDate,
              expiryDate: input.expiryDate,
              serialNumber: input.serialNumber,
              consumerVariant: input.consumerVariant,
              certificationRef: input.certificationRef,
            }
          : undefined,
        qualityControl: qc
          ? {
              approved: qc.approved,
              approvedAt: qc.approved ? new Date().toISOString() : undefined,
              inspector: qc.inspector,
              notes: qc.notes,
            }
          : undefined,
        rawMaterialLot: input.rawMaterialLot,
        supplierInfo: input.supplierInfo,
        yieldPercent: input.yieldPercent,
      };

      const result = productionProtocolSchema.safeParse(raw);
      if (!result.success) {
        safeError("manufacturing.protocol.parseFailed", { issues: result.error.issues.length });
        return null;
      }
      return result.data;
    },
    [],
  );

  const encodeBarcode = useCallback(
    (gs1Data: {
      gtin: string;
      batchLot: string;
      productionDate: string;
      expiryDate: string;
      serialNumber?: string;
    }): string =>
      encodeGs1String({
        gtin: gs1Data.gtin,
        batchLot: gs1Data.batchLot,
        productionDate: gs1Data.productionDate,
        expiryDate: gs1Data.expiryDate,
        serialNumber: gs1Data.serialNumber,
      }),
    [],
  );

  const getIdentifier = useCallback(
    (slug: string): ProductIdentifier | undefined =>
      getProductIdentifier(slug),
    [],
  );

  return useMemo(
    () => ({
      buildProductionProtocol,
      encodeBarcode,
      getIdentifier,
    }),
    [buildProductionProtocol, encodeBarcode, getIdentifier],
  );
}
