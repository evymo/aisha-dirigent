/**
 * Gate: Anthropic operating principles are governed knowledge WITH live
 * enforcement (odysseus impl/16 §4.2).
 *
 * A rule without technical enforcement is just text. This gate asserts both
 * halves stay true:
 *  A. the 6 principles exist as governed expert_rules seed (published,
 *     machine-enforceable ai_instructions, Source Onboarding classification
 *     tags per docs/enterprise/SOURCE_ONBOARDING_CONTRACT.md), and
 *  B. each principle's enforcement point exists in code — so deleting the
 *     G4 gate, the toolsAllowlist wire, the budget thresholds or the SSRF
 *     defense rule breaks this gate, not just the doctrine.
 *
 * Runtime proof (which principles were actually used per run) is the
 * knowledge_attribution trail; behavioral proof is the conformance eval suite
 * on the benchmark harness (impl/16 §4.1) — this gate is the cheap static
 * layer of the three.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf-8");

const SEED = "aisha/db/seed/core/38_anthropic_operating_principles.sql";

const PRINCIPLE_SLUGS = [
  "anthropic-eval-before-model-migration",
  "anthropic-countermeasure-before-downgrade",
  "anthropic-diagnose-before-model-swap",
  "anthropic-context-as-finite-resource",
  "anthropic-safety-hook-on-destructive",
  "anthropic-typed-output-for-pipelines",
];

describe("Anthropic principles — governed KB (impl/16 §3)", () => {
  test("all 6 principles are seeded as published expert_rules with ai_instructions", () => {
    const seed = read(SEED);
    for (const slug of PRINCIPLE_SLUGS) {
      expect(seed, `missing principle rule: ${slug}`).toContain(`'${slug}'`);
    }
    // every INSERT carries an enforceable directive + published status
    const inserts = seed.split("INSERT INTO expert_rules").length - 1;
    expect(inserts, "expected 6 principle inserts").toBe(6);
    expect((seed.match(/RULE:/g) ?? []).length, "each rule needs a machine-enforceable ai_instructions directive").toBeGreaterThanOrEqual(6);
    expect((seed.match(/'published'/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  test("rules carry the mandatory Source Onboarding classification (4 dimensions)", () => {
    const seed = read(SEED);
    for (const tag of [
      "source_type:external",
      "data_sensitivity:public",
      "retention_class:long_term",
      "legal_basis:legitimate_interest",
    ]) {
      const count = (seed.match(new RegExp(tag, "g")) ?? []).length;
      expect(count, `classification tag ${tag} must be on all 6 rules`).toBeGreaterThanOrEqual(6);
    }
  });

  test("seed is idempotent and never downgrades a published rule", () => {
    const seed = read(SEED);
    expect((seed.match(/\) ON CONFLICT \(slug\) DO UPDATE SET/g) ?? []).length).toBe(6);
    expect(seed).toMatch(/status = 'published'/);
  });
});

describe("Anthropic principles — enforcement exists (impl/16 §3.3)", () => {
  test("eval-before-model-migration → G4 gate lives in set_active_ai_model_admin", () => {
    const fn = read("aisha/db/sql/functions/set_active_ai_model_admin.sql");
    expect(fn).toMatch(/Eval-before-migration gate/i);
    expect(fn).toMatch(/eval_min_overall_score/);
  });

  test("progressive tool disclosure → route-plan toolsAllowlist is wired in chat.ts", () => {
    const chat = read("services/svc-ai-chat/src/routes/chat.ts");
    expect(chat).toMatch(/applyRouteToolsAllowlist\(/);
  });

  test("context-as-finite-resource → budget/compaction thresholds are governed warm config", () => {
    const seed = read("aisha/db/seed/core/07_system_config.sql");
    expect(seed).toMatch(/context_budget_headroom/);
    expect(seed).toMatch(/compact_threshold/);
    // the compaction LLM call is governed (purpose exists, not hardcoded)
    const resolver = read("services/svc-mcp-knowledge/src/lib/capability-resolver.ts");
    expect(resolver).toMatch(/'chat\.history_compaction'/);
  });

  test("safety-hook-on-destructive → SSRF static defense rule + approval gates stay present", () => {
    const defense = read("aisha/db/seed/core/32_aisha_static_defense_rules.sql");
    expect(defense).toMatch(/aisha-raw-fetch-outside-ssrf-guard/);
    // agent-runner permission gate surface (approval_required) still exists
    const runsTable = read("aisha/db/sql/tables/agent_runs.sql");
    expect(runsTable).toMatch(/approval_required/);
  });

  test("typed-output-for-pipelines → jsonMode is a first-class ChatRequest field in llm-dispatch", () => {
    const types = read("packages/llm-dispatch/src/providers/types.ts");
    expect(types).toMatch(/jsonMode\?:\s*boolean/);
    // Anthropic parity: jsonMode degrades to a JSON-only directive (impl/12 B-3)
    const anthropic = read("packages/llm-dispatch/src/providers/anthropic.ts");
    expect(anthropic).toMatch(/jsonMode/);
  });

  test("countermeasure-before-downgrade → caching + thinking are live in the Anthropic builder (G1/G3)", () => {
    const anthropic = read("packages/llm-dispatch/src/providers/anthropic.ts");
    expect(anthropic, "prompt caching codepoint must exist").toMatch(/cache_control/);
    expect(anthropic, "reasoningEffort → thinking mapping must exist").toMatch(/budget_tokens/);
    expect(anthropic, "one shared body builder (sync/stream/batch)").toMatch(/export function prepareAnthropicBody/);
  });
});
