/**
 * Gate — wallet-reader ↔ frontend-schema contract.
 * ============================================================================
 * The reward-shop wallet UI validates the get_my_wallet_balance RPC response
 * through walletBalanceSchema (src/hooks/useRewardShop.ts) with a LENIENT parser
 * (parseRpcArray skips rows that fail validation). So if the DB function stops
 * returning a field the schema marks required, the row is silently dropped and
 * useWalletBalance() returns null — the wallet shows 0 for every balance with no
 * error. That is exactly how aisha_tokens went missing: the schema required it,
 * MemberStory / MemberRewardShop read `wallet.aisha_tokens` as the platform
 * balance, but the RETURNS TABLE never produced it.
 *
 * This gate makes that drift impossible: every field walletBalanceSchema
 * requires MUST be a column the get_my_wallet_balance SoT function returns.
 *
 * STATIC / offline: walks the two source files as text. No DB, no network.
 * Run: AISHA_SKIP_ONLINE=1 npx vitest run --config vitest.gates.config.ts \
 *   src/tests/gates/remediation/wallet-reader-schema-contract.gate.test.ts
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/** Strip line/block comments so prose can never satisfy a scan. */
function code(src: string): string {
  return src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Field names of the `walletBalanceSchema = z.object({ ... })` literal. */
function walletSchemaKeys(): string[] {
  const src = code(readFileSync(join(ROOT, "src/hooks/useRewardShop.ts"), "utf8"));
  const m = src.match(/walletBalanceSchema\s*=\s*z\.object\(\{([\s\S]*?)\}\)/);
  if (!m) return [];
  return [...m[1].matchAll(/(\w+)\s*:/g)].map((x) => x[1]);
}

/** Column names of get_my_wallet_balance's RETURNS TABLE ( ... ). */
function rpcReturnColumns(): string[] {
  const sql = readFileSync(
    join(ROOT, "aisha/db/sql/functions/get_my_wallet_balance.sql"),
    "utf8",
  ).replace(/--[^\n]*/g, "");
  const m = sql.match(/RETURNS\s+TABLE\s*\(([\s\S]*?)\)\s*LANGUAGE/i);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((line) => line.trim().match(/^(\w+)\s+\w/)?.[1])
    .filter((x): x is string => Boolean(x));
}

describe("wallet reader returns every field the frontend schema requires", () => {
  const schemaKeys = walletSchemaKeys();
  const rpcColumns = rpcReturnColumns();

  test("both sources parse (guards against a broken regex, not a real drift)", () => {
    expect(schemaKeys.length).toBeGreaterThan(0);
    expect(rpcColumns.length).toBeGreaterThan(0);
  });

  test("every walletBalanceSchema field is a get_my_wallet_balance column", () => {
    const missing = schemaKeys.filter((k) => !rpcColumns.includes(k));
    expect(missing, `schema fields not returned by the RPC: ${missing.join(", ")}`).toEqual([]);
  });

  test("aisha_tokens (the reward-shop platform balance) is present on both sides", () => {
    // The specific regression this gate was born from.
    expect(schemaKeys).toContain("aisha_tokens");
    expect(rpcColumns).toContain("aisha_tokens");
  });
});
