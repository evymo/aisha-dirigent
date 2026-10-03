/**
 * Extension MCP Client — Unit tests for pure utilities.
 *
 * Tests extractMarkdown, extractJson, and n8n response unwrapping logic
 * from extensions/aisha-dirigent/src/mcp-client.ts.
 *
 * Uses extracted logic pattern (same as mcp-protocol.test.ts) to avoid
 * vscode module dependency. Parity with source is verified by the
 * extension-architecture gate test.
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types — mirrored from mcp-client.ts
// ---------------------------------------------------------------------------

interface McpContent {
  type: "text" | "resource";
  text?: string;
  resource?: { uri: string; text: string; mimeType: string };
}

interface McpToolResponse {
  content: McpContent[];
  isError?: boolean;
}

interface N8nAgentResponse {
  success: boolean;
  response?: string;
  provider?: string;
  model?: string;
  error?: string;
  directive?: Record<string, unknown>;
  crossSessionMessages?: Array<{
    target_domain: string;
    message: string;
  }>;
}

// ---------------------------------------------------------------------------
// Extracted pure functions — kept in sync via gate test
// ---------------------------------------------------------------------------

/** Extract markdown text from MCP tool response. */
function extractMarkdown(response: McpToolResponse | null): string {
  if (!response) return "";
  const parts: string[] = [];
  for (const content of response.content) {
    if (content.type === "text" && content.text) {
      parts.push(content.text);
    }
  }
  return parts.join("\n\n");
}

/** Extract JSON data from MCP tool response. */
function extractJson(
  response: McpToolResponse | null,
): Record<string, unknown> | null {
  if (!response) return null;
  for (const content of response.content) {
    if (content.type === "resource" && content.resource?.text) {
      try {
        return JSON.parse(content.resource.text) as Record<string, unknown>;
      } catch {
        // Not valid JSON, skip
      }
    }
    // Some tools return JSON as text content
    if (content.type === "text" && content.text?.startsWith("{")) {
      try {
        return JSON.parse(content.text) as Record<string, unknown>;
      } catch {
        // Not valid JSON, skip
      }
    }
  }
  return null;
}

/** Unwrap n8n-trigger proxy response (inner n8n_response). */
function unwrapN8nResponse(json: Record<string, unknown>): N8nAgentResponse {
  if ("n8n_response" in json && json.n8n_response && typeof json.n8n_response === "object") {
    const inner = json.n8n_response as Record<string, unknown>;
    return {
      success: (inner.success ?? json.ok ?? false) as boolean,
      response: (inner.response ?? inner.output ?? inner.text) as string | undefined,
      provider: inner.provider as string | undefined,
      model: inner.model as string | undefined,
      error: inner.error as string | undefined,
      directive: inner.directive as Record<string, unknown> | undefined,
      crossSessionMessages: inner.cross_session_messages as N8nAgentResponse["crossSessionMessages"],
    };
  }

  return {
    success: (json.success ?? json.ok ?? false) as boolean,
    response: (json.response ?? json.output ?? json.text) as string | undefined,
    provider: json.provider as string | undefined,
    model: json.model as string | undefined,
    error: json.error as string | undefined,
    directive: json.directive as Record<string, unknown> | undefined,
    crossSessionMessages: json.cross_session_messages as N8nAgentResponse["crossSessionMessages"],
  };
}

// ---------------------------------------------------------------------------
// Parity check — ensure extracted logic matches source
// ---------------------------------------------------------------------------

describe("Source parity", () => {
  it("extractMarkdown implementation matches mcp-client.ts", () => {
    const sourcePath = path.resolve(
      __dirname,
      "../../../extensions/aisha-dirigent/src/mcp-client.ts",
    );
    const source = fs.readFileSync(sourcePath, "utf-8");

    // Verify the core logic pattern exists in source
    expect(source).toContain('parts.join("\\n\\n")');
    expect(source).toContain('content.type === "text"');
  });

  it("extractJson implementation matches mcp-client.ts", () => {
    const sourcePath = path.resolve(
      __dirname,
      "../../../extensions/aisha-dirigent/src/mcp-client.ts",
    );
    const source = fs.readFileSync(sourcePath, "utf-8");

    expect(source).toContain('content.type === "resource"');
    expect(source).toContain('content.text?.startsWith("{")');
  });

  it("n8n response unwrapping logic matches mcp-client.ts", () => {
    const sourcePath = path.resolve(
      __dirname,
      "../../../extensions/aisha-dirigent/src/mcp-client.ts",
    );
    const source = fs.readFileSync(sourcePath, "utf-8");

    expect(source).toContain('"n8n_response"');
    expect(source).toContain("inner.response ?? inner.output ?? inner.text");
  });
});

// ---------------------------------------------------------------------------
// extractMarkdown tests
// ---------------------------------------------------------------------------

describe("extractMarkdown", () => {
  it("returns empty string for null response", () => {
    expect(extractMarkdown(null)).toBe("");
  });

  it("returns empty string for response with no text content", () => {
    const response: McpToolResponse = {
      content: [
        { type: "resource", resource: { uri: "test", text: "{}", mimeType: "application/json" } },
      ],
    };
    expect(extractMarkdown(response)).toBe("");
  });

  it("extracts single text content", () => {
    const response: McpToolResponse = {
      content: [{ type: "text", text: "# Hello World" }],
    };
    expect(extractMarkdown(response)).toBe("# Hello World");
  });

  it("joins multiple text contents with double newline", () => {
    const response: McpToolResponse = {
      content: [
        { type: "text", text: "Part 1" },
        { type: "text", text: "Part 2" },
        { type: "text", text: "Part 3" },
      ],
    };
    expect(extractMarkdown(response)).toBe("Part 1\n\nPart 2\n\nPart 3");
  });

  it("skips non-text content types", () => {
    const response: McpToolResponse = {
      content: [
        { type: "text", text: "Before" },
        { type: "resource", resource: { uri: "x", text: "data", mimeType: "text/plain" } },
        { type: "text", text: "After" },
      ],
    };
    expect(extractMarkdown(response)).toBe("Before\n\nAfter");
  });

  it("skips text content with undefined text", () => {
    const response: McpToolResponse = {
      content: [
        { type: "text" } as McpContent,
        { type: "text", text: "Valid" },
      ],
    };
    expect(extractMarkdown(response)).toBe("Valid");
  });

  it("handles empty content array", () => {
    const response: McpToolResponse = { content: [] };
    expect(extractMarkdown(response)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// extractJson tests
// ---------------------------------------------------------------------------

describe("extractJson", () => {
  it("returns null for null response", () => {
    expect(extractJson(null)).toBeNull();
  });

  it("extracts JSON from resource content", () => {
    const response: McpToolResponse = {
      content: [
        {
          type: "resource",
          resource: {
            uri: "test://data",
            text: '{"models": [{"name": "gpt-4"}]}',
            mimeType: "application/json",
          },
        },
      ],
    };
    const result = extractJson(response);
    expect(result).toEqual({ models: [{ name: "gpt-4" }] });
  });

  it("extracts JSON from text content starting with {", () => {
    const response: McpToolResponse = {
      content: [
        {
          type: "text",
          text: '{"status": "ok", "count": 42}',
        },
      ],
    };
    const result = extractJson(response);
    expect(result).toEqual({ status: "ok", count: 42 });
  });

  it("prefers resource content over text content", () => {
    const response: McpToolResponse = {
      content: [
        {
          type: "resource",
          resource: {
            uri: "test://",
            text: '{"source": "resource"}',
            mimeType: "application/json",
          },
        },
        {
          type: "text",
          text: '{"source": "text"}',
        },
      ],
    };
    const result = extractJson(response);
    expect(result).toEqual({ source: "resource" });
  });

  it("skips invalid JSON in resource and falls through", () => {
    const response: McpToolResponse = {
      content: [
        {
          type: "resource",
          resource: {
            uri: "test://",
            text: "not-json",
            mimeType: "application/json",
          },
        },
        {
          type: "text",
          text: '{"fallback": true}',
        },
      ],
    };
    const result = extractJson(response);
    expect(result).toEqual({ fallback: true });
  });

  it("ignores text content not starting with {", () => {
    const response: McpToolResponse = {
      content: [
        { type: "text", text: "Just plain markdown text" },
      ],
    };
    expect(extractJson(response)).toBeNull();
  });

  it("returns null for empty content array", () => {
    const response: McpToolResponse = { content: [] };
    expect(extractJson(response)).toBeNull();
  });

  it("handles nested JSON structures", () => {
    const nested = {
      data: {
        items: [{ id: 1, nested: { deep: true } }],
        metadata: { page: 1 },
      },
    };
    const response: McpToolResponse = {
      content: [
        {
          type: "text",
          text: JSON.stringify(nested),
        },
      ],
    };
    expect(extractJson(response)).toEqual(nested);
  });
});

// ---------------------------------------------------------------------------
// N8n response unwrapping tests
// ---------------------------------------------------------------------------

describe("unwrapN8nResponse", () => {
  it("unwraps n8n_response wrapper (proxy format)", () => {
    const json = {
      ok: true,
      workflow: "dirigent-agent",
      n8n_response: {
        success: true,
        response: "Hello from Aisha",
        provider: "openai",
        model: "gpt-4",
      },
    };

    const result = unwrapN8nResponse(json);
    expect(result.success).toBe(true);
    expect(result.response).toBe("Hello from Aisha");
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4");
  });

  it("falls back to direct response format when no n8n_response", () => {
    const json = {
      success: true,
      response: "Direct response",
      provider: "google",
      model: "gemini-pro",
    };

    const result = unwrapN8nResponse(json);
    expect(result.success).toBe(true);
    expect(result.response).toBe("Direct response");
    expect(result.provider).toBe("google");
  });

  it("extracts directive from inner response", () => {
    const json = {
      ok: true,
      n8n_response: {
        success: true,
        response: "Done",
        directive: {
          domain: "testing",
          current_task: "Write unit tests",
        },
      },
    };

    const result = unwrapN8nResponse(json);
    expect(result.directive).toEqual({
      domain: "testing",
      current_task: "Write unit tests",
    });
  });

  it("extracts cross-session messages", () => {
    const json = {
      ok: true,
      n8n_response: {
        success: true,
        response: "Task assigned",
        cross_session_messages: [
          { target_domain: "frontend", message: "New API endpoint ready" },
        ],
      },
    };

    const result = unwrapN8nResponse(json);
    expect(result.crossSessionMessages).toHaveLength(1);
    expect(result.crossSessionMessages![0].target_domain).toBe("frontend");
  });

  it("handles output field as response fallback", () => {
    const json = {
      ok: true,
      n8n_response: {
        success: true,
        output: "Output-based response",
      },
    };

    const result = unwrapN8nResponse(json);
    expect(result.response).toBe("Output-based response");
  });

  it("handles text field as response fallback", () => {
    const json = {
      success: true,
      text: "Text-based response",
    };

    const result = unwrapN8nResponse(json);
    expect(result.response).toBe("Text-based response");
  });

  it("uses ok field as success fallback", () => {
    const json = {
      ok: true,
      n8n_response: {
        output: "Done",
      },
    };

    const result = unwrapN8nResponse(json);
    expect(result.success).toBe(true);
  });

  it("defaults success to false when missing", () => {
    const json = {
      n8n_response: {
        response: "Partial result",
      },
    };

    const result = unwrapN8nResponse(json);
    expect(result.success).toBe(false);
  });

  it("handles error in response", () => {
    const json = {
      ok: false,
      n8n_response: {
        success: false,
        error: "Agent timeout after 120s",
      },
    };

    const result = unwrapN8nResponse(json);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Agent timeout after 120s");
    expect(result.response).toBeUndefined();
  });

  it("ignores null n8n_response", () => {
    const json = {
      success: true,
      n8n_response: null,
      response: "Fallback",
    };

    const result = unwrapN8nResponse(json as Record<string, unknown>);
    expect(result.response).toBe("Fallback");
  });
});
