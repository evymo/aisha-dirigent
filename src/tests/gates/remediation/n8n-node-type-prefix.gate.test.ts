/**
 * N8N-02 — Node Type Prefix & Credential Existence Gate (remediation, test-first)
 *
 * CONTRACT (two classes, both scanned across):
 *   - n8n/workflows/*.json
 *   - packages/n8n-nodes-aisha/workflows/*.json
 *
 *   CLASS A — Node type prefix:
 *     No workflow node may use the node-type prefix `aisha-nodes.`.
 *     The published package is `n8n-nodes-aisha`, so every custom node MUST
 *     be referenced as `n8n-nodes-aisha.<nodeName>`. A node typed
 *     `aisha-nodes.<x>` will never resolve at runtime — n8n cannot find the
 *     node class, so the workflow fails to load / execute.
 *
 *   CLASS B — Credential existence:
 *     Every credential `typeName` referenced by a node that is provided by
 *     THIS package (i.e. an `aisha*`-namespaced credential) MUST exist as a
 *     real credential class in packages/n8n-nodes-aisha/credentials/ (the set
 *     of valid names is read from that dir's `name = '...'` fields — the
 *     source of truth). Non-aisha credential typeNames are n8n built-ins and
 *     are allowed via BUILTIN_CRED_ALLOWLIST. A referenced `aisha*` credential
 *     with no backing class can never be provisioned → the node fails auth.
 *
 * KNOWN-RED (at authoring, HEAD 569c5ffd):
 *   CLASS A: 6 nodes use `aisha-nodes.aishaAdminBridge`
 *            (WF_DEV_PATCH x1, WF_SELF_LEARNING_LOOP x4, WF_PIPELINE_EXECUTOR x1).
 *   CLASS B: credential typeName `aishaAdminBridgeApi` referenced by
 *            WF_DEV_PATCH + WF_PIPELINE_EXECUTOR has no credential class in
 *            packages/n8n-nodes-aisha/credentials/.
 *
 * Post-fix: rename the prefix to `n8n-nodes-aisha.` and either add the missing
 *   credential class or point the node at an existing one → both gates GREEN.
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

const CREDENTIALS_DIR = path.join(
  ROOT,
  "packages",
  "n8n-nodes-aisha",
  "credentials",
);

/** The one and only valid package node-type prefix. */
const VALID_PACKAGE_PREFIX = "n8n-nodes-aisha.";
/** The forbidden (typo) prefix that never resolves at runtime. */
const FORBIDDEN_PREFIX = "aisha-nodes.";

/**
 * Built-in n8n credential typeNames that nodes may legitimately reference
 * without a class living in this package. Keep minimal and justified — these
 * are all shipped by n8n core / official nodes.
 */
const BUILTIN_CRED_ALLOWLIST: ReadonlySet<string> = new Set([
  "anthropicApi",
  "openAiApi",
  "googlePalmApi",
  "githubApi",
  "httpHeaderAuth",
  "rabbitmq",
]);

interface WorkflowNode {
  name?: unknown;
  type?: unknown;
  credentials?: unknown;
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

function readNodes(file: string): WorkflowNode[] {
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
  } catch {
    return [];
  }
  return Array.isArray(doc.nodes) ? (doc.nodes as WorkflowNode[]) : [];
}

/**
 * The set of valid aisha credential typeNames, read from the SoT: each
 * credential class declares `name = '<typeName>'`.
 */
function validAishaCredentialNames(): Set<string> {
  const names = new Set<string>();
  if (!fs.existsSync(CREDENTIALS_DIR)) return names;
  for (const entry of fs.readdirSync(CREDENTIALS_DIR)) {
    if (!entry.endsWith(".credentials.ts")) continue;
    const src = fs.readFileSync(path.join(CREDENTIALS_DIR, entry), "utf-8");
    const m = src.match(/\bname\s*=\s*['"]([^'"]+)['"]/);
    if (m) names.add(m[1]);
  }
  return names;
}

function isAishaNamespaced(typeName: string): boolean {
  return /^aisha/i.test(typeName);
}

describe("N8N-02 node type prefix & credential existence gate", () => {
  it("discovers workflow nodes to scan (sanity)", () => {
    let total = 0;
    for (const file of listWorkflowFiles()) total += readNodes(file).length;
    expect(total).toBeGreaterThan(0);
  });

  it("CLASS A: no node uses the forbidden 'aisha-nodes.' type prefix", () => {
    const hits: string[] = [];
    for (const file of listWorkflowFiles()) {
      const rel = path.relative(ROOT, file);
      for (const node of readNodes(file)) {
        if (typeof node.type === "string" && node.type.startsWith(FORBIDDEN_PREFIX)) {
          hits.push(
            `  ${rel} :: "${typeof node.name === "string" ? node.name : "<unnamed>"}" type="${node.type}"`,
          );
        }
      }
    }
    expect(
      hits.length,
      `Found ${hits.length} node(s) using the forbidden node-type prefix ` +
        `"${FORBIDDEN_PREFIX}". The package is "n8n-nodes-aisha"; use ` +
        `"${VALID_PACKAGE_PREFIX}<node>" instead:\n${hits.join("\n")}`,
    ).toBe(0);
  });

  it("CLASS B: every aisha-namespaced credential reference has a backing class", () => {
    const valid = validAishaCredentialNames();
    // Guard: the SoT read must have found the real credential classes,
    // otherwise the gate would false-positive on everything.
    expect(valid.size, "no aisha credential classes discovered in SoT dir").toBeGreaterThan(0);

    const hits: string[] = [];
    for (const file of listWorkflowFiles()) {
      const rel = path.relative(ROOT, file);
      for (const node of readNodes(file)) {
        const creds = node.credentials;
        if (!creds || typeof creds !== "object") continue;
        for (const typeName of Object.keys(creds as Record<string, unknown>)) {
          if (BUILTIN_CRED_ALLOWLIST.has(typeName)) continue;
          if (!isAishaNamespaced(typeName)) continue; // non-aisha => treated as built-in
          if (!valid.has(typeName)) {
            hits.push(
              `  ${rel} :: "${typeof node.name === "string" ? node.name : "<unnamed>"}" credential="${typeName}"`,
            );
          }
        }
      }
    }
    expect(
      hits.length,
      `Found ${hits.length} node credential reference(s) to aisha-namespaced ` +
        `credential typeName(s) with no backing class in ` +
        `packages/n8n-nodes-aisha/credentials/ (valid: ${[...valid].sort().join(", ")}):\n${hits.join("\n")}`,
    ).toBe(0);
  });
});
