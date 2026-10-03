/**
 * CHAINHEAD — Ledger Chain-Head On-Chain Attestation Gate (remediation, test-first)
 *
 * CONTRACT (Path-2 external tamper-evidence, documented but unimplemented):
 *   fn_blockchain_audit_guard.sql:12 states the in-DB tamper guard "guards
 *   against application bugs and casual tampering, not superusers — real
 *   external tamper-evidence is Path 2 (anchoring the chain head on the Cosmos
 *   ledger)". Path 2 must actually exist as running plumbing:
 *
 *   (A) ANCHOR ROUTE — services/svc-blockchain/src/routes/** MUST contain a
 *       route that:
 *         (A1) reads the current chain head — invokes fn_verify_audit_chain
 *              and/or reads its `head_hash` output (the deterministic tip of
 *              the hash chain), AND
 *         (A2) commits that head on-chain — broadcasts a Cosmos attestation
 *              (broadcastMsgSend / broadcastVote) carrying the head_hash in the
 *              MsgSend memo (NOT a per-record reward transfer), AND
 *         (A3) records the attestation result back into the DB — an rpcService
 *              call to a function that persists the attestation (a function
 *              name referencing chain-head/anchor/attest, e.g.
 *              record_chain_head_anchor), storing the returned cosmos tx hash.
 *       The route MUST be wired: imported AND app.register(...)'d in
 *       services/svc-blockchain/src/server.ts, on an anchor-shaped path.
 *
 *   (B) SCHEDULED CALLER — n8n/workflows/** MUST contain a workflow that runs
 *       PERIODICALLY (a scheduleTrigger node, not RabbitMQ/manual) and calls
 *       the anchor route via an httpRequest whose URL references the anchor
 *       path. This is what makes the attestation a recurring commitment of the
 *       head rather than a one-off endpoint nobody calls.
 *
 * WHY: The hash chain (record_hash/previous_hash) is only self-referential —
 *   a superuser (or a restore-from-backup that silently drops rows) can rewrite
 *   history and re-run the heals backfill so fn_verify_audit_chain still returns
 *   ok=true. External tamper-evidence requires periodically publishing the head
 *   hash to an append-only external ledger (Cosmos), so a later divergence
 *   between the DB head and the last anchored head is provable. Today
 *   ledger-sync.ts only broadcasts per-record reward MsgSend; nothing commits
 *   the chain head_hash on-chain, and no scheduled job drives such a commit.
 *
 * KNOWN-RED (authoring, branch feat/service-build-fixes): svc-blockchain has
 *   NO route that reads fn_verify_audit_chain's head_hash or broadcasts it as
 *   an attestation memo; n8n/workflows has NO scheduled anchor caller. Both
 *   invariants (A) and (B) fail → 2 instances flagged. Post-fix (an anchor
 *   route + a scheduled n8n caller) drives this gate GREEN.
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = process.cwd();

const SVC_ROUTES_DIR = path.join(ROOT, "services", "svc-blockchain", "src", "routes");
const SVC_SERVER = path.join(ROOT, "services", "svc-blockchain", "src", "server.ts");
const WORKFLOW_DIRS = [
  path.join(ROOT, "n8n", "workflows"),
  path.join(ROOT, "packages", "n8n-nodes-aisha", "workflows"),
];

const SCHEDULE_TRIGGER_TYPE = "n8n-nodes-base.scheduleTrigger";
const HTTP_REQUEST_TYPE = "n8n-nodes-base.httpRequest";

/**
 * Anchor-shaped path/name token shared by the route and its scheduled caller.
 * Deliberately naming-flexible (chain-head / ledger-anchor / head-anchor /
 * chain-anchor / anchor-chain) so any reasonable fix matches, but tight enough
 * that today's reward-sync surface (ledger-sync, dispatch, record-audit, …)
 * does NOT.
 */
const ANCHOR_TOKEN =
  /(chain[-_]?head|head[-_]?hash|ledger[-_]?anchor|head[-_]?anchor|chain[-_]?anchor|anchor[-_]?chain)/i;

function readIfExists(file: string): string {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return "";
  }
}

function listRouteFiles(): string[] {
  try {
    return fs
      .readdirSync(SVC_ROUTES_DIR)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => path.join(SVC_ROUTES_DIR, f))
      .sort();
  } catch {
    return [];
  }
}

/** A1: reads the chain head via the verifier / its head_hash output. */
function readsChainHead(src: string): boolean {
  return /fn_verify_audit_chain|verify_audit_chain|head_hash/i.test(src);
}

/** A2: broadcasts an on-chain attestation carrying the head hash in a memo. */
function broadcastsHeadAttestation(src: string): boolean {
  const broadcasts = /broadcastMsgSend|broadcastVote/.test(src);
  // The memo/payload must reference the head (not a per-record reward transfer).
  const memoReferencesHead =
    /memo[\s\S]{0,120}(head|anchor|attest|chain)/i.test(src) ||
    /(head|anchor|attest)[\s\S]{0,120}memo/i.test(src);
  return broadcasts && memoReferencesHead;
}

/** A3: persists the attestation result back into the DB. */
function persistsAttestation(src: string): boolean {
  // rpcService/rpcAdmin call to a function that records the anchor/attestation.
  return /rpc\w*\(\s*['"`][a-z0-9_]*(chain_head|anchor|attest)[a-z0-9_]*['"`]/i.test(src);
}

interface AnchorRoute {
  file: string;
  registered: boolean;
  path: string | null;
}

/** Find a route file satisfying A1+A2+A3, and check it is wired in server.ts. */
function findAnchorRoute(): AnchorRoute | null {
  const server = readIfExists(SVC_SERVER);
  for (const file of listRouteFiles()) {
    const src = readIfExists(file);
    if (!readsChainHead(src) || !broadcastsHeadAttestation(src) || !persistsAttestation(src)) {
      continue;
    }

    // Extract the declared route path (app.post('/...')).
    const pathMatch = src.match(/app\.(?:post|get|put)\s*<[^>]*>?\s*\(\s*['"`]([^'"`]+)['"`]/);
    const routePath = pathMatch ? pathMatch[1] : null;

    // Wired: the exported route registrar is imported AND app.register()'d.
    const base = path.basename(file, ".ts"); // e.g. "chain-head-anchor"
    const importGlob = new RegExp(`from\\s+['"\`][^'"\`]*/routes/${base}\\.js['"\`]`);
    const importedRegistrar = src.match(/export\s+async\s+function\s+([A-Za-z0-9_]+)/);
    const registrarName = importedRegistrar ? importedRegistrar[1] : "";
    const registered =
      importGlob.test(server) &&
      registrarName.length > 0 &&
      new RegExp(`app\\.register\\(\\s*${registrarName}\\b`).test(server);

    return { file: path.relative(ROOT, file), registered, path: routePath };
  }
  return null;
}

interface Node {
  type?: unknown;
  parameters?: Record<string, unknown>;
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

/**
 * B: a workflow that is scheduleTrigger-driven AND has an httpRequest node whose
 * URL references the anchor path token.
 */
function findScheduledAnchorCaller(): string | null {
  for (const file of listWorkflowFiles()) {
    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
    } catch {
      continue;
    }
    const nodes: Node[] = Array.isArray(doc.nodes) ? (doc.nodes as Node[]) : [];

    const hasSchedule = nodes.some((n) => n?.type === SCHEDULE_TRIGGER_TYPE);
    if (!hasSchedule) continue;

    const callsAnchor = nodes.some((n) => {
      if (n?.type !== HTTP_REQUEST_TYPE) return false;
      const url = (n.parameters?.url as string) ?? "";
      return typeof url === "string" && ANCHOR_TOKEN.test(url);
    });

    if (callsAnchor) return path.relative(ROOT, file);
  }
  return null;
}

describe("CHAINHEAD — ledger chain-head on-chain attestation gate", () => {
  it("svc-blockchain routes dir exists (sanity)", () => {
    expect(fs.existsSync(SVC_ROUTES_DIR), `missing ${SVC_ROUTES_DIR}`).toBe(true);
    expect(listRouteFiles().length, "no route files under svc-blockchain/src/routes").toBeGreaterThan(0);
  });

  it("(A) an anchor route reads the chain head, broadcasts it on-chain, persists the result, and is wired", () => {
    const route = findAnchorRoute();
    expect(
      route,
      "No svc-blockchain route commits the audit chain head on-chain. Required: a route that " +
        "(A1) reads fn_verify_audit_chain head_hash, (A2) broadcasts it as a Cosmos attestation " +
        "(broadcastMsgSend/broadcastVote with the head_hash in the memo — not a per-record reward), " +
        "and (A3) records the attestation back via an rpcService anchor/attest function.",
    ).not.toBeNull();
    // A route that exists but is never registered is dead plumbing.
    expect(
      route?.registered,
      `Anchor route ${route?.file} is not wired in services/svc-blockchain/src/server.ts ` +
        `(missing import + app.register()).`,
    ).toBe(true);
  });

  it("(B) a scheduled n8n workflow periodically calls the anchor route", () => {
    const caller = findScheduledAnchorCaller();
    expect(
      caller,
      "No scheduleTrigger-driven n8n workflow calls the chain-head anchor route via httpRequest. " +
        "Path-2 attestation must be a RECURRING commitment of the head hash, not a one-off endpoint. " +
        "Add a WF_* workflow with a scheduleTrigger + an httpRequest to the anchor path.",
    ).not.toBeNull();
  });
});
