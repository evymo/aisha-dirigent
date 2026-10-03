/**
 * Unit tests for the capability-catalog scanner/renderer.
 * Deterministic: builds a fixture repo in a temp dir, no network, no real repo.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  coresEqual,
  renderJson,
  renderMarkdown,
  scanCapabilities,
} from "./capability-catalog.mjs";

let root;

function write(rel, content) {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "cap-catalog-"));

  write(
    "package.json",
    JSON.stringify({
      name: "fixture",
      workspaces: ["packages/*", "services/*"],
      scripts: { dev: "vite", build: "vite build", "test:run": "vitest", "gen:ide": "node x", "deploy:init": "node y" },
    }),
  );

  write("services/svc-foo/package.json", JSON.stringify({ name: "@aisha/svc-foo", version: "0.1.0", description: "Foo service." }));
  write("Dockerfile.svc-foo", "FROM node:22\n");
  write("services/svc-mcp-knowledge/package.json", JSON.stringify({ name: "@aisha/svc-mcp-knowledge", version: "0.1.0" }));
  write(
    "services/svc-mcp-knowledge/src/routes/mcp.ts",
    [
      "const TOOLS = [",
      "  tool('search_knowledge', 'Search expert rules.'),",
      "  tool('get_expert_rule', 'Load one rule by slug.'),",
      "];",
      "function tool(name: string, description: string) { return { name, description }; }",
    ].join("\n"),
  );

  write("packages/pkg-bar/package.json", JSON.stringify({ name: "@aisha/pkg-bar", version: "1.2.3", description: "Bar package." }));

  write(
    "plugins/myplugin/manifest.json",
    JSON.stringify({ id: "myplugin", version: "0.1.0", name: "My Plugin", description: "Does things.", kind: "full_stack", trust_tier: "internal", capabilities: ["http.GET./x", "cron.daily"] }),
  );

  write("domains/templates/site-a/manifest.json", JSON.stringify({ name: "Site A", description: "A template." }));

  write(".claude/commands/aisha-x.md", "# AISHA X Command\n\n> auto note\n\nDoes the X thing for the platform.\n");
  write(".claude/skills/aisha-y/SKILL.md", "---\nname: aisha-y\ndescription: Does the Y thing.\n---\n\n# Y\n");

  write("n8n/workflows/WF_TEST.json", JSON.stringify({ name: "WF_TEST workflow", nodes: [{}, {}] }));

  write("aisha/db/sql/tables/foo_catalog.sql", "create table foo_catalog ();");
  write("aisha/db/sql/tables/bar_registry.sql", "create table bar_registry ();");
  write("aisha/db/sql/tables/unrelated.sql", "create table unrelated ();");
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("scanCapabilities", () => {
  it("counts each category from the git working tree", () => {
    const core = scanCapabilities(root);
    expect(core.summary).toMatchObject({
      services: 2,
      packages: 1,
      plugins: 1,
      domainTemplates: 1,
      agentCommands: 1,
      agentSkills: 1,
      mcpTools: 2,
      n8nWorkflows: 1,
      dbCatalogs: 2,
      npmScripts: 4,
    });
    expect(core.summary.total).toBe(16);
  });

  it("extracts plugin manifest fields", () => {
    const core = scanCapabilities(root);
    const plugin = core.categories.plugins[0];
    expect(plugin).toMatchObject({ id: "myplugin", kind: "full_stack", trustTier: "internal", capabilityCount: 2 });
  });

  it("parses MCP tool name + description from mcp.ts (ignoring the helper signature)", () => {
    const core = scanCapabilities(root);
    const ids = core.categories.mcpTools.map((t) => t.id);
    expect(ids).toEqual(["get_expert_rule", "search_knowledge"]); // sorted, no 'name'/'description' helper
  });

  it("reads command heading + skill front-matter", () => {
    const core = scanCapabilities(root);
    expect(core.categories.agentCommands[0]).toMatchObject({ id: "aisha-x", name: "AISHA X Command", usage: "/aisha-x" });
    expect(core.categories.agentSkills[0]).toMatchObject({ id: "aisha-y", description: "Does the Y thing." });
  });

  it("is deterministic — two scans are equal", () => {
    expect(coresEqual(scanCapabilities(root), scanCapabilities(root))).toBe(true);
  });

  it("detects drift when a capability is added", () => {
    const before = scanCapabilities(root);
    write("packages/pkg-new/package.json", JSON.stringify({ name: "@aisha/pkg-new", version: "0.0.1" }));
    const after = scanCapabilities(root);
    expect(coresEqual(before, after)).toBe(false);
    expect(after.summary.packages).toBe(2);
  });
});

describe("renderers", () => {
  it("renderJson embeds generatedAt and valid JSON", () => {
    const core = scanCapabilities(root);
    const parsed = JSON.parse(renderJson(core, { generatedAt: "2026-01-01T00:00:00.000Z" }));
    expect(parsed.generatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(parsed.summary.total).toBe(core.summary.total);
  });

  it("renderMarkdown includes the AISHA auto-gen marker and a preserved user-section", () => {
    const md = renderMarkdown(scanCapabilities(root), { generatedAt: "2026-01-01T00:00:00.000Z" });
    expect(md).toContain("Auto-generated from AISHA Expert Overlay ruleset.");
    expect(md).toContain("<!-- aisha:user-section:start -->");
    expect(md).toContain("<!-- aisha:user-section:end -->");
    expect(md).toContain("My Plugin");
  });
});
