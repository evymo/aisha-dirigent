import { describe, it, expect } from "vitest";
import {
  agentStorySpecSchema,
  agentModelKeySchema,
  pluginManifestSchema,
} from "@/lib/schemas/pluginSchemas";
import {
  availableAgentSchema,
  agentInstallResultSchema,
} from "@/lib/schemas/agentMarketplaceSchemas";

describe("agentModelKeySchema — router keys only", () => {
  it.each(["fast", "balanced", "maxQuality"])("accepts router key %s", (k) => {
    expect(agentModelKeySchema.parse(k)).toBe(k);
  });

  it("rejects a raw provider model id (authors must not pin providers)", () => {
    expect(() => agentModelKeySchema.parse("gpt-4")).toThrow();
    expect(() => agentModelKeySchema.parse("claude-opus-4-8")).toThrow();
  });
});

describe("agentStorySpecSchema", () => {
  it("applies defaults for a minimal spec", () => {
    const parsed = agentStorySpecSchema.parse({});
    expect(parsed.rule_slugs).toEqual([]);
    expect(parsed.knowledge_items).toEqual([]);
  });

  it("parses a full run-as-story + runtime-registry spec", () => {
    const parsed = agentStorySpecSchema.parse({
      rule_slugs: ["coding-standard"],
      knowledge_items: [{ title: "KB", body_markdown: "body" }],
      purpose: "a test agent",
      default_model: "maxQuality",
      allowed_tools: ["search"],
      safety_level: "elevated",
      autonomy_level: "manual",
    });
    expect(parsed.default_model).toBe("maxQuality");
    expect(parsed.knowledge_items[0].item_type).toBe("domain_doc"); // default
    expect(parsed.safety_level).toBe("elevated");
  });

  it("rejects a non-router default_model", () => {
    expect(() => agentStorySpecSchema.parse({ default_model: "gpt-4" })).toThrow();
  });

  it("rejects an invalid safety/autonomy level", () => {
    expect(() => agentStorySpecSchema.parse({ safety_level: "yolo" })).toThrow();
    expect(() => agentStorySpecSchema.parse({ autonomy_level: "rogue" })).toThrow();
  });
});

describe("pluginManifestSchema — kind=agent", () => {
  const base = {
    id: "my-agent",
    version: "1.0.0",
    kind: "agent" as const,
    trust_tier: "partner" as const,
    capabilities: ["agent.run_as_story"],
    lifecycle: { load_strategy: "hot" as const },
  };

  it("accepts an agent manifest carrying agent_spec", () => {
    const parsed = pluginManifestSchema.parse({
      ...base,
      agent_spec: { rule_slugs: ["r1"], default_model: "balanced" },
    });
    expect(parsed.kind).toBe("agent");
    expect(parsed.agent_spec?.default_model).toBe("balanced");
  });

  it("accepts a declarative agent manifest with no agent_spec", () => {
    expect(() => pluginManifestSchema.parse(base)).not.toThrow();
  });

  it("rejects an agent manifest with a raw provider model in agent_spec", () => {
    expect(() =>
      pluginManifestSchema.parse({ ...base, agent_spec: { default_model: "gpt-4" } }),
    ).toThrow();
  });
});

describe("availableAgentSchema — listing row", () => {
  it("parses a get_available_plugins(kind=agent) row", () => {
    const parsed = availableAgentSchema.parse({
      plugin_id: "11111111-1111-1111-1111-111111111111",
      slug: "my-agent",
      name: "My Agent",
      description: "does things",
      kind: "agent",
      trust_tier: "partner",
      status: "canary",
      capabilities: ["agent.run_as_story"],
      version: null,
    });
    expect(parsed.slug).toBe("my-agent");
    expect(parsed.capabilities).toEqual(["agent.run_as_story"]);
  });

  it("tolerates null name/description (declarative agents)", () => {
    const parsed = availableAgentSchema.parse({
      plugin_id: "11111111-1111-1111-1111-111111111111",
      slug: "a",
      name: null,
      description: null,
      kind: "agent",
      trust_tier: "partner",
      status: "ga",
    });
    expect(parsed.capabilities).toEqual([]); // default
  });
});

describe("agentInstallResultSchema", () => {
  it("parses an install_agent_as_story result", () => {
    const parsed = agentInstallResultSchema.parse({
      story_id: "22222222-2222-2222-2222-222222222222",
      ruleset_id: null,
      plugin_id: "11111111-1111-1111-1111-111111111111",
      slug: "my-agent",
      rule_count: 0,
      kb_count: 1,
    });
    expect(parsed.kb_count).toBe(1);
    expect(parsed.ruleset_id).toBeNull();
  });
});
