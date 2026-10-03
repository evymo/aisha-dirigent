#!/usr/bin/env node
/**
 * Frontend typecheck baseline — analog of gen-service-typecheck-baseline.mjs
 * for the React/Vite frontend at repo root.
 *
 * Runs `tsc --noEmit -p tsconfig.strict.json` which enables noImplicitAny +
 * strictNullChecks on top of tsconfig.app.json. Counts errors per file +
 * writes the totals to src/tests/gates/frontend-typecheck-baseline.json.
 *
 * The companion gate frontend-typecheck-baseline.gate.test.ts enforces
 * monotone-decreasing — any PR that grows the total fails CI.
 *
 * Why a baseline gate, not enable-strict-and-fix-all: ~900 legacy strict-
 * mode violations across ~150 files. Big-bang fix would block shipping
 * for weeks. Baseline freezes the current state as maximum + lets new
 * PRs cleanup as they touch existing code.
 *
 * Counts both noImplicitAny (TS7006/7018/7031/7053) AND strictNullChecks
 * cascade (TS2322 mostly null|undefined mismatches, TS18048 possibly
 * undefined, TS2345/2339/etc). All are real type defects, not env issues.
 *
 * Excludes: TS2304 "Cannot find name" only for the Vite build-time
 * defines (__GIT_SHA__ etc) which are environmental. All other TS2304
 * (missing imports etc.) count as real errors.
 *
 * Usage:
 *   node scripts/gen-frontend-typecheck-baseline.mjs           # update
 *   node scripts/gen-frontend-typecheck-baseline.mjs --check   # diff-only
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASELINE_FILE = path.join(ROOT, 'src/tests/gates/frontend-typecheck-baseline.json');

function runTscStrict() {
  const result = spawnSync('npx', ['tsc', '--noEmit', '-p', 'tsconfig.strict.json'], {
    cwd: ROOT,
    stdio: 'pipe',
    encoding: 'utf-8',
  });
  return (result.stdout ?? '') + (result.stderr ?? '');
}

function categorize(output) {
  const stats = {
    total: 0,
    byCode: {},
    byFile: {},
  };
  for (const line of output.split('\n')) {
    const m = line.match(/^(.+?)\((\d+),(\d+)\):\s*error (TS\d+):/);
    if (!m) continue;
    const [, file, , , code] = m;
    // Skip env-only errors that resolve via npm install or build-time defines
    if (line.includes("Cannot find name '__") && line.includes("__'")) continue;
    stats.total++;
    stats.byCode[code] = (stats.byCode[code] ?? 0) + 1;
    stats.byFile[file] = (stats.byFile[file] ?? 0) + 1;
  }
  return stats;
}

async function main() {
  const flags = { check: process.argv.includes('--check') };

  process.stdout.write('[frontend-typecheck] running tsc -p tsconfig.strict.json…\n');
  const output = runTscStrict();
  const stats = categorize(output);

  const payload = {
    generated_at: new Date().toISOString(),
    total: stats.total,
    by_code: stats.byCode,
    file_count: Object.keys(stats.byFile).length,
  };

  if (flags.check) {
    if (!existsSync(BASELINE_FILE)) {
      process.stderr.write(`No baseline at ${BASELINE_FILE}\n`);
      process.exit(1);
    }
    const existing = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8'));
    if (stats.total > existing.total) {
      process.stderr.write(
        `REGRESSION: frontend strict-mode errors grew from ${existing.total} → ${stats.total}\n`,
      );
      // Show new codes / changed counts
      for (const [code, count] of Object.entries(stats.byCode).sort()) {
        const prior = existing.by_code?.[code] ?? 0;
        if (count > prior) {
          process.stderr.write(`  ${code}: ${prior} → ${count} (+${count - prior})\n`);
        }
      }
      process.exit(1);
    }
    process.stdout.write(`[frontend-typecheck] OK: ${stats.total} errors (≤ baseline ${existing.total})\n`);
    return;
  }

  writeFileSync(BASELINE_FILE, JSON.stringify(payload, null, 2) + '\n');
  process.stdout.write(
    `[frontend-typecheck] baseline written: ${stats.total} errors across ${payload.file_count} files\n`,
  );
  for (const [code, count] of Object.entries(stats.byCode).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    process.stdout.write(`  ${code}: ${count}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`[frontend-typecheck] FAILED: ${err.message}\n`);
  process.exit(1);
});
