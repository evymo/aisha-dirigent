/**
 * WF_FIX_PROPOSER Contract Gate (PR 4)
 *
 * WF_FIX_PROPOSER turns an incident signal (sentry/drift) into an
 * improvement_proposal via fn_create_improvement_proposal — which is gated
 * internally (anomaly_key dedup, 3/h rate-limit, risk eval, auto-approve only
 * low-risk/full-autonomy else pending). The observer never applies a fix; it
 * proposes one. This gate validates the workflow + its wiring + the RPC gate.
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import type { N8nNode } from "./_types";

const ROOT = process.cwd();
const FP = path.join(ROOT, "n8n/workflows/WF_FIX_PROPOSER.json");
const SENTRY = path.join(ROOT, "n8n/workflows/WF_SENTRY_OBSERVER.json");
const RPC = path.join(ROOT, "aisha/db/sql/functions/fn_create_improvement_proposal.sql");

describe("WF_FIX_PROPOSER: workflow contract", () => {
  it("exists, parses, webhook path = fix-proposer", () => {
    expect(fs.existsSync(FP), "missing WF_FIX_PROPOSER.json").toBe(true);
    const wf = JSON.parse(fs.readFileSync(FP, "utf-8"));
    const hook = (wf.nodes || []).find((n: N8nNode) => n.type === "n8n-nodes-base.webhook");
    expect(hook?.parameters?.path, "webhook path").toBe("fix-proposer");
  });

  it("creates the proposal via fn_create_improvement_proposal (service_role, fail-open)", () => {
    const wf = JSON.parse(fs.readFileSync(FP, "utf-8"));
    const rpc = (wf.nodes || []).find(
      (n: N8nNode) => n.type === "n8n-nodes-aisha.aishaRpc" && n.parameters?.functionName === "fn_create_improvement_proposal",
    );
    expect(rpc, "must call fn_create_improvement_proposal").toBeTruthy();
    expect(rpc.parameters?.authMode).toBe("service_role");
    expect(rpc.onError ?? rpc.parameters?.onError).toBe("continueRegularOutput");
  });

  it("maps incident → category bug_fix (sentry) / infrastructure_drift (drift) + responds with proposal_id", () => {
    const text = fs.readFileSync(FP, "utf-8");
    expect(text, "must map sentry → bug_fix").toContain("bug_fix");
    expect(text, "must map drift → infrastructure_drift").toContain("infrastructure_drift");
    expect(text, "must surface proposal_id").toContain("proposal_id");
    expect(text, "must dedup via anomaly_key").toContain("anomaly_key");
  });
});

describe("WF_FIX_PROPOSER: wired from observers", () => {
  it("WF_SENTRY_OBSERVER propose path posts to /webhook/fix-proposer", () => {
    const text = fs.readFileSync(SENTRY, "utf-8");
    expect(text, "sentry observer must route propose_fix → fix-proposer webhook").toContain(
      "webhook/fix-proposer",
    );
  });
});

describe("WF_FIX_PROPOSER: fn_create_improvement_proposal SoT is gated", () => {
  it("has anomaly_key dedup + rate-limit + risk eval (no ungated proposal creation)", () => {
    expect(fs.existsSync(RPC), "missing fn_create_improvement_proposal.sql").toBe(true);
    const sql = fs.readFileSync(RPC, "utf-8");
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_create_improvement_proposal/i);
    expect(sql, "dedup via anomaly_key").toMatch(/anomaly_key/);
    expect(sql, "rate limit").toMatch(/rate.?limit|proposals.*hour|interval '1 hour'/i);
    expect(sql, "risk evaluation").toMatch(/fn_evaluate_proposal_risk/);
  });
});
