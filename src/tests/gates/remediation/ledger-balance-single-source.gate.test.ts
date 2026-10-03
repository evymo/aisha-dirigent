/**
 * Gate (remediation D4 — ledger balance = single token_transactions source):
 * token balance MUST resolve to ONE canonical source derived from the append-only
 * token_transactions ledger, and the reward-claim path must be linked to its
 * originating ledger row so it cannot be fulfilled twice.
 *
 * Contract (LOCKED D4): "converge on token_transactions-derived balance (single
 * SoT). claim_cosmos_reward links reward_claims.id to the originating
 * token_transaction/outbox row (no double-fulfilment). update_user_wallet_balance
 * must handle 'aisha'."
 *
 * Today the platform keeps TWO unreconciled balance stores — memberships.tokens_*
 * (int4) and user_wallets.*_tokens (numeric) — and the wallet reader
 * (get_my_wallet_balance) blind-reads user_wallets instead of folding the ledger.
 * claim_cosmos_reward mints a token_transaction AND a reward_claims row but never
 * links them, so a replayed / duplicated outbox fulfilment cannot be de-duped
 * against the originating transaction. And update_user_wallet_balance silently
 * drops every 'aisha' transaction (its NOT IN ('governance','impact','data')
 * filter), so the user_wallets.aisha_tokens column can never move even though the
 * ledger recorded the flow. Three independent ways the "balance" disagrees with
 * the ledger.
 *
 * This gate asserts the CORRECT post-fix contract in three parts:
 *
 *  (A) A canonical balance derivation from token_transactions exists AND is what
 *      the wallet reader returns — get_my_wallet_balance must derive from
 *      token_transactions (fold the append ledger via SUM/balance_after), not
 *      blind-read user_wallets as the sole source.
 *
 *  (B) reward_claims carries a reference column to the originating
 *      token_transaction (a FK), and claim_cosmos_reward populates it on INSERT —
 *      so the outbox fulfilment is bound 1:1 to a single ledger row.
 *
 *  (C) update_user_wallet_balance handles the 'aisha' token type (writes
 *      aisha_tokens), i.e. it does not drop 'aisha' on the floor.
 *
 * KNOWN-RED at authoring time (branch feat/service-build-fixes): (A)
 * get_my_wallet_balance reads only user_wallets; (B) reward_claims has no
 * transaction reference column and claim_cosmos_reward's reward_claims INSERT
 * omits the transaction id; (C) update_user_wallet_balance filters aisha OUT.
 * instancesFlagged = 3. After the D4 fix all parts go green.
 *
 * STATIC / offline: walks aisha/db/sql SoT only. No DB, no network, no new deps.
 * Run: AISHA_SKIP_ONLINE=1 npx vitest run --config vitest.gates.config.ts \
 *   src/tests/gates/remediation/ledger-balance-single-source.gate.test.ts
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FN = (f: string) => join(ROOT, "aisha/db/sql/functions", f);
const TBL = (f: string) => join(ROOT, "aisha/db/sql/tables", f);

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/** Strip SQL comments so keyword scans never match prose in header comments. */
function code(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const walletReader = code(read(FN("get_my_wallet_balance.sql")));
const claimCosmos = code(read(FN("claim_cosmos_reward.sql")));
const walletTrigger = code(read(FN("update_user_wallet_balance.sql")));
const rewardClaims = code(read(TBL("reward_claims.sql")));

describe("D4 — token balance is a single token_transactions-derived source", () => {
  // -- Part A: canonical ledger-derived balance is what the app reads ---------
  describe("(A) wallet balance is derived from the token_transactions ledger", () => {
    test("get_my_wallet_balance.sql exists (the app's balance reader)", () => {
      expect(walletReader.length).toBeGreaterThan(0);
    });

    test("balance reader folds the token_transactions ledger, not just user_wallets", () => {
      // The canonical balance MUST derive from the append-only ledger. A reader
      // that only SELECTs FROM user_wallets is a blind dual-store read.
      expect(/\btoken_transactions\b/i.test(walletReader)).toBe(true);
    });

    test("balance reader aggregates the ledger (SUM/balance_after fold), not a raw column read", () => {
      const folds =
        /\bSUM\s*\(/i.test(walletReader) ||
        /\bbalance_after\b/i.test(walletReader);
      expect(folds).toBe(true);
    });
  });

  // -- Part B: reward_claims linked to its originating ledger row -------------
  describe("(B) reward_claims is linked to its originating token_transaction (no double-fulfilment)", () => {
    const REF_COL = /\b(transaction_id|token_transaction_id|source_transaction_id)\b/i;

    test("reward_claims has a reference column to token_transactions (FK)", () => {
      const hasCol = REF_COL.test(rewardClaims);
      const fkToLedger =
        /REFERENCES\s+(public\.)?token_transactions/i.test(rewardClaims);
      expect(hasCol && fkToLedger).toBe(true);
    });

    test("claim_cosmos_reward populates the transaction link on the reward_claims INSERT", () => {
      // Isolate the INSERT INTO reward_claims (...) column list and assert the
      // originating transaction id is threaded into it.
      const m = claimCosmos.match(
        /INSERT\s+INTO\s+(?:public\.)?reward_claims\s*\(([^)]*)\)/i,
      );
      const columnList = m ? m[1] : "";
      expect(REF_COL.test(columnList)).toBe(true);
    });
  });

  // -- Part C: wallet trigger handles the 'aisha' token type -----------------
  describe("(C) update_user_wallet_balance handles the 'aisha' token type", () => {
    test("trigger fn exists", () => {
      expect(walletTrigger.length).toBeGreaterThan(0);
    });

    test("trigger does not filter 'aisha' out of the accepted token types", () => {
      // A guard like  NOT IN ('governance','impact','data')  drops aisha.
      const dropsAisha =
        /NOT\s+IN\s*\([^)]*\)/i.test(walletTrigger) &&
        !/NOT\s+IN\s*\([^)]*'aisha'[^)]*\)/i.test(walletTrigger) &&
        // ...only counts as a drop if there IS a positive allow-list that omits aisha
        /token_type\s+NOT\s+IN/i.test(walletTrigger);
      expect(dropsAisha).toBe(false);
    });

    test("trigger writes the aisha_tokens balance column", () => {
      expect(/\baisha_tokens\b/i.test(walletTrigger)).toBe(true);
    });
  });
});
