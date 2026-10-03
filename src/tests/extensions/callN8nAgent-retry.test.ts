/**
 * callN8nAgent — retry logic & error handling tests.
 *
 * Tests the fetch retry behavior (1-retry, exponential backoff, 5xx/network only)
 * in extensions/aisha-dirigent/src/mcp-client.ts → callN8nAgent().
 *
 * Because callN8nAgent depends on `vscode` and global `fetch`, we use the
 * vscode mock alias (vitest.config.ts) and stubGlobal for fetch.
 *
 * getDirigentConfig is mocked to isolate tests from process.env / .env files.
 *
 * @module
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as vscode from "vscode";

// ---------------------------------------------------------------------------
// Mock config module — isolate from env vars and .env files
// ---------------------------------------------------------------------------
const hoisted = vi.hoisted(() => ({
  getDirigentConfig: vi.fn(),
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

vi.mock("../../../extensions/aisha-dirigent/src/config", () => ({
  getDirigentConfig: hoisted.getDirigentConfig,
}));

vi.mock("../../../extensions/aisha-dirigent/src/auth", () => ({
  getAuthState: hoisted.getAuthState,
  isTokenExpiringSoon: hoisted.isTokenExpiringSoon,
  silentRefresh: hoisted.silentRefresh,
}));

// ---------------------------------------------------------------------------
// Mock resource-tracker — avoid top-level vscode.EventEmitter side-effect
// that fails under parallel worker isolation in the full test suite.
// ---------------------------------------------------------------------------
vi.mock("../../../extensions/aisha-dirigent/src/resource-tracker", () => ({
  recordApiCall: vi.fn(),
  onStatsChanged: vi.fn(),
  ALL_CATEGORIES: ["rpc", "mcp", "n8n", "auth", "push", "llm-discovery", "context-sync"],
}));

// ---------------------------------------------------------------------------
// Import after mocks are in place
// ---------------------------------------------------------------------------

import { callN8nAgent } from "../../../extensions/aisha-dirigent/src/mcp-client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fake Response object */
function fakeResponse(
  status: number,
  body: Record<string, unknown>,
  ok?: boolean,
): Response {
  return {
    ok: ok ?? (status >= 200 && status < 300),
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
    headers: new Headers(),
    redirected: false,
    statusText: status === 200 ? "OK" : "Error",
    type: "basic" as ResponseType,
    url: "",
    clone: () => fakeResponse(status, body, ok),
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

function setupConfig(triggerUrl = "https://n8n.example.com/trigger") {
  hoisted.getDirigentConfig.mockReturnValue({
    mcpUrl: "",
    n8nTriggerUrl: triggerUrl,
    supabaseUrl: "",
    anonKey: "",
    storyId: "",
    expertiseLevel: "intermediate",
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let fetchMock: ReturnType<typeof vi.fn>;
const originalSetTimeout = globalThis.setTimeout;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  hoisted.getAuthState.mockReturnValue({
    isAuthenticated: true,
    accessToken: "test-user-token",
    refreshToken: "test-refresh-token",
    expiresAt: Date.now() + 60_000,
    userId: "user-1",
    email: "user@example.test",
  });
  hoisted.isTokenExpiringSoon.mockReturnValue(false);
  hoisted.silentRefresh.mockResolvedValue(true);
  // Speed up backoff delays — resolve immediately
  vi.stubGlobal("setTimeout", (fn: () => void, _ms?: number) => originalSetTimeout(fn, 0));
  // jsdom lacks AbortSignal.timeout — stub it
  if (!AbortSignal.timeout) {
    AbortSignal.timeout = (_ms: number) => new AbortController().signal;
  }
  vi.mocked(vscode.window.showWarningMessage).mockReset();
  vi.mocked(vscode.window.showErrorMessage).mockReset();
  // Restore l10n.t implementation (vi.restoreAllMocks strips it in afterEach)
  vi.mocked(vscode.l10n.t).mockImplementation(
    (message: string, ...args: unknown[]) =>
      message.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? `{${i}}`)),
  );
  setupConfig();
});

afterEach(() => {
  vi.stubGlobal("setTimeout", originalSetTimeout);
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("callN8nAgent — config validation", () => {
  it("returns null and shows warning when triggerUrl is not configured", async () => {
    setupConfig("");

    const result = await callN8nAgent("test-workflow", { task: "hello" });

    expect(result).toBeNull();
    expect(vi.mocked(vscode.window.showWarningMessage)).toHaveBeenCalledWith(
      expect.stringContaining("n8n trigger URL not configured"),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends Authorization header with the current user token", async () => {
    setupConfig("https://n8n.test/trigger");
    fetchMock.mockResolvedValue(
      fakeResponse(200, { success: true, response: "ok" }),
    );

    await callN8nAgent("test-wf", { task: "x" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://n8n.test/trigger",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-user-token",
        }),
      }),
    );
  });

  it("returns null and shows warning when the user is not authenticated", async () => {
    setupConfig("https://n8n.test/trigger");
    hoisted.getAuthState.mockReturnValue({
      isAuthenticated: false,
      accessToken: undefined,
      refreshToken: undefined,
      expiresAt: undefined,
      userId: undefined,
      email: undefined,
    });

    const result = await callN8nAgent("test-wf", { task: "x" });

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.mocked(vscode.window.showWarningMessage)).toHaveBeenCalledWith(
      expect.stringContaining("sign in with AISHA ID"),
    );
  });
});

describe("callN8nAgent — successful responses", () => {
  it("returns parsed response on 200 OK (first attempt)", async () => {
    fetchMock.mockResolvedValue(
      fakeResponse(200, {
        ok: true,
        n8n_response: {
          success: true,
          response: "Hello from Aisha",
          provider: "openai",
          model: "gpt-4",
        },
      }),
    );

    const result = await callN8nAgent("dirigent-agent", { task: "greet" });

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.response).toBe("Hello from Aisha");
    expect(result!.provider).toBe("openai");
    expect(result!.model).toBe("gpt-4");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns direct format response when no n8n_response wrapper", async () => {
    fetchMock.mockResolvedValue(
      fakeResponse(200, {
        success: true,
        response: "Direct",
        provider: "google",
      }),
    );

    const result = await callN8nAgent("wf", { task: "x" });

    expect(result!.success).toBe(true);
    expect(result!.response).toBe("Direct");
    expect(result!.provider).toBe("google");
  });

  it("sends workflow and payload in request body", async () => {
    fetchMock.mockResolvedValue(
      fakeResponse(200, { success: true, response: "ok" }),
    );

    await callN8nAgent("my-workflow", { task: "analyze", data: [1, 2, 3] });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      workflow: "my-workflow",
      payload: {
        task: "analyze",
        data: [1, 2, 3],
        envelope: {
          workflow: "my-workflow",
          payload: { task: "analyze", data: [1, 2, 3] },
          context_profile: "repo",
          autonomy_mode: "hybrid",
          risk_level: "smoke",
        },
      },
    });
    expect(body.payload.envelope.run_id).toEqual(expect.any(String));
  });
});

describe("callN8nAgent — 4xx errors (no retry)", () => {
  it("does NOT retry on 400 Bad Request", async () => {
    fetchMock.mockResolvedValue(
      fakeResponse(400, { error: "Bad request" }),
    );

    const result = await callN8nAgent("wf", { task: "x" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result!.success).toBe(false);
    expect(result!.error).toContain("n8n agent error");
    expect(vi.mocked(vscode.window.showErrorMessage)).toHaveBeenCalled();
  });

  it("does NOT retry on 401 Unauthorized when refresh does not produce a token", async () => {
    hoisted.silentRefresh.mockResolvedValueOnce(false);
    fetchMock.mockResolvedValue(
      fakeResponse(401, { error: "Unauthorized" }),
    );

    const result = await callN8nAgent("wf", { task: "x" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result!.success).toBe(false);
  });

  it("does NOT retry on 404 Not Found", async () => {
    fetchMock.mockResolvedValue(
      fakeResponse(404, { error: "Not found" }),
    );

    const result = await callN8nAgent("wf", { task: "x" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result!.success).toBe(false);
  });

  it("does NOT retry on 429 Too Many Requests", async () => {
    fetchMock.mockResolvedValue(
      fakeResponse(429, { error: "Rate limited" }),
    );

    const result = await callN8nAgent("wf", { task: "x" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result!.success).toBe(false);
  });
});

describe("callN8nAgent — 5xx retry logic", () => {
  it("retries once on 500 and succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(500, { error: "Internal Server Error" }))
      .mockResolvedValueOnce(
        fakeResponse(200, { success: true, response: "Recovered" }),
      );

    const result = await callN8nAgent("wf", { task: "x" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result!.success).toBe(true);
    expect(result!.response).toBe("Recovered");
    expect(vi.mocked(vscode.window.showErrorMessage)).not.toHaveBeenCalled();
  });

  it("retries once on 502 Bad Gateway and succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(502, { error: "Bad Gateway" }))
      .mockResolvedValueOnce(
        fakeResponse(200, { success: true, response: "OK" }),
      );

    const result = await callN8nAgent("wf", { task: "x" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result!.success).toBe(true);
  });

  it("retries once on 503 Service Unavailable and succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(503, { error: "Service Unavailable" }))
      .mockResolvedValueOnce(
        fakeResponse(200, { success: true, response: "Back up" }),
      );

    const result = await callN8nAgent("wf", { task: "x" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result!.success).toBe(true);
  });

  it("fails after 2 consecutive 5xx errors (exhausts retries)", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(500, { error: "Error 1" }))
      .mockResolvedValueOnce(fakeResponse(500, { error: "Error 2" }));

    const result = await callN8nAgent("wf", { task: "x" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result!.success).toBe(false);
    expect(result!.error).toContain("n8n agent error");
    expect(vi.mocked(vscode.window.showErrorMessage)).toHaveBeenCalled();
  });

  it("does NOT retry a third time (maxAttempts = 2)", async () => {
    fetchMock.mockResolvedValue(fakeResponse(500, { error: "Always failing" }));

    await callN8nAgent("wf", { task: "x" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("callN8nAgent — network error retry logic", () => {
  it("retries once on network error and succeeds", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        fakeResponse(200, { success: true, response: "Recovered" }),
      );

    const result = await callN8nAgent("wf", { task: "x" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result!.success).toBe(true);
    expect(result!.response).toBe("Recovered");
  });

  it("retries once on timeout error and succeeds", async () => {
    const timeoutError = new DOMException("The operation was aborted", "AbortError");
    fetchMock
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce(
        fakeResponse(200, { success: true, response: "OK after timeout" }),
      );

    const result = await callN8nAgent("wf", { task: "x" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result!.success).toBe(true);
  });

  it("fails after 2 consecutive network errors", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const result = await callN8nAgent("wf", { task: "x" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result!.success).toBe(false);
    // sanitizeN8nErrorDetail maps "Failed to fetch" → "unknown" (security: don't leak internals)
    expect(result!.error).toContain("n8n agent error");
  });

  it("shows error message after exhausting retries on network error", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await callN8nAgent("wf", { task: "x" });

    // sanitizeN8nErrorDetail maps ECONNREFUSED → "network" (security: don't leak internal hostnames)
    expect(vi.mocked(vscode.window.showErrorMessage)).toHaveBeenCalledWith(
      expect.stringContaining("network"),
    );
  });
});

describe("callN8nAgent — mixed retry scenarios", () => {
  it("5xx first, then network error → fails", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(500, { error: "Server down" }))
      .mockRejectedValueOnce(new TypeError("Connection reset"));

    const result = await callN8nAgent("wf", { task: "x" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result!.success).toBe(false);
  });

  it("network error first, then 4xx → returns 4xx error (no further retry)", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(fakeResponse(400, { error: "Bad request" }));

    const result = await callN8nAgent("wf", { task: "x" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result!.success).toBe(false);
    // 4xx breaks the loop — no more retries
  });

  it("network error first, then 200 → success", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("DNS resolution failed"))
      .mockResolvedValueOnce(
        fakeResponse(200, { success: true, response: "Resolved" }),
      );

    const result = await callN8nAgent("wf", { task: "x" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result!.success).toBe(true);
    expect(result!.response).toBe("Resolved");
  });
});

describe("callN8nAgent — source parity", () => {
  it("retry pattern matches source implementation", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const sourcePath = resolve(
      __dirname,
      "../../../extensions/aisha-dirigent/src/mcp-client.ts",
    );
    const source = readFileSync(sourcePath, "utf-8");

    // Verify retry constants
    expect(source).toContain("maxAttempts = 2");
    // Verify backoff pattern
    expect(source).toContain("2000 * attempt");
    // Verify 5xx boundary check (only retry server errors)
    expect(source).toContain("response.status < 500");
    // Verify exponential backoff wait
    expect(source).toContain("setTimeout(r, 2000 * attempt)");
  });
});
