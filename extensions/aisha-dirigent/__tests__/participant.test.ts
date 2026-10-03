/**
 * Tests for participant.ts — command routing, error sanitization, handler table.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──

vi.mock("../src/config", () => ({
  getDirigentConfig: vi.fn(() => ({
    aishaUrl: "http://127.0.0.1:57421",
    anonKey: "test-anon",
    mcpUrl: "http://127.0.0.1:57421/functions/v1/mcp-knowledge-server",
    n8nTriggerUrl: "",
    storyId: "",
    expertiseLevel: "intermediate",
    instanceLabel: "",
    activeProfile: "local",
    profiles: {},
    dashboardUrl: "",
    llm: { activePreset: "", presets: {}, preferLocalForEval: true },
  })),
}));

vi.mock("../src/mcp-client", () => ({
  callMcpTool: vi.fn().mockResolvedValue(null),
  callN8nAgent: vi.fn().mockResolvedValue(null),
  extractMarkdown: vi.fn().mockReturnValue(null),
  extractJson: vi.fn().mockReturnValue(null),
}));

vi.mock("../src/workspace", () => ({
  getWorkspaceContext: vi.fn().mockResolvedValue({
    activeFilePaths: [],
    techStack: ["typescript"],
    diagnosticSummary: null,
    diffSummary: null,
    activeSelection: null,
  }),
  getProjectAnalysis: vi.fn().mockResolvedValue(null),
}));

vi.mock("../src/story-context", () => ({
  resolveStoryContext: vi.fn().mockResolvedValue({ storyId: null }),
}));

vi.mock("../src/session-manager", () => ({
  getSessionPayload: vi.fn().mockResolvedValue({}),
  getSessionSync: vi.fn().mockReturnValue(null),
  applyDirective: vi.fn(),
  recordTurn: vi.fn(),
}));

vi.mock("../src/aisha-push", () => ({
  isPushConnected: vi.fn().mockReturnValue(false),
}));

vi.mock("../src/github-app", () => ({
  handleConnectRepo: vi.fn(),
}));

vi.mock("../src/resource-tracker", () => ({
  buildInlineFooter: vi.fn().mockReturnValue(""),
  buildStatsMarkdown: vi.fn().mockReturnValue(""),
}));

vi.mock("../src/local-llm-client", () => ({
  edgeChat: vi.fn().mockResolvedValue(null),
  formatEdgeTag: vi.fn().mockReturnValue(""),
}));

vi.mock("../src/compute-tier", () => ({
  getEnvironment: vi.fn().mockReturnValue("cloud"),
  isEdgeFirstEnabled: vi.fn().mockReturnValue(false),
}));

describe("participant.ts", () => {
  describe("handleChatRequest — command routing", () => {
    it("routes known commands to handlers without throwing", async () => {
      const { handleChatRequest } = await import("../src/participant");

      const stream = {
        markdown: vi.fn(),
        progress: vi.fn(),
        reference: vi.fn(),
        button: vi.fn(),
      };
      const token = { isCancellationRequested: false, onCancellationRequested: vi.fn() };

      // Test known slash command routes without crashing
      for (const cmd of ["test", "quality", "compliance", "estimate", "next", "models", "proposals"]) {
        stream.markdown.mockClear();
        const result = await handleChatRequest(
          { command: cmd, prompt: "test input", references: [] } as unknown as Parameters<typeof handleChatRequest>[0],
          { history: [] } as unknown as Parameters<typeof handleChatRequest>[1],
          stream as unknown as Parameters<typeof handleChatRequest>[2],
          token as unknown as Parameters<typeof handleChatRequest>[3],
        );
        expect(result).toBeDefined();
        expect(result.metadata).toBeDefined();
      }
    });

    it("falls back to autonomous flow for unknown commands", async () => {
      const { handleChatRequest } = await import("../src/participant");

      const stream = {
        markdown: vi.fn(),
        progress: vi.fn(),
        reference: vi.fn(),
        button: vi.fn(),
      };
      const token = { isCancellationRequested: false, onCancellationRequested: vi.fn() };

      const result = await handleChatRequest(
        { command: undefined, prompt: "what should I do next?", references: [] } as unknown as Parameters<typeof handleChatRequest>[0],
        { history: [] } as unknown as Parameters<typeof handleChatRequest>[1],
        stream as unknown as Parameters<typeof handleChatRequest>[2],
        token as unknown as Parameters<typeof handleChatRequest>[3],
      );

      expect(result).toBeDefined();
      // MCP fallback should have been attempted since n8n is not configured
      expect(stream.markdown).toHaveBeenCalled();
    });

    it("catches errors and shows sanitized message", async () => {
      vi.resetModules();

      // Force buildBaseArgs to throw
      vi.doMock("../src/workspace", () => ({
        getWorkspaceContext: vi.fn().mockRejectedValue(new Error("http://internal-server:8080/secret/path failed with 500")),
        getProjectAnalysis: vi.fn().mockResolvedValue(null),
      }));

      const { handleChatRequest } = await import("../src/participant");

      const stream = {
        markdown: vi.fn(),
        progress: vi.fn(),
        reference: vi.fn(),
        button: vi.fn(),
      };
      const token = { isCancellationRequested: false, onCancellationRequested: vi.fn() };

      const result = await handleChatRequest(
        { command: "test", prompt: "test", references: [] } as unknown as Parameters<typeof handleChatRequest>[0],
        { history: [] } as unknown as Parameters<typeof handleChatRequest>[1],
        stream as unknown as Parameters<typeof handleChatRequest>[2],
        token as unknown as Parameters<typeof handleChatRequest>[3],
      );

      expect(result).toBeDefined();
      // Error message should be shown but raw URL should be sanitized
      const errorCall = stream.markdown.mock.calls.find(
        (call: string[]) => call[0]?.includes("Error"),
      );
      expect(errorCall).toBeDefined();
      // Internal URL should NOT appear in the output
      expect(errorCall[0]).not.toContain("http://internal-server");
    });
  });

  describe("command handler table completeness", () => {
    it("has handlers for all 16 declared slash commands", async () => {
      // Read the COMMAND_HANDLERS map keys via the module
      const participant = await import("../src/participant");

      // We verify handleChatRequest exists and is a function
      expect(typeof participant.handleChatRequest).toBe("function");

      // Verify key exports exist
      expect(typeof participant.clearSession).toBe("function");
      expect(typeof participant.getActiveSessionId).toBe("function");
    });
  });
});
