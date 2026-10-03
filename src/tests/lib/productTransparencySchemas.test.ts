import { describe, expect, it } from "vitest";

import {
  batchDetailTransparencySchema,
  batchMaterialSchema,
  batchProtocolStepSchema,
  productTransparencySchema,
  transparencyBatchSchema,
  transparencyTopicRefSchema,
  transparencyVariantSchema,
} from "@/lib/schemas/productTransparencySchemas";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const TOPIC_ID = "22222222-2222-4222-8222-222222222222";
const BATCH_ID = "33333333-3333-4333-8333-333333333333";

describe("productTransparencySchemas", () => {
  it("validates product transparency responses", () => {
    const batch = transparencyBatchSchema.parse({
      batch_code: "B-001",
      batch_number: "001",
      status: "released",
      production_date: "2026-04-01",
      expiry_date: "2027-04-01",
      quality_approved: true,
      raw_material_lot: "LOT-1",
      supplier_info: null,
      blockchain_tx_hash: null,
      blockchain_recorded_at: null,
      unit: "bottle",
      total_units: 100,
      available_units: 80,
    });

    const topic = transparencyTopicRefSchema.parse({
      topic_id: TOPIC_ID,
      slug: "quality",
      title_key: "knowledge.quality.title",
      verification_status: "verified",
      link_type: "evidence",
      is_verified: true,
    });

    const variant = transparencyVariantSchema.parse({
      variant_code: "default",
      variant_name: "Default",
      description: null,
      is_default: true,
    });

    expect(
      productTransparencySchema.parse({
        product: {
          id: PRODUCT_ID,
          name: "Aisha Drops",
          slug: "aisha-drops",
          description: null,
          short_description: "Daily support",
          category: "supplement",
          origin_content: { source: "EU" },
          substances_content: null,
          benefits_content: null,
          usage_content: null,
          volume_ml: 30,
          doses_per_package: 60,
          image_url: null,
        },
        batches: [batch],
        knowledge_topics: [topic],
        variants: [variant],
      }).batches[0].batch_code,
    ).toBe("B-001");
  });

  it("validates batch detail transparency responses", () => {
    const protocolStep = batchProtocolStepSchema.parse({
      step_name: "Quality control",
      step_order: 1,
      step_type: "qc",
      description: "Final QC",
      is_completed: true,
      completed_at: "2026-04-02T00:00:00.000Z",
      status: "completed",
    });

    const material = batchMaterialSchema.parse({
      material_name: "Base oil",
      item_code: "MAT-1",
      direction: "input",
      planned_qty: 10,
      actual_qty: 9.8,
      unit: "l",
      lot_number: "LOT-1",
    });

    const detail = batchDetailTransparencySchema.parse({
      batch: {
        id: BATCH_ID,
        batch_code: "B-001",
        batch_number: "001",
        status: "released",
        production_date: "2026-04-01",
        expiry_date: "2027-04-01",
        quality_approved: true,
        qc_approved_at: "2026-04-02T00:00:00.000Z",
        qc_notes: null,
        raw_material_lot: "LOT-1",
        supplier_info: null,
        blockchain_tx_hash: "0xabc",
        blockchain_recorded_at: "2026-04-02T00:00:00.000Z",
        released_at: "2026-04-03T00:00:00.000Z",
        content_type: "oil",
        purpose: "wellness",
        total_units: 100,
        available_units: 80,
        projected_yield_percent: 98,
      },
      product: {
        name: "Aisha Drops",
        slug: "aisha-drops",
        category: "supplement",
        image_url: null,
      },
      protocol_steps: [protocolStep],
      materials: [material],
      knowledge_topics: [{
        topic_id: TOPIC_ID,
        slug: "quality",
        title_key: "knowledge.quality.title",
        verification_status: "verified",
      }],
    });

    expect(detail.materials[0].actual_qty).toBe(9.8);
  });

  it("rejects malformed UUID topic references", () => {
    expect(() =>
      transparencyTopicRefSchema.parse({
        topic_id: "not-a-uuid",
        slug: "quality",
        title_key: "knowledge.quality.title",
        verification_status: "verified",
      }),
    ).toThrow();
  });
});
