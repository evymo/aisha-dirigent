#!/usr/bin/env node
/**
 * check-definer-rpc-security.mjs — close access.mjs's migration blind spot, reliably
 *
 * The existing security gate, scripts/db/db-manager/access.mjs (run in CI as
 * `--static`), scans ONLY aisha/db/sql/functions/*.sql for the SEC_DEF_NO_AUTH class
 * (a SECURITY DEFINER function with no auth check). Functions defined directly in a
 * MIGRATION and never mirrored into that source-of-truth are invisible to it.
 *
 * This check covers that blind spot — but reads the CATALOG, not migration text,
 * because migrations are a *history*: a function's real posture is the last
 * CREATE OR REPLACE + every GRANT/REVOKE applied in order (e.g. the audience module
 * REVOKEs PUBLIC via a runtime-generated `format()` statement that no text scan can
 * see). Only the applied catalog knows the truth. It therefore runs against the
 * cold-start database in scripts/db/verify-cold-start-apply.sh step 5/5 (which has
 * applied baseline + every delta), where $AISHA_DB_URL points.
 *
 * It FLAGS a function when ALL hold (catalog-authoritative):
 *   - SECURITY DEFINER (prosecdef)
 *   - EXECUTE-able by PUBLIC or anon (the actual, post-REVOKE grant state)
 *   - NOT a trigger function (RETURNS trigger → not RPC-callable; grant is moot)
 *   - no auth check in the body (access.mjs's exact pattern)
 *   - NOT defined in aisha/db/sql/functions/ (else access.mjs already lints it)
 *   - NOT on the reviewed allowlist
 *
 * Identity-keyed (allowlist of names + reasons), NOT a count — so it cannot be
 * masked by swapping one function for another, and a new footgun is a new name = a
 * hard fail. Remediation for a flag: add an auth check, OR move it into
 * sql/functions/ (so access.mjs lints it), OR — if genuinely safe (e.g. a definer
 * RLS helper) — add it to the allowlist WITH a reason.
 *
 * Usage:
 *   AISHA_DB_URL=postgres://… node scripts/db/check-definer-rpc-security.mjs           # gate: exit 1 on flag
 *   AISHA_DB_URL=postgres://… node scripts/db/check-definer-rpc-security.mjs --report  # list, never fail
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { psqlPripojeni } from './lib/psql-pripojeni.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const SQL_FUNCTIONS_DIR = path.join(ROOT, 'aisha/db/sql/functions');
const ALLOWLIST_FILE = path.join(ROOT, 'src/tests/gates/definer-rpc-security.allowlist.json');

const DB_URL = process.env.AISHA_DB_URL || process.env.DATABASE_URL || '';

// access.mjs's exact auth pattern, as a Postgres ARE (case-insensitive). '' = a
// literal single quote inside the SQL string. Kept in sync with access.mjs so both
// gates agree on what "has an auth check" means.
const AUTH_ARE =
  String.raw`(auth\.uid\(\)|is_admin_or_staff\s*\(|is_service_role\s*\(|current_setting\s*\(\s*''request\.jwt\.claim\.role''|get_jwt_role\s*\()`;

// The sharp catalog set: definer + PUBLIC/anon-EXECUTE + not-trigger + no-auth.
const SHARP_SQL = `
WITH sharp AS (
  SELECT DISTINCT p.oid, p.proname AS name
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f'::"char", p.proowner))) a
  WHERE n.nspname = 'public'
    AND p.prosecdef
    -- exclude (event-)trigger functions: not RPC-callable, the EXECUTE grant is moot
    AND p.prorettype NOT IN ('pg_catalog.trigger'::regtype, 'pg_catalog.event_trigger'::regtype)
    AND a.privilege_type = 'EXECUTE'
    AND (a.grantee = 0 OR a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'anon'))
    AND pg_get_functiondef(p.oid) !~* '${AUTH_ARE}'
)
SELECT name,
       (pg_get_functiondef(oid) ~* '\\m(INSERT\\s+INTO|UPDATE\\s+\\w|DELETE\\s+FROM|MERGE\\s+INTO)\\M') AS dml
FROM sharp ORDER BY name;`;

function psql(sql) {
  const { cil, env } = psqlPripojeni(DB_URL); // heslo prostředím, ne v argv
  const r = spawnSync('psql', [cil, '-X', '-v', 'ON_ERROR_STOP=1', '-tAF|', '-c', sql], { encoding: 'utf-8', env });
  if (r.error) throw new Error(`psql not runnable: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`psql exited ${r.status}: ${(r.stderr || '').trim()}`);
  return (r.stdout || '').trim().split('\n').filter(Boolean).map((line) => line.split('|'));
}

// Function names defined in the sql/functions/ SoT (access.mjs's domain).
function sotNames() {
  const names = new Set();
  if (!existsSync(SQL_FUNCTIONS_DIR)) return names;
  for (const f of readdirSync(SQL_FUNCTIONS_DIR).filter((x) => x.endsWith('.sql'))) {
    const src = readFileSync(path.join(SQL_FUNCTIONS_DIR, f), 'utf-8');
    const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)/gi;
    let m;
    while ((m = re.exec(src))) names.add(m[1].toLowerCase());
  }
  return names;
}

function main() {
  const report = process.argv.includes('--report');
  if (!DB_URL) {
    console.error('[definer-rpc-security] AISHA_DB_URL (or DATABASE_URL) must be set to a Postgres connection string.');
    process.exit(1);
  }

  let rows;
  try {
    rows = psql(SHARP_SQL);
  } catch (err) {
    console.error(`[definer-rpc-security] ${err.message}`);
    process.exit(1);
  }

  const sot = sotNames();
  const allow = existsSync(ALLOWLIST_FILE)
    ? new Map((JSON.parse(readFileSync(ALLOWLIST_FILE, 'utf-8')).allowlist ?? []).map((e) => [e.name.toLowerCase(), e.reason]))
    : new Map();

  // Blind spot = sharp set NOT in sql/functions/ (access.mjs can't see these).
  const blindSpot = rows
    .map(([name, dml]) => ({ name, dml: dml === 't', inSoT: sot.has(name.toLowerCase()) }))
    .filter((f) => !f.inSoT);
  const violations = blindSpot.filter((f) => !allow.has(f.name.toLowerCase()));

  console.error(
    `[definer-rpc-security] catalog sharp set (definer + PUBLIC/anon + no-auth + not-trigger) = ${rows.length}; ` +
      `of those, in sql/functions/ (access.mjs covers) = ${rows.length - blindSpot.length}; ` +
      `blind-spot = ${blindSpot.length} (${blindSpot.filter((f) => allow.has(f.name.toLowerCase())).length} allowlisted).`,
  );

  if (report) {
    for (const f of blindSpot) {
      console.log(`  ${f.name}  [${f.dml ? 'DML' : 'read'} ${allow.has(f.name.toLowerCase()) ? 'ALLOWLISTED' : 'FLAGGED'}]`);
    }
    process.exit(0);
  }

  if (violations.length) {
    console.error(`[definer-rpc-security] ${violations.length} migration-defined SECURITY DEFINER RPC(s) exposed to anon/PUBLIC with no auth check, invisible to access.mjs (not in sql/functions/):`);
    for (const v of violations) console.error(`  ✗ ${v.name}${v.dml ? ' — performs DML' : ''}`);
    console.error('Fix: add an auth check (auth.uid()/is_admin_or_staff()), OR move it into aisha/db/sql/functions/ so access.mjs lints it,');
    console.error(`     OR — if genuinely safe — add it to ${path.relative(ROOT, ALLOWLIST_FILE)} with a reason.`);
    process.exit(1);
  }

  console.error('[definer-rpc-security] clean — 0 unreviewed migration-defined definer RPC footguns.');
  process.exit(0);
}

main();
