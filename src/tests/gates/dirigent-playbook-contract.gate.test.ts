/**
 * Dirigent Playbook Contract Gate (PR 2)
 *
 * Validates the 5 WF_DIRIGENT_*.json n8n playbooks against the documented
 * contract BEFORE they are imported into the n8n instance:
 *   - dispatch mapping (dirigent_dispatch_event SoT) ↔ webhook paths parity
 *   - response shape {advisory, decision} via respondToWebhook
 *   - advisory-only invariant: ONLY goal_evaluator may emit decision block/ask
 *   - fail-open: every aishaRpc node uses service_role + continueRegularOutput
 *
 * Spec: n8n/workflows/README-dirigent-supervisor.md +
 *       aisha/db/sql/functions/dirigent_dispatch_event.sql
 *
 * Runs offline (pure JSON/SQL parse). Catches structural drift that would
 * otherwise only surface at prod import time.
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import type { N8nNode, N8nWorkflow } from "./_types";

const ROOT = process.cwd();
const WF_DIR = path.join(ROOT, "n8n/workflows");
const DISPATCH_FN = path.join(ROOT, "aisha/db/sql/functions/dirigent_dispatch_event.sql");

/** Canonical event → playbook pairs the overlay depends on. */
const EXPECTED: Record<string, string> = {
  session_start: "briefing",
  prompt_submit: "intent_advisor",
  pre_tool: "compliance_pre_check",
  post_tool: "compliance_enforcement",
  stop: "goal_evaluator",
};

const PLAYBOOK_FILE: Record<string, string> = {
  briefing: "WF_DIRIGENT_BRIEFING.json",
  intent_advisor: "WF_DIRIGENT_INTENT_ADVISOR.json",
  compliance_pre_check: "WF_DIRIGENT_COMPLIANCE_PRE_CHECK.json",
  compliance_enforcement: "WF_DIRIGENT_COMPLIANCE_ENFORCEMENT.json",
  goal_evaluator: "WF_DIRIGENT_GOAL_EVALUATOR.json",
};

function wfPath(playbook: string): string {
  return path.join(WF_DIR, PLAYBOOK_FILE[playbook]);
}
function readWf(playbook: string): N8nWorkflow {
  return JSON.parse(fs.readFileSync(wfPath(playbook), "utf-8"));
}
function wfText(playbook: string): string {
  return fs.readFileSync(wfPath(playbook), "utf-8");
}
function nodesOfType(wf: N8nWorkflow, type: string): N8nNode[] {
  return (wf.nodes || []).filter((n: N8nNode) => n.type === type);
}

/** Parse `WHEN '<event>' THEN '<playbook>'` pairs from the dispatch RPC. */
function dispatchMapping(): Record<string, string> {
  const sql = fs.readFileSync(DISPATCH_FN, "utf-8");
  const map: Record<string, string> = {};
  const re = /WHEN\s+'([a-z_]+)'\s+THEN\s+'([a-z_]+)'/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) map[m[1]] = m[2];
  return map;
}

// ---------------------------------------------------------------------------
// 1. Dispatch mapping ↔ playbook JSON parity
// ---------------------------------------------------------------------------
describe("Dirigent playbooks: dispatch mapping ↔ JSON parity", () => {
  it("dirigent_dispatch_event SoT maps the 5 documented event→playbook pairs", () => {
    expect(fs.existsSync(DISPATCH_FN), "missing dirigent_dispatch_event.sql SoT").toBe(true);
    const map = dispatchMapping();
    for (const [evt, pb] of Object.entries(EXPECTED)) {
      expect(map[evt], `dispatch RPC must map ${evt} → ${pb}`).toBe(pb);
    }
  });

  it("each playbook JSON exists, parses, and has webhook path dirigent/<playbook>", () => {
    for (const pb of Object.values(EXPECTED)) {
      expect(fs.existsSync(wfPath(pb)), `missing ${PLAYBOOK_FILE[pb]}`).toBe(true);
      const wf = readWf(pb);
      const hook = nodesOfType(wf, "n8n-nodes-base.webhook")[0];
      expect(hook, `${pb} missing webhook trigger`).toBeTruthy();
      expect(hook.parameters?.path, `${pb} webhook path`).toBe(`dirigent/${pb}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Response shape + advisory-only invariant
// ---------------------------------------------------------------------------
describe("Dirigent playbooks: response + advisory-only contract", () => {
  it("each playbook responds via respondToWebhook with advisory + decision", () => {
    for (const pb of Object.values(EXPECTED)) {
      const wf = readWf(pb);
      const respond = nodesOfType(wf, "n8n-nodes-base.respondToWebhook")[0];
      expect(respond, `${pb} missing respondToWebhook node`).toBeTruthy();
      const body = String(respond.parameters?.responseBody || "");
      expect(body, `${pb} response must surface advisory`).toContain("advisory");
      expect(body, `${pb} response must surface decision`).toContain("decision");
    }
  });

  it("ONLY goal_evaluator may emit decision block/ask (advisory-only invariant)", () => {
    // Match a decision VALUE assignment: decision: 'block' | "ask" etc.
    const DECISION_BLOCK = /decision\s*:\s*['"](block|ask)['"]/i;
    for (const pb of Object.values(EXPECTED)) {
      const emitsBlock = DECISION_BLOCK.test(wfText(pb));
      if (pb === "goal_evaluator") {
        expect(emitsBlock, "goal_evaluator must be able to block/ask on Stop").toBe(true);
      } else {
        expect(emitsBlock, `${pb} must NOT emit block/ask — advisory-only`).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Fail-open RPC calls (cold-start parity at n8n layer)
// ---------------------------------------------------------------------------
describe("Dirigent playbooks: fail-open RPC calls", () => {
  it("every aishaRpc node uses service_role + onError continueRegularOutput", () => {
    for (const pb of Object.values(EXPECTED)) {
      const wf = readWf(pb);
      const rpcs = nodesOfType(wf, "n8n-nodes-aisha.aishaRpc");
      expect(rpcs.length, `${pb} should call ≥1 aishaRpc`).toBeGreaterThanOrEqual(1);
      for (const r of rpcs) {
        const fn = r.parameters?.functionName || "(unknown)";
        expect(r.parameters?.authMode, `${pb}.${fn} authMode must be service_role`).toBe("service_role");
        const onErr = r.onError ?? r.parameters?.onError;
        expect(onErr, `${pb}.${fn} must fail-open (onError=continueRegularOutput)`).toBe(
          "continueRegularOutput",
        );
      }
    }
  });
});
