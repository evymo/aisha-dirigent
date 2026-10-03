/**
 * Tests for the Rules Engine — cache TTL, fallback semantics, evaluate
 * behaviour on regex bindings.
 *
 * Mocks `./generators/fetch-bindings` so we can drive the live-RPC path
 * deterministically (success / null / mixed) without a running gateway.
 * The bundled JSON mirror is loaded from disk by the real module (the
 * Vite raw-text loader serves it as `import` of a parsed object).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Uri } from "vscode";

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

vi.mock("../src/generators/fetch-bindings", async () => {
  const actual = await vi.importActual<typeof import("../src/generators/fetch-bindings")>(
    "../src/generators/fetch-bindings",
  );
  return {
    ...actual,
    fetchClaudeHookBindings: mockFetch,
  };
});

import {
  evaluate,
  loadBindings,
  invalidateCache,
  _resetCacheForTests,
} from "../src/rules-engine";

const ROOT = Uri.file("/tmp/aisha-rules-test");

const VALID_LIVE_BINDING = {
  rule_slug: "live-only-rule",
  hook_event: "PreToolUse",
  matcher: "Edit|Write|MultiEdit",
  scanner_kind: "regex" as const,
  pattern_regex: "LIVE_SENTINEL",
  messages: { cs: "live ze serveru", en: "live from server" },
  hint: null,
  cooldown_sec: 45,
  severity: "high" as const,
};

beforeEach(() => {
  mockFetch.mockReset();
  _resetCacheForTests();
});

describe("loadBindings — cache + fallback", () => {
  it("returns live bindings when RPC succeeds", async () => {
    mockFetch.mockResolvedValueOnce([VALID_LIVE_BINDING]);
    const result = await loadBindings({ ttlMs: 1000 });
    expect(result.source).toBe("live");
    expect(result.bindings).toHaveLength(1);
    expect(result.bindings[0].rule_slug).toBe("live-only-rule");
  });

  it("falls back to bundled mirror when RPC returns null", async () => {
    mockFetch.mockResolvedValueOnce(null);
    const result = await loadBindings({});
    expect(result.source).toBe("bundled");
    expect(result.bindings.length).toBeGreaterThan(0);
    // The 5 known regex rules must all be present. Filter by kind first so the
    // assertion stays correct as config-driven kinds (relay/snapshot) are added
    // to the same seed — it asserts the regex SET, not the whole binding count.
    const regexSlugs = result.bindings
      .filter((b) => b.scanner_kind === "regex")
      .map((b) => b.rule_slug)
      .sort();
    expect(regexSlugs).toEqual(["no-any", "no-console", "rpc-only", "select-star", "ts-ignore"]);
  });

  it("bundled fallback preserves the relay binding with config (drift guard)", async () => {
    // Regression: parseBindings used to reject scanner_kind='relay' and return
    // null for the WHOLE array → fallback collapsed to [] → 0 bindings → the
    // supervision overlay broke. The fallback must carry every seed binding.
    mockFetch.mockResolvedValueOnce(null);
    const result = await loadBindings({});
    expect(result.source).toBe("bundled");
    const relay = result.bindings.find((b) => b.rule_slug === "supervisor-relay");
    expect(relay, "relay binding must survive the offline parse").toBeDefined();
    expect(relay!.scanner_kind).toBe("relay");
    expect(relay!.config?.events?.length ?? 0).toBeGreaterThan(0);
  });

  it("falls back to bundled mirror when RPC returns empty array", async () => {
    mockFetch.mockResolvedValueOnce([]);
    const result = await loadBindings({});
    expect(result.source).toBe("bundled");
    expect(result.bindings.length).toBeGreaterThan(0);
  });

  it("falls back to bundled mirror when RPC throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"));
    const result = await loadBindings({});
    expect(result.source).toBe("bundled");
  });

  it("cache hit within TTL — second call does not re-fetch", async () => {
    mockFetch.mockResolvedValueOnce([VALID_LIVE_BINDING]);
    await loadBindings({ ttlMs: 60_000 });
    await loadBindings({ ttlMs: 60_000 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("force=true bypasses cache", async () => {
    mockFetch.mockResolvedValue([VALID_LIVE_BINDING]);
    await loadBindings({});
    await loadBindings({ force: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("invalidateCache() clears cache", async () => {
    mockFetch.mockResolvedValue([VALID_LIVE_BINDING]);
    await loadBindings({});
    invalidateCache();
    await loadBindings({});
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("expired cache (TTL=0) re-fetches", async () => {
    mockFetch.mockResolvedValue([VALID_LIVE_BINDING]);
    await loadBindings({ ttlMs: 0 });
    await loadBindings({ ttlMs: 0 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("passes storyId through to the RPC call", async () => {
    mockFetch.mockResolvedValueOnce([VALID_LIVE_BINDING]);
    await loadBindings({ storyId: "story-uuid-123" });
    expect(mockFetch).toHaveBeenCalledWith("story-uuid-123");
  });
});

describe("evaluate — regex matching against signals", () => {
  it("matches a single rule on .from(...).select() pattern", async () => {
    mockFetch.mockResolvedValueOnce(null); // → fallback to bundled (5 rules)
    const matches = await evaluate(
      {
        source: "editor",
        type: "edit-content",
        message: 'const data = await apiClient.from("users").select("id");',
        timestamp: new Date().toISOString(),
      },
      { rootUri: ROOT },
    );
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.some((m) => m.rule_id === "rpc-only")).toBe(true);
  });

  it("matches MULTIPLE rules when signal contains multiple violations", async () => {
    mockFetch.mockResolvedValueOnce(null);
    const matches = await evaluate(
      {
        source: "editor",
        type: "edit-content",
        message: 'const data = await apiClient.from("users").select("*"); console.log(data);',
        timestamp: new Date().toISOString(),
      },
      { rootUri: ROOT },
    );
    const slugs = matches.map((m) => m.rule_id).sort();
    expect(slugs).toContain("rpc-only");
    expect(slugs).toContain("select-star");
    expect(slugs).toContain("no-console");
  });

  it("returns empty array when signal matches NO rules", async () => {
    mockFetch.mockResolvedValueOnce(null);
    const matches = await evaluate(
      {
        source: "editor",
        type: "edit-content",
        message: "// totally clean code, no violations here",
        timestamp: new Date().toISOString(),
      },
      { rootUri: ROOT },
    );
    expect(matches).toHaveLength(0);
  });

  it("severity high → decision 'warn'", async () => {
    mockFetch.mockResolvedValueOnce([
      { ...VALID_LIVE_BINDING, severity: "high", pattern_regex: "FOO" },
    ]);
    const matches = await evaluate(
      {
        source: "editor",
        type: "edit-content",
        message: "this contains FOO",
        timestamp: new Date().toISOString(),
      },
      { rootUri: ROOT },
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].decision).toBe("warn");
    expect(matches[0].severity).toBe("high");
  });

  it("severity moderate → decision 'suggest'", async () => {
    mockFetch.mockResolvedValueOnce([
      { ...VALID_LIVE_BINDING, severity: "moderate", pattern_regex: "BAR" },
    ]);
    const matches = await evaluate(
      {
        source: "editor",
        type: "edit-content",
        message: "see BAR here",
        timestamp: new Date().toISOString(),
      },
      { rootUri: ROOT },
    );
    expect(matches[0].decision).toBe("suggest");
  });

  it("severity low → decision 'suggest' (same lighter-touch as moderate)", async () => {
    mockFetch.mockResolvedValueOnce([
      { ...VALID_LIVE_BINDING, severity: "low", pattern_regex: "BAZ" },
    ]);
    const matches = await evaluate(
      {
        source: "editor",
        type: "edit-content",
        message: "BAZ rule trigger",
        timestamp: new Date().toISOString(),
      },
      { rootUri: ROOT },
    );
    expect(matches[0].decision).toBe("suggest");
  });

  it("NEVER returns decision 'block' or 'escalate' on regex hit (advisory-only invariant)", async () => {
    mockFetch.mockResolvedValueOnce(null);
    const matches = await evaluate(
      {
        source: "editor",
        type: "edit-content",
        message: '.from("users").select("*") console.log() @ts-ignore as any',
        timestamp: new Date().toISOString(),
      },
      { rootUri: ROOT },
    );
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      expect(m.decision).not.toBe("block");
      expect(m.decision).not.toBe("escalate");
    }
  });

  it("match.context carries matched_text + signal_source + bindings_source", async () => {
    mockFetch.mockResolvedValueOnce([
      { ...VALID_LIVE_BINDING, pattern_regex: "LIVE_SENTINEL\\b" },
    ]);
    const matches = await evaluate(
      {
        source: "terminal",
        type: "log-output",
        message: "found LIVE_SENTINEL in stream",
        timestamp: new Date().toISOString(),
      },
      { rootUri: ROOT },
    );
    expect(matches[0].context).toMatchObject({
      matched_text: "LIVE_SENTINEL",
      signal_source: "terminal",
      bindings_source: "live",
    });
  });

  it("skips malformed regex bindings without crashing evaluation", async () => {
    mockFetch.mockResolvedValueOnce([
      { ...VALID_LIVE_BINDING, rule_slug: "broken-regex", pattern_regex: "[unclosed(" },
      { ...VALID_LIVE_BINDING, rule_slug: "ok-rule", pattern_regex: "GOOD" },
    ]);
    const matches = await evaluate(
      {
        source: "editor",
        type: "edit-content",
        message: "this matches GOOD just fine",
        timestamp: new Date().toISOString(),
      },
      { rootUri: ROOT },
    );
    // broken-regex skipped silently; ok-rule still fires
    expect(matches).toHaveLength(1);
    expect(matches[0].rule_id).toBe("ok-rule");
  });
});

describe("loadBindings — concurrency + edge cases (gap-fill)", () => {
  it("concurrent first-call: both awaits get the same cached result (no double-fetch race)", async () => {
    // mockResolvedValue (not Once) — concurrent loads may both call before
    // either has populated the cache. Today's implementation does NOT
    // dedupe in-flight fetches; both calls hit fetchClaudeHookBindings()
    // and both populate the cache idempotently. Acceptable for MVP
    // (60s TTL means at most 1 collision per minute).
    mockFetch.mockResolvedValue([VALID_LIVE_BINDING]);
    const [a, b] = await Promise.all([loadBindings({}), loadBindings({})]);
    expect(a.bindings).toEqual(b.bindings);
    expect(a.source).toBe("live");
    // Locks in the observed-today behaviour: both calls fire.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("scanner_kind='heuristic' bindings are skipped by regex evaluator", async () => {
    mockFetch.mockResolvedValueOnce([
      {
        ...VALID_LIVE_BINDING,
        rule_slug: "heuristic-only",
        scanner_kind: "heuristic" as const,
        pattern_regex: null,
      },
    ]);
    const matches = await evaluate(
      {
        source: "editor",
        type: "edit-content",
        message: "LIVE_SENTINEL would match if scanner_kind were regex",
        timestamp: new Date().toISOString(),
      },
      { rootUri: ROOT },
    );
    expect(matches).toHaveLength(0);
  });

  it("regex binding with pattern_regex=null is skipped (defense beyond CHECK constraint)", async () => {
    mockFetch.mockResolvedValueOnce([
      // CHECK constraint at DB level prevents this row from being
      // inserted, but evaluate() MUST still defend against the possibility
      // (corrupt RPC response, manual UPDATE, etc.)
      { ...VALID_LIVE_BINDING, rule_slug: "regex-no-pattern", pattern_regex: null as unknown as string },
    ]);
    const matches = await evaluate(
      {
        source: "editor",
        type: "edit-content",
        message: "LIVE_SENTINEL here",
        timestamp: new Date().toISOString(),
      },
      { rootUri: ROOT },
    );
    expect(matches).toHaveLength(0);
  });
});
