/**
 * Sentry Rollback — Wired + Gated Gate (PR 3)
 *
 * WF_SENTRY_OBSERVER detects post-deploy incidents and, on error_rate_spike,
 * must REQUEST a rollback via request_rollback() — which inserts a PENDING
 * rollback that requires human approval (WF_APPROVAL_GATE) before execution.
 *
 * Invariant (advisory-only / least-privilege): the observer REQUESTS, it never
 * EXECUTES. Rollback is always human-approved. This gate ensures the old
 * "fake auto_rollback_initiated" stub stays replaced and no execution path
 * (update_rollback_status) leaks into the observer.
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import type { N8nNode } from "./_types";

const ROOT = process.cwd();
const WF = path.join(ROOT, "n8n/workflows/WF_SENTRY_OBSERVER.json");
const RPC = path.join(ROOT, "aisha/db/sql/functions/request_rollback.sql");

describe("Sentry rollback: wired to request_rollback", () => {
  it("WF_SENTRY_OBSERVER calls request_rollback via aishaRpc (not a TODO stub)", () => {
    const wf = JSON.parse(fs.readFileSync(WF, "utf-8"));
    const rpcNodes = (wf.nodes || []).filter((n: N8nNode) => n.type === "n8n-nodes-aisha.aishaRpc");
    const rb = rpcNodes.find((n: N8nNode) => n.parameters?.functionName === "request_rollback");
    expect(rb, "WF_SENTRY_OBSERVER must call request_rollback via aishaRpc").toBeTruthy();
    expect(rb.parameters?.authMode, "request_rollback call must be service_role").toBe("service_role");
    expect(rb.onError ?? rb.parameters?.onError, "rollback request must fail-open").toBe(
      "continueRegularOutput",
    );
  });

  it("observer never EXECUTES rollback — request only (execution is approval-gated)", () => {
    const text = fs.readFileSync(WF, "utf-8");
    expect(
      /update_rollback_status/.test(text),
      "observer must NOT approve/execute rollback (that is WF_APPROVAL_GATE's job)",
    ).toBe(false);
    expect(
      /auto_rollback_initiated/.test(text),
      "the fake 'auto_rollback_initiated' stub must be replaced by request_rollback",
    ).toBe(false);
  });
});

describe("Sentry rollback: request_rollback SoT is gated", () => {
  it("request_rollback inserts a PENDING request, throttles, and is service_role/admin gated", () => {
    expect(fs.existsSync(RPC), "missing request_rollback.sql SoT").toBe(true);
    const sql = fs.readFileSync(RPC, "utf-8");
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.request_rollback/i);
    expect(sql, "rollback must be inserted as 'pending' (human-approved before execution)").toMatch(
      /'pending'/,
    );
    expect(sql, "must throttle repeated requests").toMatch(/throttle|v_throttle_minutes/i);
    expect(sql, "must be service_role / admin gated").toMatch(/service_role/);
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.request_rollback/i);
  });
});
