import { describe, expect, test } from "vitest";

const payload = {
  generated_at: "2026-01-01T00:00:00Z",
  rules: [
    {
      category: "coding_standard",
      slug: "sample-rule",
      title: "Sample Rule",
      ai_instructions: "Keep generated adapter output testable.",
    },
  ],
  ruleset: { fingerprint: "fp-runtime" },
  story: {
    title: "Runtime Contract Test",
    tech_stack: ["TypeScript", "Fastify", "React Native"],
  },
};

const singleFileAdapters = [
  ["copilot", "../adapter-copilot.mjs"],
  ["agents", "../adapter-agents.mjs"],
  ["claude", "../adapter-claude.mjs"],
  ["cursorrules", "../adapter-cursorrules.mjs"],
  ["windsurfrules", "../adapter-windsurfrules.mjs"],
  ["antigravity", "../adapter-antigravity.mjs"],
  ["zedrules", "../adapter-zedrules.mjs"],
  ["aisha-agent", "../adapter-aisha-agent.mjs"],
  ["codex-skill", "../adapter-codex-skill.mjs"],
];

function expectRuntimeContract(content, label) {
  expect(content, `${label}: missing runtime contract heading`).toContain("AISHA Runtime Contract");
  expect(content, `${label}: missing gateway contract`).toContain("/functions/v1/*");
  expect(content, `${label}: missing shared API client contract`).toContain("@aisha/api-core");
  expect(content, `${label}: missing local bring-up contract`).toContain("npm run stack:bringup");
  expect(content, `${label}: missing plugin broker secret contract`).toContain("BROKER_TOKEN_SECRET");
  expect(content, `${label}: missing dynamic function route contract`).toContain("ROUTE_TABLE");
}

describe("IDE adapter runtime contract", () => {
  test.each(singleFileAdapters)("%s output includes the shared runtime contract", async (id, modulePath) => {
    const adapter = await import(modulePath);
    const content = await adapter.generate(payload);
    expectRuntimeContract(content, id);
  });

  test("claude-app skill and agent include the shared runtime contract", async () => {
    const { generate } = await import("../adapter-claude-app.mjs");
    const out = await generate(payload);
    const byPath = new Map(out.files.map((file) => [file.path, file.content]));

    expectRuntimeContract(
      byPath.get("extensions/aisha-dirigent-claude/skills/aisha-dirigent/SKILL.md") ?? "",
      "claude-app skill",
    );
    expectRuntimeContract(
      byPath.get("extensions/aisha-dirigent-claude/agents/aisha-dirigent.md") ?? "",
      "claude-app agent",
    );
  });

  test("claude-overlay advisor and supervisor skill include the shared runtime contract", async () => {
    const { generate } = await import("../adapter-claude-overlay.mjs");
    const out = await generate(payload);
    const byPath = new Map(out.files.map((file) => [file.path, file.content]));

    expectRuntimeContract(
      byPath.get(".claude/agents/aisha-advisor.md") ?? "",
      "claude-overlay advisor",
    );
    expectRuntimeContract(
      byPath.get(".claude/skills/aisha-supervisor/SKILL.md") ?? "",
      "claude-overlay supervisor skill",
    );
  });
});
