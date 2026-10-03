/**
 * RLS-self-reference gate — the second DB-security invariant, gated on cold-start
 *
 * Companion to definer-rpc-security.gate. DB_SECURITY_INVARIANTS.md (#240) defines two
 * invariants; the cold-start gate operationalized the first (definer grants). This
 * closes the loop on the second: public.aisha_assert_rls_self_reference() flags RLS
 * policies whose USING/WITH CHECK queries their own table in a FROM/JOIN — the Postgres
 * 42P17 recursion vector. scripts/db/check-rls-self-reference.mjs runs that RPC against
 * the APPLIED cold-start catalog (verify-cold-start-apply.sh step 5/5), failing on any
 * self-reference not on the reviewed allowlist.
 *
 * This gate test is STATIC (same idiom as definer-rpc-security.gate): it validates the
 * checker + allowlist + wiring without standing up Postgres (that is the cold-start
 * gate's job). It keeps the allowlist minimal so pre-existing self-refs can't quietly
 * pile up, and the wiring from rotting.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const ALLOWLIST = resolve(ROOT, 'src/tests/gates/rls-self-reference.allowlist.json');
const CHECK = resolve(ROOT, 'scripts/db/check-rls-self-reference.mjs');
const COLD_START = resolve(ROOT, 'scripts/db/verify-cold-start-apply.sh');
const MIGRATION = resolve(ROOT, 'aisha/db/migrations/00000000000000_baseline.sql');
const DOC = resolve(ROOT, 'docs/security/DB_SECURITY_INVARIANTS.md');

interface Allowlist {
  _comment: string;
  allowlist: Array<{ table: string; policy: string; reason: string }>;
}

describe('RLS-self-reference gate', () => {
  test('allowlist exists and is well-formed', () => {
    expect(existsSync(ALLOWLIST), `Missing allowlist: ${ALLOWLIST}`).toBe(true);
    const a = JSON.parse(readFileSync(ALLOWLIST, 'utf-8')) as Allowlist;
    expect(typeof a._comment).toBe('string');
    expect(Array.isArray(a.allowlist)).toBe(true);
    for (const e of a.allowlist) {
      expect(typeof e.table, 'allowlist entry needs a table').toBe('string');
      expect(e.table.length).toBeGreaterThan(0);
      expect(typeof e.policy, 'allowlist entry needs a policy').toBe('string');
      expect(e.policy.length).toBeGreaterThan(0);
      // Every entry carries a human justification — no bare names. Stops the allowlist
      // from becoming a silent dumping ground for live recursion risks.
      expect(e.reason?.length ?? 0, `allowlist entry "${e.table}::${e.policy}" needs a reason`).toBeGreaterThan(20);
    }
  });

  test('allowlist stays minimal (every entry is a known recursion risk awaiting reroute)', () => {
    const a = JSON.parse(readFileSync(ALLOWLIST, 'utf-8')) as Allowlist;
    expect(a.allowlist.length).toBeLessThan(10);
  });

  test('the check script runs the assertion RPC against the allowlist', () => {
    expect(existsSync(CHECK), `Missing checker: ${CHECK}`).toBe(true);
    const src = readFileSync(CHECK, 'utf-8');
    expect(src).toContain('aisha_assert_rls_self_reference');
    expect(src).toContain('rls-self-reference.allowlist.json');
    expect(src).toContain('--report');
  });

  test('cold-start gate step 5/5 runs the RLS checker', () => {
    expect(existsSync(COLD_START)).toBe(true);
    const src = readFileSync(COLD_START, 'utf-8');
    expect(src).toContain('check-rls-self-reference.mjs');
    expect(src).toContain('5/5  DB-security');
  });

  test('the assertion RPC is defined by a migration', () => {
    expect(existsSync(MIGRATION)).toBe(true);
    const sql = readFileSync(MIGRATION, 'utf-8');
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION\s+public\.aisha_assert_rls_self_reference/);
  });

  test('the security doc documents this gate', () => {
    expect(existsSync(DOC)).toBe(true);
    expect(readFileSync(DOC, 'utf-8')).toContain('check-rls-self-reference');
  });
});
