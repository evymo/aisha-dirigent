/**
 * Product Transparency Zod Schemas
 *
 * Type-safe validation for product and batch transparency RPC responses.
 * These RPCs return non-sensitive data for member/public transparency views.
 *
 * @module lib/schemas/productTransparencySchemas
 */

import { z } from "zod";

// =====================================================
// Batch (within product transparency)
// =====================================================

export const transparencyBatchSchema = z.object({
    batch_code: z.string().nullable(),
    batch_number: z.string().nullable(),
    status: z.string().nullable(),
    production_date: z.string().nullable(),
    expiry_date: z.string().nullable(),
    quality_approved: z.boolean().nullable(),
    raw_material_lot: z.string().nullable(),
    supplier_info: z.string().nullable(),
    blockchain_tx_hash: z.string().nullable(),
    blockchain_recorded_at: z.string().nullable(),
    unit: z.string().nullable(),
    total_units: z.number().nullable(),
    available_units: z.number().nullable(),
});

export type TransparencyBatch = z.infer<typeof transparencyBatchSchema>;

// =====================================================
// Knowledge Topic Reference (within transparency)
// =====================================================

export const transparencyTopicRefSchema = z.object({
    topic_id: z.string().uuid(),
    slug: z.string(),
    title_key: z.string(),
    verification_status: z.string(),
    link_type: z.string().optional(),
    is_verified: z.boolean().optional(),
});

export type TransparencyTopicRef = z.infer<typeof transparencyTopicRefSchema>;

// =====================================================
// Production Variant (within product transparency)
// =====================================================

export const transparencyVariantSchema = z.object({
    variant_code: z.string(),
    variant_name: z.string(),
    description: z.string().nullable(),
    is_default: z.boolean(),
});

export type TransparencyVariant = z.infer<typeof transparencyVariantSchema>;

// =====================================================
// Product Transparency Response
// =====================================================

export const productTransparencySchema = z.object({
    product: z.object({
        id: z.string().uuid(),
        name: z.string(),
        slug: z.string(),
        description: z.string().nullable(),
        short_description: z.string().nullable(),
        category: z.string().nullable(),
        origin_content: z.unknown().nullable(),
        substances_content: z.unknown().nullable(),
        benefits_content: z.unknown().nullable(),
        usage_content: z.unknown().nullable(),
        volume_ml: z.number().nullable(),
        doses_per_package: z.number().nullable(),
        image_url: z.string().nullable(),
    }),
    batches: z.array(transparencyBatchSchema),
    knowledge_topics: z.array(transparencyTopicRefSchema),
    variants: z.array(transparencyVariantSchema),
});

export type ProductTransparency = z.infer<typeof productTransparencySchema>;

// =====================================================
// Batch Protocol Step (within batch detail)
// =====================================================

export const batchProtocolStepSchema = z.object({
    step_name: z.string(),
    step_order: z.number().nullable(),
    step_type: z.string().nullable(),
    description: z.string().nullable(),
    is_completed: z.boolean().nullable(),
    completed_at: z.string().nullable(),
    status: z.string().nullable(),
});

export type BatchProtocolStep = z.infer<typeof batchProtocolStepSchema>;

// =====================================================
// Batch Material (within batch detail)
// =====================================================

export const batchMaterialSchema = z.object({
    material_name: z.string().nullable(),
    item_code: z.string().nullable(),
    direction: z.string().nullable(),
    planned_qty: z.number().nullable(),
    actual_qty: z.number().nullable(),
    unit: z.string().nullable(),
    lot_number: z.string().nullable(),
});

export type BatchMaterial = z.infer<typeof batchMaterialSchema>;

// =====================================================
// Batch Detail Transparency Response
// =====================================================

export const batchDetailTransparencySchema = z.object({
    batch: z.object({
        id: z.string().uuid(),
        batch_code: z.string().nullable(),
        batch_number: z.string().nullable(),
        status: z.string().nullable(),
        production_date: z.string().nullable(),
        expiry_date: z.string().nullable(),
        quality_approved: z.boolean().nullable(),
        qc_approved_at: z.string().nullable(),
        qc_notes: z.string().nullable(),
        raw_material_lot: z.string().nullable(),
        supplier_info: z.string().nullable(),
        blockchain_tx_hash: z.string().nullable(),
        blockchain_recorded_at: z.string().nullable(),
        released_at: z.string().nullable(),
        content_type: z.string().nullable(),
        purpose: z.string().nullable(),
        total_units: z.number().nullable(),
        available_units: z.number().nullable(),
        projected_yield_percent: z.number().nullable(),
    }),
    product: z.object({
        name: z.string(),
        slug: z.string(),
        category: z.string().nullable(),
        image_url: z.string().nullable(),
    }),
    protocol_steps: z.array(batchProtocolStepSchema),
    materials: z.array(batchMaterialSchema),
    knowledge_topics: z.array(transparencyTopicRefSchema),
});

export type BatchDetailTransparency = z.infer<typeof batchDetailTransparencySchema>;
