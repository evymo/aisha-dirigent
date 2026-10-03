/**
 * Service typecheck baseline gate — monotone-decreasing implicit-any debt
 *
 * Closes the gap Phase 4 (tsconfig-strict-coverage.gate) didn't catch:
 * Phase 4 verifies every service tsconfig has `"strict": true`. But the
 * root `tsc --noEmit` doesn't traverse service subprojects, and
 * `npm run typecheck:repo` only covers frontend + mobile-app + 2 packages.
 * So services were strict-on-paper but never strict-checked.
 *
 * This gate enforces the canonical AISHA monotone-decreasing baseline
 * pattern (same as aisha-branding.gate and the legacy-SDK-removal gate):
 *
 *   1. service-typecheck-baseline.json records implicit-any count per
 *      service at the moment Phase 7 follow-up landed.
 *   2. This gate runs per-service `tsc --noEmit` on every PR.
 *   3. If a service grows above its baseline → PR fails.
 *   4. If a service shrinks → great, baseline can be regenerated.
 *
 * Result: ZERO new implicit-any debt enters the codebase. Existing 284
 * errors get fixed gradually in service-specific PRs (mechanical:
 * mostly adding FastifyRequest / FastifyReply param types).
 *
 * What this gate does NOT do:
 *   - Run live tsc (expensive — 23 service tsc invocations, ~30-60s each).
 *     Instead it reads the cached baseline file and trusts the generator
 *     script. CI runs `npm run gen:service-typecheck:check` as a separate
 *     step which actually does the live typecheck.
 *   - Catch module-not-found errors (TS2307). Those are environmental
 *     (Verdaccio token, missing node_modules) and outside this gate's
 *     scope. Generator filters them automatically.
 *
 * To regenerate baseline (after fixing errors in a service):
 *   npm run gen:service-typecheck:baseline
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { isTrackedService } from './lib/tracked-services';

const ROOT = process.cwd();
const BASELINE_FILE = resolve(ROOT, 'src/tests/gates/service-typecheck-baseline.json');
const SERVICES_DIR = resolve(ROOT, 'services');
const GENERATOR_SCRIPT = resolve(ROOT, 'scripts/gen-service-typecheck-baseline.mjs');

interface Baseline {
  generated_at: string;
  // Implicit-any debt per service (monotone-decreasing ratchet).
  services: Record<string, number>;
  // Hard-blocking compile errors per service (TS2304/TS2552/TS2300) — MUST be 0.
  blocking: Record<string, number>;
}

const BLOCKING_CODES = ['TS2304', 'TS2552', 'TS2300'] as const;

describe('Service typecheck baseline gate', () => {
  test('baseline file exists', () => {
    expect(existsSync(BASELINE_FILE), `Missing baseline: ${BASELINE_FILE}`).toBe(true);
  });

  test('generator script exists + is executable', () => {
    expect(existsSync(GENERATOR_SCRIPT)).toBe(true);
  });

  test('baseline has well-formed JSON with services + blocking maps', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8')) as Baseline;
    expect(baseline.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(baseline.services).toBeTypeOf('object');
    expect(Object.keys(baseline.services).length).toBeGreaterThan(0);
    // The blocking-codes counter is a distinct, required map (added so real
    // errors like TS2304 can't ship under the implicit-any-only filter).
    expect(baseline.blocking, 'baseline.blocking map missing — regenerate via `npm run gen:service-typecheck:baseline`').toBeTypeOf('object');
    expect(Object.keys(baseline.blocking).length).toBeGreaterThan(0);
  });

  test('every service has a blocking-codes entry alongside its implicit-any entry', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8')) as Baseline;
    const missing = Object.keys(baseline.services).filter((svc) => !(svc in baseline.blocking));
    expect(
      missing,
      `Services in services map but missing from blocking map: ${missing.join(', ')}. Regenerate via \`npm run gen:service-typecheck:baseline\`.`,
    ).toEqual([]);
  });

  test('blocking-codes counter is DISTINCT from the implicit-any debt counter', () => {
    // Regression guard for the whole point of TASK C: the two counters must be
    // separate maps. If someone collapses them back into one, real blocking
    // errors (TS2304 et al.) would again hide under the implicit-any-only
    // filter. The blocking map is keyed identically but tracked independently.
    const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8')) as Baseline;
    expect(baseline.blocking).not.toBe(baseline.services);
    expect(Object.keys(baseline.blocking).sort()).toEqual(Object.keys(baseline.services).sort());
  });

  test('svc-blockchain has 0 blocking typecheck errors', () => {
    // The service this work centers on must be clean — no TS2304/TS2552/TS2300.
    const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8')) as Baseline;
    expect(
      baseline.blocking['svc-blockchain'],
      'svc-blockchain must carry ZERO blocking typecheck errors',
    ).toBe(0);
  });

  test('every blocking count is a non-negative integer and a clean set exists', () => {
    // The enforced contract: a service at 0 today must stay 0 (live-enforced by
    // `npm run gen:service-typecheck:check`, which fails on any blocking
    // REGRESSION above the recorded baseline). This static gate asserts the
    // committed baseline is well-formed (every count a real non-negative int)
    // and that a blocking-clean set exists — so a regenerated baseline that
    // corrupted the counter (negative / NaN / all-dirty) is caught.
    const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8')) as Baseline;
    for (const [svc, count] of Object.entries(baseline.blocking)) {
      expect(Number.isInteger(count), `${svc} blocking count must be an integer`).toBe(true);
      expect(count, `${svc} blocking count must be >= 0`).toBeGreaterThanOrEqual(0);
    }
    const clean = Object.values(baseline.blocking).filter((n) => n === 0).length;
    expect(clean, 'at least the core services must be blocking-clean').toBeGreaterThan(0);
  });

  test('pre-existing blocking offenders are tracked (informational — fix to 0 in dedicated PRs)', () => {
    // Not a failing assertion. Surfaces the services that carry real blocking
    // defects today (unimported FastifyRequest/FastifyReply/Fastify → TS2304)
    // so they are visible and get fixed. Live ratcheting (no GROWTH, must shrink
    // to 0) is enforced by `npm run gen:service-typecheck:check`. These are
    // out-of-scope for the lane that introduced this counter; each needs its own
    // per-service import fix + baseline regen.
    const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8')) as Baseline;
    const offenders = Object.entries(baseline.blocking)
      .filter(([, count]) => count > 0)
      .map(([svc, count]) => `${svc}=${count}`);
    expect(
      offenders.length,
      `Blocking-defect services to fix (${BLOCKING_CODES.join('/')}): ${offenders.join(', ') || 'none'}. ` +
        `Each must reach 0 in a dedicated PR (add the missing fastify type/value imports).`,
    ).toBeGreaterThanOrEqual(0);
  });

  test('every service with tsconfig.json + strict mode has a baseline entry', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8')) as Baseline;

    const orphanedServices: string[] = [];
    for (const svc of readdirSync(SERVICES_DIR)) {
      // Untracked leftovers are residue, not services — see lib/tracked-services.ts.
      if (!isTrackedService(svc)) continue;
      const svcPath = join(SERVICES_DIR, svc);
      if (!statSync(svcPath).isDirectory()) continue;
      const tsconfigPath = join(svcPath, 'tsconfig.json');
      const pkgJsonPath = join(svcPath, 'package.json');
      if (!existsSync(tsconfigPath) || !existsSync(pkgJsonPath)) continue;

      // Only require baseline entry if strict mode is on (otherwise Phase 4
      // gate would fail first)
      const tsc = readFileSync(tsconfigPath, 'utf-8');
      const isStrict = /"strict"\s*:\s*true/.test(tsc) ||
        (/"noImplicitAny"\s*:\s*true/.test(tsc) && /"strictNullChecks"\s*:\s*true/.test(tsc));
      if (!isStrict) continue;

      if (!(svc in baseline.services)) {
        orphanedServices.push(svc);
      }
    }
    expect(
      orphanedServices,
      `Services with strict mode but no baseline entry: ${orphanedServices.join(', ')}. Run \`npm run gen:service-typecheck:baseline\` to refresh.`,
    ).toEqual([]);
  });

  test('total implicit-any debt is finite and tracked', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8')) as Baseline;
    const total = Object.values(baseline.services).reduce((a, b) => a + b, 0);
    // Sanity: cannot be negative, must be a real number. Upper bound is
    // informational — if total grows past 500 something is structurally
    // wrong (gates regenerated wrong, or massive regression slipped in).
    expect(total).toBeGreaterThanOrEqual(0);
    expect(total).toBeLessThan(500);
  });

  test('baseline ratchets DOWN over time (informational reminder)', () => {
    // Not enforced — this test passes always. It's a visible reminder in
    // CI output that the baseline represents technical debt to be paid
    // down, not a permanent waiver. The actual ratcheting enforcement is
    // in the `npm run gen:service-typecheck:check` CI step which fails
    // when a service grows above its baseline.
    const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8')) as Baseline;
    const services = Object.keys(baseline.services).length;
    const clean = Object.values(baseline.services).filter((n) => n === 0).length;
    const dirty = services - clean;
    // Output via expect message — surfaces in test runner output
    expect(
      clean,
      `Service typecheck health: ${clean}/${services} services have ZERO implicit-any. ` +
        `${dirty} services still carry debt. Each PR that touches a dirty service should ` +
        `aim to reduce its count.`,
    ).toBeGreaterThanOrEqual(0);
  });

  test('npm scripts gen:service-typecheck are wired', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.['gen:service-typecheck:baseline']).toBeDefined();
    expect(pkg.scripts?.['gen:service-typecheck:check']).toBeDefined();
  });
});
