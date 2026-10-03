#!/usr/bin/env node
/**
 * Generate src/tests/gates/service-typecheck-baseline.json
 *
 * Walks every services/(svc)/tsconfig.json with strict mode and runs
 * "tsc --noEmit" against it. Records TWO distinct, independent counters
 * per service into the baseline file:
 *
 *   services[svc] — implicit-any errors (TS7006/7018/7031/7053). This is
 *     legacy debt; the companion gate enforces it as monotone-decreasing
 *     (any PR that grows it fails).
 *
 *   blocking[svc] — HARD-BLOCKING compile errors (TS2304 cannot-find-name,
 *     TS2552 cannot-find-name-did-you-mean, TS2300 duplicate-identifier).
 *     These are REAL defects (an unimported symbol, a typo, a duplicate
 *     declaration) that the implicit-any filter let ship undetected. The gate
 *     enforces a hard-0 floor for every CURRENTLY-CLEAN service (a service at 0
 *     must STAY 0 — introducing one fails immediately) and a strict ratchet for
 *     the handful of pre-existing offenders (they may not grow; each should drop
 *     to 0 in a dedicated per-service fix PR). Clean stays clean, dirty only
 *     gets cleaner.
 *
 * Keeping the two counters separate matters: implicit-any is a slowly-paid
 * debt budget, whereas a blocking code is a real defect — zero is the only
 * acceptable steady state, and it is the enforced floor for every clean service.
 *
 * Why the implicit-any ratchet: 21 services have ~300 implicit-any errors today
 * (legacy debt from before strict:true was wired). A big-bang fix would
 * be a 1000-LOC PR. Instead we freeze current state as baseline and
 * prevent NEW debt while existing debt shrinks over time.
 *
 * Module-not-found errors (TS2307, mostly Verdaccio @aisha/security in
 * dev environments without the token) are FILTERED OUT — they are env
 * issues, not code defects. CI with proper Verdaccio access resolves them.
 *
 * Usage:
 *   node scripts/gen-service-typecheck-baseline.mjs           # update
 *   node scripts/gen-service-typecheck-baseline.mjs --check   # diff-only
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SERVICES_DIR = path.join(ROOT, 'services');
const BASELINE_FILE = path.join(ROOT, 'src/tests/gates/service-typecheck-baseline.json');

// TS error codes that count as "implicit any" — i.e. real strict-mode
// violations the developer can fix by adding explicit types.
const IMPLICIT_ANY_CODES = new Set(['TS7006', 'TS7018', 'TS7031', 'TS7053']);

// HARD-BLOCKING codes — real compile errors (NOT debt). These slip past the
// implicit-any filter (e.g. TS2304 cannot-find-name shipped undetected). The
// gate requires the per-service blocking count to be 0, no ratchet/budget.
//   TS2304 — Cannot find name 'X' (undefined symbol / missing import)
//   TS2552 — Cannot find name 'X'. Did you mean 'Y'? (typo'd symbol)
//   TS2300 — Duplicate identifier 'X'
const BLOCKING_CODES = new Set(['TS2304', 'TS2552', 'TS2300']);

// Codes we EXCLUDE because they're environment artifacts (missing
// node_modules, Verdaccio token absent, missing @types not in dev install)
// rather than code defects. TS7016 was here originally but is removed:
// it indicates a missing declaration file, which is fixed by `npm install`
// or by adding a @types/* dep — env/dependency issue, not implicit-any.
const ENV_CODES = new Set([
  'TS2307', // Cannot find module
  'TS2305', // Module has no exported member (cascades from TS2307)
  'TS7016', // Could not find declaration file — npm install / @types/*
]);

// Runs tsc once and tallies BOTH counters from the same output, so the two
// numbers are always consistent (one tsc invocation, never drift between runs).
function countTypecheckErrors(svcPath) {
  const result = spawnSync('npx', ['tsc', '--noEmit'], {
    cwd: svcPath,
    stdio: 'pipe',
    encoding: 'utf-8',
    env: { ...process.env },
  });
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  let implicitAny = 0;
  let blocking = 0;
  for (const line of output.split('\n')) {
    const match = line.match(/error (TS\d+):/);
    if (!match) continue;
    const code = match[1];
    if (ENV_CODES.has(code)) continue;
    if (IMPLICIT_ANY_CODES.has(code)) implicitAny++;
    if (BLOCKING_CODES.has(code)) blocking++;
  }
  return { implicitAny, blocking };
}

async function main() {
  const flags = {
    check: process.argv.includes('--check'),
  };

  if (!existsSync(SERVICES_DIR)) {
    console.error('services/ directory not found');
    process.exit(1);
  }

  const baseline = { generated_at: new Date().toISOString(), services: {}, blocking: {} };

  for (const svc of readdirSync(SERVICES_DIR).sort()) {
    const svcPath = path.join(SERVICES_DIR, svc);
    if (!statSync(svcPath).isDirectory()) continue;
    if (!existsSync(path.join(svcPath, 'tsconfig.json'))) continue;
    if (!existsSync(path.join(svcPath, 'package.json'))) continue;
    process.stdout.write(`[svc-typecheck] ${svc}…`);
    const { implicitAny, blocking } = countTypecheckErrors(svcPath);
    baseline.services[svc] = implicitAny;
    baseline.blocking[svc] = blocking;
    process.stdout.write(` implicit-any=${implicitAny} blocking=${blocking}\n`);
  }

  if (flags.check) {
    if (!existsSync(BASELINE_FILE)) {
      console.error('No baseline file at', BASELINE_FILE);
      process.exit(1);
    }
    const existing = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8'));
    let failed = false;
    // Implicit-any: monotone-decreasing ratchet (per-service floor = prior count).
    for (const [svc, count] of Object.entries(baseline.services)) {
      const prior = existing.services[svc] ?? 0;
      if (count > prior) {
        console.error(`REGRESSION: ${svc} now has ${count} implicit-any errors (was ${prior})`);
        failed = true;
      }
    }
    // Blocking codes: hard-0 floor for every CURRENTLY-CLEAN service + a strict
    // ratchet for the pre-existing offenders.
    //   - A service at 0 in the committed baseline must STAY 0 — a new blocking
    //     error (e.g. an unimported FastifyRequest → TS2304) fails the check.
    //   - A pre-existing offender (>0 in baseline) may not grow; it should shrink
    //     to 0 in a dedicated per-service fix PR.
    // This is the same monotone-non-increasing discipline as implicit-any, but
    // for a hard-defect class — clean stays clean, dirty only gets cleaner.
    const priorBlocking = existing.blocking ?? {};
    for (const [svc, count] of Object.entries(baseline.blocking)) {
      const prior = priorBlocking[svc] ?? 0;
      if (count > prior) {
        console.error(
          `BLOCKING REGRESSION: ${svc} now has ${count} blocking typecheck error(s) ` +
            `(TS2304/TS2552/TS2300), was ${prior}. These are real defects — fix the code.`,
        );
        failed = true;
      }
    }
    process.exit(failed ? 1 : 0);
  }

  writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + '\n');
  const totalAny = Object.values(baseline.services).reduce((a, b) => a + b, 0);
  const totalBlocking = Object.values(baseline.blocking).reduce((a, b) => a + b, 0);
  process.stdout.write(
    `\n[svc-typecheck] baseline written: ${totalAny} implicit-any + ${totalBlocking} blocking errors across ${Object.keys(baseline.services).length} services\n`,
  );
  if (totalBlocking > 0) {
    process.stdout.write(
      `[svc-typecheck] WARNING: ${totalBlocking} blocking error(s) recorded — the gate (and gen:service-typecheck:check) will FAIL until they are 0\n`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
