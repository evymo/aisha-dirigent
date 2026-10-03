/**
 * MCP Protocol — JSON-RPC 2.0 dispatcher for Model Context Protocol servers.
 *
 * Implements the MCP "Streamable HTTP" transport layer with:
 * - Tool registration + invocation
 * - Resource registration + reading
 * - Prompt registration + retrieval
 * - Standard JSON-RPC 2.0 error codes
 * - Batch request support
 *
 * @module
 */

// =============================================================================
// Types
// =============================================================================

/** A single content item in an MCP tool result. */
export interface McpContent {
  type: "text" | "resource";
  /** MIME type of the content (e.g., "text/plain", "application/json", "text/markdown"). */
  mimeType?: string;
  /** The textual content value. */
  text?: string;
  /** Optional resource URI (for type "resource"). */
  uri?: string;
}

/** Result returned by an MCP tool handler. */
export interface McpToolResult {
  content: McpContent[];
  isError?: boolean;
}

/** JSON-RPC 2.0 response envelope. */
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** JSON-RPC 2.0 request envelope. */
interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

/** Schema for an MCP tool's input. */
interface ToolInputSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
}

/** Definition of a registered MCP tool. */
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
}

/** Handler function for a tool invocation. */
type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<McpToolResult>;

/** Definition of a registered MCP resource. */
interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType?: string;
}

/** Handler function for reading a resource. */
type ResourceHandler = () => Promise<{
  text: string;
  mimeType?: string;
}>;

/** Argument for an MCP prompt. */
interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

/** Definition of a registered MCP prompt. */
interface PromptDefinition {
  name: string;
  description: string;
  arguments?: PromptArgument[];
}

/** Message returned by a prompt handler. */
interface PromptMessage {
  role: string;
  content: McpContent;
}

/** Handler function for getting a prompt. */
type PromptHandler = (
  args: Record<string, string>,
) => Promise<{ messages: PromptMessage[] }>;

// =============================================================================
// Content helpers
// =============================================================================

/**
 * Create a plain text content item.
 */
export function textContent(text: string): McpContent {
  return { type: "text", mimeType: "text/plain", text };
}

/**
 * Create a JSON content item (serialized to formatted string).
 */
export function jsonContent(data: unknown): McpContent {
  return {
    type: "text",
    mimeType: "application/json",
    text: JSON.stringify(data, null, 2),
  };
}

/**
 * Create a Markdown content item.
 */
export function markdownContent(text: string): McpContent {
  return { type: "text", mimeType: "text/markdown", text };
}

// =============================================================================
// Tool result helpers
// =============================================================================

/**
 * Create a successful tool result with content items.
 */
export function toolSuccess(content: McpContent[]): McpToolResult {
  return { content, isError: false };
}

/**
 * Create an error tool result with a message.
 */
export function toolError(message: string): McpToolResult {
  return { content: [textContent(message)], isError: true };
}

// =============================================================================
// JSON-RPC helpers
// =============================================================================

function jsonRpcSuccess(
  id: string | number | null,
  result: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

// Standard JSON-RPC 2.0 error codes
const ERR_PARSE = -32700;
const ERR_INVALID_REQUEST = -32600;
const ERR_METHOD_NOT_FOUND = -32601;
const ERR_INVALID_PARAMS = -32602;
const ERR_INTERNAL = -32603;

// =============================================================================
// McpServer
// =============================================================================

interface McpServerOptions {
  name: string;
  version: string;
}

/**
 * MCP Server — registers tools, resources, and prompts, and dispatches
 * JSON-RPC 2.0 requests according to the Model Context Protocol spec.
 *
 * @example
 * ```ts
 * const server = new McpServer({ name: "my-server", version: "1.0.0" });
 * server.registerTool(definition, handler);
 * const response = await server.handleRequest(jsonRpcBody);
 * ```
 */
export class McpServer {
  private name: string;
  private version: string;

  private tools: Map<string, { definition: ToolDefinition; handler: ToolHandler }> =
    new Map();
  /** Deferred tools — only name + description sent in tools/list; full schema loaded on demand. */
  private deferredTools: Map<string, { definition: ToolDefinition; handler: ToolHandler }> =
    new Map();
  private resources: Map<
    string,
    { definition: ResourceDefinition; handler: ResourceHandler }
  > = new Map();
  private prompts: Map<
    string,
    { definition: PromptDefinition; handler: PromptHandler }
  > = new Map();

  constructor(options: McpServerOptions) {
    this.name = options.name;
    this.version = options.version;
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  /** Register a tool with its definition and async handler. */
  registerTool(definition: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(definition.name, { definition, handler });
  }

  /**
   * Register a deferred tool — handler is stored but only a lightweight stub
   * (name + description, no inputSchema) appears in `tools/list`.
   * Full definition is returned on `tools/call` or via `tool_search`.
   */
  registerDeferredTool(definition: ToolDefinition, handler: ToolHandler): void {
    this.deferredTools.set(definition.name, { definition, handler });
  }

  /** Register a resource with its definition and async handler. */
  registerResource(
    definition: ResourceDefinition,
    handler: ResourceHandler,
  ): void {
    this.resources.set(definition.uri, { definition, handler });
  }

  /** Register a prompt with its definition and async handler. */
  registerPrompt(definition: PromptDefinition, handler: PromptHandler): void {
    this.prompts.set(definition.name, { definition, handler });
  }

  // ---------------------------------------------------------------------------
  // Request dispatch
  // ---------------------------------------------------------------------------

  /**
   * Handle an incoming JSON-RPC 2.0 request (single or batch).
   * Returns a single response or array of responses.
   */
  async handleRequest(
    body: unknown,
  ): Promise<JsonRpcResponse | JsonRpcResponse[]> {
    // Batch request
    if (Array.isArray(body)) {
      const results = await Promise.all(
        body.map((item) => this.dispatchSingle(item as JsonRpcRequest)),
      );
      return results;
    }

    return this.dispatchSingle(body as JsonRpcRequest);
  }

  // ---------------------------------------------------------------------------
  // Single request dispatcher
  // ---------------------------------------------------------------------------

  private async dispatchSingle(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!req || typeof req !== "object" || !req.method) {
      return jsonRpcError(null, ERR_INVALID_REQUEST, "Invalid request");
    }

    const id = req.id ?? null;
    const params = req.params ?? {};

    try {
      switch (req.method) {
        case "initialize":
          return this.handleInitialize(id, params);

        case "ping":
          return jsonRpcSuccess(id, {});

        case "tools/list":
          return this.handleToolsList(id);

        case "tools/call":
          return await this.handleToolsCall(id, params);

        case "resources/list":
          return this.handleResourcesList(id);

        case "resources/read":
          return await this.handleResourcesRead(id, params);

        case "prompts/list":
          return this.handlePromptsList(id);

        case "prompts/get":
          return await this.handlePromptsGet(id, params);

        default:
          return jsonRpcError(id, ERR_METHOD_NOT_FOUND, `Unknown method: ${req.method}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Internal error";
      return jsonRpcError(id, ERR_INTERNAL, msg);
    }
  }

  // ---------------------------------------------------------------------------
  // MCP method handlers
  // ---------------------------------------------------------------------------

  private handleInitialize(
    id: string | number | null,
    _params: Record<string, unknown>,
  ): JsonRpcResponse {
    return jsonRpcSuccess(id, {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: { listChanged: false },
        resources: { subscribe: false, listChanged: false },
        prompts: { listChanged: false },
      },
      serverInfo: {
        name: this.name,
        version: this.version,
      },
    });
  }

  private handleToolsList(id: string | number | null): JsonRpcResponse {
    // Core tools: full definitions
    const coreTools = Array.from(this.tools.values()).map((t) => t.definition);

    // Deferred tools: lightweight stubs (name + description only, no inputSchema)
    // Clients discover full schema via tool_search or tools/call resolves it on demand
    const deferredStubs = Array.from(this.deferredTools.values()).map((t) => ({
      name: t.definition.name,
      description: `[deferred] ${t.definition.description}`,
      inputSchema: { type: "object" as const },
    }));

    return jsonRpcSuccess(id, { tools: [...coreTools, ...deferredStubs] });
  }

  private async handleToolsCall(
    id: string | number | null,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> {
    const toolName = params.name as string;
    if (!toolName) {
      return jsonRpcError(id, ERR_INVALID_PARAMS, "Missing tool name");
    }

    // Look up in core tools first, then deferred tools
    const tool = this.tools.get(toolName) ?? this.deferredTools.get(toolName);
    if (!tool) {
      return jsonRpcError(
        id,
        ERR_INVALID_PARAMS,
        `Unknown tool: ${toolName}`,
      );
    }

    const args = (params.arguments ?? {}) as Record<string, unknown>;
    const result = await tool.handler(args);

    return jsonRpcSuccess(id, result);
  }

  private handleResourcesList(id: string | number | null): JsonRpcResponse {
    const resources = Array.from(this.resources.values()).map(
      (r) => r.definition,
    );
    return jsonRpcSuccess(id, { resources });
  }

  private async handleResourcesRead(
    id: string | number | null,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> {
    const uri = params.uri as string;
    if (!uri) {
      return jsonRpcError(id, ERR_INVALID_PARAMS, "Missing resource URI");
    }

    const resource = this.resources.get(uri);
    if (!resource) {
      return jsonRpcError(
        id,
        ERR_INVALID_PARAMS,
        `Unknown resource: ${uri}`,
      );
    }

    const result = await resource.handler();

    return jsonRpcSuccess(id, {
      contents: [
        {
          uri,
          mimeType: result.mimeType ?? resource.definition.mimeType ?? "text/plain",
          text: result.text,
        },
      ],
    });
  }

  private handlePromptsList(id: string | number | null): JsonRpcResponse {
    const prompts = Array.from(this.prompts.values()).map((p) => ({
      name: p.definition.name,
      description: p.definition.description,
      arguments: p.definition.arguments ?? [],
    }));
    return jsonRpcSuccess(id, { prompts });
  }

  private async handlePromptsGet(
    id: string | number | null,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> {
    const promptName = params.name as string;
    if (!promptName) {
      return jsonRpcError(id, ERR_INVALID_PARAMS, "Missing prompt name");
    }

    const prompt = this.prompts.get(promptName);
    if (!prompt) {
      return jsonRpcError(
        id,
        ERR_INVALID_PARAMS,
        `Unknown prompt: ${promptName}`,
      );
    }

    const args = (params.arguments ?? {}) as Record<string, string>;
    const result = await prompt.handler(args);

    return jsonRpcSuccess(id, {
      description: prompt.definition.description,
      messages: result.messages,
    });
  }

  // ---------------------------------------------------------------------------
  // Deferred tool search API
  // ---------------------------------------------------------------------------

  /**
   * Search deferred tools by name or description pattern.
   * Returns full tool definitions (including inputSchema) for matching tools.
   * Used by the `tool_search` meta-tool.
   *
   * @param query - Search string (matched case-insensitively against name + description).
   * @returns Matching tool definitions with full inputSchema.
   */
  searchDeferredTools(query: string): ToolDefinition[] {
    const q = query.toLowerCase();
    const results: ToolDefinition[] = [];

    for (const { definition } of this.deferredTools.values()) {
      const nameMatch = definition.name.toLowerCase().includes(q);
      const descMatch = definition.description.toLowerCase().includes(q);
      if (nameMatch || descMatch) {
        results.push(definition);
      }
    }

    return results;
  }

  /**
   * Get full definition of a specific deferred tool by name.
   * Returns null if not found or not deferred.
   */
  getDeferredToolDefinition(name: string): ToolDefinition | null {
    return this.deferredTools.get(name)?.definition ?? null;
  }
}