#!/usr/bin/env node
/**
 * check-fk-relationship-gaps.mjs — the "DB architect" relationship lens
 *
 * Third sibling of the cold-start DB-invariant family
 * (check-definer-rpc-security.mjs, check-rls-self-reference.mjs). Same shape:
 * read the APPLIED catalog (not migration text), identity-keyed allowlist,
 * --report mode, run from verify-cold-start-apply.sh against $AISHA_DB_URL.
 *
 * What it answers — "kde jsou a kde nejsou vazby":
 *   A column named like a foreign key (`*_id`, not the PK `id`) that has NO
 *   foreign-key constraint covering it (pg_constraint.contype='f'). At the
 *   AISHA scale (338 tables, FKs mostly inline, lots of legacy
 *   RLS-instead-of-FK), a large share of logical relationships are not
 *   enforced — this lens quantifies exactly which.
 *
 * Why catalog, not regex over aisha/db/sql/tables/*.sql:
 *   The truth of "is there an FK on this column" is the applied constraint
 *   set, including deferred FKs in aisha/db/sql/constraints/ and any added by
 *   a later migration. Only the catalog knows the post-apply shape. This is
 *   the same reason the definer / RLS-self-ref checks read the catalog.
 *
 * Noise control — a `*_id` with no FK is only a CANDIDATE gap when at least
 * one high-precision signal fires (else it is almost certainly not a relation,
 * e.g. external_id / correlation_id / trace_id / tenant_id with no table):
 *   • fk_elsewhere     — a column of the SAME name backs a real FK on some
 *                        OTHER public table → inconsistent enforcement, the
 *                        textbook "missing constraint" (e.g. document_id is an
 *                        FK in 30 tables but plain in 1).
 *   • stem_table_exists — a public table named <stem> or <stem>s exists
 *                        (stem = column without the _id suffix).
 * Columns matching neither signal are reported as "ignored (no signal)" and
 * never gate.
 *
 * Identity-keyed on `table.column`: a NEW gap is a NEW identity = a hard fail.
 * Pre-existing gaps are snapshotted into the allowlist (`--baseline`) WITH a
 * reason, exactly like gate:branding:baseline (the repo's baseline-snapshot pattern).
 * The gate then guards REGRESSIONS (new unenforced *_id columns), not the
 * absolute count — the architect drives the snapshot down over time.
 *
 * Usage:
 *   AISHA_DB_URL=postgres://… node scripts/db/check-fk-relationship-gaps.mjs            # gate: exit 1 on a NEW gap
 *   AISHA_DB_URL=postgres://… node scripts/db/check-fk-relationship-gaps.mjs --report   # list all candidates, never fail
 *   AISHA_DB_URL=postgres://… node scripts/db/check-fk-relationship-gaps.mjs --baseline # snapshot current candidates into the allowlist
 *
 * @module
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { porovnej } from '../lib/razeni.mjs';
import { psqlPripojeni } from './lib/psql-pripojeni.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const ALLOWLIST_FILE = path.join(ROOT, 'src/tests/gates/fk-relationship-gaps.allowlist.json');

const DB_URL = process.env.AISHA_DB_URL || process.env.DATABASE_URL || '';

// Candidate gaps: public base-table `*_id` columns (not the PK `id`) NOT covered
// by any FK constraint, enriched with the two precision signals + the target(s)
// the column references elsewhere (so the message can say "elsewhere → table X").
const GAPS_SQL = `
WITH idcols AS (
  SELECT c.relname AS tbl, a.attname AS col
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  WHERE c.relkind = 'r'
    AND a.attname ~ '_id$'
    AND a.attname <> 'id'
),
fk_cols AS (  -- (tbl, col) pairs already covered by a FK constraint here
  SELECT c.relname AS tbl, a.attname AS col
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  JOIN unnest(con.conkey) AS k(attnum) ON true
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
  WHERE con.contype = 'f'
),
fk_targets AS (  -- per column NAME, the distinct public tables it references elsewhere
  SELECT a.attname AS col, string_agg(DISTINCT tc.relname, ',' ORDER BY tc.relname) AS targets
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  JOIN unnest(con.conkey) AS k(attnum) ON true
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
  JOIN pg_class tc ON tc.oid = con.confrelid
  WHERE con.contype = 'f'
  GROUP BY a.attname
),
pk_cols AS (  -- (tbl, col) pairs that are part of a PRIMARY KEY. A PK named like
              -- run_id is the FK TARGET, not a source missing an FK (e.g. aitg_runs.run_id).
  SELECT c.relname AS tbl, a.attname AS col
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  JOIN unnest(con.conkey) AS k(attnum) ON true
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
  WHERE con.contype = 'p'
),
ptables AS (
  SELECT c.relname FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  WHERE c.relkind = 'r'
)
SELECT
  i.tbl,
  i.col,
  (ft.targets IS NOT NULL)                                            AS fk_elsewhere,
  EXISTS (SELECT 1 FROM ptables p
          WHERE (p.relname = regexp_replace(i.col, '_id$', '')
              OR p.relname = regexp_replace(i.col, '_id$', '') || 's')
            -- exclude the external-ID pattern: a <tablename_singular>_id column on
            -- its OWN table (e.g. stripe_disputes.stripe_dispute_id) is a Stripe/
            -- external key, not a relation.
            AND p.relname <> i.tbl) AS stem_table_exists,
  COALESCE(ft.targets, regexp_replace(i.col, '_id$', '') || '(?)')    AS guess
FROM idcols i
LEFT JOIN fk_cols f ON f.tbl = i.tbl AND f.col = i.col
LEFT JOIN fk_targets ft ON ft.col = i.col
WHERE f.col IS NULL
  AND NOT EXISTS (SELECT 1 FROM pk_cols pk WHERE pk.tbl = i.tbl AND pk.col = i.col)
ORDER BY i.tbl, i.col;`;

function psql(sql) {
  const { cil, env } = psqlPripojeni(DB_URL); // heslo prostředím, ne v argv
  const r = spawnSync('psql', [cil, '-X', '-v', 'ON_ERROR_STOP=1', '-tAF|', '-c', sql], { encoding: 'utf-8', env });
  if (r.error) throw new Error(`psql not runnable: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`psql exited ${r.status}: ${(r.stderr || '').trim()}`);
  return (r.stdout || '').trim().split('\n').filter(Boolean).map((line) => line.split('|'));
}

function loadAllowlist() {
  if (!existsSync(ALLOWLIST_FILE)) return new Map();
  const json = JSON.parse(readFileSync(ALLOWLIST_FILE, 'utf-8'));
  return new Map((json.allowlist ?? []).map((e) => [`${e.table}.${e.column}`.toLowerCase(), e.reason]));
}

function main() {
  const report = process.argv.includes('--report');
  const baseline = process.argv.includes('--baseline');
  if (!DB_URL) {
    console.error('[fk-relationship-gaps] AISHA_DB_URL (or DATABASE_URL) must be set to a Postgres connection string.');
    process.exit(1);
  }

  let rows;
  try {
    rows = psql(GAPS_SQL);
  } catch (err) {
    console.error(`[fk-relationship-gaps] ${err.message}`);
    process.exit(1);
  }

  // Split into precision-signal candidates vs no-signal noise.
  const all = rows.map(([tbl, col, fkElsewhere, stemExists, guess]) => ({
    tbl,
    col,
    fkElsewhere: fkElsewhere === 't',
    stemExists: stemExists === 't',
    guess,
    id: `${tbl}.${col}`.toLowerCase(),
  }));
  const candidates = all.filter((g) => g.fkElsewhere || g.stemExists);
  const noise = all.length - candidates.length;

  if (baseline) {
    const snapshot = {
      _comment:
        'Allowlist for scripts/db/check-fk-relationship-gaps.mjs (the DB-architect relationship lens). ' +
        'Each entry is a `*_id`-named column with NO foreign-key constraint, but a high-precision signal ' +
        '(same-named column is an FK elsewhere, or a <stem>/<stem>s table exists) says it probably SHOULD be ' +
        'one. Identity-keyed on table.column: a NEW gap is a NEW identity = a hard fail in ' +
        'verify-cold-start-apply.sh. This file is the snapshot of PRE-EXISTING gaps — the gate guards ' +
        'against regressions while the architect drives the count down. To clear an entry: add a FOREIGN KEY ' +
        'in aisha/db/sql/tables/<table>.sql (or aisha/db/sql/constraints/) and regenerate baseline ' +
        '(npm run db:init:generate). To re-snapshot after intentional change: npm run db:schema:gaps:baseline.',
      _generated_at: new Date().toISOString().slice(0, 10),
      _candidate_count: candidates.length,
      allowlist: candidates
        .slice()
        .sort((a, b) => porovnej(a.id, b.id))
        .map((g) => ({
          table: g.tbl,
          column: g.col,
          reason: `Pre-existing unenforced relationship (baseline snapshot). ${
            g.fkElsewhere ? `'${g.col}' is an enforced FK elsewhere → ${g.guess}` : `a '${g.guess}' table exists`
          }; no FK constraint here. Guarded against NEW drift — add a FOREIGN KEY in the table SoT to clear.`,
        })),
    };
    writeFileSync(ALLOWLIST_FILE, JSON.stringify(snapshot, null, 2) + '\n');
    console.error(
      `[fk-relationship-gaps] baseline written: ${candidates.length} candidate gap(s) snapshotted to ${path.relative(ROOT, ALLOWLIST_FILE)} (${noise} no-signal *_id columns ignored).`,
    );
    process.exit(0);
  }

  const allow = loadAllowlist();
  const violations = candidates.filter((g) => !allow.has(g.id));

  console.error(
    `[fk-relationship-gaps] ${all.length} unconstrained *_id column(s); ${candidates.length} candidate gap(s) ` +
      `(${candidates.length - violations.length} allowlisted), ${noise} ignored (no signal).`,
  );

  if (report) {
    for (const g of candidates) {
      const sig = [g.fkElsewhere ? 'fk-elsewhere' : null, g.stemExists ? 'stem-table' : null].filter(Boolean).join('+');
      console.log(
        `  ${g.tbl}.${g.col} → ${g.guess}  [${sig}] ${allow.has(g.id) ? 'ALLOWLISTED' : 'FLAGGED'}`,
      );
    }
    process.exit(0);
  }

  if (violations.length) {
    console.error(`[fk-relationship-gaps] ${violations.length} NEW unenforced relationship(s) (a *_id column gained no FK):`);
    for (const v of violations) console.error(`  ✗ ${v.tbl}.${v.col} (looks like → ${v.guess})`);
    console.error('Fix: add a FOREIGN KEY in aisha/db/sql/tables/' + violations[0].tbl + '.sql (or aisha/db/sql/constraints/) referencing the target,');
    console.error('     then regenerate baseline: npm run db:init:generate.');
    console.error('     If the column is intentionally unconstrained (cross-schema auth.users ref, soft/polymorphic ref), add it to');
    console.error(`     ${path.relative(ROOT, ALLOWLIST_FILE)} with a reason, or re-snapshot: npm run db:schema:gaps:baseline.`);
    process.exit(1);
  }

  console.error('[fk-relationship-gaps] clean — 0 unreviewed unenforced relationships.');
  process.exit(0);
}

main();
