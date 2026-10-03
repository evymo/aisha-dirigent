/**
 * Product Transparency Hooks
 *
 * React Query hooks for fetching product and batch transparency data.
 * Uses RPC-only data access pattern.
 *
 * @module hooks/useProductTransparency
 */

import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import {
    productTransparencySchema,
    batchDetailTransparencySchema,
    type ProductTransparency,
    type BatchDetailTransparency,
} from "@/lib/schemas/productTransparencySchemas";

// =============================================================================
// Query Keys
// =============================================================================

export const transparencyKeys = {
    all: ["transparency"] as const,
    product: (slug: string) => [...transparencyKeys.all, "product", slug] as const,
    batch: (code: string) => [...transparencyKeys.all, "batch", code] as const,
};

// =============================================================================
// Hooks
// =============================================================================

/**
 * Fetches product transparency data including batches, knowledge topics, and variants.
 * Public-safe (non-sensitive). Available to anon and authenticated users.
 */
export function useProductTransparency(slug: string) {
    return useQuery<ProductTransparency>({
        queryKey: transparencyKeys.product(slug),
        queryFn: async () => {
            const { data, error } = await aisha.rpc("get_product_transparency", {
                p_product_slug: slug,
            });
            if (error) throw new Error(error.message);
            if (!data || (typeof data === "object" && "error" in (data as Record<string, unknown>))) {
                throw new Error((data as Record<string, string>)?.error ?? "Product not found");
            }
            return productTransparencySchema.parse(data);
        },
        enabled: !!slug,
    });
}

/**
 * Fetches batch detail transparency data including protocol steps, materials,
 * and related knowledge topics.
 * Available to authenticated users only.
 */
export function useBatchTransparency(batchCode: string) {
    return useQuery<BatchDetailTransparency>({
        queryKey: transparencyKeys.batch(batchCode),
        queryFn: async () => {
            const { data, error } = await aisha.rpc("get_batch_detail_transparency", {
                p_batch_code: batchCode,
            });
            if (error) throw new Error(error.message);
            if (!data || (typeof data === "object" && "error" in (data as Record<string, unknown>))) {
                throw new Error((data as Record<string, string>)?.error ?? "Batch not found");
            }
            return batchDetailTransparencySchema.parse(data);
        },
        enabled: !!batchCode,
    });
}
