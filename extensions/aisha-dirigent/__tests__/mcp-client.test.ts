/**
 * Tests for mcp-client.ts — MCP JSON-RPC transport and n8n agent delegation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vscode from "vscode";
import { getDirigentConfig } from "../src/config";
import type { DirigentConfig } from "../src/config";

// Mock config
vi.mock("../src/config", () => ({
  getDirigentConfig: vi.fn(() => ({
    aishaUrl: "http://127.0.0.1:57421",
    anonKey: "test-anon",
    mcpUrl: "http://127.0.0.1:57421/functions/v1/mcp-knowledge-server",
    n8nTriggerUrl: "http://127.0.0.1:57421/admin/n8n-trigger",
    storyId: "",
    expertiseLevel: "intermediate",
    instanceLabel: "",
    activeProfile: "local",
    profiles: {},
  })),
}));

vi.mock("../src/auth", () => ({
  getAuthState: vi.fn(() => ({
    isAuthenticated: true,
    accessToken: "test-user-token",
    refreshToken: "test-refresh-token",
    expiresAt: Date.now() + 60_000,
    userId: "user-1",
    email: "user@example.test",
  })),
  isTokenExpiringSoon: vi.fn(() => false),
  silentRefresh: vi.fn(() => Promise.resolve(true)),
}));

// Mock resource-tracker
vi.mock("../src/resource-tracker", () => ({
  recordApiCall: vi.fn().mockReturnValue({
    provider: "mcp",
    durationMs: 100,
    responseBytes: 200,
    isError: false,
  }),
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { callMcpTool, callN8nAgent, extractMarkdown, extractJson } from "../src/mcp-client";

/** Helper to override config for specific tests. */
function setConfig(overrides: Partial<ReturnType<typeof getDirigentConfig>>) {
  vi.mocked(getDirigentConfig).mockReturnValue({
    aishaUrl: "http://127.0.0.1:57421",
    anonKey: "test-anon",
    mcpUrl: "http://127.0.0.1:57421/functions/v1/mcp-knowledge-server",
    n8nTriggerUrl: "http://127.0.0.1:57421/admin/n8n-trigger",
    storyId: "",
    expertiseLevel: "intermediate",
    instanceLabel: "",
    activeProfile: "local",
    profiles: {},
    dashboardUrl: "",
    llm: { activePreset: "", presets: {}, preferLocalForEval: false },
    ...overrides,
  } as DirigentConfig);
}

describe("mcp-client.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    // Restore default config (overridden by setConfig in individual tests)
    setConfig({});
  });

  describe("callMcpTool", () => {
    it("returns null and shows warning when MCP URL is empty", async () => {
      setConfig({ mcpUrl: "", anonKey: "" });
      const showWarningSpy = vi.spyOn(vscode.window, "showWarningMessage");

      const result = await callMcpTool("search_knowledge", { query: "test" });

      expect(result).toBeNull();
      expect(showWarningSpy).toHaveBeenCalled();
    });

    it("returns MCP response on successful call", async () => {
      const mcpResponse = {
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [{ type: "text", text: "## Results\nFound 3 items" }],
          isError: false,
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mcpResponse,
      });

      const result = await callMcpTool("search_knowledge", { query: "test" });

      expect(result).not.toBeNull();
      expect(result!.content).toHaveLength(1);
      expect(result!.content[0].text).toContain("Found 3 items");
    });

    it("shows generic error on HTTP 500 after retries", async () => {
      const showErrorSpy = vi.spyOn(vscode.window, "showErrorMessage");

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error: connection pool exhausted at db://prod-db:5432/main",
      });

      const result = await callMcpTool("search_knowledge", { query: "test" });

      expect(result).toBeNull();
      expect(showErrorSpy).toHaveBeenCalled();
      const errorMsg = showErrorSpy.mock.calls[0]?.[0] as string;
      expect(errorMsg).not.toContain("connection pool");
      expect(errorMsg).not.toContain("prod-db");
    });

    it("shows generic error on JSON-RPC error response", async () => {
      const showErrorSpy = vi.spyOn(vscode.window, "showErrorMessage");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32603, message: "relation \"secret_table\" does not exist" },
        }),
      });

      const result = await callMcpTool("search_knowledge", { query: "test" });

      expect(result).toBeNull();
      expect(showErrorSpy).toHaveBeenCalled();
      const errorMsg = showErrorSpy.mock.calls[0]?.[0] as string;
      expect(errorMsg).not.toContain("secret_table");
    });

    it("shows generic error on network failure after retries", async () => {
      const showErrorSpy = vi.spyOn(vscode.window, "showErrorMessage");

      mockFetch.mockRejectedValue(new Error("getaddrinfo ENOTFOUND internal-mcp.cluster.local"));

      const result = await callMcpTool("search_knowledge", { query: "test" });

      expect(result).toBeNull();
      expect(showErrorSpy).toHaveBeenCalled();
      const errorMsg = showErrorSpy.mock.calls[0]?.[0] as string;
      expect(errorMsg).not.toContain("internal-mcp.cluster.local");
    });
  });

  describe("callN8nAgent", () => {
    it("returns null and shows warning when trigger URL is empty", async () => {
      setConfig({ n8nTriggerUrl: "" });
      const showWarningSpy = vi.spyOn(vscode.window, "showWarningMessage");

      const result = await callN8nAgent("dirigent-agent", { task: "test" });

      expect(result).toBeNull();
      expect(showWarningSpy).toHaveBeenCalled();
    });

    it("returns success response from n8n agent", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          workflow: "dirigent-agent",
          n8n_status: "success",
          n8n_response: {
            success: true,
            response: "Analysis complete. Found 2 issues.",
            provider: "openai",
            model: "gpt-4",
          },
        }),
      });

      const result = await callN8nAgent("dirigent-agent", { task: "review" });

      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
      expect(result!.response).toContain("Analysis complete");
      expect(result!.model).toBe("gpt-4");
    });

    it("shows generic error on unavailable n8n agent", async () => {
      const showErrorSpy = vi.spyOn(vscode.window, "showErrorMessage");

      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        text: async () => "Bad Gateway: upstream n8n worker at http://n8n-internal:5678 is down",
      });

      const result = await callN8nAgent("dirigent-agent", { task: "test" });

      expect(result).not.toBeNull();
      expect(result!.success).toBe(false);
      expect(showErrorSpy).toHaveBeenCalled();
      const errorMsg = showErrorSpy.mock.calls[0]?.[0] as string;
      expect(errorMsg).not.toContain("n8n-internal");
    });

    it("shows generic error on network failure", async () => {
      const showErrorSpy = vi.spyOn(vscode.window, "showErrorMessage");

      mockFetch.mockRejectedValue(new Error("connect ECONNREFUSED 192.0.2.42:5678"));

      const result = await callN8nAgent("dirigent-agent", { task: "test" });

      expect(result).not.toBeNull();
      expect(result!.success).toBe(false);
      expect(showErrorSpy).toHaveBeenCalled();
      const errorMsg = showErrorSpy.mock.calls[0]?.[0] as string;
      expect(errorMsg).not.toContain("192.0.2.42");
    });
  });

  describe("extractMarkdown", () => {
    it("returns empty string for null response", () => {
      expect(extractMarkdown(null)).toBe("");
    });

    it("concatenates text content items", () => {
      const result = extractMarkdown({
        content: [
          { type: "text", text: "## Title" },
          { type: "text", text: "Body content" },
        ],
      });
      expect(result).toBe("## Title\n\nBody content");
    });

    it("skips resource content items", () => {
      const result = extractMarkdown({
        content: [
          { type: "text", text: "Hello" },
          { type: "resource", resource: { uri: "file:///a.json", text: '{"x":1}', mimeType: "application/json" } },
        ],
      });
      expect(result).toBe("Hello");
    });
  });

  describe("extractJson", () => {
    it("returns null for null response", () => {
      expect(extractJson(null)).toBeNull();
    });

    it("parses JSON from resource content", () => {
      const result = extractJson({
        content: [
          { type: "resource", resource: { uri: "res:///data", text: '{"score": 85}', mimeType: "application/json" } },
        ],
      });
      expect(result).toEqual({ score: 85 });
    });

    it("parses JSON from text content starting with {", () => {
      const result = extractJson({
        content: [
          { type: "text", text: '{"status": "ok", "count": 3}' },
        ],
      });
      expect(result).toEqual({ status: "ok", count: 3 });
    });

    it("returns null for non-JSON text content", () => {
      const result = extractJson({
        content: [
          { type: "text", text: "## Just Markdown" },
        ],
      });
      expect(result).toBeNull();
    });
  });
});
