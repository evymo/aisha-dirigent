/**
 * OPANCHOR - Ledger Operational Anchor Coverage Gate (remediation, test-first)
 *
 * LOCKED DECISION (Tier 1 "consequential events"): the immutable hash-chain
 * ledger (aisha/db/sql/tables/blockchain_audit_records.sql - a real SHA-256
 * record_hash/previous_hash chain with an in-DB tamper guard) already anchors
 * token movements (fn_queue_blockchain_sync), AI cognition decisions
 * (fn_anchor_decision, record_type='aisha_cognition_anchor') and manual
 * admin/staff audits (edge_blockchain_audit + svc-blockchain /audit route). It
 * must ALSO anchor a FINGERPRINT (hash + reference only; the erasable payload
 * stays in a linked table) of CONSEQUENTIAL operational + governance events.
 *
 * The Tier-1 sources that must be anchored:
 *   1. Governance decisions - member ballots (reference_table 'governance_votes')
 *      AND agent-change approvals (improvement_proposals). Reverses the earlier
 *      "keep governance separate" default.
 *   2. Deploys - the blue-green deploy path anchors a deploy / blue_green event.
 *   3. PKI rotations - the cert-rotation workflow anchors a pki-rotation event.
 *   4. Privileged admin actions + security events - anchored via the
 *      edge_blockchain_audit / record-audit allowlist.
 *
 * CONTRACT asserted here (the CORRECT post-fix state, so a fix turns it GREEN):
 *
 *   (A) TAXONOMY SUPERSET. The anchor taxonomy - the union of the record-audit.ts
 *       allowlist, the edge_blockchain_audit.sql helper, and any record_type
 *       CHECK/enum on blockchain_audit_records.sql - INCLUDES every Tier-1
 *       category: a deploy/blue-green event type, a pki-rotation event type,
 *       governance_votes, improvement_proposals, and an admin-privileged/security
 *       type. Asserted as a SUPERSET (each category matched by at least one of a
 *       small documented synonym set).
 *
 *   (B) PRODUCER WIRING. Each Tier-1 PRODUCER references an anchor SINK - a call
 *       to edge_blockchain_audit, the svc-blockchain record-audit route (the
 *       "slash audit" path), an INSERT/queue into blockchain_audit_records, or
 *       fn_anchor_decision / fn_queue_blockchain_sync. Producer groups (flexible
 *       on the exact wiring file): the blue-green deploy workflow, the PKI
 *       cert-rotation workflow, and the improvement_proposals approval path. A
 *       group passes when at least one of its candidate files anchors.
 *
 * OVERLAP: member-ballot anchoring (reference_table 'governance_votes') is the
 *   subject of ledger-governance-tables.gate.test.ts; this gate deliberately
 *   focuses on the BROADER Tier-1 coverage (deploys / PKI / improvement_proposals
 *   / admin) plus the taxonomy superset. governance_votes is still asserted as a
 *   taxonomy token here (it is already present), so the RED signal comes from the
 *   missing deploy/pki/improvement/admin tokens and the unwired producers.
 *
 * KNOWN-RED (authoring, branch feat/remediation): today only token movements,
 *   AI cognition and manual admin audits anchor. The allowlist
 *   (services/svc-blockchain/src/routes/record-audit.ts) contains only the
 *   token, governance and consent tokens - NO deploy, pki-rotation,
 *   improvement_proposals or admin-privileged/security token. And NONE of the
 *   producer workflows (WF_BLUE_GREEN_ORCHESTRATOR / WF_PKI_CERT_ROTATION /
 *   WF_APPROVAL_GATE et al) references any anchor sink. So (A) fails with 4
 *   missing tokens and (B) fails with 3 unanchored producers. Post-fix (extend
 *   the allowlist + wire each producer to an anchor sink) drives this GREEN.
 *
 * SCOPE: static SoT scan (reads a small documented set of real files under the
 *   working tree). Offline, deterministic, no new deps - consistent with the
 *   sibling remediation gates. Run:
 *     AISHA_SKIP_ONLINE=1 npx vitest run --config vitest.gates.config.ts \
 *       src/tests/gates/remediation/ledger-operational-anchor-coverage.gate.test.ts
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = process.cwd();

// --- Taxonomy source files (the allowlist + edge helper + table CHECK/enum) ---
const RECORD_AUDIT_ROUTE = path.join(
  ROOT,
  "services",
  "svc-blockchain",
  "src",
  "routes",
  "record-audit.ts",
);
const EDGE_AUDIT_FN = path.join(
  ROOT,
  "aisha",
  "db",
  "sql",
  "functions",
  "edge_blockchain_audit.sql",
);
const LEDGER_TABLE = path.join(
  ROOT,
  "aisha",
  "db",
  "sql",
  "tables",
  "blockchain_audit_records.sql",
);
const TAXONOMY_SOURCES = [RECORD_AUDIT_ROUTE, EDGE_AUDIT_FN, LEDGER_TABLE];

// --- Producer groups: each anchors if any candidate references an anchor sink ---
const WF_DIR = path.join(ROOT, "n8n", "workflows");
const wf = (name: string): string => path.join(WF_DIR, name);

interface ProducerGroup {
  key: string;
  candidates: string[];
}

const PRODUCER_GROUPS: ProducerGroup[] = [
  {
    key: "deploy (blue-green)",
    candidates: [
      wf("WF_BLUE_GREEN_ORCHESTRATOR.json"),
      wf("WF_SELF_DEPLOY.json"),
      wf("WF_DEPLOY_STORY.json"),
    ],
  },
  {
    key: "pki cert-rotation",
    candidates: [wf("WF_PKI_CERT_ROTATION.json")],
  },
  {
    key: "agent-change approvals (improvement_proposals)",
    candidates: [
      wf("WF_APPROVAL_GATE.json"),
      wf("WF_IMPROVEMENT_EVAL.json"),
      wf("WF_PROPOSAL_OUTCOME_REVIEW.json"),
    ],
  },
];

/**
 * Tier-1 taxonomy categories. Each is matched by a SMALL documented synonym set
 * so any reasonable naming of the fix matches, while today's token-and-consent
 * allowlist does NOT (except governance_votes, which is already present).
 */
interface TaxonomyCategory {
  key: string;
  re: RegExp;
}

const TIER1_TAXONOMY: TaxonomyCategory[] = [
  {
    key: "deploy / blue-green event type",
    re: /\b(deploy|blue[_-]?green|bluegreen|blue_green_switch|deployment)\b/i,
  },
  {
    key: "pki-rotation event type",
    re: /\b(pki_rotation|pki_cert_rotation|cert_rotation|certificate_rotation|cert_rotate|cert_renewal|pki_rotate)\b/i,
  },
  {
    key: "governance_votes (member ballots)",
    re: /\bgovernance_votes?\b/i,
  },
  {
    key: "improvement_proposals (agent-change approvals)",
    re: /\b(improvement_proposals?|agent_change|agent_change_approval|proposal_approval)\b/i,
  },
  {
    key: "admin-privileged / security event type",
    re: /\b(admin_action|privileged_action|admin_privileged|privileged_admin|security_event|admin_audit)\b/i,
  },
];

/**
 * Anchor SINK token: a call into the immutable ledger. Matches the edge helper,
 * a direct table INSERT/queue, the two anchor RPC wrappers, or the svc-blockchain
 * record-audit route (its declared path is the "slash audit" path). Kept
 * specific (underscore/slash-delimited) so incidental "audit_journal" text does
 * NOT count as ledger anchoring.
 */
const ANCHOR_SINK =
  /(edge_blockchain_audit|blockchain_audit_records|fn_anchor_decision|fn_queue_blockchain_sync|record[-_]?audit|\/audit\b)/i;

function readIfExists(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : null;
}

/** Concatenated text of all present taxonomy-source files. */
function taxonomyCorpus(): string {
  return TAXONOMY_SOURCES.map((f) => readIfExists(f) ?? "").join("\n/* --- */\n");
}

/** A producer group anchors when at least one existing candidate hits a sink. */
function groupAnchors(group: ProducerGroup): boolean {
  return group.candidates.some((f) => {
    const src = readIfExists(f);
    return src !== null && ANCHOR_SINK.test(src);
  });
}

describe("OPANCHOR - ledger operational anchor coverage gate", () => {
  it("taxonomy-source and producer files exist (sanity)", () => {
    const missingSources = TAXONOMY_SOURCES.filter((f) => !fs.existsSync(f));
    expect(
      missingSources.map((f) => path.relative(ROOT, f)),
      "Taxonomy-source file(s) missing - cannot evaluate the anchor allowlist.",
    ).toEqual([]);

    // Each producer group must have at least one existing candidate file, else
    // the producer itself is absent and the gap is elsewhere.
    for (const group of PRODUCER_GROUPS) {
      const present = group.candidates.filter((f) => fs.existsSync(f));
      expect(
        present.length,
        `Producer group "${group.key}" has no candidate file present under ` +
          `${path.relative(ROOT, WF_DIR)} (looked for ` +
          `${group.candidates.map((f) => path.basename(f)).join(", ")}).`,
      ).toBeGreaterThan(0);
    }
  });

  it("(A) the anchor taxonomy is a SUPERSET of the Tier-1 categories", () => {
    const corpus = taxonomyCorpus();
    const missing = TIER1_TAXONOMY.filter((c) => !c.re.test(corpus)).map(
      (c) => c.key,
    );

    expect(
      missing,
      `Anchor taxonomy is missing Tier-1 category token(s): ` +
        `[${missing.join(" | ")}]. The taxonomy corpus (record-audit.ts ` +
        `allowlist + edge_blockchain_audit.sql + the record_type CHECK/enum on ` +
        `blockchain_audit_records.sql) MUST include a token for each Tier-1 ` +
        `consequential event: a deploy/blue-green type, a pki-rotation type, ` +
        `governance_votes, improvement_proposals, and an ` +
        `admin-privileged/security type. Today the allowlist ` +
        `(services/svc-blockchain/src/routes/record-audit.ts) carries only ` +
        `token_*/governance_*/consent_* tokens - add the missing Tier-1 tokens ` +
        `so the taxonomy is a superset.`,
    ).toEqual([]);
  });

  it("(B) every Tier-1 producer is wired to an anchor sink", () => {
    const unanchored = PRODUCER_GROUPS.filter((g) => !groupAnchors(g)).map(
      (g) =>
        `${g.key} [${g.candidates.map((f) => path.basename(f)).join(", ")}]`,
    );

    expect(
      unanchored,
      `Tier-1 producer(s) with NO anchor wiring: ` +
        `[${unanchored.join(" ; ")}]. Each producer MUST reference an anchor ` +
        `sink - a call to edge_blockchain_audit, the svc-blockchain ` +
        `record-audit route (the "slash audit" path), an INSERT/queue into ` +
        `blockchain_audit_records, or fn_anchor_decision / ` +
        `fn_queue_blockchain_sync - so its consequential event writes a ` +
        `fingerprint into the immutable hash chain. Wiring location is flexible ` +
        `(any candidate file in the group satisfies it).`,
    ).toEqual([]);
  });
});
