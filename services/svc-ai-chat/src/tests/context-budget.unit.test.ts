/**
 * impl 03 (odysseus) — B-6 acceptance tests, written BEFORE the implementation.
 *
 * Contract (impl/12 §B-6 + impl/09 §B-2/B-3):
 *  - computeInputBudget derives the input budget from the model context
 *    window with headroom (0.7 default — chars/4 underestimates) and an
 *    absolute hard max; UNKNOWN window → null → today's behavior (parity,
 *    no aggressive trimming)
 *  - enforceHistoryBudget trims from the OLDEST side, always keeps the most
 *    recent turns verbatim, never reorders
 *  - trimContextBundleLayers respects bundle.tokenBudget: memory events and
 *    KB chunk tails go first; ruleset + project_context layers are NEVER
 *    dropped (governance must survive budget pressure)
 */
import { describe, test, expect } from "vitest";
import {
  estimateTokens,
  estimateMessagesTokens,
  computeInputBudget,
  enforceHistoryBudget,
  shouldCompactHistory,
  trimContextBundleLayers,
} from "../lib/contextBudget.js";

const msg = (role: "user" | "assistant", chars: number) => ({
  role,
  content: "x".repeat(chars),
});

describe("estimateTokens — single conservative estimator (reuse chars/4)", () => {
  test("chars/4 rounded up; empty → 0", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("")).toBe(0);
  });
  test("messages add a small per-message overhead", () => {
    const one = estimateMessagesTokens([msg("user", 400)]);
    expect(one).toBeGreaterThanOrEqual(100);
    expect(estimateMessagesTokens([msg("user", 400), msg("assistant", 400)])).toBeGreaterThan(one + 99);
  });
});

describe("computeInputBudget — window-derived, fail-open on unknown", () => {
  test("16k vs 128k window → proportionally different budgets", () => {
    const small = computeInputBudget({ contextWindow: 16_000, maxOutputTokens: 3_000, headroom: 0.7, hardMax: 200_000 });
    const large = computeInputBudget({ contextWindow: 128_000, maxOutputTokens: 3_000, headroom: 0.7, hardMax: 200_000 });
    expect(small).toBe(Math.floor(16_000 * 0.7) - 3_000);
    expect(large).toBe(Math.floor(128_000 * 0.7) - 3_000);
    expect(large!).toBeGreaterThan(small!);
  });

  test("hard max caps huge windows", () => {
    const b = computeInputBudget({ contextWindow: 2_000_000, maxOutputTokens: 3_000, headroom: 0.7, hardMax: 200_000 });
    expect(b).toBe(200_000);
  });

  test("unknown/NULL window → null (parity — impl/09 B-2 anti-regression)", () => {
    expect(computeInputBudget({ contextWindow: null, maxOutputTokens: 3_000, headroom: 0.7, hardMax: 200_000 })).toBeNull();
    expect(computeInputBudget({ contextWindow: undefined, maxOutputTokens: 3_000, headroom: 0.7, hardMax: 200_000 })).toBeNull();
    expect(computeInputBudget({ contextWindow: 0, maxOutputTokens: 3_000, headroom: 0.7, hardMax: 200_000 })).toBeNull();
  });

  test("degenerate window smaller than output reservation → null (never a negative budget)", () => {
    expect(computeInputBudget({ contextWindow: 2_000, maxOutputTokens: 3_000, headroom: 0.7, hardMax: 200_000 })).toBeNull();
  });
});

describe("enforceHistoryBudget — oldest-first trim, tail always verbatim", () => {
  const history = [
    msg("user", 4_000),      // ~1000 tok (oldest)
    msg("assistant", 4_000), // ~1000
    msg("user", 4_000),      // ~1000
    msg("assistant", 4_000), // ~1000 (newest)
  ];

  test("under budget → unchanged (identity, same references)", () => {
    const r = enforceHistoryBudget({ history, budgetTokens: 100_000, keepLastTurns: 2 });
    expect(r.kept).toEqual(history);
    expect(r.droppedCount).toBe(0);
  });

  test("over budget → drops from the oldest side only", () => {
    const r = enforceHistoryBudget({ history, budgetTokens: 2_100, keepLastTurns: 2 });
    expect(r.droppedCount).toBe(2);
    expect(r.kept).toEqual(history.slice(2));
  });

  test("keepLastTurns is kept even when over budget (never drop the live exchange)", () => {
    const r = enforceHistoryBudget({ history, budgetTokens: 100, keepLastTurns: 2 });
    expect(r.kept).toEqual(history.slice(2));
    expect(r.droppedCount).toBe(2);
  });

  test("null budget → parity (no trimming at all)", () => {
    const r = enforceHistoryBudget({ history, budgetTokens: null, keepLastTurns: 2 });
    expect(r.kept).toEqual(history);
    expect(r.droppedCount).toBe(0);
  });
});

describe("shouldCompactHistory — threshold trigger", () => {
  test("triggers only above threshold fraction of the budget", () => {
    expect(shouldCompactHistory({ historyTokens: 8_600, budgetTokens: 10_000, threshold: 0.85 })).toBe(true);
    expect(shouldCompactHistory({ historyTokens: 8_400, budgetTokens: 10_000, threshold: 0.85 })).toBe(false);
    expect(shouldCompactHistory({ historyTokens: 999_999, budgetTokens: null, threshold: 0.85 })).toBe(false);
  });
});

describe("trimContextBundleLayers — governance survives budget pressure", () => {
  const bundle = {
    profile: "chat_default",
    tokenBudget: 300,
    tokensUsed: 10_000,
    layers: {
      project_context: { name: "aisha" },
      ruleset: { rules: [{ slug: "anthropic-context-as-finite-resource", ai_instructions: "RULE: budget context" }] },
      kb_retrieval: {
        chunks: Array.from({ length: 10 }, (_, i) => ({
          source_slug: `doc-${i}`,
          chunk_text: "k".repeat(2_000),
          relevance: 1 - i * 0.05,
        })),
      },
      memory: { events: Array.from({ length: 20 }, (_, i) => ({ event_type: `e${i}` })) },
    },
  };

  test("over budget → memory events and KB chunk tail trimmed, ruleset + project_context intact", () => {
    const out = trimContextBundleLayers(bundle);
    expect(out.trimmed).toBe(true);
    const layers = out.bundle.layers as Record<string, { chunks?: unknown[]; events?: unknown[]; rules?: unknown[] }>;
    expect(layers.ruleset, "ruleset layer must survive").toBeDefined();
    expect(layers.project_context, "project_context must survive").toBeDefined();
    const chunks = (layers.kb_retrieval?.chunks ?? []) as Array<{ source_slug: string }>;
    expect(chunks.length).toBeLessThan(10);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // highest-relevance chunks (head) survive — the tail goes first
    expect(chunks[0].source_slug).toBe("doc-0");
    expect((layers.memory?.events ?? []).length).toBeLessThanOrEqual(5);
  });

  test("within budget → identity (no mutation, trimmed=false)", () => {
    const small = { ...bundle, tokensUsed: 100, tokenBudget: 10_000 };
    const out = trimContextBundleLayers(small);
    expect(out.trimmed).toBe(false);
    expect(out.bundle).toBe(small);
  });

  test("zero/unknown budget → parity (never trim on missing data)", () => {
    const out = trimContextBundleLayers({ ...bundle, tokenBudget: 0 });
    expect(out.trimmed).toBe(false);
  });

  test("null bundle passes through", () => {
    expect(trimContextBundleLayers(null).bundle).toBeNull();
  });
});
