import { describe, expect, it } from "vitest";

import {
  BLOCK_LIBRARY,
  BlockLibraryEntrySchema,
  PartnerTemplateSchema,
  TemplateBlockConfigSchema,
  getBlockByType,
  getBlocksByCategory,
  getMergedBlocksByCategory,
  mergeWithStudyQuestionnaires,
} from "@/schemas/partnerTemplateSchemas";

const FIRST_DYNAMIC_QUESTIONNAIRE_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_DYNAMIC_QUESTIONNAIRE_ID = "22222222-2222-4222-8222-222222222222";

describe("partnerTemplateSchemas", () => {
  it("validates every static block library entry", () => {
    expect(BLOCK_LIBRARY.length).toBeGreaterThan(0);

    for (const entry of BLOCK_LIBRARY) {
      expect(BlockLibraryEntrySchema.parse(entry)).toEqual(entry);
    }
  });

  it("finds blocks by type and category", () => {
    expect(getBlockByType("meeting_onboarding")?.category).toBe("meeting");
    expect(getBlockByType("questionnaire_dynamic")).toBeUndefined();

    const consentBlocks = getBlocksByCategory("consent");
    expect(consentBlocks.length).toBeGreaterThan(0);
    expect(consentBlocks.every((block) => block.category === "consent")).toBe(true);
  });

  it("merges study questionnaires by replacing static questionnaire blocks", () => {
    const merged = mergeWithStudyQuestionnaires([
      {
        id: FIRST_DYNAMIC_QUESTIONNAIRE_ID,
        title: "Baseline Intake",
        description: "Initial intake form",
        is_required: true,
      },
      {
        id: SECOND_DYNAMIC_QUESTIONNAIRE_ID,
        title: "Follow Up",
        description: "Progress check",
        is_required: false,
      },
    ]);

    const questionnaires = getMergedBlocksByCategory("questionnaire", merged);

    expect(questionnaires).toHaveLength(2);
    expect(questionnaires.map((entry) => entry.questionnaire_id)).toEqual([
      FIRST_DYNAMIC_QUESTIONNAIRE_ID,
      SECOND_DYNAMIC_QUESTIONNAIRE_ID,
    ]);
    expect(merged.some((entry) => entry.block_type === "questionnaire_womac")).toBe(false);
    expect(merged.some((entry) => entry.category === "meeting")).toBe(true);
  });

  it("keeps static questionnaire blocks when no study questionnaire is supplied", () => {
    const merged = mergeWithStudyQuestionnaires([]);

    expect(merged).toEqual(BLOCK_LIBRARY);
    expect(getMergedBlocksByCategory("questionnaire", merged).length).toBeGreaterThan(1);
  });

  it("validates full partner template payloads", () => {
    const block = TemplateBlockConfigSchema.parse({
      id: "33333333-3333-4333-8333-333333333333",
      block_type: "action_schedule_lab",
      order: 1,
      is_required: true,
      delay_days: 7,
      condition: {
        depends_on: "44444444-4444-4444-8444-444444444444",
        require_status: "completed",
      },
    });

    const template = PartnerTemplateSchema.parse({
      id: "55555555-5555-4555-8555-555555555555",
      partner_id: "66666666-6666-4666-8666-666666666666",
      name: "Recovery Plan",
      description: "Structured recovery onboarding",
      category: "onboarding",
      is_active: true,
      is_default: false,
      blocks: [block],
      study_id: "77777777-7777-4777-8777-777777777777",
      usage_count: 3,
      last_used_at: null,
      created_at: "2026-04-01T00:00:00.000Z",
      updated_at: "2026-04-02T00:00:00.000Z",
    });

    expect(template.blocks[0].block_type).toBe("action_schedule_lab");
  });

  it("rejects invalid UUID references and template names", () => {
    expect(() =>
      TemplateBlockConfigSchema.parse({
        id: "not-a-uuid",
        block_type: "meeting_check_in",
        order: 1,
        is_required: false,
      }),
    ).toThrow();

    expect(() =>
      PartnerTemplateSchema.parse({
        id: "55555555-5555-4555-8555-555555555555",
        partner_id: "66666666-6666-4666-8666-666666666666",
        name: "",
        category: "custom",
        is_active: true,
        is_default: false,
        blocks: [],
        usage_count: 0,
        last_used_at: null,
        created_at: "2026-04-01T00:00:00.000Z",
        updated_at: "2026-04-02T00:00:00.000Z",
      }),
    ).toThrow();
  });
});
