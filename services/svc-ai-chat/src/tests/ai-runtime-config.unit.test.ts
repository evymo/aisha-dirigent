/**
 * impl 08 §4 / impl 12 §B-8 — warm `ai_runtime` config loader acceptance tests
 * (written BEFORE the implementation).
 *
 * Contract (mirrors svc-agent-runner getRunnerCaps):
 *  - DB row system_config['ai_runtime'] overrides defaults, takes effect
 *    within the cache TTL (no redeploy)
 *  - DB unreachable → env JSON bootstrap (AI_RUNTIME_CONFIG_JSON) → code
 *    defaults; a transient DB error never loses the last-known config
 *  - TTL cache: within TTL no second RPC; after TTL a refresh happens
 *  - values are clamped to sane ranges (a typo in the DB must not produce
 *    a 0-token budget or a 500 % headroom)
 */
import { describe, test, expect, beforeEach } from "vitest";
import {
  getAiRuntimeConfig,
  AI_RUNTIME_DEFAULTS,
  __resetAiRuntimeConfigCache,
} from "../lib/aiRuntimeConfig.js";
import type { PostgrestClient } from "../lib/rpcAdapter.js";

function clientReturning(value: unknown, calls?: { count: number }): PostgrestClient {
  return {
    async rpc<T>(fn: string, params?: Record<string, unknown>) {
      if (calls) calls.count += 1;
      if (fn !== "get_system_config" || params?.p_key !== "ai_runtime") {
        return { data: null, error: { message: `unexpected rpc ${fn}` } };
      }
      return { data: value as T, error: null };
    },
  };
}

function failingClient(): PostgrestClient {
  return {
    async rpc() {
      return { data: null, error: { message: "db down" } };
    },
  };
}

beforeEach(() => {
  __resetAiRuntimeConfigCache();
  delete process.env.AI_RUNTIME_CONFIG_JSON;
});

describe("getAiRuntimeConfig — resolution order", () => {
  test("defaults apply when the DB row is empty", async () => {
    const cfg = await getAiRuntimeConfig(clientReturning({}));
    expect(cfg).toEqual(AI_RUNTIME_DEFAULTS);
    // headroom is the impl/09 §B-3 guardrail: 0.7, NOT 0.85 (estimateTokens
    // chars/4 underestimates code/JSON/CJK)
    expect(cfg.contextBudgetHeadroom).toBe(0.7);
  });

  test("DB values override defaults (operator tunes without redeploy)", async () => {
    const cfg = await getAiRuntimeConfig(
      clientReturning({ compact_keep_last_turns: 10, context_budget_headroom: 0.6 }),
    );
    expect(cfg.compactKeepLastTurns).toBe(10);
    expect(cfg.contextBudgetHeadroom).toBe(0.6);
    // untouched keys keep defaults
    expect(cfg.compactThreshold).toBe(AI_RUNTIME_DEFAULTS.compactThreshold);
  });

  test("DB unreachable → env JSON bootstrap wins over code defaults", async () => {
    process.env.AI_RUNTIME_CONFIG_JSON = JSON.stringify({ research_max_rounds: 5 });
    const cfg = await getAiRuntimeConfig(failingClient());
    expect(cfg.researchMaxRounds).toBe(5);
    expect(cfg.compactKeepLastTurns).toBe(AI_RUNTIME_DEFAULTS.compactKeepLastTurns);
  });

  test("DB unreachable with no env → code defaults (never throws)", async () => {
    const cfg = await getAiRuntimeConfig(failingClient());
    expect(cfg).toEqual(AI_RUNTIME_DEFAULTS);
  });

  test("transient DB error serves last-known config, not defaults", async () => {
    const t0 = 1_000_000;
    const good = clientReturning({ compact_keep_last_turns: 12 });
    const cfg1 = await getAiRuntimeConfig(good, t0);
    expect(cfg1.compactKeepLastTurns).toBe(12);
    // TTL expired + DB now failing → keep last-known (12), not default (6)
    const cfg2 = await getAiRuntimeConfig(failingClient(), t0 + 3_600_000);
    expect(cfg2.compactKeepLastTurns).toBe(12);
  });
});

describe("getAiRuntimeConfig — TTL cache", () => {
  test("second call within TTL does not re-hit the DB", async () => {
    const calls = { count: 0 };
    const client = clientReturning({ compact_keep_last_turns: 9 }, calls);
    const t0 = 5_000_000;
    await getAiRuntimeConfig(client, t0);
    await getAiRuntimeConfig(client, t0 + 1_000);
    expect(calls.count).toBe(1);
  });

  test("call after TTL refreshes from the DB", async () => {
    const calls = { count: 0 };
    const client = clientReturning({ compact_keep_last_turns: 9 }, calls);
    const t0 = 5_000_000;
    await getAiRuntimeConfig(client, t0);
    await getAiRuntimeConfig(client, t0 + 3_600_000);
    expect(calls.count).toBe(2);
  });
});

describe("getAiRuntimeConfig — clamping (DB typos must not break runtime)", () => {
  test("headroom is clamped to [0.3, 0.95]", async () => {
    const hi = await getAiRuntimeConfig(clientReturning({ context_budget_headroom: 5 }));
    expect(hi.contextBudgetHeadroom).toBe(0.95);
    __resetAiRuntimeConfigCache();
    const lo = await getAiRuntimeConfig(clientReturning({ context_budget_headroom: 0 }));
    expect(lo.contextBudgetHeadroom).toBe(0.3);
  });

  test("keep_last_turns has a floor of 1; budgets have positive floors", async () => {
    const cfg = await getAiRuntimeConfig(
      clientReturning({ compact_keep_last_turns: -3, context_budget_hard_max: 0 }),
    );
    expect(cfg.compactKeepLastTurns).toBeGreaterThanOrEqual(1);
    expect(cfg.contextBudgetHardMax).toBeGreaterThan(0);
  });

  test("non-numeric junk in the DB falls back to defaults per key", async () => {
    const cfg = await getAiRuntimeConfig(
      clientReturning({ compact_threshold: "oops", injection_rescan_threshold: null }),
    );
    expect(cfg.compactThreshold).toBe(AI_RUNTIME_DEFAULTS.compactThreshold);
    expect(cfg.injectionRescanThreshold).toBe(AI_RUNTIME_DEFAULTS.injectionRescanThreshold);
  });
});
