/**
 * MCP Client — JSON-RPC 2.0 HTTP transport for MCP Knowledge Server.
 *
 * Sends tool/call requests to the AISHA backend Edge Function MCP endpoint.
 * Handles authentication via Bearer token and graceful error handling.
 *
 * @module
 */

import * as vscode from "vscode";
import { getDirigentConfig } from "./config";
import { randomUUID } from "crypto";
import type { RequestStats } from "./resource-tracker";
import { recordApiCall } from "./resource-tracker";
import { getAuthState, isTokenExpiringSoon, silentRefresh } from "./auth";

/** JSON-RPC 2.0 request */
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: Record<string, unknown>;
}

/** JSON-RPC 2.0 response */
interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** MCP tool call result content item */
export interface McpContent {
  type: "text" | "resource";
  text?: string;
  resource?: { uri: string; text: string; mimeType: string };
}

/** MCP tool call response */
export interface McpToolResponse {
  content: McpContent[];
  isError?: boolean;
  _stats?: RequestStats;
}

let requestId = 0;

function buildRequestEnvelope(
  workflow: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const config = getDirigentConfig();
  const contextProfile = (typeof payload.context_profile === "string" && payload.context_profile)
    ? payload.context_profile
    : "repo";
  return {
    workflow,
    payload,
    story_id: config.storyId || undefined,
    context_profile: contextProfile,
    autonomy_mode: "hybrid",
    risk_level: "smoke",
    run_id: randomUUID(),
  };
}

/**
 * Get MCP configuration from VS Code settings.
 */
function getConfig(): { url: string } {
  const config = getDirigentConfig();
  return {
    url: config.mcpUrl || "",
  };
}

async function resolveAccessToken(): Promise<string | undefined> {
  if (getAuthState().accessToken && isTokenExpiringSoon()) {
    await silentRefresh();
  }

  const auth = getAuthState();
  return auth.isAuthenticated ? auth.accessToken ?? undefined : undefined;
}

async function buildMcpHeaders(): Promise<Record<string, string> | null> {
  const bearerToken = await resolveAccessToken();
  if (!bearerToken) {
    return null;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (bearerToken) {
    headers["Authorization"] = `Bearer ${bearerToken}`;
  }
  return headers;
}

/**
 * Call an MCP tool on the Knowledge Server.
 *
 * @param toolName - MCP tool name (e.g. "moderate_flow")
 * @param args - Tool arguments object
 * @returns MCP tool response or null on error
 */
export async function callMcpTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpToolResponse | null> {
  const { url } = getConfig();

  if (!url) {
    vscode.window.showWarningMessage(
      vscode.l10n.t("AISHA Dirigent: MCP URL not configured. Use .aisha/dirigent.local.json or AISHA_MCP_URL."),
    );
    return null;
  }

  const initialHeaders = await buildMcpHeaders();
  if (!initialHeaders) {
    vscode.window.showWarningMessage(
      vscode.l10n.t("AISHA Dirigent: sign in with AISHA ID before calling MCP tools."),
    );
    return null;
  }

  const request: JsonRpcRequest = {
    jsonrpc: "2.0",
    id: ++requestId,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  };

  const maxRetries = 2;
  let lastError: string | undefined;
  const t0 = performance.now();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: await buildMcpHeaders() ?? initialHeaders,
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(30_000),
      });

      if (response.status === 401 && getAuthState().isAuthenticated && attempt < maxRetries) {
        const refreshed = await silentRefresh();
        if (refreshed) {
          lastError = "HTTP 401: refreshed Keycloak token";
          continue;
        }
      }

      if (!response.ok) {
        const text = await response.text();
        // Retry on 5xx server errors
        if (response.status >= 500 && attempt < maxRetries) {
          lastError = `HTTP ${response.status}: ${text.substring(0, 200)}`;
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        recordApiCall("mcp", performance.now() - t0, text.length, true);
        vscode.window.showErrorMessage(
          vscode.l10n.t("AISHA MCP error ({0}). Check connection settings.", response.status),
        );
        return null;
      }

      const json = (await response.json()) as JsonRpcResponse;
      const responseBytes = JSON.stringify(json).length;

      if (json.error) {
        recordApiCall("mcp", performance.now() - t0, responseBytes, true);
        vscode.window.showErrorMessage(
          vscode.l10n.t("AISHA MCP RPC error. Check MCP server logs."),
        );
        return null;
      }

      const stats = recordApiCall("mcp", performance.now() - t0, responseBytes, false);
      const result = json.result as McpToolResponse;
      if (result) result._stats = stats;
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < maxRetries) {
        lastError = msg;
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      recordApiCall("mcp", performance.now() - t0, 0, true);
      vscode.window.showErrorMessage(
        vscode.l10n.t("AISHA MCP connection failed. Verify MCP URL and network."),
      );
      return null;
    }
  }

  recordApiCall("mcp", performance.now() - t0, 0, true);
  vscode.window.showErrorMessage(
    vscode.l10n.t("AISHA MCP failed after retries. Check connection."),
  );
  return null;
}

/**
 * Extract markdown text from MCP tool response.
 */
export function extractMarkdown(
  response: McpToolResponse | null,
): string {
  if (!response) return "";
  const parts: string[] = [];
  for (const content of response.content) {
    if (content.type === "text" && content.text) {
      parts.push(content.text);
    }
  }
  return parts.join("\n\n");
}

/**
 * Extract JSON data from MCP tool response.
 */
export function extractJson(
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

// ──────────────────────────────────────────
// n8n Agent Delegation
// ──────────────────────────────────────────

/** Response from n8n agent workflow. */
export interface N8nAgentResponse {
  success: boolean;
  response?: string;
  provider?: string;
  model?: string;
  error?: string;
  /** Session directive from Aisha — domain/task/status updates. */
  directive?: Record<string, unknown>;
  /** Cross-session messages from Aisha orchestration. */
  crossSessionMessages?: Array<{
    target_domain: string;
    message: string;
  }>;
  _stats?: RequestStats;
}

function sanitizeN8nErrorDetail(detail: string | undefined): string {
  if (!detail) {
    return "unknown";
  }

  // Never leak internal hostnames/IPs to users.
  const lower = detail.toLowerCase();
  if (
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("ehostunreach") ||
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("network") ||
    /\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(detail)
  ) {
    return "network";
  }

  if (lower.startsWith("http ")) {
    const m = detail.match(/^HTTP\s+(\d{3})/i);
    return m ? `HTTP ${m[1]}` : "HTTP error";
  }

  return "unknown";
}

/**
 * Get n8n trigger configuration from VS Code settings.
 */
function getN8nConfig(): { triggerUrl: string } {
  const config = getDirigentConfig();
  return {
    triggerUrl: config.n8nTriggerUrl || "",
  };
}

/**
 * Call an n8n AI Agent workflow via the n8n-trigger edge function.
 *
 * Routes to named workflow (e.g. "dirigent-agent", "model-router")
 * through the authenticated n8n-trigger proxy.
 *
 * @param workflow - Workflow name from WORKFLOW_MAP (e.g. "dirigent-agent")
 * @param payload - Task payload to pass to the workflow
 * @returns Agent response or null on error
 */
export async function callN8nAgent(
  workflow: string,
  payload: Record<string, unknown>,
): Promise<N8nAgentResponse | null> {
  const { triggerUrl } = getN8nConfig();

  if (!triggerUrl) {
    vscode.window.showWarningMessage(
      vscode.l10n.t("AISHA Dirigent: n8n trigger URL not configured. Use .aisha/dirigent.local.json or AISHA_N8N_TRIGGER_URL."),
    );
    return null;
  }

  let accessToken = await resolveAccessToken();
  if (!accessToken) {
    vscode.window.showWarningMessage(
      vscode.l10n.t("AISHA Dirigent: sign in with AISHA ID before calling n8n agents."),
    );
    return null;
  }

  const maxAttempts = 2;
  const t0 = performance.now();

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    headers["Authorization"] = `Bearer ${accessToken}`;

    let response: Response | undefined;
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const envelope = buildRequestEnvelope(workflow, payload);
        response = await fetch(triggerUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({
            workflow,
            payload: {
              ...payload,
              envelope,
            },
          }),
          signal: AbortSignal.timeout(120_000), // 2 min — agents need more time
        });

        if (response.status === 401 && attempt < maxAttempts) {
          const refreshed = await silentRefresh();
          accessToken = refreshed ? getAuthState().accessToken ?? undefined : undefined;
          if (accessToken) {
            headers["Authorization"] = `Bearer ${accessToken}`;
            lastError = "HTTP 401";
            continue;
          }
        }

        if (response.ok || response.status < 500) {
          break; // Success or client error (no point retrying 4xx)
        }
        lastError = `HTTP ${response.status}`;
      } catch (fetchErr) {
        lastError = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      }

      if (attempt < maxAttempts) {
        // Exponential backoff: 2s before retry
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }

    if (!response || !response.ok) {
      const text = response ? await response.text() : "";
      const safeError = sanitizeN8nErrorDetail(lastError);
      recordApiCall("n8n", performance.now() - t0, text.length, true);
      vscode.window.showErrorMessage(
        vscode.l10n.t(
          "AISHA: n8n agent error ({0}). Check trigger URL.",
          safeError,
        ),
      );
      return {
        success: false,
        error: `n8n agent error (${safeError})`,
        response: undefined,
        provider: undefined,
        model: undefined,
      };
    }

    const json = await response.json() as Record<string, unknown>;
    const responseBytes = JSON.stringify(json).length;
    const stats = recordApiCall("n8n", performance.now() - t0, responseBytes, false);

    // n8n-trigger wraps the actual agent response:
    // { ok, workflow, n8n_status, n8n_response: <actual agent payload> }
    // Extract the inner n8n_response if present (proxy wrapper format).
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
        _stats: stats,
      };
    }

    // Fallback — direct response format (e.g. when calling n8n webhooks directly)
    return {
      success: (json.success ?? json.ok ?? false) as boolean,
      response: (json.response ?? json.output ?? json.text) as string | undefined,
      provider: json.provider as string | undefined,
      model: json.model as string | undefined,
      error: json.error as string | undefined,
      directive: json.directive as Record<string, unknown> | undefined,
      crossSessionMessages: json.cross_session_messages as N8nAgentResponse["crossSessionMessages"],
      _stats: stats,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordApiCall("n8n", performance.now() - t0, 0, true);
    vscode.window.showErrorMessage(
      vscode.l10n.t("AISHA n8n agent call failed. Check network and trigger URL."),
    );
    return {
      success: false,
      error: msg,
      response: undefined,
      provider: undefined,
      model: undefined,
    };
  }
}
