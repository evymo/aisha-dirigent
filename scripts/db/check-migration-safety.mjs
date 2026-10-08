#!/usr/bin/env node
/**
 * check-migration-safety.mjs — the migration-safety half of the DB-quality lens
 *
 * Static sibling of check-fk-relationship-gaps.mjs (which is catalog-based). This one
 * needs NO database: it runs Squawk (https://squawkhq.com) over the delta migrations in
 * aisha/db/migrations/ and flags DDL that locks or breaks prod — CREATE INDEX without
 * CONCURRENTLY, dropping columns/tables, renames, NOT NULL adds, FK adds without NOT
 * VALID, etc. Rule selection + exclusions live in .squawk.toml (prod-safety core only).
 *
 * Identity-keyed allowlist (file::rule::line), exactly like the FK-gap gate: migrations
 * are append-only/immutable, so a NEW violation is a NEW identity = a hard fail. The
 * existing 100+ smells are snapshotted (`--baseline`) — the gate guards against NEW
 * unsafe DDL while the inventory is driven down. Runs in test:gates (it's static).
 *
 * Usage:
 *   npm run db:migrations:lint            # gate: exit 1 on a NEW violation
 *   npm run db:migrations:lint:report     # list every violation, never fail
 *   npm run db:migrations:lint:baseline   # snapshot current violations into the allowlist
 *
 * @module
 */

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { porovnej } from '../lib/razeni.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const MIGRATIONS_DIR = path.join(ROOT, 'aisha/db/migrations');
const BASELINE_SQL = '00000000000000_baseline.sql';
const ALLOWLIST_FILE = path.join(ROOT, 'src/tests/gates/migration-safety.allowlist.json');
const SQUAWK_LOCAL = path.join(ROOT, 'node_modules/.bin/squawk');
const SQUAWK_VERSION = '2.55.0';

function deltaMigrationFiles() {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && f !== BASELINE_SQL)
    .sort()
    .map((f) => path.join('aisha/db/migrations', f));
}

// Resolve squawk: the pinned devDependency binary, else npx as a fallback.
function squawkCmd() {
  if (existsSync(SQUAWK_LOCAL)) return { cmd: SQUAWK_LOCAL, pre: [] };
  return { cmd: 'npx', pre: ['--yes', `squawk-cli@${SQUAWK_VERSION}`] };
}

function runSquawk(files) {
  const { cmd, pre } = squawkCmd();
  // Squawk finds .squawk.toml by searching upward from cwd (=ROOT): pg_version,
  // assume_in_transaction, excluded_rules, excluded_paths all apply.
  //
  // CI isolation: squawk auto-detects a GitHub-Actions environment (GITHUB_ACTIONS
  // env var) and then emits `::warning::` GHA annotations to stdout, OVERRIDING
  // `--reporter=json` — which breaks the JSON parse below. Every Actions runner
  // sets GITHUB_ACTIONS=true, so the gate failed CI-only while passing locally.
  // Strip the var for this child so --reporter=json is honored.
  const env = { ...process.env };
  delete env.GITHUB_ACTIONS;
  const r = spawnSync(cmd, [...pre, '--reporter=json', ...files], { cwd: ROOT, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, env });
  if (r.error) throw new Error(`squawk not runnable (${r.error.message}). Is squawk-cli installed? npm i -D squawk-cli@${SQUAWK_VERSION}`);
  // Squawk exits non-zero when it finds violations — that's expected; parse stdout.
  const out = (r.stdout || '').trim();
  if (!out) {
    if (r.status !== 0) throw new Error(`squawk failed: ${(r.stderr || '').trim()}`);
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    throw new Error(`could not parse squawk JSON output: ${(r.stderr || out).slice(0, 400)}`);
  }
  return parsed
    // `syntax-error` = squawk's parser hit PL/pgSQL it can't fully parse; the migration
    // applies fine via migrate.mjs (the real syntax authority). Not an actionable smell.
    .filter((v) => v.rule_name !== 'syntax-error')
    .map((v) => ({
      file: v.file,
      rule: v.rule_name,
      line: v.line,
      level: v.level,
      message: v.message,
      id: `${v.file}::${v.rule_name}::${v.line}`,
    }));
}

function loadAllowlist() {
  if (!existsSync(ALLOWLIST_FILE)) return new Map();
  const json = JSON.parse(readFileSync(ALLOWLIST_FILE, 'utf-8'));
  return new Map((json.allowlist ?? []).map((e) => [`${e.file}::${e.rule}::${e.line}`, e]));
}

function main() {
  const report = process.argv.includes('--report');
  const baseline = process.argv.includes('--baseline');

  const files = deltaMigrationFiles();
  if (files.length === 0) {
    console.error('[migration-safety] no delta migrations found under aisha/db/migrations/.');
    process.exit(0);
  }

  let violations;
  try {
    violations = runSquawk(files);
  } catch (err) {
    console.error(`[migration-safety] ${err.message}`);
    process.exit(1);
  }

  if (baseline) {
    const snapshot = {
      _comment:
        'Allowlist for scripts/db/check-migration-safety.mjs (the migration-safety lens). Each entry is a ' +
        'Squawk prod-safety violation (lock/data-loss/breaking DDL) in a delta migration. Identity-keyed on ' +
        'file::rule::line: migrations are append-only, so a NEW violation is a NEW identity = a hard fail in ' +
        'test:gates. This is the snapshot of PRE-EXISTING smells — the gate guards against NEW unsafe DDL while ' +
        'the inventory is driven down. Rule selection is in .squawk.toml. Re-snapshot: npm run db:migrations:lint:baseline.',
      _generated_at: new Date().toISOString().slice(0, 10),
      _violation_count: violations.length,
      allowlist: violations
        .slice()
        .sort((a, b) => porovnej(a.id, b.id))
        .map((v) => ({ file: v.file, rule: v.rule, line: v.line, level: v.level, message: v.message })),
    };
    writeFileSync(ALLOWLIST_FILE, JSON.stringify(snapshot, null, 2) + '\n');
    console.error(`[migration-safety] baseline written: ${violations.length} violation(s) snapshotted to ${path.relative(ROOT, ALLOWLIST_FILE)}.`);
    process.exit(0);
  }

  const allow = loadAllowlist();
  const newViolations = violations.filter((v) => !allow.has(v.id));

  // Per-rule summary for context.
  const byRule = {};
  for (const v of violations) byRule[v.rule] = (byRule[v.rule] || 0) + 1;
  const ruleSummary = Object.entries(byRule).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r}=${n}`).join(', ');
  console.error(`[migration-safety] ${violations.length} prod-safety violation(s) across ${files.length} migrations (${violations.length - newViolations.length} allowlisted). ${ruleSummary}`);

  if (report) {
    for (const v of violations) {
      console.log(`  ${allow.has(v.id) ? 'ALLOWLISTED' : 'FLAGGED    '} ${v.file}:${v.line} [${v.rule}] ${v.message}`);
    }
    process.exit(0);
  }

  if (newViolations.length) {
    console.error(`[migration-safety] ${newViolations.length} NEW unsafe DDL violation(s):`);
    for (const v of newViolations) console.error(`  ✗ ${v.file}:${v.line} [${v.rule}] ${v.message}`);
    console.error('Fix the migration (e.g. CREATE INDEX CONCURRENTLY, ADD COLUMN nullable then backfill, FK ... NOT VALID then VALIDATE),');
    console.error('see https://squawkhq.com for each rule. If genuinely safe in a fresh-apply cold-start context, re-snapshot:');
    console.error('  npm run db:migrations:lint:baseline');
    process.exit(1);
  }

  console.error('[migration-safety] clean — 0 new unsafe DDL beyond the baseline.');
  process.exit(0);
}

main();
