/**
 * impl 01 (odysseus) — B-5 acceptance tests, written BEFORE the implementation.
 *
 * `route_task` already computes RoutePlan.toolsAllowlist (orchestrationBridge
 * maps raw.tools_allowlist); until now chat.ts ignored it and sent the full
 * channelConfig.allowed_tools catalog to the LLM. applyRouteToolsAllowlist
 * narrows the channel set by the route plan.
 *
 * Contract (impl/12 §B-5):
 *  - result is ALWAYS a subset of channelToolNames (never expands rights)
 *  - empty/absent allowlist → today's behavior (parity)
 *  - flag off → today's behavior (parity)
 *  - disjoint allowlist (no overlap) → fail-open to channel set (parity),
 *    never an empty tool set caused by a route/channel mismatch
 */
import { describe, test, expect } from "vitest";
import {
  applyRouteToolsAllowlist,
  isDynamicToolSelectionEnabled,
} from "../lib/toolSelection.js";

const CHANNEL = ["kb_search", "rag_query", "create_order", "get_profile"];
const ON = { enabled: true };

describe("applyRouteToolsAllowlist — narrowing", () => {
  test("intersects channel tools with the route allowlist, preserving channel order", () => {
    const out = applyRouteToolsAllowlist(CHANNEL, ["rag_query", "kb_search"], ON);
    expect(out).toEqual(["kb_search", "rag_query"]);
  });

  test("never expands: allowlist entries outside the channel set are dropped", () => {
    const out = applyRouteToolsAllowlist(CHANNEL, ["kb_search", "admin_wipe_db"], ON);
    expect(out).toEqual(["kb_search"]);
    expect(out).not.toContain("admin_wipe_db");
  });

  test("subset invariant holds for every result", () => {
    const samples: Array<string[] | undefined> = [
      ["rag_query"],
      ["nonexistent"],
      [],
      undefined,
      ["get_profile", "create_order", "extra"],
    ];
    for (const allowlist of samples) {
      const out = applyRouteToolsAllowlist(CHANNEL, allowlist, ON);
      expect(out.every((t) => CHANNEL.includes(t)), `subset violated for ${JSON.stringify(allowlist)}`).toBe(true);
    }
  });

  test("duplicate allowlist entries do not duplicate results", () => {
    const out = applyRouteToolsAllowlist(CHANNEL, ["kb_search", "kb_search"], ON);
    expect(out).toEqual(["kb_search"]);
  });
});

describe("applyRouteToolsAllowlist — parity fallbacks", () => {
  test("empty allowlist → channel set unchanged (no narrowing signal)", () => {
    expect(applyRouteToolsAllowlist(CHANNEL, [], ON)).toEqual(CHANNEL);
  });

  test("undefined allowlist → channel set unchanged", () => {
    expect(applyRouteToolsAllowlist(CHANNEL, undefined, ON)).toEqual(CHANNEL);
  });

  test("null allowlist → channel set unchanged", () => {
    expect(applyRouteToolsAllowlist(CHANNEL, null, ON)).toEqual(CHANNEL);
  });

  test("flag off → channel set unchanged even with a narrowing allowlist (parity)", () => {
    expect(applyRouteToolsAllowlist(CHANNEL, ["kb_search"], { enabled: false })).toEqual(CHANNEL);
  });

  test("disjoint allowlist → fail-open to channel set (route/channel mismatch must not zero the tools)", () => {
    expect(applyRouteToolsAllowlist(CHANNEL, ["unknown_a", "unknown_b"], ON)).toEqual(CHANNEL);
  });

  test("empty channel set stays empty regardless of allowlist", () => {
    expect(applyRouteToolsAllowlist([], ["kb_search"], ON)).toEqual([]);
  });
});

describe("isDynamicToolSelectionEnabled — flag convention", () => {
  test("default off (unset env)", () => {
    expect(isDynamicToolSelectionEnabled({})).toBe(false);
  });
  test("explicit opt-in only ('true')", () => {
    expect(isDynamicToolSelectionEnabled({ DYNAMIC_TOOL_SELECTION: "true" })).toBe(true);
    expect(isDynamicToolSelectionEnabled({ DYNAMIC_TOOL_SELECTION: "1" })).toBe(false);
    expect(isDynamicToolSelectionEnabled({ DYNAMIC_TOOL_SELECTION: "false" })).toBe(false);
  });
});
