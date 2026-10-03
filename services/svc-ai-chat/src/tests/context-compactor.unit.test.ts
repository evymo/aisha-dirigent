/**
 * impl 03 (odysseus) — compaction glue acceptance tests (B-6), written first.
 *
 * Contract:
 *  - history over compact_threshold × budget → old turns summarized via the
 *    injected summarize callback (governed chat.history_compaction purpose);
 *    the recent tail stays VERBATIM; the summary is provenance-labeled
 *  - below threshold / null budget → untouched (parity)
 *  - summarize failure → graceful fallback to plain oldest-first trim
 *    (compaction must never take the chat down)
 *  - post-summary result still over budget → hard budget enforcement applies
 */
import { describe, test, expect } from "vitest";
import { compactHistoryIfNeeded, COMPACTION_SUMMARY_PREFIX } from "../lib/contextCompactor.js";

const msg = (role: "user" | "assistant", chars: number, tag = "") => ({
  role,
  content: tag + "x".repeat(Math.max(0, chars - tag.length)),
});

const CFG = { compactThreshold: 0.85, compactKeepLastTurns: 2, compactSummaryMaxTokens: 256 };

describe("compactHistoryIfNeeded", () => {
  test("below threshold → identity, summarize never called", async () => {
    let called = 0;
    const history = [msg("user", 400), msg("assistant", 400)];
    const out = await compactHistoryIfNeeded({
      history,
      budgetTokens: 100_000,
      cfg: CFG,
      summarize: async () => {
        called++;
        return "summary";
      },
    });
    expect(out.compacted).toBe(false);
    expect(out.history).toEqual(history);
    expect(called).toBe(0);
  });

  test("null budget → identity (parity — never compact without a known window)", async () => {
    const history = [msg("user", 40_000), msg("assistant", 40_000), msg("user", 40_000)];
    const out = await compactHistoryIfNeeded({
      history,
      budgetTokens: null,
      cfg: CFG,
      summarize: async () => "summary",
    });
    expect(out.compacted).toBe(false);
    expect(out.history).toEqual(history);
  });

  test("over threshold → head summarized, tail verbatim, summary labeled", async () => {
    const history = [
      msg("user", 4_000, "OLD1:"),
      msg("assistant", 4_000, "OLD2:"),
      msg("user", 4_000, "NEW1:"),
      msg("assistant", 4_000, "NEW2:"),
    ];
    const out = await compactHistoryIfNeeded({
      history,
      budgetTokens: 4_000, // history ~4k tokens > 0.85 × 4000
      cfg: CFG,
      summarize: async (head) => {
        expect(head).toHaveLength(2);
        expect(head[0].content.startsWith("OLD1:")).toBe(true);
        return "users discussed OLD things";
      },
    });
    expect(out.compacted).toBe(true);
    expect(out.history).toHaveLength(3); // summary + 2 verbatim tail turns
    expect(out.history[0].role).toBe("assistant");
    expect(out.history[0].content.startsWith(COMPACTION_SUMMARY_PREFIX)).toBe(true);
    expect(out.history[0].content).toContain("users discussed OLD things");
    expect(out.history[1].content.startsWith("NEW1:")).toBe(true);
    expect(out.history[2].content.startsWith("NEW2:")).toBe(true);
  });

  test("summarize failure → fallback to plain trim (never throws, tail intact)", async () => {
    const history = [
      msg("user", 4_000, "OLD1:"),
      msg("assistant", 4_000, "OLD2:"),
      msg("user", 4_000, "NEW1:"),
      msg("assistant", 4_000, "NEW2:"),
    ];
    const out = await compactHistoryIfNeeded({
      history,
      budgetTokens: 2_100,
      cfg: CFG,
      summarize: async () => {
        throw new Error("resolver down");
      },
    });
    expect(out.compacted).toBe(true);
    expect(out.fallback).toBe(true);
    expect(out.history.length).toBeLessThan(history.length);
    const last = out.history[out.history.length - 1];
    expect(last.content.startsWith("NEW2:")).toBe(true);
  });

  test("empty summary → fallback trim (an empty block must not replace history)", async () => {
    const history = [msg("user", 4_000), msg("assistant", 4_000), msg("user", 4_000), msg("assistant", 4_000)];
    const out = await compactHistoryIfNeeded({
      history,
      budgetTokens: 2_100,
      cfg: CFG,
      summarize: async () => "   ",
    });
    expect(out.fallback).toBe(true);
  });

  test("history shorter than keepLastTurns → identity (nothing to compact)", async () => {
    const history = [msg("user", 40_000)];
    const out = await compactHistoryIfNeeded({
      history,
      budgetTokens: 1_000,
      cfg: CFG,
      summarize: async () => "s",
    });
    expect(out.compacted).toBe(false);
    expect(out.history).toEqual(history);
  });
});
