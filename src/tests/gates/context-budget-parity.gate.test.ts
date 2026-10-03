/**
 * Gate: adaptive context budget stays parity-safe (impl 03, impl/12 §B-6,
 * impl/09 §B-2/B-3 anti-regression).
 *
 * Guards four contracts:
 *  1. NULL/unknown context window can never trigger trimming —
 *     computeInputBudget must return null for a missing window and every
 *     consumer must treat null as "no enforcement" (today's behavior).
 *  2. The feature flag is default-off opt-in (ADAPTIVE_CONTEXT_BUDGET ===
 *     'true') and chat.ts wraps ALL enforcement behind it.
 *  3. The compaction summarizer goes through the governed
 *     chat.history_compaction purpose (resolveDefaultModel → resolver), never
 *     a hardcoded model literal.
 *  4. The headroom guardrail (0.7, NOT 0.85 — chars/4 underestimates) stays
 *     the seeded default.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf-8");

const CHAT = "services/svc-ai-chat/src/routes/chat.ts";
const BUDGET = "services/svc-ai-chat/src/lib/contextBudget.ts";
const RUNTIME_CFG = "services/svc-ai-chat/src/lib/aiRuntimeConfig.ts";
const TIERS_FN = "aisha/db/sql/functions/get_adaptive_model_tiers.sql";

describe("context budget — parity + governance (impl 03)", () => {
  test("unknown window fails open: computeInputBudget returns null, guarded before use", () => {
    const budget = read(BUDGET);
    expect(budget).toMatch(/if \(!contextWindow[\s\S]{0,120}?return null/);
    const chat = read(CHAT);
    expect(chat, "chat.ts must skip enforcement when the budget is null").toMatch(
      /inputBudget !== null/,
    );
  });

  test("flag is default-off opt-in and wraps every enforcement site in chat.ts", () => {
    const budget = read(BUDGET);
    expect(budget).toMatch(/ADAPTIVE_CONTEXT_BUDGET\s*===\s*["']true["']/);
    const chat = read(CHAT);
    const enforcementSites = ["trimContextBundleLayers(", "compactHistoryIfNeeded("];
    for (const site of enforcementSites) {
      const idx = chat.indexOf(site);
      expect(idx, `${site} must be wired in chat.ts`).toBeGreaterThan(-1);
      const preceding = chat.slice(Math.max(0, idx - 2500), idx);
      expect(
        preceding.includes("isAdaptiveContextBudgetEnabled()"),
        `${site} must be guarded by isAdaptiveContextBudgetEnabled()`,
      ).toBe(true);
    }
  });

  test("compaction summarizer resolves via the governed chat.history_compaction purpose", () => {
    const chat = read(CHAT);
    // resolveDefaultBackend = týž resolver a týž účel, jen vrací i providera z řádku
    // registru (brána provider-z-registru-ne-z-prefixu) — vlastnost „vybírá resolver" drží.
    expect(chat).toMatch(/resolveDefault(?:Model|Backend)\(\s*['"]chat\.history_compaction['"]/);
    // no model literal anywhere near the summarizer — resolver decides
    const idx = chat.indexOf("chat.history_compaction");
    const window = chat.slice(idx, idx + 900);
    expect(
      /gpt-4|claude-3|gemini-1|o3-mini/.test(window),
      "no hardcoded model may back the compaction summarizer",
    ).toBe(false);
  });

  test("headroom guardrail: seeded default stays 0.7 (impl/09 B-3)", () => {
    const cfg = read(RUNTIME_CFG);
    expect(cfg).toMatch(/contextBudgetHeadroom:\s*0\.7/);
    const seed = read("aisha/db/seed/core/07_system_config.sql");
    expect(seed).toMatch(/"context_budget_headroom":\s*0\.7/);
  });

  test("window source is the registry via get_adaptive_model_tiers windows payload (one source)", () => {
    const fn = read(TIERS_FN);
    expect(fn).toMatch(/jsonb_build_object\(\s*'windows'|'windows',/);
    expect(fn).toMatch(/context_window/);
    expect(fn).toMatch(/max_output_tokens/);
    const bridge = read("services/svc-ai-chat/src/lib/orchestrationBridge.ts");
    expect(bridge).toMatch(/contextWindow\?:/);
    expect(bridge).toMatch(/windows/);
    // baseline carries the regenerated function
    const base = read("aisha/db/migrations/00000000000000_baseline.sql");
    expect(base, "regenerate the baseline after the tiers RPC change").toMatch(
      /odysseus impl 03: attach registry windows/,
    );
  });
});
