/**
 * Tests for config-writer.ts — direction inference, rules fetching, file writes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ──

vi.mock("../src/mcp-client", () => ({
  callMcpTool: vi.fn().mockResolvedValue(null),
  extractMarkdown: vi.fn().mockReturnValue(null),
}));

vi.mock("../src/story-context", () => ({
  resolveStoryContext: vi.fn().mockResolvedValue({ storyId: null }),
}));

// Track files written via vscode.workspace.fs.writeFile
const writtenFiles: Array<{ path: string; content: string }> = [];

/**
 * Re-import config-writer module to get clean state per test.
 * Module-level state (recentSaves, currentDirection) is reset on re-import.
 */
async function loadConfigWriter() {
  vi.resetModules();

  // Set workspace folders on vscode mock before importing
  const vscode = await import("vscode");
  (vscode.workspace as Record<string, unknown>).workspaceFolders = [
    { uri: { fsPath: "/test/workspace" } },
  ];

  // Capture writeFile calls
  writtenFiles.length = 0;
  (vscode.workspace.fs as Record<string, unknown>).writeFile = vi.fn(
    async (uri: { fsPath: string }, content: Uint8Array) => {
      writtenFiles.push({
        path: uri.fsPath,
        content: new TextDecoder().decode(content),
      });
    },
  );

  // Ensure mcp-client mock returns null (fallback path)
  const mcpClient = await import("../src/mcp-client");
  vi.mocked(mcpClient.callMcpTool).mockResolvedValue(null);
  vi.mocked(mcpClient.extractMarkdown).mockReturnValue(null);

  // Ensure story-context mock returns { storyId: null }
  const storyCtx = await import("../src/story-context");
  vi.mocked(storyCtx.resolveStoryContext).mockResolvedValue(
    { storyId: null } as Awaited<ReturnType<typeof storyCtx.resolveStoryContext>>,
  );

  return await import("../src/config-writer");
}

describe("config-writer.ts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ──────────────────────────────────────────
  // Direction Inference
  // ──────────────────────────────────────────

  describe("recordFileSave + getDirection", () => {
    it("starts with 'general' domain and empty roles", async () => {
      const { getDirection } = await loadConfigWriter();
      const dir = getDirection();
      expect(dir.domain).toBe("general");
      expect(dir.activeRoles).toEqual([]);
    });

    it("infers 'backend' domain from hook saves", async () => {
      const { recordFileSave, getDirection } = await loadConfigWriter();
      recordFileSave("src/hooks/useMyFeature.ts", "hook");
      const dir = getDirection();
      expect(dir.domain).toBe("backend");
      expect(dir.activeRoles).toContain("hook");
      expect(dir.activeFiles).toContain("src/hooks/useMyFeature.ts");
    });

    it("infers 'database' domain from migration saves", async () => {
      const { recordFileSave, getDirection } = await loadConfigWriter();
      recordFileSave("aisha/db/migrations/001.sql", "migration");
      expect(getDirection().domain).toBe("database");
    });

    it("infers 'frontend' domain from component saves", async () => {
      const { recordFileSave, getDirection } = await loadConfigWriter();
      recordFileSave("src/components/MyBtn.tsx", "component");
      expect(getDirection().domain).toBe("frontend");
    });

    it("infers 'testing' domain from test saves", async () => {
      const { recordFileSave, getDirection } = await loadConfigWriter();
      recordFileSave("src/tests/hooks/useFoo.test.ts", "test");
      expect(getDirection().domain).toBe("testing");
    });

    it("infers 'i18n' domain from i18n saves", async () => {
      const { recordFileSave, getDirection } = await loadConfigWriter();
      recordFileSave("src/i18n/segments/en/core.json", "i18n");
      expect(getDirection().domain).toBe("i18n");
    });

    it("infers 'devops' domain from edge function saves", async () => {
      const { recordFileSave, getDirection } = await loadConfigWriter();
      recordFileSave("AISHA/functions/my-fn/index.ts", "edge_function");
      expect(getDirection().domain).toBe("devops");
    });

    it("returns direction change = true on first non-general save", async () => {
      const { recordFileSave } = await loadConfigWriter();
      const changed = recordFileSave("src/hooks/useFoo.ts", "hook");
      expect(changed).toBe(true);
    });

    it("returns direction change = false on same-domain save", async () => {
      const { recordFileSave } = await loadConfigWriter();
      recordFileSave("src/hooks/useFoo.ts", "hook");
      const changed = recordFileSave("src/hooks/useBar.ts", "hook");
      expect(changed).toBe(false);
    });

    it("returns direction change = true when switching domains", async () => {
      const { recordFileSave } = await loadConfigWriter();
      recordFileSave("src/hooks/useFoo.ts", "hook");
      const changed = recordFileSave("aisha/db/migrations/001.sql", "migration");
      expect(changed).toBe(true);
    });

    it("tracks up to MAX_TRACKED_FILES (10) recent saves", async () => {
      const { recordFileSave, getDirection } = await loadConfigWriter();
      // Save 15 files
      for (let i = 0; i < 15; i++) {
        recordFileSave(`src/hooks/use${i}.ts`, "hook");
      }
      // Only 10 files tracked
      expect(getDirection().activeFiles.length).toBeLessThanOrEqual(10);
    });

    it("database domain takes priority over backend when mixed", async () => {
      const { recordFileSave, getDirection } = await loadConfigWriter();
      recordFileSave("src/hooks/useFoo.ts", "hook");
      recordFileSave("aisha/db/migrations/001.sql", "migration");
      // migration is most recent, and database > backend in priority
      expect(getDirection().domain).toBe("database");
    });
  });

  // ──────────────────────────────────────────
  // getActiveRulesForRole (fallback rules)
  // ──────────────────────────────────────────

  describe("getActiveRulesForRole", () => {
    it("returns universal baseline rules for any role", async () => {
      const { getActiveRulesForRole } = await loadConfigWriter();
      const rules = getActiveRulesForRole("hook");
      expect(rules.length).toBeGreaterThan(0);
      // Universal baseline includes code_quality, testing, security, architecture, git_workflow
      expect(rules.some((r: string) => r.includes("No Regressions"))).toBe(true);
    });

    it("includes security baseline rules", async () => {
      const { getActiveRulesForRole } = await loadConfigWriter();
      const rules = getActiveRulesForRole("component");
      expect(rules.some((r: string) => r.includes("No Secrets"))).toBe(true);
    });

    it("includes input validation baseline for schema role", async () => {
      const { getActiveRulesForRole } = await loadConfigWriter();
      const rules = getActiveRulesForRole("schema");
      expect(rules.some((r: string) => r.includes("Validate All Input"))).toBe(true);
    });

    it("includes architecture baseline for migration role", async () => {
      const { getActiveRulesForRole } = await loadConfigWriter();
      const rules = getActiveRulesForRole("migration");
      expect(rules.some((r: string) => r.includes("SOLID"))).toBe(true);
    });

    it("includes testing baseline for test role", async () => {
      const { getActiveRulesForRole } = await loadConfigWriter();
      const rules = getActiveRulesForRole("test");
      expect(rules.some((r: string) => r.includes("Test All New Code"))).toBe(true);
    });

    it("returns same baseline for unknown role", async () => {
      const { getActiveRulesForRole } = await loadConfigWriter();
      const rules = getActiveRulesForRole("other");
      expect(rules.length).toBeGreaterThan(0);
      expect(rules.some((r: string) => r.includes("Least Privilege"))).toBe(true);
    });
  });

  // ──────────────────────────────────────────
  // forceConfigRefresh
  // ──────────────────────────────────────────

  describe("forceConfigRefresh", () => {
    it("writes active-rules.json on forced refresh", async () => {
      const { forceConfigRefresh, recordFileSave } = await loadConfigWriter();

      // Set up a direction so rules are non-trivial
      recordFileSave("src/hooks/useFoo.ts", "hook");

      await forceConfigRefresh("manual");

      const rulesFile = writtenFiles.find((f) => f.path.endsWith("active-rules.json"));
      expect(rulesFile).toBeDefined();

      const parsed = JSON.parse(rulesFile!.content);
      expect(parsed.version).toBe("1.0");
      expect(parsed.direction.domain).toBe("backend");
      expect(parsed.source).toBe("fallback"); // MCP is mocked to return null
    });

    it("writes prompt-template.md for non-general domain", async () => {
      const { forceConfigRefresh, recordFileSave } = await loadConfigWriter();
      recordFileSave("aisha/db/migrations/001.sql", "migration");

      await forceConfigRefresh("manual");

      const templateFile = writtenFiles.find((f) => f.path.endsWith("prompt-template.md"));
      expect(templateFile).toBeDefined();
      expect(templateFile!.content).toContain("AISHA");
      expect(templateFile!.content).toContain("database");
    });

    it("skips prompt-template.md for general domain", async () => {
      const { forceConfigRefresh } = await loadConfigWriter();
      // No saves → general domain

      await forceConfigRefresh("manual");

      const templateFile = writtenFiles.find((f) => f.path.endsWith("prompt-template.md"));
      expect(templateFile).toBeUndefined();
    });

    it("includes story ID in active-rules when available", async () => {
      const mod = await loadConfigWriter();
      mod.recordFileSave("src/hooks/useFoo.ts", "hook");

      // Override story-context mock for this test
      const storyCtx = await import("../src/story-context");
      vi.mocked(storyCtx.resolveStoryContext).mockResolvedValue(
        { storyId: "test-story-123" } as Awaited<ReturnType<typeof storyCtx.resolveStoryContext>>,
      );

      await mod.forceConfigRefresh("manual");

      const rulesFile = writtenFiles.find((f) => f.path.endsWith("active-rules.json"));
      expect(rulesFile).toBeDefined();
      const parsed = JSON.parse(rulesFile!.content);
      expect(parsed.storyId).toBe("test-story-123");
    });

    it("avoids redundant writes (fingerprint check)", async () => {
      const { forceConfigRefresh, recordFileSave } = await loadConfigWriter();
      recordFileSave("src/hooks/useFoo.ts", "hook");

      await forceConfigRefresh("manual");
      const firstCount = writtenFiles.filter((f) => f.path.endsWith("active-rules.json")).length;

      // Force again — same direction, same rules → should skip
      await forceConfigRefresh("manual");
      const secondCount = writtenFiles.filter((f) => f.path.endsWith("active-rules.json")).length;

      expect(secondCount).toBe(firstCount); // No additional write
    });
  });

  // ──────────────────────────────────────────
  // scheduleConfigRefresh (debouncing)
  // ──────────────────────────────────────────

  describe("scheduleConfigRefresh", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("debounces rapid calls", async () => {
      const { scheduleConfigRefresh, recordFileSave } = await loadConfigWriter();
      recordFileSave("src/hooks/useFoo.ts", "hook");

      // Schedule multiple times rapidly
      scheduleConfigRefresh("save");
      scheduleConfigRefresh("save");
      scheduleConfigRefresh("save");

      // No writes yet (within debounce window)
      expect(writtenFiles.length).toBe(0);
    });
  });

  // ──────────────────────────────────────────
  // onConfigUpdate event
  // ──────────────────────────────────────────

  describe("onConfigUpdate event", () => {
    it("fires event when config file is written", async () => {
      const { forceConfigRefresh, recordFileSave, onConfigUpdate } = await loadConfigWriter();
      recordFileSave("src/hooks/useFoo.ts", "hook");

      const events: Array<{ file: string; trigger: string }> = [];
      const disposable = onConfigUpdate((e) => {
        events.push({ file: e.file, trigger: e.trigger });
      });

      await forceConfigRefresh("manual");

      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events.some((e) => e.file === "active-rules")).toBe(true);

      disposable.dispose();
    });
  });

  // ──────────────────────────────────────────
  // Prompt template content
  // ──────────────────────────────────────────

  describe("prompt template content", () => {
    it("includes direction context for backend domain", async () => {
      const { forceConfigRefresh, recordFileSave } = await loadConfigWriter();
      recordFileSave("src/hooks/useFoo.ts", "hook");

      await forceConfigRefresh("manual");

      const template = writtenFiles.find((f) => f.path.endsWith("prompt-template.md"));
      expect(template).toBeDefined();
      expect(template!.content).toContain("backend");
      expect(template!.content).toContain("hook");
    });

    it("includes direction context for database domain", async () => {
      const { forceConfigRefresh, recordFileSave } = await loadConfigWriter();
      recordFileSave("aisha/db/migrations/001.sql", "migration");

      await forceConfigRefresh("manual");

      const template = writtenFiles.find((f) => f.path.endsWith("prompt-template.md"));
      expect(template).toBeDefined();
      expect(template!.content).toContain("database");
      expect(template!.content).toContain("migration");
    });

    it("includes baseline rules in testing template", async () => {
      const { forceConfigRefresh, recordFileSave } = await loadConfigWriter();
      recordFileSave("src/tests/hooks/useFoo.test.ts", "test");

      await forceConfigRefresh("manual");

      const template = writtenFiles.find((f) => f.path.endsWith("prompt-template.md"));
      expect(template).toBeDefined();
      expect(template!.content).toContain("testing");
    });

    it("includes baseline rules in i18n template", async () => {
      const { forceConfigRefresh, recordFileSave } = await loadConfigWriter();
      recordFileSave("src/i18n/segments/en/core.json", "i18n");

      await forceConfigRefresh("manual");

      const template = writtenFiles.find((f) => f.path.endsWith("prompt-template.md"));
      expect(template).toBeDefined();
      expect(template!.content).toContain("i18n");
    });
  });

  // ──────────────────────────────────────────
  // readActiveRulesConfig
  // ──────────────────────────────────────────

  describe("readActiveRulesConfig", () => {
    it("returns null when file does not exist", async () => {
      vi.resetModules();
      const vscode = await import("vscode");
      (vscode.workspace as Record<string, unknown>).workspaceFolders = [
        { uri: { fsPath: "/test/workspace" } },
      ];
      // readFile throws (file doesn't exist)
      (vscode.workspace.fs as Record<string, unknown>).readFile = vi.fn().mockRejectedValue(
        new Error("not found"),
      );

      const { readActiveRulesConfig } = await import("../src/config-writer");
      const config = await readActiveRulesConfig();
      expect(config).toBeNull();
    });

    it("parses valid JSON from disk", async () => {
      vi.resetModules();
      const vscode = await import("vscode");
      (vscode.workspace as Record<string, unknown>).workspaceFolders = [
        { uri: { fsPath: "/test/workspace" } },
      ];

      const mockConfig = {
        version: "1.0",
        updatedAt: "2026-03-31T00:00:00Z",
        storyId: null,
        direction: { activeRoles: ["hook"], activeFiles: [], domain: "backend", lastActivityAt: "" },
        rules: { api_design: ["RPC-only"] },
        activeTemplate: "backend",
        source: "fallback",
      };

      (vscode.workspace.fs as Record<string, unknown>).readFile = vi.fn().mockResolvedValue(
        new TextEncoder().encode(JSON.stringify(mockConfig)),
      );

      const { readActiveRulesConfig } = await import("../src/config-writer");
      const config = await readActiveRulesConfig();
      expect(config).toEqual(mockConfig);
    });
  });
});
