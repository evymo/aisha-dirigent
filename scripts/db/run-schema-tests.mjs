#!/usr/bin/env node
/**
 * run-schema-tests.mjs — pgTAP schema-contract test runner
 *
 * The in-DB complement of the catalog-based FK-relationship gate. Runs every
 * aisha/db/tests/schema/*.sql (pgTAP plan/assertions/finish, each wrapped in a
 * BEGIN…ROLLBACK that also CREATE EXTENSIONs pgtap so it never persists) against
 * the APPLIED schema and parses the TAP output. A `not ok` line, a plan mismatch,
 * or a psql error fails the run.
 *
 * pgTAP must be available in the server (infra/postgres ships postgresql-17-pgtap), and
 * the connecting role must be a superuser (CREATE EXTENSION) — true for the cold-start
 * / throwaway DB. Wired into verify-cold-start-apply.sh; also: npm run db:schema:test.
 *
 * Usage:
 *   AISHA_DB_URL=postgres://… node scripts/db/run-schema-tests.mjs           # gate: exit 1 on any failure
 *   AISHA_DB_URL=postgres://… node scripts/db/run-schema-tests.mjs --report  # show every ok/not ok line
 *
 * @module
 */

import { existsSync, readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { psqlPripojeni } from './lib/psql-pripojeni.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const TESTS_DIR = path.join(ROOT, 'aisha/db/tests/schema');
const DB_URL = process.env.AISHA_DB_URL || process.env.DATABASE_URL || '';

function testFiles() {
  if (!existsSync(TESTS_DIR)) return [];
  return readdirSync(TESTS_DIR).filter((f) => f.endsWith('.sql')).sort();
}

// Run one pgTAP file; return { ok, notOk: [...], planned, error }.
function runFile(file) {
  const abs = path.join(TESTS_DIR, file);
  const { cil, env } = psqlPripojeni(DB_URL); // heslo prostředím, ne v argv
  const r = spawnSync('psql', [cil, '-X', '-tA', '-v', 'ON_ERROR_STOP=1', '-f', abs], { encoding: 'utf-8', env });
  if (r.error) return { error: `psql not runnable: ${r.error.message}`, ok: 0, notOk: [], planned: null };
  if (r.status !== 0) return { error: (r.stderr || '').trim() || `psql exited ${r.status}`, ok: 0, notOk: [], planned: null };
  const lines = (r.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const planLine = lines.find((l) => /^1\.\.\d+$/.test(l));
  const planned = planLine ? Number(planLine.split('..')[1]) : null;
  const ok = lines.filter((l) => /^ok \d+/.test(l));
  const notOk = lines.filter((l) => /^not ok \d+/.test(l));
  return { ok: ok.length, notOk, planned, lines };
}

function main() {
  const report = process.argv.includes('--report');
  if (!DB_URL) {
    console.error('[schema-tests] AISHA_DB_URL (or DATABASE_URL) must point at a Postgres with pgTAP available and the schema applied.');
    process.exit(1);
  }

  const files = testFiles();
  if (files.length === 0) {
    console.error('[schema-tests] no test files under aisha/db/tests/schema/.');
    process.exit(0);
  }

  let totalOk = 0;
  let failed = false;
  for (const file of files) {
    const res = runFile(file);
    if (res.error) {
      console.error(`[schema-tests] ✗ ${file}: ${res.error}`);
      failed = true;
      continue;
    }
    totalOk += res.ok;
    if (report) {
      for (const l of res.lines.filter((l) => /^(ok|not ok) /.test(l))) console.log(`  ${file}: ${l}`);
    }
    // A plan with fewer ok than planned (and no not-ok) means assertions were skipped/errored mid-file.
    const planMismatch = res.planned != null && res.ok + res.notOk.length !== res.planned;
    if (res.notOk.length || planMismatch) {
      failed = true;
      console.error(`[schema-tests] ✗ ${file}: ${res.notOk.length} failing assertion(s)${planMismatch ? `, plan mismatch (planned ${res.planned}, ran ${res.ok + res.notOk.length})` : ''}`);
      for (const l of res.notOk) console.error(`     ${l}`);
    } else {
      console.error(`[schema-tests] ✓ ${file}: ${res.ok}/${res.planned ?? res.ok} assertions passed`);
    }
  }

  if (failed) {
    console.error('[schema-tests] FAILED — fix the schema (or the assertion if the contract legitimately changed).');
    process.exit(1);
  }
  console.error(`[schema-tests] clean — ${totalOk} schema-contract assertion(s) hold across ${files.length} file(s).`);
  process.exit(0);
}

main();
