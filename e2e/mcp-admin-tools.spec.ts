/**
 * MCP Knowledge Server — Admin Tools E2E Tests
 *
 * Tests the admin_github_git and admin_appsmith MCP tools
 * via JSON-RPC 2.0 protocol against the local edge function.
 *
 * These tests verify:
 * - Tool registration (tools/list)
 * - Parameter validation
 * - Error handling for missing credentials
 * - JSON-RPC protocol compliance
 */

import { test, expect } from "@playwright/test";

const FUNCTIONS_URL =
  process.env.VITE_AISHA_POSTGREST_URL || "http://127.0.0.1:3001";
const AISHA_POSTGREST_ANON_KEY =
  process.env.VITE_AISHA_POSTGREST_ANON_KEY || "";

const MCP_ENDPOINT = `${FUNCTIONS_URL}/functions/v1/mcp-knowledge-server`;

/**
 * Send a JSON-RPC 2.0 request to MCP server.
 */
async function mcpCall(
  request: ReturnType<typeof test>["request"] extends never
    ? never
    : Awaited<ReturnType<typeof test.extend<Record<string, never>>["request"]>>,
  method: string,
  params: Record<string, unknown> = {},
  id: number | string = 1,
) {
  const response = await request.post(MCP_ENDPOINT, {
    headers: {
      "Content-Type": "application/json",
      apikey: AISHA_POSTGREST_ANON_KEY,
      Authorization: `Bearer ${AISHA_POSTGREST_ANON_KEY}`,
    },
    data: {
      jsonrpc: "2.0",
      id,
      method,
      params,
    },
  });
  return {
    status: response.status(),
    body: await response.json(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MCP Protocol — Basic Health
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("MCP Knowledge Server — Protocol", () => {
  test("GET returns server discovery info", async ({ request }) => {
    const response = await request.get(MCP_ENDPOINT, {
      headers: {
        apikey: AISHA_POSTGREST_ANON_KEY,
        Authorization: `Bearer ${AISHA_POSTGREST_ANON_KEY}`,
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("name");
    expect(data).toHaveProperty("version");
    expect(data).toHaveProperty("protocol", "mcp");
    expect(data).toHaveProperty("transport", "streamable-http");
  });

  test("Invalid JSON returns parse error", async ({ request }) => {
    const response = await request.post(MCP_ENDPOINT, {
      headers: {
        "Content-Type": "application/json",
        apikey: AISHA_POSTGREST_ANON_KEY,
        Authorization: `Bearer ${AISHA_POSTGREST_ANON_KEY}`,
      },
      data: "not-json{{{",
    });

    expect(response.status()).toBe(200); // JSON-RPC errors still return 200
    const body = await response.json();
    expect(body.error.code).toBe(-32700);
    expect(body.error.message).toContain("Parse error");
  });

  test("PUT returns 405 Method Not Allowed", async ({ request }) => {
    const response = await request.put(MCP_ENDPOINT, {
      headers: {
        "Content-Type": "application/json",
        apikey: AISHA_POSTGREST_ANON_KEY,
        Authorization: `Bearer ${AISHA_POSTGREST_ANON_KEY}`,
      },
      data: {},
    });

    expect(response.status()).toBe(405);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tools List — Verify admin tools are registered
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("MCP Tools Registration", () => {
  test("tools/list includes admin_github_git", async ({ request }) => {
    const { status, body } = await mcpCall(request, "tools/list", {});

    expect(status).toBe(200);
    expect(body.result).toBeDefined();
    expect(body.result.tools).toBeDefined();

    const toolNames = body.result.tools.map(
      (t: { name: string }) => t.name,
    );
    expect(toolNames).toContain("admin_github_git");
  });

  test("tools/list includes admin_appsmith", async ({ request }) => {
    const { status, body } = await mcpCall(request, "tools/list", {});

    expect(status).toBe(200);

    const toolNames = body.result.tools.map(
      (t: { name: string }) => t.name,
    );
    expect(toolNames).toContain("admin_appsmith");
  });

  test("admin_github_git has required input schema", async ({ request }) => {
    const { body } = await mcpCall(request, "tools/list", {});

    const tool = body.result.tools.find(
      (t: { name: string }) => t.name === "admin_github_git",
    );
    expect(tool).toBeDefined();
    expect(tool.inputSchema).toBeDefined();
    expect(tool.inputSchema.properties).toHaveProperty("operation");
  });

  test("admin_appsmith has required input schema", async ({ request }) => {
    const { body } = await mcpCall(request, "tools/list", {});

    const tool = body.result.tools.find(
      (t: { name: string }) => t.name === "admin_appsmith",
    );
    expect(tool).toBeDefined();
    expect(tool.inputSchema).toBeDefined();
    expect(tool.inputSchema.properties).toHaveProperty("operation");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Admin GitHub Git — Tool Calls
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("admin_github_git — Tool Calls", () => {
  test("list_repos operation returns result or credential error", async ({
    request,
  }) => {
    const { status, body } = await mcpCall(request, "tools/call", {
      name: "admin_github_git",
      arguments: { operation: "list_repos" },
    });

    expect(status).toBe(200);
    expect(body.result).toBeDefined();

    // Either succeeds with content or errors on missing credentials
    if (body.result.isError) {
      // Credential lookup failure is expected in test env
      const textContent = body.result.content?.find(
        (c: { type: string }) => c.type === "text",
      );
      expect(textContent).toBeDefined();
    } else {
      expect(body.result.content).toBeDefined();
      expect(Array.isArray(body.result.content)).toBe(true);
    }
  });

  test("unknown operation returns error", async ({ request }) => {
    const { status, body } = await mcpCall(request, "tools/call", {
      name: "admin_github_git",
      arguments: { operation: "nonexistent_op" },
    });

    expect(status).toBe(200);
    expect(body.result).toBeDefined();
    expect(body.result.isError).toBe(true);
  });

  test("get_file requires repo and path parameters", async ({ request }) => {
    const { status, body } = await mcpCall(request, "tools/call", {
      name: "admin_github_git",
      arguments: { operation: "get_file" },
    });

    expect(status).toBe(200);
    expect(body.result).toBeDefined();
    // Should fail due to missing required params or credential
    expect(body.result.isError).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Admin Appsmith — Tool Calls
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("admin_appsmith — Tool Calls", () => {
  test("list_pages operation returns result or credential error", async ({
    request,
  }) => {
    const { status, body } = await mcpCall(request, "tools/call", {
      name: "admin_appsmith",
      arguments: { operation: "list_pages", application_id: "test-app-id" },
    });

    expect(status).toBe(200);
    expect(body.result).toBeDefined();

    // Either succeeds or errors on missing credentials
    if (body.result.isError) {
      const textContent = body.result.content?.find(
        (c: { type: string }) => c.type === "text",
      );
      expect(textContent).toBeDefined();
    } else {
      expect(body.result.content).toBeDefined();
    }
  });

  test("unknown operation returns error", async ({ request }) => {
    const { status, body } = await mcpCall(request, "tools/call", {
      name: "admin_appsmith",
      arguments: { operation: "nonexistent_op" },
    });

    expect(status).toBe(200);
    expect(body.result).toBeDefined();
    expect(body.result.isError).toBe(true);
  });

  test("deploy operation requires application_id", async ({ request }) => {
    const { status, body } = await mcpCall(request, "tools/call", {
      name: "admin_appsmith",
      arguments: { operation: "deploy_app" },
    });

    expect(status).toBe(200);
    expect(body.result).toBeDefined();
    // Should fail due to missing application_id or credential
    expect(body.result.isError).toBe(true);
  });

  test("git_sync requires application_id", async ({ request }) => {
    const { status, body } = await mcpCall(request, "tools/call", {
      name: "admin_appsmith",
      arguments: { operation: "git_sync" },
    });

    expect(status).toBe(200);
    expect(body.result).toBeDefined();
    expect(body.result.isError).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// JSON-RPC Batch — Protocol compliance
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("MCP JSON-RPC Batch", () => {
  test("Batch request returns array of responses", async ({ request }) => {
    const response = await request.post(MCP_ENDPOINT, {
      headers: {
        "Content-Type": "application/json",
        apikey: AISHA_POSTGREST_ANON_KEY,
        Authorization: `Bearer ${AISHA_POSTGREST_ANON_KEY}`,
      },
      data: [
        { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      ],
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    expect(body[0].id).toBe(1);
    expect(body[1].id).toBe(2);
  });
});
