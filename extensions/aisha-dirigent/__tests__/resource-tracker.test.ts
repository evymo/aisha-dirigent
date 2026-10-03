/**
 * resource-tracker.test.ts — Per-model token tracking & formatters.
 *
 * Tests: recordModelUsage accumulation, getModelUsage, getSnapshot,
 *        formatTokens, formatBytes, formatDuration, formatCost, buildStatsMarkdown.
 *
 * Uses vi.resetModules() per test for clean singleton state.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Fresh import helper ──────────────────────────────────────────────

async function freshTracker() {
  vi.resetModules();
  return import("../src/resource-tracker");
}

// ── Tests ────────────────────────────────────────────────────────────

describe("recordModelUsage + getModelUsage", () => {
  beforeEach(() => vi.resetModules());

  it("single call → 1 record with callCount 1", async () => {
    const t = await freshTracker();
    t.recordModelUsage({
      provider: "edge",
      modelId: "llama3.2",
      tier: "edge",
      promptTokens: 100,
      completionTokens: 50,
      totalLatencyMs: 200,
    });
    const usage = t.getModelUsage();
    expect(usage).toHaveLength(1);
    expect(usage[0].callCount).toBe(1);
    expect(usage[0].promptTokens).toBe(100);
    expect(usage[0].completionTokens).toBe(50);
  });

  it("same model 2× → callCount 2, tokens accumulated", async () => {
    const t = await freshTracker();
    t.recordModelUsage({
      provider: "edge",
      modelId: "llama3.2",
      tier: "edge",
      promptTokens: 100,
      completionTokens: 50,
      totalLatencyMs: 200,
    });
    t.recordModelUsage({
      provider: "edge",
      modelId: "llama3.2",
      tier: "edge",
      promptTokens: 80,
      completionTokens: 40,
      totalLatencyMs: 150,
    });
    const usage = t.getModelUsage();
    expect(usage).toHaveLength(1);
    expect(usage[0].callCount).toBe(2);
    expect(usage[0].promptTokens).toBe(180);
    expect(usage[0].completionTokens).toBe(90);
    expect(usage[0].totalLatencyMs).toBe(350);
  });

  it("different models → separate records", async () => {
    const t = await freshTracker();
    t.recordModelUsage({
      provider: "edge",
      modelId: "llama3.2",
      tier: "edge",
      promptTokens: 100,
      completionTokens: 50,
      totalLatencyMs: 200,
    });
    t.recordModelUsage({
      provider: "cloud",
      modelId: "gpt-4o",
      tier: "cloud",
      promptTokens: 200,
      completionTokens: 100,
      totalLatencyMs: 500,
    });
    const usage = t.getModelUsage();
    expect(usage).toHaveLength(2);
    const models = usage.map((u) => u.modelId).sort();
    expect(models).toEqual(["gpt-4o", "llama3.2"]);
  });

  it("onStatsChanged fires after recordModelUsage", async () => {
    const t = await freshTracker();
    const listener = vi.fn();
    t.onStatsChanged(listener);
    t.recordModelUsage({
      provider: "edge",
      modelId: "llama3.2",
      tier: "edge",
      promptTokens: 100,
      completionTokens: 50,
      totalLatencyMs: 200,
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("getSnapshot", () => {
  beforeEach(() => vi.resetModules());

  it("includes modelUsage in snapshot", async () => {
    const t = await freshTracker();
    t.recordModelUsage({
      provider: "edge",
      modelId: "llama3.2",
      tier: "edge",
      promptTokens: 100,
      completionTokens: 50,
      totalLatencyMs: 200,
    });
    const snap = t.getSnapshot();
    expect(snap.modelUsage).toHaveLength(1);
    expect(snap.modelUsage[0].modelId).toBe("llama3.2");
  });

  it("includes token aggregates from recordApiCall", async () => {
    const t = await freshTracker();
    t.recordApiCall("mcp", 100, 500, false, { promptTokens: 200, completionTokens: 100 });
    const snap = t.getSnapshot();
    expect(snap.tokens.prompt).toBe(200);
    expect(snap.tokens.completion).toBe(100);
    expect(snap.tokens.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("tracks uptime", async () => {
    const t = await freshTracker();
    const snap = t.getSnapshot();
    expect(snap.uptimeMs).toBeGreaterThanOrEqual(0);
  });
});

describe("formatTokens", () => {
  beforeEach(() => vi.resetModules());

  it.each([
    [0, "0"],
    [999, "999"],
    [1000, "1.0K"],
    [1500, "1.5K"],
    [23600, "23.6K"],
    [1_500_000, "1.5M"],
  ] as const)("formatTokens(%i) = %s", async (input, expected) => {
    const { formatTokens } = await freshTracker();
    expect(formatTokens(input)).toBe(expected);
  });
});

describe("formatBytes", () => {
  beforeEach(() => vi.resetModules());

  it.each([
    [0, "0B"],
    [500, "500B"],
    [1024, "1.0KB"],
    [1536, "1.5KB"],
    [1048576, "1.0MB"],
  ] as const)("formatBytes(%i) = %s", async (input, expected) => {
    const { formatBytes } = await freshTracker();
    expect(formatBytes(input)).toBe(expected);
  });
});

describe("formatDuration", () => {
  beforeEach(() => vi.resetModules());

  it.each([
    [500, "500ms"],
    [1500, "1.5s"],
    [90_000, "1m 30s"],
    [3_700_000, "1h 1m"],
  ] as const)("formatDuration(%i) = %s", async (input, expected) => {
    const { formatDuration } = await freshTracker();
    expect(formatDuration(input)).toBe(expected);
  });
});

describe("formatCost", () => {
  beforeEach(() => vi.resetModules());

  it.each([
    [0.0001, "<$0.001"],
    [0.012, "$0.012"],
    [1.5, "$1.50"],
  ] as const)("formatCost(%s) = %s", async (input, expected) => {
    const { formatCost } = await freshTracker();
    expect(formatCost(input)).toBe(expected);
  });
});

describe("buildStatsMarkdown", () => {
  beforeEach(() => vi.resetModules());

  it("includes per-model table when usage exists", async () => {
    const t = await freshTracker();
    t.recordModelUsage({
      provider: "edge",
      modelId: "llama3.2",
      tier: "edge",
      promptTokens: 100,
      completionTokens: 50,
      totalLatencyMs: 200,
    });
    const md = t.buildStatsMarkdown();
    expect(md).toContain("Per-Model Usage");
    expect(md).toContain("llama3.2");
    expect(md).toContain("edge");
  });

  it("omits per-model table when no usage", async () => {
    const t = await freshTracker();
    const md = t.buildStatsMarkdown();
    expect(md).not.toContain("Per-Model Usage");
  });

  it("shows API call category rows", async () => {
    const t = await freshTracker();
    t.recordApiCall("mcp", 100, 500, false);
    const md = t.buildStatsMarkdown();
    expect(md).toContain("MCP Tools");
    expect(md).toContain("1");
  });

  it("always includes token summary", async () => {
    const t = await freshTracker();
    const md = t.buildStatsMarkdown();
    expect(md).toContain("Tokens:");
  });
});
