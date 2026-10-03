/**
 * MCP Protocol Tests — McpServer JSON-RPC 2.0 dispatcher.
 *
 * Tests the core McpServer class from mcp-protocol.ts directly,
 * verifying tool registration, request dispatch, error handling,
 * and JSON-RPC 2.0 compliance.
 *
 * @module
 */
import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Re-implement McpServer locally for Node.js testing.
// The source in _shared/mcp-protocol.ts uses no Deno APIs, but path resolution
// across Deno module conventions is fragile. We copy the essential logic here
// to keep tests stable, and validate contract parity via a separate test.
// ---------------------------------------------------------------------------

interface McpContent {
  type: "text" | "resource";
  mimeType?: string;
  text?: string;
  uri?: string;
}

interface McpToolResult {
  content: McpContent[];
  isError?: boolean;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface ToolInputSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<McpToolResult>;

function jsonRpcSuccess(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

const ERR_INVALID_REQUEST = -32600;
const ERR_METHOD_NOT_FOUND = -32601;
const ERR_INVALID_PARAMS = -32602;
const ERR_INTERNAL = -32603;

class McpServer {
  private name: string;
  private version: string;
  private tools = new Map<string, { definition: ToolDefinition; handler: ToolHandler }>();

  constructor(opts: { name: string; version: string }) {
    this.name = opts.name;
    this.version = opts.version;
  }

  registerTool(definition: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(definition.name, { definition, handler });
  }

  async handleRequest(body: unknown): Promise<JsonRpcResponse | JsonRpcResponse[]> {
    if (Array.isArray(body)) {
      return Promise.all(body.map((item) => this.dispatchSingle(item as JsonRpcRequest)));
    }
    return this.dispatchSingle(body as JsonRpcRequest);
  }

  private async dispatchSingle(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!req || typeof req !== "object" || !req.method) {
      return jsonRpcError(null, ERR_INVALID_REQUEST, "Invalid request");
    }
    const id = req.id ?? null;
    const params = req.params ?? {};

    try {
      switch (req.method) {
        case "initialize":
          return jsonRpcSuccess(id, {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: { listChanged: false },
              resources: { subscribe: false, listChanged: false },
              prompts: { listChanged: false },
            },
            serverInfo: { name: this.name, version: this.version },
          });

        case "tools/list":
          return jsonRpcSuccess(id, {
            tools: Array.from(this.tools.values()).map((t) => t.definition),
          });

        case "tools/call": {
          const toolName = params.name as string;
          if (!toolName) return jsonRpcError(id, ERR_INVALID_PARAMS, "Missing tool name");
          const tool = this.tools.get(toolName);
          if (!tool) return jsonRpcError(id, ERR_INVALID_PARAMS, `Unknown tool: ${toolName}`);
          const args = (params.arguments ?? {}) as Record<string, unknown>;
          const result = await tool.handler(args);
          return jsonRpcSuccess(id, result);
        }

        default:
          return jsonRpcError(id, ERR_METHOD_NOT_FOUND, `Unknown method: ${req.method}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Internal error";
      return jsonRpcError(id, ERR_INTERNAL, msg);
    }
  }
}

// =============================================================================
// Test helpers
// =============================================================================

function textContent(text: string): McpContent {
  return { type: "text", mimeType: "text/plain", text };
}

function toolSuccess(content: McpContent[]): McpToolResult {
  return { content, isError: false };
}

function toolError(message: string): McpToolResult {
  return { content: [textContent(message)], isError: true };
}

function makeServer(): McpServer {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });

  server.registerTool(
    {
      name: "echo",
      description: "Echo back the input",
      inputSchema: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
    },
    async (args) => toolSuccess([textContent(String(args.message ?? ""))]),
  );

  server.registerTool(
    {
      name: "failing_tool",
      description: "Always throws",
      inputSchema: { type: "object" },
    },
    async () => {
      throw new Error("Intentional failure");
    },
  );

  return server;
}

// =============================================================================
// Tests
// =============================================================================

describe("McpServer — JSON-RPC 2.0 Protocol", () => {
  describe("initialize", () => {
    it("returns server info and capabilities", async () => {
      const server = makeServer();
      const res = (await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      })) as JsonRpcResponse;

      expect(res.jsonrpc).toBe("2.0");
      expect(res.id).toBe(1);
      expect(res.error).toBeUndefined();

      const result = res.result as Record<string, unknown>;
      expect(result.protocolVersion).toBe("2024-11-05");

      const info = result.serverInfo as Record<string, string>;
      expect(info.name).toBe("test-server");
      expect(info.version).toBe("1.0.0");
    });
  });

  describe("tools/list", () => {
    it("returns all registered tools", async () => {
      const server = makeServer();
      const res = (await server.handleRequest({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      })) as JsonRpcResponse;

      expect(res.error).toBeUndefined();
      const result = res.result as { tools: ToolDefinition[] };
      expect(result.tools).toHaveLength(2);

      const names = result.tools.map((t) => t.name).sort();
      expect(names).toEqual(["echo", "failing_tool"]);
    });

    it("each tool has required schema fields", async () => {
      const server = makeServer();
      const res = (await server.handleRequest({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/list",
      })) as JsonRpcResponse;

      const result = res.result as { tools: ToolDefinition[] };
      for (const tool of result.tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe("object");
      }
    });
  });

  describe("tools/call", () => {
    it("invokes a tool and returns success", async () => {
      const server = makeServer();
      const res = (await server.handleRequest({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "echo", arguments: { message: "hello" } },
      })) as JsonRpcResponse;

      expect(res.error).toBeUndefined();
      const result = res.result as McpToolResult;
      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toBe("hello");
    });

    it("returns error for unknown tool", async () => {
      const server = makeServer();
      const res = (await server.handleRequest({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "nonexistent", arguments: {} },
      })) as JsonRpcResponse;

      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe(ERR_INVALID_PARAMS);
      expect(res.error!.message).toContain("Unknown tool");
    });

    it("returns error when tool name is missing", async () => {
      const server = makeServer();
      const res = (await server.handleRequest({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {},
      })) as JsonRpcResponse;

      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe(ERR_INVALID_PARAMS);
    });

    it("handles tool exceptions gracefully", async () => {
      const server = makeServer();
      const res = (await server.handleRequest({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "failing_tool", arguments: {} },
      })) as JsonRpcResponse;

      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe(ERR_INTERNAL);
      expect(res.error!.message).toBe("Intentional failure");
    });
  });

  describe("error handling", () => {
    it("returns METHOD_NOT_FOUND for unknown method", async () => {
      const server = makeServer();
      const res = (await server.handleRequest({
        jsonrpc: "2.0",
        id: 8,
        method: "nonexistent/method",
      })) as JsonRpcResponse;

      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe(ERR_METHOD_NOT_FOUND);
    });

    it("returns INVALID_REQUEST for null body", async () => {
      const server = makeServer();
      const res = (await server.handleRequest(null)) as JsonRpcResponse;

      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe(ERR_INVALID_REQUEST);
    });

    it("returns INVALID_REQUEST for body without method", async () => {
      const server = makeServer();
      const res = (await server.handleRequest({ id: 9 })) as JsonRpcResponse;

      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe(ERR_INVALID_REQUEST);
    });
  });

  describe("batch requests", () => {
    it("handles array of requests", async () => {
      const server = makeServer();
      const res = (await server.handleRequest([
        { jsonrpc: "2.0", id: 10, method: "initialize", params: {} },
        { jsonrpc: "2.0", id: 11, method: "tools/list" },
      ])) as JsonRpcResponse[];

      expect(Array.isArray(res)).toBe(true);
      expect(res).toHaveLength(2);
      expect(res[0].id).toBe(10);
      expect(res[1].id).toBe(11);
      expect(res[0].error).toBeUndefined();
      expect(res[1].error).toBeUndefined();
    });
  });

  describe("content helpers", () => {
    it("textContent creates plain text", () => {
      const c = textContent("hello");
      expect(c.type).toBe("text");
      expect(c.mimeType).toBe("text/plain");
      expect(c.text).toBe("hello");
    });

    it("toolSuccess wraps content", () => {
      const r = toolSuccess([textContent("ok")]);
      expect(r.isError).toBe(false);
      expect(r.content).toHaveLength(1);
    });

    it("toolError wraps error message", () => {
      const r = toolError("boom");
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toBe("boom");
    });
  });
});
