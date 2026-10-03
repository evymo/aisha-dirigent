#!/usr/bin/env node
/**
 * verify-no-deferred-override — cold-start integrity gate.
 *
 * THE BUG THIS PROVES/GUARDS:
 * cold-start = apply the SoT-derived baseline.sql, then REPLAY the `deferred`
 * migrations on top. A deferred migration that re-`CREATE OR REPLACE`s a
 * function which the baseline already defines (from the current SoT) will
 * OVERRIDE the SoT-correct body with its own FROZEN, older body — silently
 * regressing it on every fresh cold-start (dropped auth guards, missing RBAC
 * clauses, raw audit inserts that RLS blocks, lost context layers, …).
 *
 * Definitive (no SQL parsing): compare the ACTUAL deployed function definitions
 * between two freshly-built databases —
 *   BASE  = substrate + baseline.sql ONLY            (== the SoT intent)
 *   FULL  = substrate + baseline.sql + deferred replay (== cold-start reality)
 * Any function present in both with a DIFFERENT pg_get_functiondef() is an
 * override → a cold-start regression.
 *
 * Usage:
 *   BASE_DB_URL=postgres://… FULL_DB_URL=postgres://… node scripts/db/verify-no-deferred-override.mjs
 * Exits 1 (and lists offenders) if any override is found.
 */
import { execFileSync } from 'node:child_process';
import { psqlPripojeni } from './lib/psql-pripojeni.mjs';

const BASE = process.env.BASE_DB_URL;
const FULL = process.env.FULL_DB_URL;
if (!BASE || !FULL) {
  console.error('BASE_DB_URL and FULL_DB_URL must be set');
  process.exit(2);
}

// name(identity-args) | md5(definition) for every normal (prokind='f') public function
const QUERY =
  "SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' || '|' || md5(pg_get_functiondef(p.oid)) " +
  "FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'";

function dump(url) {
  const { cil, env } = psqlPripojeni(url); // heslo prostředím, ne v argv
  const out = execFileSync('psql', [cil, '-tAc', QUERY], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  const m = new Map();
  for (const ln of out.split('\n')) {
    const i = ln.lastIndexOf('|');
    if (i > 0) m.set(ln.slice(0, i), ln.slice(i + 1));
  }
  return m;
}

const base = dump(BASE);
const full = dump(FULL);
const overrides = [];
for (const [sig, h] of base) {
  if (full.has(sig) && full.get(sig) !== h) overrides.push(sig);
}
overrides.sort();

console.log(`base functions=${base.size}  full functions=${full.size}  common=${[...base.keys()].filter((k) => full.has(k)).length}`);
if (overrides.length === 0) {
  console.log('✅ no deferred-migration overrides — cold-start function bodies match the SoT baseline');
  process.exit(0);
}
console.error(`❌ ${overrides.length} function(s) overridden by deferred migrations (cold-start regression vs SoT baseline):`);
for (const s of overrides) console.error('   • ' + s);
console.error('\nFix: back-port migration-only objects to aisha/db/sql/ (so baseline is complete and these migrations stop being deferred), OR bring each deferred body in lockstep with the SoT. Then this gate returns 0.');
process.exit(1);
