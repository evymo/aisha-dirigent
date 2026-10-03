/**
 * Model-face naming gate
 *
 * The public MODEL face is `ask.<tld>/v1` (the governed Omni surface). "gateway"
 * is a RETIRED public name — it survives only internally (`@aisha/gateway` = the
 * edge-proxy service; `llm-gateway` = the internal theopenco driver container,
 * public:false). So an IDE model napoj (`ANTHROPIC_BASE_URL`/`OPENAI_BASE_URL`)
 * must point at `ask.<tld>`, never `gateway.<tld>`. See
 * docs/planning/AISHA_OMNI_GATEWAY.md §0.6.
 */
import { describe, test, expect } from "vitest";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();

/** git grep hits for `pattern` (extended regex), text files only, minus tests. */
function grepHits(pattern: string): string[] {
  try {
    return execFileSync(
      "git",
      ["grep", "-nIE", pattern, "--", ".", ":!src/tests/gates/**"],
      { cwd: ROOT, encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
  } catch {
    return []; // git grep exits 1 when there are no matches
  }
}

describe("model-face naming: the IDE model napoj is ask, never gateway", () => {
  test("no ANTHROPIC_BASE_URL / OPENAI_BASE_URL points at gateway.<tld>", () => {
    // model napoj env set to a gateway.* host — the retired public name
    const offenders = grepHits("(ANTHROPIC|OPENAI)_BASE_URL[= ]+https?://gateway\\.");
    expect(
      offenders,
      "the public MODEL face is ask.<tld>/v1 — set ANTHROPIC_BASE_URL/OPENAI_BASE_URL to " +
        "https://ask.<tld>/v1 (PAT auth), never gateway.<tld>. The theopenco llm-gateway is an " +
        "internal driver (public:false), not a public IDE endpoint. See AISHA_OMNI_GATEWAY.md §0.6.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
