/**
 * D3 — Local governance ballot ledger gate (remediation, test-first)
 *
 * CONTRACT (post-fix, per LOCKED DECISION D3):
 *   Member voting must be recorded in a LOCAL, queryable ballot ledger — not
 *   only broadcast by a single custodial backend signer. Concretely:
 *
 *   (a) Two SoT table files exist, each with Row Level Security ENABLED:
 *         aisha/db/sql/tables/governance_proposals.sql
 *         aisha/db/sql/tables/governance_votes.sql
 *       (RLS = `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` or the inline
 *        `... ENABLE ROW LEVEL SECURITY` form). Without RLS the ballot ledger
 *       leaks/accepts cross-tenant rows.
 *
 *   (b) A ballot RPC (a SoT function whose name casts/records a governance
 *       vote — e.g. cast_vote / cast_governance_vote / record_governance_vote)
 *       writes a row into the immutable hash-chain ledger keyed on the ballot
 *       table: it INSERTs into `blockchain_audit_records` (or PERFORMs a
 *       fn_queue_* wrapper over it) with `reference_table = 'governance_votes'`.
 *       This binds every ballot to the tamper-evident chain (D3: "each ballot
 *       writes a blockchain_audit_records row").
 *
 *   (c) Vote weight derives from token holdings — the ballot RPC references
 *       `memberships.tokens_governance` (or `user_wallets.governance_tokens`) —
 *       so weight is not an unauthenticated client-supplied number.
 *
 * KNOWN-RED (at authoring, HEAD feat/service-build-fixes):
 *   - governance_proposals.sql and governance_votes.sql DO NOT EXIST under
 *     aisha/db/sql/tables/ (the strings appear only as allowlist literals in
 *     services/svc-blockchain/src/routes/record-audit.ts:13-16).
 *   - No ballot RPC exists; voting is custodial single-signer via
 *     svc-blockchain /governance/vote → broadcastVote (no local ballots, no
 *     ledger row, no on-chain-independent tally).
 *   Every assertion below is therefore expected to FAIL until D3 lands.
 *
 * Post-fix: add the two RLS-enabled tables + a cast-vote RPC that writes the
 *   ledger row and reads tokens_governance → gate GREEN.
 *
 * SCOPE: static SoT scan (walks aisha/db/sql/**). Offline, deterministic, no
 *   new deps — consistent with the sibling remediation gates.
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = process.cwd();
const TABLES_DIR = path.join(ROOT, "aisha", "db", "sql", "tables");
const FUNCTIONS_DIR = path.join(ROOT, "aisha", "db", "sql", "functions");

const PROPOSALS_SQL = path.join(TABLES_DIR, "governance_proposals.sql");
const VOTES_SQL = path.join(TABLES_DIR, "governance_votes.sql");

function readIfExists(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : null;
}

/** True if the SoT table SQL enables Row Level Security on the table. */
function hasRlsEnabled(sql: string): boolean {
  return /\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b/i.test(sql);
}

/** List *.sql function files (empty array if the dir is missing). */
function listFunctionSql(): string[] {
  if (!fs.existsSync(FUNCTIONS_DIR)) return [];
  return fs
    .readdirSync(FUNCTIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => path.join(FUNCTIONS_DIR, f));
}

/**
 * A "ballot RPC" is a SoT function that INSERTs a ballot into governance_votes.
 * Recognised by an `INSERT INTO [public.]governance_votes` statement.
 */
function findBallotRpcs(): { file: string; sql: string }[] {
  const out: { file: string; sql: string }[] = [];
  for (const file of listFunctionSql()) {
    const sql = fs.readFileSync(file, "utf-8");
    if (/\bINSERT\s+INTO\s+(?:public\.)?governance_votes\b/i.test(sql)) {
      out.push({ file, sql });
    }
  }
  return out;
}

/**
 * True if the RPC binds the ballot to the immutable ledger keyed on the ballot
 * table: it references blockchain_audit_records (directly, or via a
 * fn_queue_blockchain_sync helper) AND carries reference_table =
 * 'governance_votes'.
 */
function writesLedgerRowForVotes(sql: string): boolean {
  const touchesLedger =
    /\bblockchain_audit_records\b/i.test(sql) ||
    /\bfn_queue_blockchain_sync\b/i.test(sql);
  const keyedOnVotes =
    /reference_table[\s\S]{0,80}?['"]governance_votes['"]/i.test(sql) ||
    /['"]governance_votes['"][\s\S]{0,80}?reference_table/i.test(sql);
  return touchesLedger && keyedOnVotes;
}

/** True if the RPC derives weight from a token-holding column. */
function derivesWeightFromTokens(sql: string): boolean {
  return (
    /\btokens_governance\b/i.test(sql) ||
    /\bgovernance_tokens\b/i.test(sql)
  );
}

describe("D3 local governance ballot ledger gate", () => {
  // (a) tables exist + RLS
  it("governance_proposals SoT table exists with RLS enabled", () => {
    const sql = readIfExists(PROPOSALS_SQL);
    expect(
      sql,
      `Missing SoT table file: ${path.relative(ROOT, PROPOSALS_SQL)}. ` +
        `D3 requires a LOCAL governance_proposals table (RLS, tally, quorum). ` +
        `Currently 'governance_proposals' exists only as an allowlist string in ` +
        `services/svc-blockchain/src/routes/record-audit.ts.`,
    ).not.toBeNull();
    expect(
      hasRlsEnabled(sql as string),
      `governance_proposals.sql exists but does not ENABLE ROW LEVEL SECURITY.`,
    ).toBe(true);
  });

  it("governance_votes SoT table exists with RLS enabled", () => {
    const sql = readIfExists(VOTES_SQL);
    expect(
      sql,
      `Missing SoT table file: ${path.relative(ROOT, VOTES_SQL)}. ` +
        `D3 requires a LOCAL governance_votes ballot table (RLS). ` +
        `Currently 'governance_votes' exists only as an allowlist string in ` +
        `services/svc-blockchain/src/routes/record-audit.ts — voting is ` +
        `custodial single-signer with no local ballots.`,
    ).not.toBeNull();
    expect(
      hasRlsEnabled(sql as string),
      `governance_votes.sql exists but does not ENABLE ROW LEVEL SECURITY.`,
    ).toBe(true);
  });

  // (b) a ballot RPC writes the immutable ledger row keyed on governance_votes
  it("a ballot RPC writes a blockchain_audit_records row with reference_table='governance_votes'", () => {
    const ballots = findBallotRpcs();
    expect(
      ballots.length,
      `No ballot RPC found: no SoT function under ` +
        `${path.relative(ROOT, FUNCTIONS_DIR)} INSERTs into governance_votes. ` +
        `D3 requires a custodial cast-vote RPC that persists a local ballot.`,
    ).toBeGreaterThan(0);

    const bound = ballots.filter((b) => writesLedgerRowForVotes(b.sql));
    expect(
      bound.length,
      `Ballot RPC(s) [${ballots
        .map((b) => path.basename(b.file))
        .join(", ")}] do not bind the ballot to the immutable chain: none ` +
        `insert/queue a blockchain_audit_records row with ` +
        `reference_table = 'governance_votes'. Per D3 each ballot MUST write a ` +
        `hash-chain ledger row keyed on governance_votes.`,
    ).toBeGreaterThan(0);
  });

  // (c) weight derives from token holdings, not client input
  it("the ballot RPC derives vote weight from memberships.tokens_governance (or user_wallets.governance_tokens)", () => {
    const ballots = findBallotRpcs();
    expect(
      ballots.length,
      `No ballot RPC found (see prior assertion) — cannot verify vote weight ` +
        `derivation.`,
    ).toBeGreaterThan(0);

    const weighted = ballots.filter((b) => derivesWeightFromTokens(b.sql));
    expect(
      weighted.length,
      `Ballot RPC(s) [${ballots
        .map((b) => path.basename(b.file))
        .join(", ")}] do not reference tokens_governance / governance_tokens. ` +
        `Per D3 vote weight MUST derive from token holdings, not a ` +
        `client-supplied number.`,
    ).toBeGreaterThan(0);
  });
});
