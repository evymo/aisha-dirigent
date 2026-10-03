/**
 * n8n Sentry Observer Workflow Gate
 *
 * Ověřuje strukturu `WF_SENTRY_OBSERVER.json`:
 *   1. Valid JSON, required nodes, webhook trigger
 *   2. Production env gate (drop dev/staging events)
 *   3. Anomaly classifier produkuje 5 actions (rollback, propose, canary, escalate, log)
 *   4. Switch routes na 5 specific nody
 *   5. Všechny nody vedou k respond
 */

import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { N8nNode, N8nWorkflow, N8nConnectionTarget } from "./_types";
import { requireNode } from "./_n8n-helpers";

const ROOT = process.cwd();
const WF_PATH = join(ROOT, "n8n/workflows/WF_SENTRY_OBSERVER.json");

let wf: N8nWorkflow;

describe("WF_SENTRY_OBSERVER.json — structure", () => {
  test("file exists and is valid JSON", () => {
    expect(existsSync(WF_PATH)).toBe(true);
    const content = readFileSync(WF_PATH, "utf-8");
    expect(() => { wf = JSON.parse(content); }).not.toThrow();
  });

  test("has required top-level fields", () => {
    expect(wf.name).toBe("WF_SENTRY_OBSERVER");
    expect(Array.isArray(wf.nodes)).toBe(true);
    expect(typeof wf.connections).toBe("object");
    expect(wf.tags).toContain("aisha");
    expect(wf.tags).toContain("sentry");
  });

  test("webhook trigger on documented path", () => {
    const trigger = requireNode(wf, (n) => n.type === "n8n-nodes-base.webhook");
    expect(trigger.parameters.path).toBe("sentry-observe");
    expect(trigger.parameters.httpMethod).toBe("POST");
  });

  test("required nodes present", () => {
    const ids = wf.nodes.map((n: N8nNode) => n.id);
    const required = [
      "wh-sentry",
      "parse-event",
      "env-gate",         // production filter
      "classify",         // anomaly classifier
      "route",            // switch on action
      "do-rollback",
      "do-propose",
      "do-canary",
      "do-escalate",
      "do-log",
      "respond",
    ];
    for (const id of required) {
      expect(ids).toContain(id);
    }
  });

  test("classifier produces 5 distinct actions", () => {
    const node = requireNode(wf, (n) => n.id === "classify");
    const code = node.parameters.jsCode;
    expect(code).toContain("auto_rollback");
    expect(code).toContain("propose_fix");
    expect(code).toContain("canary_verify");
    expect(code).toContain("escalate_alert");
    expect(code).toContain("log_only");
  });

  test("classifier covers all expected patterns", () => {
    const node = requireNode(wf, (n) => n.id === "classify");
    const code = node.parameters.jsCode;
    expect(code).toContain("error_rate_spike");
    expect(code).toContain("new_exception_class");
    expect(code).toContain("perf_degradation");
    expect(code).toContain("recurring_issue");
  });

  test("parse-event extracts deployment context (release, app, slot)", () => {
    const node = requireNode(wf, (n) => n.id === "parse-event");
    const code = node.parameters.jsCode;
    expect(code).toContain("release");
    expect(code).toContain("app");
    expect(code).toContain("slot");
    expect(code).toContain("aisha.app");  // tag namespace
  });

  test("production env gate drops non-prod events to respond directly", () => {
    const conn = wf.connections["Production env?"];
    expect(conn).toBeDefined();
    const main = conn.main ?? [];
    // Production env? has 2 outputs: prod (→ classify) + non-prod (→ respond)
    expect(main.length).toBe(2);
    // Second branch should go to Respond
    const nonProdTargets = main[1].map((c: N8nConnectionTarget) => c.node);
    expect(nonProdTargets).toContain("Respond");
  });

  test("all action nodes lead to respond (directly or via drift trigger)", () => {
    // Rollback-request path (PR 3: gated request_rollback) passes through "Trigger drift check (post-incident)"
    const rollbackTargets = (wf.connections["Request rollback (gated)"].main ?? [])[0].map((c: N8nConnectionTarget) => c.node);
    expect(rollbackTargets).toContain("Trigger drift check (post-incident)");
    // Drift trigger node leads to respond
    const driftTargets = (wf.connections["Trigger drift check (post-incident)"].main ?? [])[0].map((c: N8nConnectionTarget) => c.node);
    expect(driftTargets).toContain("Respond");
    // Other action nodes go directly to respond
    const otherActions = ["Queue fix proposal", "Schedule canary verify", "Post operator alert", "Log only"];
    for (const name of otherActions) {
      const targets = (wf.connections[name].main ?? [])[0].map((c: N8nConnectionTarget) => c.node);
      expect(targets).toContain("Respond");
    }
  });

  test("auto-rollback chain triggers drift check (event-driven)", () => {
    const node = requireNode(wf, (n) => n.id === "trigger-drift-on-incident");
    expect(node.parameters.url).toContain("/webhook/drift-now");
    expect(node.parameters.jsonBody).toContain("sentry-incident");
  });
});
