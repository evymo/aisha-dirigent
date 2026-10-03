/**
 * Anthropic parity package — acceptance tests written BEFORE the code
 * (odysseus impl/12 §B-1..B-4 + impl/14 G1/G3).
 *
 * A-1  sync chat() posts EXACTLY prepareAnthropicBody(request).body — the
 *      one-builder invariant that keeps sync/stream/batch from drifting.
 * A-2  golden body for a representative request (system+tools+jsonMode+
 *      caching+thinking) — catches unintended body changes.
 * A-4  betas[] is the single source of beta headers per capability.
 * B-2  prompt caching: cache_control lands on the LAST stable system block
 *      and the LAST tool; stable/variable system split keeps the breakpoint
 *      BEFORE the variable part.
 * B-3  jsonMode degrades to a JSON-only system directive (no native json
 *      mode on the Messages API) — parity with openai-compat behavior.
 * B-4  chatStream: native Anthropic SSE → UnifiedStreamChunk sequence with
 *      normalized finishReason + usage on the terminal chunk; setup errors
 *      throw BEFORE the first yield.
 * G3   reasoningEffort maps to thinking.budget_tokens tiers; temperature is
 *      dropped (API constraint) and the budget respects max_tokens.
 */
import { describe, test, expect } from "vitest";
import {
  AnthropicBackend,
  prepareAnthropicBody,
  CAPABILITY_BETAS,
} from "../providers/anthropic.js";
import type { ChatRequest } from "../providers/types.js";

const BASE: ChatRequest = {
  model: "claude-sonnet-5",
  systemPrompt: "You are AISHA.",
  messages: [{ role: "user", content: "hello" }],
  maxTokens: 4096,
  temperature: 0.3,
};

describe("prepareAnthropicBody — caching (B-2/G1)", () => {
  test("system becomes a block array with cache_control on the LAST block", () => {
    const { body } = prepareAnthropicBody(BASE);
    const system = body.system as Array<Record<string, unknown>>;
    expect(Array.isArray(system)).toBe(true);
    expect(system[system.length - 1].cache_control).toEqual({ type: "ephemeral" });
  });

  test("stable/variable split: breakpoint sits after the STABLE part, variable part uncached", () => {
    const { body } = prepareAnthropicBody({
      ...BASE,
      systemPromptStable: "PINNED RULES + PERSONALITY (stable prefix)",
      systemPrompt: "KB context for THIS query (variable)",
    });
    const system = body.system as Array<Record<string, unknown>>;
    expect(system).toHaveLength(2);
    expect(system[0].text).toContain("stable prefix");
    expect(system[0].cache_control, "stable block carries the breakpoint").toEqual({ type: "ephemeral" });
    expect(system[1].cache_control, "variable block must NOT be cached").toBeUndefined();
  });

  test("tools carry cache_control on the LAST tool only (schemas are a stable prefix)", () => {
    const { body } = prepareAnthropicBody({
      ...BASE,
      tools: [
        { type: "function", function: { name: "a", description: "d", parameters: {} } },
        { type: "function", function: { name: "b", description: "d", parameters: {} } },
      ],
    });
    const tools = body.tools as Array<Record<string, unknown>>;
    expect(tools[0].cache_control).toBeUndefined();
    expect(tools[1].cache_control).toEqual({ type: "ephemeral" });
  });

  test("no system, no tools → no empty blocks, no cache_control artifacts", () => {
    const { body } = prepareAnthropicBody({ model: "claude-x", messages: [{ role: "user", content: "q" }] });
    expect(body.system).toBeUndefined();
    expect(body.tools).toBeUndefined();
  });
});

describe("prepareAnthropicBody — jsonMode (B-3) + thinking (G3)", () => {
  test("jsonMode appends a JSON-only directive to the system blocks (degrade, not fail)", () => {
    const { body } = prepareAnthropicBody({ ...BASE, jsonMode: true });
    const system = body.system as Array<Record<string, unknown>>;
    const joined = system.map((b) => b.text).join("\n");
    expect(joined).toMatch(/valid JSON only/i);
  });

  test("reasoningEffort maps to thinking budget tiers and drops temperature", () => {
    const low = prepareAnthropicBody({ ...BASE, reasoningEffort: "low" }).body;
    const high = prepareAnthropicBody({ ...BASE, maxTokens: 32_000, reasoningEffort: "high" }).body;
    expect((low.thinking as Record<string, unknown>).type).toBe("enabled");
    expect((low.thinking as Record<string, unknown>).budget_tokens).toBe(2_048);
    expect((high.thinking as Record<string, unknown>).budget_tokens).toBe(16_384);
    expect(low.temperature, "temperature is incompatible with extended thinking").toBeUndefined();
    expect(high.temperature).toBeUndefined();
  });

  test("thinking budget respects max_tokens (budget < max_tokens, floor 1024, else disabled)", () => {
    const clamped = prepareAnthropicBody({ ...BASE, maxTokens: 4_096, reasoningEffort: "high" }).body;
    expect((clamped.thinking as Record<string, unknown>).budget_tokens).toBe(4_096 - 1_024);
    const tiny = prepareAnthropicBody({ ...BASE, maxTokens: 1_500, reasoningEffort: "high" }).body;
    expect(tiny.thinking, "no room for a meaningful budget → thinking disabled").toBeUndefined();
    expect(tiny.temperature, "no thinking → temperature preserved").toBe(0.3);
  });

  test("no reasoningEffort → no thinking key (classification stays cheap)", () => {
    const { body } = prepareAnthropicBody(BASE);
    expect(body.thinking).toBeUndefined();
    expect(body.temperature).toBe(0.3);
  });
});

describe("prepareAnthropicBody — golden body (A-2) + betas (A-4)", () => {
  test("golden representative body", () => {
    const { body, betas } = prepareAnthropicBody({
      model: "claude-sonnet-5",
      systemPromptStable: "STABLE",
      systemPrompt: "VARIABLE",
      messages: [
        { role: "user", content: "u1" },
        { role: "assistant", content: "a1" },
        { role: "user", content: "u2" },
      ],
      maxTokens: 2_048,
      temperature: 0.1,
      jsonMode: true,
      tools: [{ type: "function", function: { name: "t", description: "d", parameters: { type: "object" } } }],
      toolChoice: "auto",
    });
    expect(body).toEqual({
      model: "claude-sonnet-5",
      max_tokens: 2_048,
      temperature: 0.1,
      messages: [
        { role: "user", content: "u1" },
        { role: "assistant", content: "a1" },
        { role: "user", content: "u2" },
      ],
      system: [
        { type: "text", text: "STABLE", cache_control: { type: "ephemeral" } },
        { type: "text", text: "VARIABLE" },
        { type: "text", text: expect_json_directive() },
      ],
      tools: [
        {
          name: "t",
          description: "d",
          input_schema: { type: "object" },
          cache_control: { type: "ephemeral" },
        },
      ],
      tool_choice: { type: "auto" },
    });
    expect(betas).toEqual([]);
  });

  test("CAPABILITY_BETAS is the single beta source; GA capabilities need none", () => {
    expect(CAPABILITY_BETAS.prompt_caching).toEqual([]);
    expect(CAPABILITY_BETAS.extended_thinking).toEqual([]);
  });
});

/** The directive text is an implementation constant — read it via the builder. */
function expect_json_directive(): string {
  const { body } = prepareAnthropicBody({ model: "m", messages: [{ role: "user", content: "x" }], jsonMode: true });
  const system = body.system as Array<Record<string, unknown>>;
  return String(system[system.length - 1].text);
}

describe("AnthropicBackend.chat — one-builder invariant (A-1) + cache usage (B-2)", () => {
  test("chat() posts exactly prepareAnthropicBody(request).body and maps cache usage", async () => {
    const backend = new AnthropicBackend("test-key");
    const request: ChatRequest = { ...BASE, jsonMode: true };
    let posted: Record<string, unknown> | null = null;

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
      posted = JSON.parse(init?.body ?? "{}");
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "{\"ok\":true}" }],
          stop_reason: "end_turn",
          usage: {
            input_tokens: 100,
            output_tokens: 5,
            cache_read_input_tokens: 80,
            cache_creation_input_tokens: 20,
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    try {
      const res = await backend.chat(request);
      expect(posted).toEqual(prepareAnthropicBody(request).body);
      expect(res.usage.inputTokens).toBe(100);
      expect(res.usage.cacheReadTokens).toBe(80);
      expect(res.usage.cacheCreationTokens).toBe(20);
      expect(res.text).toBe('{"ok":true}');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("AnthropicBackend.chatStream — native SSE parity (B-4)", () => {
  function sseResponse(events: Array<[string, unknown]>): Response {
    const payload = events.map(([ev, data]) => `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`).join("");
    return new Response(new Blob([payload]).stream(), { status: 200 });
  }

  test("text stream → content deltas + terminal usage/finishReason", async () => {
    const backend = new AnthropicBackend("test-key");
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      sseResponse([
        ["message_start", { message: { usage: { input_tokens: 42 } } }],
        ["content_block_start", { index: 0, content_block: { type: "text" } }],
        ["content_block_delta", { index: 0, delta: { type: "text_delta", text: "Hel" } }],
        ["content_block_delta", { index: 0, delta: { type: "text_delta", text: "lo" } }],
        ["content_block_stop", { index: 0 }],
        ["message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } }],
        ["message_stop", {}],
      ])) as typeof fetch;

    try {
      const chunks: Array<{ content?: string; finish?: string; usage?: unknown }> = [];
      for await (const c of backend.chatStream!(BASE)) {
        chunks.push({ content: c.delta.content, finish: c.finishReason, usage: c.usage });
      }
      const text = chunks.map((c) => c.content ?? "").join("");
      expect(text).toBe("Hello");
      const terminal = chunks[chunks.length - 1];
      expect(terminal.finish).toBe("stop");
      expect(terminal.usage).toEqual({ inputTokens: 42, outputTokens: 7 });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("tool-use stream → toolCallDelta fragments and finishReason tool_calls", async () => {
    const backend = new AnthropicBackend("test-key");
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      sseResponse([
        ["message_start", { message: { usage: { input_tokens: 10 } } }],
        ["content_block_start", { index: 0, content_block: { type: "tool_use", id: "tu_1", name: "search" } }],
        ["content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: '{"q":' } }],
        ["content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: '"x"}' } }],
        ["content_block_stop", { index: 0 }],
        ["message_delta", { delta: { stop_reason: "tool_use" }, usage: { output_tokens: 3 } }],
        ["message_stop", {}],
      ])) as typeof fetch;

    try {
      const deltas: Array<{ id?: string; name?: string; argumentsFragment?: string }> = [];
      let finish: string | undefined;
      for await (const c of backend.chatStream!(BASE)) {
        if (c.delta.toolCallDelta) deltas.push(c.delta.toolCallDelta);
        if (c.finishReason) finish = c.finishReason;
      }
      expect(deltas[0]).toMatchObject({ id: "tu_1", name: "search" });
      expect(deltas.map((d) => d.argumentsFragment ?? "").join("")).toBe('{"q":"x"}');
      expect(finish).toBe("tool_calls");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("setup failure throws BEFORE the first yield (no empty-stream masquerade)", async () => {
    const backend = new AnthropicBackend("test-key");
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;
    try {
      const gen = backend.chatStream!(BASE);
      await expect(gen.next()).rejects.toThrow(/anthropic/i);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
