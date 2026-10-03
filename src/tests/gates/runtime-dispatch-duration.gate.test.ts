/**
 * GATE: runtime_dispatch captures real dispatch latency (L0 measurability).
 *
 * Fix on failure: measure elapsed time around executeViaRuntime and pass it to
 * fn_log_runtime_dispatch_trace as p_duration_ms — never hard-code `p_duration_ms: null`, or the
 * outcome read (fn_get_decision_outcomes) and Langfuse lose the per-dispatch latency signal.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SRC = readFileSync(
  join(ROOT, "services/svc-ai-chat/src/reflection/nodes/runtime_dispatch.ts"),
  "utf8",
);

describe("runtime_dispatch — dispatch latency captured (L0)", () => {
  it("does not hard-code p_duration_ms: null", () => {
    expect(
      SRC,
      "runtime_dispatch must measure latency, not pass `p_duration_ms: null` to the trace",
    ).not.toMatch(/p_duration_ms:\s*null/);
  });

  it("measures duration around executeViaRuntime and passes it to the trace", () => {
    expect(SRC, "must capture a start timestamp (Date.now())").toMatch(/Date\.now\(\)/);
    expect(SRC, "must pass a computed duration to p_duration_ms").toMatch(
      /p_duration_ms:\s*Date\.now\(\)\s*-/,
    );
  });
});
