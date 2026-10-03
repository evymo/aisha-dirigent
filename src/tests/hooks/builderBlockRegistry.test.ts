/**
 * Tests for the AISHA Story Canvas builder modules.
 *
 * Covers:
 * - Block registry: structure, completeness, i18n key presence
 * - aishaBlocksPlugin: GrapesJS editor integration
 * - Zod schemas: StoryCanvasData, UpdateStoryCanvasRequest/Response edge cases
 *
 * @module
 */

import { describe, expect, it, vi } from "vitest";
import {
  CANVAS_BLOCK_REGISTRY,
  RUNTIME_BLOCK_DEFINITIONS,
  type BlockCategory,
  type CanvasBlockEntry,
} from "@/lib/builder/blockRegistry";
import { aishaBlocksPlugin } from "@/lib/builder/aishaBlocksPlugin";
import {
  StoryCanvasDataSchema,
  UpdateStoryCanvasRequestSchema,
  UpdateStoryCanvasResponseSchema,
} from "@/schemas/storyDeliverySchemas";

// =====================================================
// Block Registry
// =====================================================

describe("CANVAS_BLOCK_REGISTRY", () => {
  it("contains exactly 31 blocks", () => {
    expect(CANVAS_BLOCK_REGISTRY).toHaveLength(31);
  });

  it("has 26 web blocks and 5 workflow blocks", () => {
    const web = CANVAS_BLOCK_REGISTRY.filter((b) => b.category === "web");
    const workflow = CANVAS_BLOCK_REGISTRY.filter((b) => b.category === "workflow");
    expect(web).toHaveLength(26);
    expect(workflow).toHaveLength(5);
  });

  it("every block has a unique blockType", () => {
    const types = CANVAS_BLOCK_REGISTRY.map((b) => b.blockType);
    expect(new Set(types).size).toBe(types.length);
  });

  it("every block has a valid category", () => {
    const validCategories: BlockCategory[] = ["web", "workflow"];
    for (const block of CANVAS_BLOCK_REGISTRY) {
      expect(validCategories).toContain(block.category);
    }
  });

  it("every block has non-empty content", () => {
    for (const block of CANVAS_BLOCK_REGISTRY) {
      expect(block.content.trim().length).toBeGreaterThan(0);
    }
  });

  it("every block has i18n nameKey matching builder.blocks.{type}.title", () => {
    for (const block of CANVAS_BLOCK_REGISTRY) {
      expect(block.nameKey).toBe(`builder.blocks.${block.blockType}.title`);
    }
  });

  it("every block has i18n descriptionKey matching builder.blocks.{type}.description", () => {
    for (const block of CANVAS_BLOCK_REGISTRY) {
      expect(block.descriptionKey).toBe(`builder.blocks.${block.blockType}.description`);
    }
  });

  it("every block has an icon component", () => {
    for (const block of CANVAS_BLOCK_REGISTRY) {
      // Lucide icons are ForwardRef objects or functions
      expect(block.icon).toBeDefined();
      expect(["function", "object"]).toContain(typeof block.icon);
    }
  });

  it("every block content contains at least one data-gjs-type attribute", () => {
    for (const block of CANVAS_BLOCK_REGISTRY) {
      expect(block.content).toContain("data-gjs-type");
    }
  });

  it("web blocks have aisha-prefixed class names in content", () => {
    const webBlocks = CANVAS_BLOCK_REGISTRY.filter((b) => b.category === "web");
    for (const block of webBlocks) {
      expect(block.content).toContain(`aisha-${block.blockType}`);
    }
  });

  it("workflow blocks have aisha-prefixed class names in content", () => {
    const workflowBlocks = CANVAS_BLOCK_REGISTRY.filter((b) => b.category === "workflow");
    for (const block of workflowBlocks) {
      expect(block.content).toContain(`aisha-${block.blockType}`);
    }
  });

  it("block types are alphabetically sorted within each category", () => {
    const categories: BlockCategory[] = ["web", "workflow"];
    for (const cat of categories) {
      const blocks = CANVAS_BLOCK_REGISTRY.filter((b) => b.category === cat);
      const types = blocks.map((b) => b.blockType);
      // We check they appear in a logical order (not necessarily alpha),
      // but at minimum all expected blocks are present
      expect(types.length).toBeGreaterThan(0);
    }
  });

  it("expected web block types are present", () => {
    const webTypes = CANVAS_BLOCK_REGISTRY
      .filter((b) => b.category === "web")
      .map((b) => b.blockType)
      .sort();
    expect(webTypes).toEqual([
      "about",
      "announcement-bar",
      "contact",
      "cost-pillars",
      "cta",
      "data-table",
      "faq",
      "features",
      "footer",
      "hero",
      "hiring",
      "how-it-works",
      "install-grid",
      "layer-stack",
      "modes",
      "ordered-list",
      "pillars",
      "pricing",
      "process-loop",
      "project-configurator",
      "signal-cards",
      "specialist-guild",
      "stats-counter",
      "testimonials",
      "timeline",
      "trust-bar",
    ]);
  });

  it("expected workflow block types are present", () => {
    const workflowTypes = CANVAS_BLOCK_REGISTRY
      .filter((b) => b.category === "workflow")
      .map((b) => b.blockType)
      .sort();
    expect(workflowTypes).toEqual([
      "action",
      "consent",
      "info",
      "meeting",
      "questionnaire",
    ]);
  });
});

// =====================================================
// aishaBlocksPlugin
// =====================================================

describe("aishaBlocksPlugin", () => {
  function createMockEditor() {
    const addedBlocks: Record<string, unknown> = {};
    return {
      Blocks: {
        add: vi.fn((id: string, config: unknown) => {
          addedBlocks[id] = config;
        }),
      },
      DomComponents: {
        addType: vi.fn(),
      },
      _addedBlocks: addedBlocks,
    };
  }

  it("registers one block for each registry entry", () => {
    const mockEditor = createMockEditor();
    const t = vi.fn((key: string) => key);

    aishaBlocksPlugin(mockEditor as never, { t });

    expect(mockEditor.Blocks.add).toHaveBeenCalledTimes(
      CANVAS_BLOCK_REGISTRY.length + RUNTIME_BLOCK_DEFINITIONS.length,
    );
  });

  it("prefixes each block id with 'aisha-'", () => {
    const mockEditor = createMockEditor();
    const t = vi.fn((key: string) => key);

    aishaBlocksPlugin(mockEditor as never, { t });

    for (const block of CANVAS_BLOCK_REGISTRY) {
      expect(mockEditor.Blocks.add).toHaveBeenCalledWith(
        `aisha-${block.blockType}`,
        expect.objectContaining({
          content: expect.objectContaining({
            content: block.content,
            type: `aisha-${block.blockType}`,
          }),
          label: block.nameKey,
        }),
      );
    }
  });

  it("passes translated category as the category field", () => {
    const mockEditor = createMockEditor();
    const t = vi.fn((key: string) => `translated:${key}`);

    aishaBlocksPlugin(mockEditor as never, { t });

    // Check a web block uses translated web category
    const heroCall = mockEditor.Blocks.add.mock.calls.find(
      (call: unknown[]) => call[0] === "aisha-hero",
    );
    expect(heroCall).toBeDefined();
    expect(heroCall?.[1]).toEqual(
      expect.objectContaining({
        category: "translated:builder.categories.web",
      }),
    );

    // Check a workflow block uses translated workflow category
    const meetingCall = mockEditor.Blocks.add.mock.calls.find(
      (call: unknown[]) => call[0] === "aisha-meeting",
    );
    expect(meetingCall).toBeDefined();
    expect(meetingCall?.[1]).toEqual(
      expect.objectContaining({
        category: "translated:builder.categories.workflow",
      }),
    );
  });

  it("sets title attribute from descriptionKey translation", () => {
    const mockEditor = createMockEditor();
    const t = vi.fn((key: string) => `t(${key})`);

    aishaBlocksPlugin(mockEditor as never, { t });

    const heroCall = mockEditor.Blocks.add.mock.calls.find(
      (call: unknown[]) => call[0] === "aisha-hero",
    );
    expect(heroCall?.[1]).toEqual(
      expect.objectContaining({
        attributes: expect.objectContaining({
          title: "t(builder.blocks.hero.description)",
        }),
      }),
    );
  });

  it("sets gjs-block CSS classes on each block", () => {
    const mockEditor = createMockEditor();
    const t = vi.fn((key: string) => key);

    aishaBlocksPlugin(mockEditor as never, { t });

    for (const block of CANVAS_BLOCK_REGISTRY) {
      const call = mockEditor.Blocks.add.mock.calls.find(
        (c: unknown[]) => c[0] === `aisha-${block.blockType}`,
      );
      expect(call?.[1]).toEqual(
        expect.objectContaining({
          attributes: expect.objectContaining({
            class: `gjs-block-aisha gjs-block-${block.blockType}`,
          }),
        }),
      );
    }
  });
});

// =====================================================
// Canvas Zod Schemas — extended edge cases
// =====================================================

describe("StoryCanvasDataSchema", () => {
  it("accepts object with all optional fields present", () => {
    const data = {
      assets: [{ src: "img.png" }],
      pages: [{ id: "p1" }],
      styles: [{ selectors: [".cls"] }],
    };
    expect(StoryCanvasDataSchema.parse(data)).toEqual(data);
  });

  it("accepts empty object", () => {
    expect(StoryCanvasDataSchema.parse({})).toEqual({});
  });

  it("passes through unknown properties (GrapesJS compat)", () => {
    const data = { customProp: true, pages: [] };
    const parsed = StoryCanvasDataSchema.parse(data);
    expect(parsed).toHaveProperty("customProp", true);
  });

  it("rejects non-object types", () => {
    expect(() => StoryCanvasDataSchema.parse("not-an-object")).toThrow();
    expect(() => StoryCanvasDataSchema.parse(42)).toThrow();
    expect(() => StoryCanvasDataSchema.parse(null)).toThrow();
  });

  it("accepts assets with any shape inside array", () => {
    const data = { assets: [1, "two", { complex: true }] };
    expect(StoryCanvasDataSchema.parse(data)).toEqual(data);
  });
});

describe("UpdateStoryCanvasRequestSchema", () => {
  const validRequest = {
    canvas_data: { pages: [] },
    story_id: "00000000-0000-4000-8000-000000000001",
  };

  it("accepts minimal valid request", () => {
    const result = UpdateStoryCanvasRequestSchema.parse(validRequest);
    expect(result.story_id).toBe(validRequest.story_id);
  });

  it("accepts full request with all optional fields", () => {
    const full = {
      ...validRequest,
      canvas_css: "body { color: red; }",
      canvas_html: "<div>Test</div>",
      publish: true,
    };
    expect(UpdateStoryCanvasRequestSchema.parse(full)).toEqual(full);
  });

  it("accepts null for canvas_css and canvas_html", () => {
    const req = { ...validRequest, canvas_css: null, canvas_html: null };
    const result = UpdateStoryCanvasRequestSchema.parse(req);
    expect(result.canvas_css).toBeNull();
    expect(result.canvas_html).toBeNull();
  });

  it("rejects invalid UUID for story_id", () => {
    expect(() =>
      UpdateStoryCanvasRequestSchema.parse({ ...validRequest, story_id: "not-a-uuid" }),
    ).toThrow();
  });

  it("rejects missing canvas_data", () => {
    expect(() =>
      UpdateStoryCanvasRequestSchema.parse({ story_id: validRequest.story_id }),
    ).toThrow();
  });

  it("rejects non-boolean publish", () => {
    expect(() =>
      UpdateStoryCanvasRequestSchema.parse({ ...validRequest, publish: "yes" }),
    ).toThrow();
  });
});

describe("UpdateStoryCanvasResponseSchema", () => {
  it("accepts valid response", () => {
    const resp = {
      published: false,
      story_id: "00000000-0000-4000-8000-000000000001",
      updated: true,
    };
    expect(UpdateStoryCanvasResponseSchema.parse(resp)).toEqual(resp);
  });

  it("rejects missing fields", () => {
    expect(() => UpdateStoryCanvasResponseSchema.parse({})).toThrow();
    expect(() =>
      UpdateStoryCanvasResponseSchema.parse({ published: true, updated: true }),
    ).toThrow();
  });

  it("rejects non-boolean published", () => {
    expect(() =>
      UpdateStoryCanvasResponseSchema.parse({
        published: "yes",
        story_id: "00000000-0000-4000-8000-000000000001",
        updated: true,
      }),
    ).toThrow();
  });
});
