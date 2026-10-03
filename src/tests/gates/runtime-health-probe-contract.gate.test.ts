/**
 * Gate — runtime health probe contract (static analysis, no live DB).
 *
 * The E3 runtime axis derives the executor from ai_runtime_registry and filters on
 * adapter_health. WF_RUNTIME_HEALTH_PROBE is the DEDICATED probe that keeps that
 * field honest from real service reachability. This gate locks the contract:
 *
 *   - record_runtime_health_result writes the three columns fn_resolve_runtime
 *     reads, validates the enum, audits, and is SERVICE-ROLE ONLY (the field is
 *     GLOBAL — a per-process / authenticated writer would flip-flop it).
 *   - get_runtimes_due_health_probe schedules with NULL-first + exponential backoff,
 *     excluding human + disabled runtimes.
 *   - fn_resolve_runtime excludes only a CONFIRMED 'down' runtime (not degraded/
 *     unknown) — the probe tightens availability, it doesn't gate unprobed runtimes.
 *   - the WF drives the loop via the two RPCs and does NOT report from a single
 *     process's config (no isAvailable/runtimeAdapterHealth reference).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const RECORD_SQL = readFileSync(join(ROOT, "aisha/db/sql/functions/record_runtime_health_result.sql"), "utf8");
const DUE_SQL = readFileSync(join(ROOT, "aisha/db/sql/functions/get_runtimes_due_health_probe.sql"), "utf8");
const RESOLVE_SQL = readFileSync(join(ROOT, "aisha/db/sql/functions/fn_resolve_runtime.sql"), "utf8");
const WF_RAW = readFileSync(join(ROOT, "n8n/workflows/WF_RUNTIME_HEALTH_PROBE.json"), "utf8");

describe("runtime health probe — contract", () => {
  describe("record_runtime_health_result", () => {
    it("is SECURITY DEFINER + service-role only (the GLOBAL field needs one trusted writer)", () => {
      expect(RECORD_SQL).toMatch(/SECURITY DEFINER/i);
      expect(RECORD_SQL).toMatch(/GRANT EXECUTE[\s\S]*TO service_role/i);
      expect(RECORD_SQL, "probe RPC must NOT be callable by authenticated users").not.toMatch(/TO authenticated/i);
    });
    it("updates the three health columns fn_resolve_runtime reads", () => {
      expect(RECORD_SQL).toMatch(/adapter_health\s*=/i);
      expect(RECORD_SQL).toMatch(/adapter_health_checked_at\s*=\s*now\(\)/i);
      expect(RECORD_SQL).toMatch(/consecutive_failure_count\s*=/i);
    });
    it("resets the failure counter on healthy, increments otherwise", () => {
      expect(RECORD_SQL).toMatch(/WHEN p_status = 'healthy' THEN 0/i);
      expect(RECORD_SQL).toMatch(/consecutive_failure_count \+ 1/i);
    });
    it("validates p_status against the adapter_health enum", () => {
      expect(RECORD_SQL).toMatch(/'healthy',\s*'degraded',\s*'down',\s*'unknown'/i);
    });
    it("audits the probe transition (audit_journal action='runtime.health_probed')", () => {
      expect(RECORD_SQL).toMatch(/runtime\.health_probed/);
    });
  });

  describe("get_runtimes_due_health_probe", () => {
    it("is SECURITY DEFINER + service-role only", () => {
      expect(DUE_SQL).toMatch(/SECURITY DEFINER/i);
      expect(DUE_SQL).toMatch(/GRANT EXECUTE[\s\S]*TO service_role/i);
    });
    it("excludes human + disabled runtimes", () => {
      expect(DUE_SQL).toMatch(/is_enabled\s*=\s*true/i);
      expect(DUE_SQL).toMatch(/runtime_kind\s*<>\s*'human'/i);
    });
    it("schedules via adapter_health_checked_at with NULL-first + exponential backoff", () => {
      expect(DUE_SQL).toMatch(/adapter_health_checked_at IS NULL/i);
      expect(DUE_SQL).toMatch(/NULLS FIRST/i);
      expect(DUE_SQL).toMatch(/consecutive_failure_count/i);
    });
  });

  describe("fn_resolve_runtime honors the probe", () => {
    it("excludes a probe-confirmed 'down' runtime", () => {
      expect(RESOLVE_SQL).toMatch(/adapter_health\s*<>\s*'down'/i);
    });
    it("does NOT hard-gate 'degraded'/'unknown' (reachable + unprobed stay usable)", () => {
      expect(RESOLVE_SQL, "the old IN('healthy','unknown') filter would exclude degraded + never-probed").not.toMatch(
        /adapter_health\s+IN\s*\(\s*'healthy'\s*,\s*'unknown'\s*\)/i,
      );
    });
  });

  describe("WF_RUNTIME_HEALTH_PROBE wiring (multi-instance-safe)", () => {
    const wf = JSON.parse(WF_RAW) as { nodes: Array<{ type: string }> };
    it("is a dedicated scheduled probe", () => {
      expect(wf.nodes.some((n) => n.type === "n8n-nodes-base.scheduleTrigger")).toBe(true);
    });
    it("drives the loop via the two RPCs", () => {
      expect(WF_RAW).toMatch(/rpc\/get_runtimes_due_health_probe/);
      expect(WF_RAW).toMatch(/rpc\/record_runtime_health_result/);
    });
    it("reflects SERVICE reachability, NOT a single process's config (no isAvailable/runtimeAdapterHealth)", () => {
      expect(WF_RAW, "the probe must not source health from a process's config-presence").not.toMatch(
        /runtimeAdapterHealth|isAvailable/,
      );
    });
  });
});
