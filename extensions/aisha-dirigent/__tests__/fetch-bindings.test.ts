/**
 * Tests for the live-RPC fetch with offline fallback semantics.
 *
 * Focus: the defensive parser must REJECT any malformed RPC payload (return
 * null) so the orchestrator falls back to the bundled JSON mirror, which is
 * byte-checked against the SQL seed by the claude-overlay-drift gate test.
 *
 * Rendering garbage hooks from a corrupted RPC response would be far worse
 * than running on stale-but-known-correct bundled data.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { parseBindings, fetchClaudeHookBindings } from "../src/generators/fetch-bindings";
// The SAME bundled mirror the production offline path parses (rules-engine
// fallback) — used by the round-trip drift guard at the bottom of this file.
import bindingsMirror from "../../../aisha/db/seed/claude_hook_bindings.json";

vi.mock("../src/backend-rpc", () => ({
  callRpc: vi.fn(),
}));

import { callRpc } from "../src/backend-rpc";
const mockedCallRpc = vi.mocked(callRpc);

beforeEach(() => {
  mockedCallRpc.mockReset();
});

describe("parseBindings — defensive parser", () => {
  it("accepts well-formed RPC array with required fields", () => {
    const raw = [
      {
        rule_slug: "rpc-only",
        hook_event: "PreToolUse",
        matcher: "Edit|Write|MultiEdit",
        scanner_kind: "regex",
        pattern_regex: "\\.from\\(",
        messages: { cs: "test cs", en: "test en" },
        hint: "tip",
        cooldown_sec: 45,
        severity: "high",
      },
    ];
    const out = parseBindings(raw);
    expect(out).toHaveLength(1);
    expect(out![0].rule_slug).toBe("rpc-only");
    expect(out![0].severity).toBe("high");
  });

  it("returns null on non-array input", () => {
    expect(parseBindings(null)).toBeNull();
    expect(parseBindings("not array")).toBeNull();
    expect(parseBindings(42)).toBeNull();
    expect(parseBindings({})).toBeNull();
  });

  it("returns null if ANY item is malformed (atomic — no partial bindings)", () => {
    const validItem = {
      rule_slug: "a",
      hook_event: "PreToolUse",
      matcher: "Edit",
      scanner_kind: "regex",
      pattern_regex: "x",
      messages: { cs: "cs", en: "en" },
      cooldown_sec: 45,
      severity: "low",
    };
    const out = parseBindings([validItem, { rule_slug: "missing-other-fields" }]);
    expect(out).toBeNull();
  });

  it("rejects scanner_kind=regex without pattern_regex (CHECK constraint mirror)", () => {
    const broken = {
      rule_slug: "broken",
      hook_event: "PreToolUse",
      matcher: "Edit",
      scanner_kind: "regex",
      // pattern_regex MISSING
      messages: { cs: "cs", en: "en" },
      cooldown_sec: 45,
      severity: "low",
    };
    expect(parseBindings([broken])).toBeNull();
  });

  it("accepts scanner_kind=heuristic without pattern_regex", () => {
    const heuristic = {
      rule_slug: "i18n",
      hook_event: "PreToolUse",
      matcher: "Edit|Write|MultiEdit",
      scanner_kind: "heuristic",
      pattern_regex: null,
      messages: { cs: "cs", en: "en" },
      cooldown_sec: 45,
      severity: "moderate",
    };
    expect(parseBindings([heuristic])).toHaveLength(1);
  });

  it("accepts scanner_kind=relay with config and preserves it (config-driven scanner)", () => {
    // This is the exact regression: the parser used to reject every non-regex/
    // -heuristic kind and collapse the whole array to null, blanking the overlay.
    const relay = {
      rule_slug: "supervisor-relay",
      hook_event: "PreToolUse",
      matcher: "*",
      scanner_kind: "relay",
      pattern_regex: null,
      messages: { cs: "cs", en: "en" },
      cooldown_sec: 0,
      severity: "low",
      config: { endpoint_path: "/dirigent/dispatch", events: [{ arg: "stop", hook_event: "Stop" }] },
    };
    const out = parseBindings([relay]);
    expect(out).toHaveLength(1);
    expect(out![0].scanner_kind).toBe("relay");
    expect(out![0].pattern_regex).toBeNull();
    expect(out![0].config).toEqual(relay.config);
  });

  it("rejects scanner_kind=relay WITHOUT config (config-driven scanners require config)", () => {
    const noConfig = {
      rule_slug: "supervisor-relay",
      hook_event: "PreToolUse",
      matcher: "*",
      scanner_kind: "relay",
      pattern_regex: null,
      messages: { cs: "cs", en: "en" },
      cooldown_sec: 0,
      severity: "low",
      // config MISSING — a relay with nothing to do is a malformed payload.
    };
    expect(parseBindings([noConfig])).toBeNull();
  });

  it("accepts scanner_kind=snapshot with config (the other config-driven kind)", () => {
    const snapshot = {
      rule_slug: "workflow-snapshot",
      hook_event: "PostToolUse",
      matcher: "Agent",
      scanner_kind: "snapshot",
      pattern_regex: null,
      messages: { cs: "cs", en: "en" },
      cooldown_sec: 10,
      severity: "low",
      config: { events: [{ arg: "post_tool", hook_event: "PostToolUse", matcher: "Agent" }] },
    };
    expect(parseBindings([snapshot])).toHaveLength(1);
  });

  it("rejects invalid severity / scanner_kind enum values", () => {
    const baseValid = {
      rule_slug: "x",
      hook_event: "PreToolUse",
      matcher: "Edit",
      pattern_regex: "y",
      messages: { cs: "cs", en: "en" },
      cooldown_sec: 45,
    };
    expect(
      parseBindings([{ ...baseValid, scanner_kind: "ml-classifier", severity: "high" }]),
    ).toBeNull();
    expect(
      parseBindings([{ ...baseValid, scanner_kind: "regex", severity: "critical" }]),
    ).toBeNull();
  });

  it("normalizes optional fields to null when absent or wrong type", () => {
    const minimal = {
      rule_slug: "x",
      hook_event: "PreToolUse",
      matcher: "Edit",
      scanner_kind: "regex" as const,
      pattern_regex: "y",
      messages: { cs: "cs", en: "en" },
      cooldown_sec: 45,
      severity: "low" as const,
      // hint MISSING
    };
    const out = parseBindings([minimal]);
    expect(out![0].hint).toBeNull();
    // Pattern matchers carry no config — normalized to null, not left undefined.
    expect(out![0].config).toBeNull();
  });

  it("returns empty array on empty input array (not null — distinct signals)", () => {
    expect(parseBindings([])).toEqual([]);
  });
});

describe("parseBindings — real-seed round-trip (drift guard)", () => {
  // The production offline path parses THIS exact mirror (rules-engine.ts
  // fallback). The relay-kind regression escaped precisely because every other
  // parser test above uses hand-built fixtures — none fed the parser the real
  // SoT. Feeding it the actual seed makes any future scanner_kind / shape
  // addition that the parser doesn't yet understand fail loudly HERE, in the
  // parser's own unit, instead of silently blanking the overlay downstream.
  const seed = (bindingsMirror as { bindings: unknown[] }).bindings;

  it("parses EVERY binding in the bundled seed — no kind is silently dropped", () => {
    const out = parseBindings(seed);
    expect(out).not.toBeNull();
    expect(out!).toHaveLength(seed.length);
  });

  it("preserves the relay binding's config (the regression that blanked the overlay)", () => {
    const out = parseBindings(seed);
    const relay = out!.find((b) => b.rule_slug === "supervisor-relay");
    expect(relay, "supervisor-relay must survive the parse").toBeDefined();
    expect(relay!.scanner_kind).toBe("relay");
    expect(relay!.pattern_regex).toBeNull();
    expect(relay!.config).toBeTruthy();
    const events = relay!.config?.events ?? [];
    expect(events.length).toBeGreaterThan(0);
  });
});

describe("fetchClaudeHookBindings — orchestrator fallback contract", () => {
  it("returns parsed bindings when RPC succeeds with valid payload", async () => {
    mockedCallRpc.mockResolvedValueOnce({
      data: [
        {
          rule_slug: "rpc-only",
          hook_event: "PreToolUse",
          matcher: "Edit",
          scanner_kind: "regex",
          pattern_regex: "x",
          messages: { cs: "cs", en: "en" },
          cooldown_sec: 45,
          severity: "high",
        },
      ],
      stats: null,
    });
    const out = await fetchClaudeHookBindings(null);
    expect(out).toHaveLength(1);
    expect(mockedCallRpc).toHaveBeenCalledWith("mcp_get_claude_hook_bindings", {
      p_story_id: null,
    });
  });

  it("returns null when RPC returns null (no token / no gateway)", async () => {
    mockedCallRpc.mockResolvedValueOnce({ data: null, stats: null });
    expect(await fetchClaudeHookBindings(null)).toBeNull();
  });

  it("returns null when RPC returns malformed payload (defensive parse fails)", async () => {
    mockedCallRpc.mockResolvedValueOnce({ data: { not: "array" }, stats: null });
    expect(await fetchClaudeHookBindings(null)).toBeNull();
  });

  it("passes p_story_id when provided (story-scoped bindings)", async () => {
    mockedCallRpc.mockResolvedValueOnce({ data: [], stats: null });
    await fetchClaudeHookBindings("story-uuid-123");
    expect(mockedCallRpc).toHaveBeenCalledWith("mcp_get_claude_hook_bindings", {
      p_story_id: "story-uuid-123",
    });
  });
});
