/**
 * local-llm-client.test.ts — Edge chat client for simple tasks.
 *
 * Tests: edgeChat (success, fallback, error handling), formatEdgeTag.
 * Verifies that edgeChat returns null (not throws) when edge is unavailable.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock("../src/compute-tier", () => ({
  resolveTier: vi.fn(),
}));

vi.mock("../src/resource-tracker", () => ({
  recordApiCall: vi.fn(),
  recordModelUsage: vi.fn(),
}));

// ── Helpers ──────────────────────────────────────────────────────────

async function mockResolveTier(result: {
  tier: string;
  endpoint: string;
  model: string | null;
  reason: string;
}) {
  const { resolveTier } = await import("../src/compute-tier") as { resolveTier: Mock };
  resolveTier.mockReturnValue(result);
}

function mockFetchOk(data: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => data,
  }) as unknown as typeof fetch;
}

function mockFetchError() {
  global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused")) as unknown as typeof fetch;
}

function mockFetchHttpError() {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status: 500,
    json: async () => ({}),
  }) as unknown as typeof fetch;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("edgeChat", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    vi.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns null when tier resolves to backend (caller fallback)", async () => {
    await mockResolveTier({
      tier: "self-hosted",
      endpoint: "http://localhost:57421",
      model: null,
      reason: "Edge-first disabled",
    });
    const { edgeChat } = await import("../src/local-llm-client");
    const result = await edgeChat(
      [{ role: "user", content: "summarize errors" }],
      { task: "recap" },
    );
    expect(result).toBeNull();
  });

  it("returns null when model is null", async () => {
    await mockResolveTier({
      tier: "edge",
      endpoint: "http://localhost:11434/v1",
      model: null,
      reason: "No model",
    });
    const { edgeChat } = await import("../src/local-llm-client");
    const result = await edgeChat(
      [{ role: "user", content: "test" }],
      { task: "recap" },
    );
    expect(result).toBeNull();
  });

  it("calls fetch with correct URL, headers, and body", async () => {
    await mockResolveTier({
      tier: "edge",
      endpoint: "http://localhost:11434/v1",
      model: "llama3.2",
      reason: "Edge-first enabled",
    });
    mockFetchOk({
      choices: [{ message: { content: "summary" }, finish_reason: "stop" }],
      model: "llama3.2",
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });

    const { edgeChat } = await import("../src/local-llm-client");
    await edgeChat(
      [{ role: "user", content: "summarize errors" }],
      { task: "recap", maxTokens: 512, temperature: 0.5 },
    );

    const fetchCall = (global.fetch as Mock).mock.calls[0];
    expect(fetchCall[0]).toBe("http://localhost:11434/v1/chat/completions");
    const body = JSON.parse(fetchCall[1].body);
    expect(body.model).toBe("llama3.2");
    expect(body.max_tokens).toBe(512);
    expect(body.temperature).toBe(0.5);
    expect(body.messages).toHaveLength(1);
  });

  it("returns EdgeChatResult with correct fields on success", async () => {
    await mockResolveTier({
      tier: "edge",
      endpoint: "http://localhost:11434/v1",
      model: "llama3.2",
      reason: "Edge-first enabled",
    });
    mockFetchOk({
      choices: [{ message: { content: "Here is the summary" }, finish_reason: "stop" }],
      model: "llama3.2",
      usage: { prompt_tokens: 120, completion_tokens: 80 },
    });

    const { edgeChat } = await import("../src/local-llm-client");
    const result = await edgeChat(
      [{ role: "user", content: "summarize" }],
      { task: "recap" },
    );

    expect(result).not.toBeNull();
    expect(result!.content).toBe("Here is the summary");
    expect(result!.model).toBe("llama3.2");
    expect(result!.tier).toBe("edge");
    expect(result!.tokens.promptTokens).toBe(120);
    expect(result!.tokens.completionTokens).toBe(80);
    expect(result!.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("calls recordModelUsage after successful edge chat", async () => {
    await mockResolveTier({
      tier: "edge",
      endpoint: "http://localhost:11434/v1",
      model: "llama3.2",
      reason: "Edge-first enabled",
    });
    mockFetchOk({
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      model: "llama3.2",
      usage: { prompt_tokens: 50, completion_tokens: 25 },
    });

    const { edgeChat } = await import("../src/local-llm-client");
    await edgeChat(
      [{ role: "user", content: "test" }],
      { task: "recap" },
    );

    const { recordModelUsage } = await import("../src/resource-tracker") as { recordModelUsage: Mock };
    expect(recordModelUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "llama3.2",
        tier: "edge",
        promptTokens: 50,
        completionTokens: 25,
      }),
    );
  });

  it("returns null on fetch network error (no throw)", async () => {
    await mockResolveTier({
      tier: "edge",
      endpoint: "http://localhost:11434/v1",
      model: "llama3.2",
      reason: "Edge-first enabled",
    });
    mockFetchError();

    const { edgeChat } = await import("../src/local-llm-client");
    const result = await edgeChat(
      [{ role: "user", content: "test" }],
      { task: "recap" },
    );
    expect(result).toBeNull();
  });

  it("returns null on HTTP error response (non-ok)", async () => {
    await mockResolveTier({
      tier: "edge",
      endpoint: "http://localhost:11434/v1",
      model: "llama3.2",
      reason: "Edge-first enabled",
    });
    mockFetchHttpError();

    const { edgeChat } = await import("../src/local-llm-client");
    const result = await edgeChat(
      [{ role: "user", content: "test" }],
      { task: "recap" },
    );
    expect(result).toBeNull();
  });
});

describe("formatEdgeTag", () => {
  it("formats with k suffix for tokens >= 1000", async () => {
    const { formatEdgeTag } = await import("../src/local-llm-client");
    const tag = formatEdgeTag({
      content: "test",
      model: "llama3.2",
      tier: "edge",
      tokens: { promptTokens: 1200, completionTokens: 856 },
      latencyMs: 340.7,
    });
    expect(tag).toBe("[Edge: llama3.2 · ↑1.2k ↓856 tokens · 341ms]");
  });

  it("formats without k suffix for tokens < 1000", async () => {
    const { formatEdgeTag } = await import("../src/local-llm-client");
    const tag = formatEdgeTag({
      content: "test",
      model: "mistral",
      tier: "edge",
      tokens: { promptTokens: 42, completionTokens: 18 },
      latencyMs: 120,
    });
    expect(tag).toBe("[Edge: mistral · ↑42 ↓18 tokens · 120ms]");
  });

  it("formats very large token counts", async () => {
    const { formatEdgeTag } = await import("../src/local-llm-client");
    const tag = formatEdgeTag({
      content: "test",
      model: "llama3.2",
      tier: "edge",
      tokens: { promptTokens: 15000, completionTokens: 3200 },
      latencyMs: 5000,
    });
    expect(tag).toBe("[Edge: llama3.2 · ↑15.0k ↓3.2k tokens · 5000ms]");
  });
});
