/**
 * Omni acceptance — streaming-routing — tier never branches execution (RED regression guard).
 *
 * AREA: Mandatory complexity routing as a contract (spec §6.5, §19.3, §20 P0 #6).
 * KIND: integration (source-contract assertion against the live /chat handler).
 * LIVE + INTENTIONALLY RED — this test PROVES the current bug recorded in the spec:
 *
 *   §19.3: "classifyMessageComplexity běží, ale tier nikdy nevětví exekuci
 *           (chat.ts:875 vždy synchronní engine.execute()) → §6.5 dnes porušeno
 *           pro VŠECHNY requesty."
 *   §1 #2 / §19.3: "chooseExecutionStrategy:1308 + kickOffReflectionWorkflow:1342
 *           — 0 volajících (repo-wide grep)."
 *
 * It is a regression GUARD: it MUST stay red until P0 #6 ("Wire classify/chooseStrategy/
 * kickOff into /chat") lands, and MUST flip green the moment routing branches.
 * We assert on the real source file (the cross-package handler cannot be imported
 * under the root acceptance config — same pattern the repo's gate tests use).
 *
 * NOTE: these are NOT skip-until-impl — the surfaces (chat.ts, the two orchestration
 * functions) all EXIST today; the wiring is what is missing. Per the live-vs-skip
 * rule, a real current bug gets a LIVE assertion that fails now.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const CHAT_TS = path.join(REPO_ROOT, "services/svc-ai-chat/src/routes/chat.ts");
const ORCH_BRIDGE = path.join(REPO_ROOT, "services/svc-ai-chat/src/lib/orchestrationBridge.ts");

function read(p: string): string {
  return readFileSync(p, "utf-8");
}

describe("[omni][streaming-routing] tier-never-branches (LIVE, RED until P0 #6)", () => {
  it("baseline: the orchestration surfaces the contract depends on all still exist", () => {
    const bridge = read(ORCH_BRIDGE);
    // If any of these disappear, the RED tests below would pass for the wrong reason.
    expect(bridge).toContain("export function classifyMessageComplexity");
    expect(bridge).toContain("export async function chooseExecutionStrategy");
    expect(bridge).toContain("export async function kickOffReflectionWorkflow");
  });

  it("baseline: /chat selects a model via selectOptimalModel (classify runs transitively)", () => {
    const chat = read(CHAT_TS);
    // selectOptimalModel() → classifyMessageComplexity() (orchestrationBridge.ts:1219).
    expect(chat).toContain("selectOptimalModel");
  });

  // ── RED GUARD #1 — §6.5: tier MUST branch SSE-vs-202; today it never does. ──
  it("RED: /chat MUST consult complexity tier to choose stream-vs-async (chat.ts:875)", () => {
    const chat = read(CHAT_TS);
    // The handler must read the classified tier and branch on the stream/async
    // boundary (greeting|simple|moderate → SSE; complex|deep_analysis → 202).
    // Today chat.ts unconditionally runs `engine.execute()` regardless of tier.
    const branchesOnTier =
      /classifyMessageComplexity/.test(chat) &&
      /(deep_analysis|complex)/.test(chat) &&
      /(202|X-Stream-Poll-URL|chooseExecutionStrategy)/.test(chat);
    expect(
      branchesOnTier,
      "EXPECTED-RED until P0 #6: chat.ts does not branch execution on complexity tier; " +
        "every request falls through to synchronous engine.execute() (chat.ts:875), " +
        "violating §6.5 for ALL requests.",
    ).toBe(true);
  });

  // ── RED GUARD #2 — §19.3: chooseExecutionStrategy / kickOffReflectionWorkflow
  //    have ZERO callers. The async (tier3+) lane cannot exist without them. ──
  it("RED: /chat MUST call chooseExecutionStrategy to decide sync-vs-async lane", () => {
    const chat = read(CHAT_TS);
    expect(
      chat.includes("chooseExecutionStrategy"),
      "EXPECTED-RED until P0 #6: chooseExecutionStrategy has 0 callers; the tier3+ " +
        "async lane (202 + poll) is unreachable.",
    ).toBe(true);
  });

  it("RED: /chat MUST call kickOffReflectionWorkflow to start the tier3+ run + ai_runs row", () => {
    const chat = read(CHAT_TS);
    expect(
      chat.includes("kickOffReflectionWorkflow"),
      "EXPECTED-RED until P0 #6: kickOffReflectionWorkflow has 0 callers; tier3+ " +
        "requests never create an ai_runs row nor POST /reflect/runs.",
    ).toBe(true);
  });

  // ── FALSE-POSITIVE GUARD: the RED tests must be failing because the WIRING is
  //    absent, not because the function names were renamed/deleted. If the
  //    callee names changed, this catches it and tells us to re-ground the guard. ──
  it("FALSE-POSITIVE GUARD: RED guards key off real, still-exported callee names", () => {
    const bridge = read(ORCH_BRIDGE);
    expect(bridge).toMatch(/export async function chooseExecutionStrategy\(/);
    expect(bridge).toMatch(/export async function kickOffReflectionWorkflow\(/);
    // The async strategy shape the lane decision keys off is { strategy: "sync"|"batch" }.
    expect(bridge).toContain('strategy: "sync" | "batch"');
  });
});
