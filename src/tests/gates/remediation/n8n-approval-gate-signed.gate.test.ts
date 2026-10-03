/**
 * N8N-03 — Approval-Gate Signed-Link + Persisted-State Gate (remediation, test-first)
 *
 * CONTRACT:
 *   An n8n code node that takes the AUTHORITATIVE approve/reject (or expiry)
 *   decision for a WF_APPROVAL_GATE-style flow MUST NOT trust client-supplied
 *   GET query params alone. Concretely, for every code node whose jsCode
 *   derives a `decision` from `query.decision` (and the approval id from
 *   `query.id`), that node's workflow MUST satisfy BOTH:
 *
 *     (1) SIGNED LINK — the deciding code node verifies an HMAC / signature
 *         of the approval link (createHmac / timingSafeEqual / verifySignature
 *         / a `signature`|`hmac` token), so a guessed/forged approval-response
 *         URL cannot be replayed; AND
 *     (2) PERSISTED STATE — the workflow contains an aishaRpc node whose
 *         `functionName` resolves/persists server-side approval state (a
 *         function name referencing "approval", e.g. fn_resolve_approval_request
 *         / create_approval_request). Logging RPCs like `log_integration_action`
 *         do NOT count as authoritative state.
 *
 * WHY: Without a signature, the approve link is `?id=<guessable>&decision=approved
 *   &expires=<attacker-chosen>` — anyone who can reach `/webhook/approval-response`
 *   can approve (or indefinitely postpone expiry of) any pending privileged
 *   action by guessing/replaying the id. The decision must bind to a signed
 *   token AND a persisted approval record the server owns.
 *
 * KNOWN-RED (at authoring, branch feat/remediation): WF_APPROVAL_GATE's
 *   "Process Response" code node reads approvalId=query.id, decision=
 *   query.decision, expiresAt=query.expires with NO signature verification,
 *   and the workflow's only RPCs are fn_evaluate_proposal_risk +
 *   log_integration_action (no approval-state resolve/persist). 2 copies
 *   (n8n/workflows + packages/n8n-nodes-aisha/workflows) → 2 violations.
 *   Post-fix: add HMAC verify to the deciding code node + a resolve-approval
 *   RPC, driving this gate GREEN.
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = process.cwd();

const WORKFLOW_DIRS = [
  path.join(ROOT, "n8n", "workflows"),
  path.join(ROOT, "packages", "n8n-nodes-aisha", "workflows"),
];

const CODE_TYPE = "n8n-nodes-base.code";
const RPC_TYPE = "n8n-nodes-aisha.aishaRpc";

/**
 * Workflow files (relative) intentionally exempt from this invariant.
 * Keep minimal and justified. Empty by design — the approval decision
 * must always be signed + persisted.
 */
const FILE_ALLOWLIST: ReadonlySet<string> = new Set<string>([]);

/**
 * Signals that a code node makes an authoritative approval decision from
 * client query params: it reads the decision AND the approval id from `query`.
 */
function decidesFromQuery(jsCode: string): boolean {
  const readsDecision = /query\s*\.\s*decision|query\s*\[\s*['"]decision['"]\s*\]/.test(jsCode);
  const readsId = /query\s*\.\s*id|query\s*\[\s*['"]id['"]\s*\]/.test(jsCode);
  return readsDecision && readsId;
}

/**
 * (1) SIGNED LINK: the deciding node verifies an HMAC / signature of the link.
 */
function verifiesSignature(jsCode: string): boolean {
  return /createHmac|timingSafeEqual|verifySignature|\bhmac\b|\bsignature\b|\bsig\b/i.test(jsCode);
}

/**
 * (2) PERSISTED STATE: an aishaRpc node whose functionName resolves/persists
 * approval state. `log_integration_action` (audit logging) does NOT qualify.
 */
function functionNameIsApprovalState(fnName: string): boolean {
  if (!/approval/i.test(fnName)) return false;
  if (/^log_integration_action$/i.test(fnName)) return false;
  return /resolve|create|upsert|persist|record|get|lookup|fetch|claim|consume/i.test(fnName);
}

interface Node {
  type?: unknown;
  name?: unknown;
  parameters?: Record<string, unknown>;
}

interface Violation {
  file: string;
  nodeName: string;
  reasons: string[];
}

function listWorkflowFiles(): string[] {
  const out: string[] = [];
  for (const dir of WORKFLOW_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (entry.endsWith(".json")) out.push(path.join(dir, entry));
    }
  }
  return out.sort();
}

function analyze(): { decidingNodes: number; violations: Violation[] } {
  let decidingNodes = 0;
  const violations: Violation[] = [];

  for (const file of listWorkflowFiles()) {
    const rel = path.relative(ROOT, file);
    if (FILE_ALLOWLIST.has(rel)) continue;

    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
    } catch {
      continue; // malformed workflow JSON is out of scope
    }
    const nodes: Node[] = Array.isArray(doc.nodes) ? (doc.nodes as Node[]) : [];

    // Workflow-level: does ANY aishaRpc node resolve/persist approval state?
    const hasApprovalStateRpc = nodes.some((n) => {
      if (n?.type !== RPC_TYPE) return false;
      const fnName = (n.parameters?.functionName as string) ?? "";
      return typeof fnName === "string" && functionNameIsApprovalState(fnName);
    });

    for (const node of nodes) {
      if (node?.type !== CODE_TYPE) continue;
      const jsCode = (node.parameters?.jsCode as string) ?? "";
      if (typeof jsCode !== "string" || !decidesFromQuery(jsCode)) continue;

      decidingNodes++;
      const reasons: string[] = [];
      if (!verifiesSignature(jsCode)) {
        reasons.push("no HMAC/signature verification of the approval link");
      }
      if (!hasApprovalStateRpc) {
        reasons.push("no persisted-state approval RPC (resolve/create) in workflow");
      }
      if (reasons.length > 0) {
        violations.push({
          file: rel,
          nodeName: typeof node.name === "string" ? node.name : "<unnamed>",
          reasons,
        });
      }
    }
  }

  return { decidingNodes, violations };
}

describe("N8N-03 approval-gate signed-link + persisted-state gate", () => {
  it("discovers at least one query-driven approval-decision node (sanity)", () => {
    const { decidingNodes } = analyze();
    expect(decidingNodes).toBeGreaterThan(0);
  });

  it("every query-driven approval decision is signature-verified AND persisted", () => {
    const { violations } = analyze();
    const report = violations
      .map((v) => `  ${v.file} :: "${v.nodeName}"\n      - ${v.reasons.join("\n      - ")}`)
      .join("\n");
    expect(
      violations.length,
      `Found ${violations.length} approval-decision code node(s) that trust client ` +
        `GET query params without a signed link and/or persisted server-side state. ` +
        `Each must (1) verify an HMAC/signature of the approval link and (2) resolve ` +
        `approval state via an aishaRpc function, or be justified into FILE_ALLOWLIST:\n${report}`,
    ).toBe(0);
  });
});
