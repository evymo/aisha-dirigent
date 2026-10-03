/**
 * N8N-04 — Webhook Authentication Gate (remediation, test-first)
 *
 * CONTRACT:
 *   Every `n8n-nodes-base.webhook` node declared in
 *     - n8n/workflows/*.json
 *     - packages/n8n-nodes-aisha/workflows/*.json
 *   MUST declare authentication (i.e. `parameters.authentication` set to a
 *   non-'none', non-empty value — e.g. "headerAuth"), EXCEPT webhook nodes
 *   whose `parameters.path` is an intentionally-public endpoint on the
 *   explicit allowlist below.
 *
 * WHY: Unauthenticated n8n webhooks expose autonomous orchestration triggers
 *   (deploy, compliance, factory, agent) to anyone who can reach the n8n
 *   ingress — an unauthenticated remote trigger of privileged automation.
 *
 * KNOWN-RED (at authoring, HEAD 569c5ffd): 75 webhook nodes, 0 with
 *   authentication → 72 unauthenticated + non-allowlisted violations.
 *   Post-fix: each flagged webhook must add header-auth (or be justified
 *   into the allowlist), driving this gate GREEN.
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

/**
 * Intentionally-public webhook paths. A webhook whose `parameters.path`
 * matches one of these MAY be unauthenticated. Anything else must declare
 * authentication. Keep this list minimal and justified.
 */
const PUBLIC_PATH_ALLOWLIST: ReadonlySet<string> = new Set([
  // Public end-user chat surface (anonymous inbound is the point).
  "public-chat",
  // Approval-response landing hit from notification links (token-in-URL,
  // validated downstream); cannot carry a static auth header.
  "approval-response",
]);

const WEBHOOK_TYPE = "n8n-nodes-base.webhook";

interface WebhookViolation {
  file: string;
  nodeName: string;
  path: string | undefined;
  authentication: unknown;
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

function hasAuthentication(auth: unknown): boolean {
  if (typeof auth !== "string") return false;
  const v = auth.trim().toLowerCase();
  return v.length > 0 && v !== "none";
}

function collectWebhookViolations(): {
  totalWebhooks: number;
  authed: number;
  allowlistedPublic: number;
  violations: WebhookViolation[];
} {
  let totalWebhooks = 0;
  let authed = 0;
  let allowlistedPublic = 0;
  const violations: WebhookViolation[] = [];

  for (const file of listWorkflowFiles()) {
    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
    } catch {
      // Malformed workflow JSON is out of scope for this gate.
      continue;
    }
    const nodes = Array.isArray(doc.nodes) ? (doc.nodes as Record<string, unknown>[]) : [];
    for (const node of nodes) {
      if (node?.type !== WEBHOOK_TYPE) continue;
      totalWebhooks++;
      const params = (node.parameters ?? {}) as Record<string, unknown>;
      const auth = params.authentication;
      const nodePath = typeof params.path === "string" ? params.path : undefined;

      if (hasAuthentication(auth)) {
        authed++;
        continue;
      }
      if (nodePath !== undefined && PUBLIC_PATH_ALLOWLIST.has(nodePath)) {
        allowlistedPublic++;
        continue;
      }
      violations.push({
        file: path.relative(ROOT, file),
        nodeName: typeof node.name === "string" ? node.name : "<unnamed>",
        path: nodePath,
        authentication: auth,
      });
    }
  }

  return { totalWebhooks, authed, allowlistedPublic, violations };
}

describe("N8N-04 webhook authentication gate", () => {
  it("discovers webhook nodes to scan (sanity)", () => {
    const { totalWebhooks } = collectWebhookViolations();
    expect(totalWebhooks).toBeGreaterThan(0);
  });

  it("every non-allowlisted webhook node declares authentication", () => {
    const { violations } = collectWebhookViolations();
    const report = violations
      .map((v) => `  ${v.file} :: "${v.nodeName}" (path="${v.path ?? "?"}")`)
      .join("\n");
    expect(
      violations.length,
      `Found ${violations.length} unauthenticated, non-allowlisted n8n webhook node(s). ` +
        `Each must set parameters.authentication (e.g. "headerAuth") or be justified ` +
        `into PUBLIC_PATH_ALLOWLIST:\n${report}`,
    ).toBe(0);
  });
});
