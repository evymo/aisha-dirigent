#!/usr/bin/env node
/**
 * check-rls-self-reference.mjs — the second DB-security invariant, gated on cold-start
 *
 * Companion to check-definer-rpc-security.mjs. DB_SECURITY_INVARIANTS.md (shipped in
 * #240) defines TWO invariants + assertion RPCs; the cold-start gate operationalized
 * the first (definer grants). This closes the loop on the second:
 *
 *   public.aisha_assert_rls_self_reference() → RLS policies whose USING / WITH CHECK
 *   expression queries their OWN table in a FROM/JOIN — the Postgres 42P17 infinite-
 *   recursion vector (every read that touches the table 500s). The fix is to route the
 *   self-reference through a STABLE SECURITY DEFINER helper (the is_story_partner()
 *   pattern 20260530130000 applied to story_participants), so the policy no longer
 *   names its own table.
 *
 * Run as part of verify-cold-start-apply.sh step 5/5 against the APPLIED cold-start
 * schema. Identity-keyed (table :: policy) allowlist, exactly like the definer gate:
 * a NEW self-reference is a new identity = a hard fail; pre-existing ones are
 * allowlisted WITH a reason (and a pointer to the helper-reroute fix for their owner)
 * so the gate guards regressions without doing RLS-policy surgery on tables it does
 * not own.
 *
 * Uses psql (via spawnSync) — same dependency as the cold-start script. The assertion
 * RPC is applied by 20260530160000_aisha_db_security_invariants.sql.
 *
 * Usage:
 *   AISHA_DB_URL=postgres://… node scripts/db/check-rls-self-reference.mjs           # gate: exit 1 on a new self-ref
 *   AISHA_DB_URL=postgres://… node scripts/db/check-rls-self-reference.mjs --report  # list, never fail
 */

import { existsSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { psqlPripojeni } from './lib/psql-pripojeni.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const ALLOWLIST_FILE = path.join(ROOT, 'src/tests/gates/rls-self-reference.allowlist.json');

const DB_URL = process.env.AISHA_DB_URL || process.env.DATABASE_URL || '';

function psqlRows(sql) {
  // -F '|' field separator; policy names may contain spaces but not '|'.
  const { cil, env } = psqlPripojeni(DB_URL); // heslo prostředím, ne v argv
  const r = spawnSync('psql', [cil, '-X', '-v', 'ON_ERROR_STOP=1', '-tAF|', '-c', sql], { encoding: 'utf-8', env });
  if (r.error) throw new Error(`psql not runnable: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`psql exited ${r.status}: ${(r.stderr || '').trim()}`);
  return (r.stdout || '').trim().split('\n').filter(Boolean).map((line) => line.split('|'));
}

function main() {
  const report = process.argv.includes('--report');
  if (!DB_URL) {
    console.error('[rls-self-reference] AISHA_DB_URL (or DATABASE_URL) must be set to a Postgres connection string.');
    process.exit(1);
  }

  // Guard: the assertion RPC must be present (applied by 20260530160000).
  let rows;
  try {
    const present = psqlRows("SELECT to_regprocedure('public.aisha_assert_rls_self_reference()') IS NOT NULL");
    if (present[0]?.[0] !== 't') {
      throw new Error('public.aisha_assert_rls_self_reference() not found — is 20260530160000 applied to AISHA_DB_URL?');
    }
    rows = psqlRows('SELECT table_ident, policy_name, clause FROM public.aisha_assert_rls_self_reference()');
  } catch (err) {
    console.error(`[rls-self-reference] ${err.message}`);
    process.exit(1);
  }

  const allow = existsSync(ALLOWLIST_FILE)
    ? new Map((JSON.parse(readFileSync(ALLOWLIST_FILE, 'utf-8')).allowlist ?? []).map((e) => [`${e.table}::${e.policy}`.toLowerCase(), e.reason]))
    : new Map();

  const hits = rows.map(([table, policy, clause]) => ({ table, policy, clause, id: `${table}::${policy}`.toLowerCase() }));
  const violations = hits.filter((h) => !allow.has(h.id));

  console.error(`[rls-self-reference] ${hits.length} policy/policies query their own table (FROM/JOIN); ${hits.length - violations.length} allowlisted.`);

  if (report) {
    for (const h of hits) console.log(`  ${h.table} :: ${h.policy} [${h.clause}] ${allow.has(h.id) ? 'ALLOWLISTED' : 'FLAGGED'}`);
    process.exit(0);
  }

  if (violations.length) {
    console.error(`[rls-self-reference] ${violations.length} NEW RLS self-reference(s) (42P17 recursion risk):`);
    for (const v of violations) console.error(`  ✗ ${v.table} :: ${v.policy} (${v.clause})`);
    console.error('Fix: route the self-reference through a STABLE SECURITY DEFINER helper (see is_story_partner() +');
    console.error('     20260530130000_fix_story_participants_rls_recursion). If genuinely safe, add it to');
    console.error(`     ${path.relative(ROOT, ALLOWLIST_FILE)} with a reason.`);
    process.exit(1);
  }

  console.error('[rls-self-reference] clean — 0 unreviewed RLS self-references.');
  process.exit(0);
}

main();
