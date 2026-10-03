/**
 * Omni acceptance — streaming-routing — classifyMessageComplexity tier boundaries.
 *
 * AREA: Mandatory complexity routing as a contract (spec §6.5, §20 P0 #6, §19.3).
 * KIND: unit. LIVE — `classifyMessageComplexity` exists today at
 *   services/svc-ai-chat/src/lib/orchestrationBridge.ts:1034 (pure heuristic).
 *
 * These tests assert the EXACT tier-boundary CONTRACT the §6.5 routing keys off:
 *     greeting | simple | moderate  → tier 1/2 lane → SSE
 *     complex  | deep_analysis      → tier 3+  lane → 202 + X-Stream-Poll-URL
 *
 * RESOLUTION CONVENTION (matches router-consolidation.omni.spec.ts in this suite):
 *   orchestrationBridge.ts is NOT import-safe — its module scope top-imports
 *   `@aisha/security` (createSafeLogger, orchestrationBridge.ts:43), a workspace
 *   package that ships only built dist/ (absent in a source checkout), so Vite
 *   cannot resolve its entry and a runtime `import()` poisons the whole suite file.
 *   The repo's gate/acceptance convention for non-import-safe modules is
 *   SOURCE-LEVEL assertion via readFileSync. We therefore assert the real, declared
 *   scoring thresholds + tier-mapping + greeting override that DEFINE the boundary,
 *   plus the 5-tier enum the lane decision partitions. This is a LIVE contract
 *   guard on the genuine classifier source — not a reimplementation, and it flips
 *   RED if anyone moves a boundary that would silently re-route a lane.
 *
 * Runtime tier↔lane behaviour is additionally exercised end-to-end (through the
 * real classifier inside the running service) by e2e/omni/streaming-routing.spec.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../../..");
const BRIDGE = path.join(ROOT, "services/svc-ai-chat/src/lib/orchestrationBridge.ts");
const src = readFileSync(BRIDGE, "utf-8");

// Slice of classifyMessageComplexity (orchestrationBridge.ts:1034-1086).
const fnStart = src.indexOf("export function classifyMessageComplexity");
const fnBody = src.slice(fnStart, src.indexOf("\n}", fnStart) + 2);

describe("[omni][streaming-routing] classifyMessageComplexity tier-boundary contract (LIVE §6.5)", () => {
  it("baseline: the classifier the routing contract keys off still exists", () => {
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnBody).toContain("score");
  });

  // ── POSITIVE: the 5-tier enum the SSE/202 lane decision partitions ──────────
  it("POSITIVE: MessageComplexity is exactly the 5 declared tiers (lanes partition these)", () => {
    // orchestrationBridge.ts:990
    expect(src).toContain(
      'export type MessageComplexity = "greeting" | "simple" | "moderate" | "complex" | "deep_analysis"',
    );
  });

  // ── POSITIVE: stream-lane boundaries (low scores → greeting/simple/moderate) ─
  it("POSITIVE: low-word-count messages score into the stream lane (score 0-1 → simple)", () => {
    expect(fnBody).toMatch(/wordCount <= 5\) score \+= 0/);
    expect(fnBody).toMatch(/score <= 1\) return "simple"/);
  });

  it("POSITIVE: a bare greeting overrides scoring → 'greeting' (cheapest stream tier)", () => {
    // wordCount<=8 + GREETING_PATTERNS override (orchestrationBridge.ts:1077).
    expect(fnBody).toMatch(/wordCount <= 8 && GREETING_PATTERNS\.some/);
    expect(fnBody).toMatch(/return "greeting"/);
  });

  it("POSITIVE: mid scores stay in the stream lane ('moderate' for score 2-3)", () => {
    expect(fnBody).toMatch(/score <= 3\) return "moderate"/);
  });

  // ── POSITIVE: async-lane boundaries (high scores → complex/deep_analysis) ────
  it("POSITIVE: score 4-6 crosses into the async lane ('complex' → 202)", () => {
    expect(fnBody).toMatch(/score <= 6\) return "complex"/);
  });

  it("POSITIVE: score >6 is the deepest async tier ('deep_analysis' → 202)", () => {
    // Final fall-through return after the score<=6 check.
    expect(fnBody).toMatch(/return "deep_analysis"/);
  });

  it("POSITIVE: analytical/technical/escalation intent ADDS score (pushes toward async lane)", () => {
    // The multipliers that move a borderline prompt across the stream→async boundary.
    expect(fnBody).toMatch(/hasAnalyticalRequest\) score \+= 3/);
    expect(fnBody).toMatch(/hasCodeOrTechnical\) score \+= 2/);
    expect(fnBody).toMatch(/escalationSignals\.length > 0\) score \+= 2/);
    expect(fnBody).toMatch(/hasMultipleQuestions\) score \+= 2/);
  });

  // ── NEGATIVE: the boundary thresholds are ORDERED & non-overlapping, so a tier
  //    can never map to two lanes. If the cutoffs ever overlap, routing is
  //    ambiguous and this guard fails. ─────────────────────────────────────────
  it("NEGATIVE: tier cutoffs are strictly ascending (1 < 3 < 6) — no ambiguous lane", () => {
    const cuts = [...fnBody.matchAll(/score <= (\d+)\) return "(\w+)"/g)].map((m) => [
      Number(m[1]),
      m[2],
    ]) as Array<[number, string]>;
    // Expect simple(<=1), moderate(<=3), complex(<=6) in ascending order.
    expect(cuts.map((c) => c[1])).toEqual(["simple", "moderate", "complex"]);
    expect(cuts.map((c) => c[0])).toEqual([1, 3, 6]);
    for (let i = 1; i < cuts.length; i++) {
      expect(cuts[i][0]).toBeGreaterThan(cuts[i - 1][0]);
    }
  });

  // ── FALSE-POSITIVE GUARD: analytical intent must outweigh brevity. A SHORT but
  //    analytical prompt must not score into the stream lane. The analytical
  //    multiplier (+3) alone exceeds the simple cutoff (<=1), so a short analytical
  //    prompt cannot be silently downgraded to 'simple' — guarding §6.5's
  //    "mis-classified as simple must not silently downgrade complex work". ─────
  it("FALSE-POSITIVE GUARD: analytical multiplier (+3) alone exceeds the 'simple' cutoff (<=1)", () => {
    const analyticalBump = Number(
      (fnBody.match(/hasAnalyticalRequest\) score \+= (\d+)/) ?? [])[1],
    );
    const simpleCut = Number((fnBody.match(/score <= (\d+)\) return "simple"/) ?? [])[1]);
    expect(analyticalBump).toBeGreaterThan(simpleCut); // 3 > 1 → cannot stay 'simple'
  });

  it("FALSE-POSITIVE GUARD: the greeting fast-path is gated by word count (long text never 'greeting')", () => {
    // A long analytical message starting with "hi, ..." must NOT shortcut to greeting —
    // the wordCount<=8 guard prevents a long body from grabbing the cheapest lane.
    expect(fnBody).toMatch(/wordCount <= 8 && GREETING_PATTERNS/);
  });
});
