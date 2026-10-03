/**
 * Approval Explainability Gate Test
 *
 * Verifies that WF_APPROVAL_GATE.json satisfies the AISHA governance requirements:
 * - Independent risk scoring via fn_evaluate_proposal_risk (no blind trust in caller-declared severity)
 * - Explainability fields: computedRisk, contextHash, criteriaMet, criteriaFailed, decisionReasoning
 * - Timeout/expiry handling: expired decision state in Process Response
 * - Audit completeness: Log nodes include all required fields
 * - Notify Expert includes computed risk in notification
 *
 * Part of: Fáze 2 — Critical Gap Closure (approval explainability)
 * Config: vitest.gates.config.ts (node env, 2 min timeout)
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const WORKFLOW_PATH = path.join(ROOT, "n8n/workflows/WF_APPROVAL_GATE.json");

function loadWorkflow(): Record<string, unknown> {
  expect(fs.existsSync(WORKFLOW_PATH)).toBe(true);
  return JSON.parse(fs.readFileSync(WORKFLOW_PATH, "utf-8")) as Record<string, unknown>;
}

type N8nNode = {
  id: string;
  name: string;
  type: string;
  parameters: Record<string, unknown>;
  position?: number[];
};

type N8nWorkflow = {
  name: string;
  nodes: N8nNode[];
  connections: Record<string, { main: Array<Array<{ node: string; type: string; index: number }>> }>;
};

describe("WF_APPROVAL_GATE: explainability gate", () => {
  const workflow = loadWorkflow() as unknown as N8nWorkflow;
  const nodesByName = Object.fromEntries(workflow.nodes.map((n) => [n.name, n]));

  it("Evaluate Risk node exists and uses fn_evaluate_proposal_risk", () => {
    const node = nodesByName["Evaluate Risk"];
    expect(node, "Evaluate Risk node is missing from WF_APPROVAL_GATE").toBeDefined();
    expect(node.type).toBe("n8n-nodes-aisha.aishaRpc");
    expect(node.parameters["functionName"]).toBe("fn_evaluate_proposal_risk");
  });

  it("Approval Request routes through Evaluate Risk before Create Approval Request", () => {
    const arConn = workflow.connections["Approval Request"];
    expect(arConn, "Approval Request connection missing").toBeDefined();
    const firstTarget = arConn.main[0][0].node;
    expect(
      firstTarget,
      `Approval Request must route to 'Evaluate Risk' first — found '${firstTarget}'`
    ).toBe("Evaluate Risk");

    const erConn = workflow.connections["Evaluate Risk"];
    expect(erConn, "Evaluate Risk connection missing").toBeDefined();
    const erTarget = erConn.main[0][0].node;
    expect(
      erTarget,
      `Evaluate Risk must route to 'Create Approval Request' — found '${erTarget}'`
    ).toBe("Create Approval Request");
  });

  it("Create Approval Request computes contextHash and criteriaMet", () => {
    const node = nodesByName["Create Approval Request"];
    expect(node).toBeDefined();
    const code = node.parameters["jsCode"] as string;
    expect(code).toContain("computedRisk");
    expect(code).toContain("contextHash");
    expect(code).toContain("criteriaMet");
    expect(code).toContain("criteriaFailed");
    expect(code).toContain("decisionReasoning");
  });

  it("Create Approval Request reads caller body from Approval Request node (not $input)", () => {
    const node = nodesByName["Create Approval Request"];
    const code = node.parameters["jsCode"] as string;
    expect(
      code,
      "Must reference $('Approval Request') to get original webhook body"
    ).toContain("Approval Request");
    expect(
      code,
      "Must use riskEval from $input (Evaluate Risk output)"
    ).toContain("riskEval");
  });

  it("Approve/reject links include expires= query parameter for expiry check", () => {
    const node = nodesByName["Create Approval Request"];
    const code = node.parameters["jsCode"] as string;
    expect(code, "approveLink must include expires= parameter").toContain(
      "decision=approved&expires="
    );
    expect(code, "rejectLink must include expires= parameter").toContain(
      "decision=rejected&expires="
    );
  });

  it("Process Response handles 'expired' decision state", () => {
    const node = nodesByName["Process Response"];
    expect(node).toBeDefined();
    const code = node.parameters["jsCode"] as string;
    expect(code, "Process Response must check for expiry").toContain("expiresAtStr");
    expect(code, "Process Response must set decision = 'expired'").toContain("expired");
    expect(code, "Process Response must include isExpired in output").toContain("isExpired");
    expect(code, "Process Response must accept 'expired' as valid decision").toContain(
      "'approved', 'rejected', 'expired'"
    );
  });

  it("Log Approval Request includes explainability fields in audit payload", () => {
    const node = nodesByName["Log Approval Request"];
    expect(node).toBeDefined();
    const rpcParams = node.parameters["rpcParams"] as string;
    expect(rpcParams, "Log must include computedRisk").toContain("computedRisk");
    expect(rpcParams, "Log must include contextHash").toContain("contextHash");
    expect(rpcParams, "Log must include criteriaMet").toContain("criteriaMet");
    expect(rpcParams, "Log must include criteriaFailed").toContain("criteriaFailed");
    expect(rpcParams, "Log must include decisionReasoning").toContain("decisionReasoning");
  });

  it("Log Response includes decision reasoning and expiry state", () => {
    const node = nodesByName["Log Response"];
    expect(node).toBeDefined();
    const rpcParams = node.parameters["rpcParams"] as string;
    expect(rpcParams, "Log Response must include decisionReasoning").toContain(
      "decisionReasoning"
    );
    expect(rpcParams, "Log Response must include isExpired").toContain("isExpired");
    expect(rpcParams, "Log Response must map expired to 'expired' status").toContain("expired");
  });

  it("Notify Expert message includes computed risk (not just declared severity)", () => {
    const node = nodesByName["Notify Expert"];
    expect(node).toBeDefined();
    const jsonBody = node.parameters["jsonBody"] as string;
    expect(jsonBody, "Notify Expert must show computed risk").toContain("computedRisk");
    expect(
      jsonBody,
      "Notify Expert must reference criteria information"
    ).toContain("criteriaMet");
  });

  it("Evaluate Risk node has onError: continueRegularOutput (graceful degradation)", () => {
    const node = nodesByName["Evaluate Risk"];
    expect(node["onError"]).toBe("continueRegularOutput");
  });

  it("Log Approval Request has onError: continueRegularOutput (audit must not block flow)", () => {
    const node = nodesByName["Log Approval Request"];
    expect(node["onError"]).toBe("continueRegularOutput");
  });

  it("Log Response has onError: continueRegularOutput (audit must not block response)", () => {
    const node = nodesByName["Log Response"];
    expect(node["onError"]).toBe("continueRegularOutput");
  });
});

describe("WF_APPROVAL_GATE: structure integrity", () => {
  const workflow = loadWorkflow() as unknown as N8nWorkflow;

  it("workflow has exactly 17 nodes (16 original + 1 Evaluate Risk)", () => {
    expect(workflow.nodes.length).toBe(17);
  });

  it("all required nodes are present", () => {
    const required = [
      "Approval Request",
      "Evaluate Risk",
      "Create Approval Request",
      "Valid?",
      "Log Approval Request",
      "Notify Expert",
      "Prepare Response",
      "Respond Success",
      "Approval Response",
      "Process Response",
      "Valid Response?",
      "Log Response",
      "Notify Dirigent",
    ];
    const nodeNames = new Set(workflow.nodes.map((n) => n.name));
    for (const name of required) {
      expect(nodeNames.has(name), `Required node missing: ${name}`).toBe(true);
    }
  });
});
