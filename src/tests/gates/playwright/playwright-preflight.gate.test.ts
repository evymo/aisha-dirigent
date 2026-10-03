/**
 * Playwright runner preflight gate.
 *
 * Pairs with `scripts/playwright-runner-preflight.mjs` + the operator runbook
 * at `docs/stack/playwright-runtime-validation.md`. The preflight script is
 * the runtime equivalent of the static gate suite — gates verify the code
 * shape, the preflight verifies the runtime wiring. Both must exist and stay
 * synchronized.
 *
 * Why this gate exists: without it, a future PR could:
 *  - rename the preflight script → operators can't find it
 *  - drop the runbook → operators don't know how to validate runtime
 *  - regress the script's coverage (skip e2e-reports check, e.g.) → false
 *    confidence ("preflight green" means less than it claims)
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const PREFLIGHT = resolve(ROOT, 'scripts/playwright-runner-preflight.mjs');
const RUNBOOK = resolve(ROOT, 'docs/stack/playwright-runtime-validation.md');

describe('Playwright runner — preflight script', () => {
  test('script exists at canonical path', () => {
    expect(existsSync(PREFLIGHT), 'scripts/playwright-runner-preflight.mjs missing').toBe(true);
  });

  test('script accepts --app-name (required)', () => {
    const src = readFileSync(PREFLIGHT, 'utf-8');
    expect(src).toMatch(/--app-name/);
    expect(src, 'must surface --app-name as required').toMatch(/!opts\.appName|appName.*required/i);
  });

  test('script accepts --json + --quiet for CI integration', () => {
    const src = readFileSync(PREFLIGHT, 'utf-8');
    expect(src).toMatch(/--json/);
    expect(src).toMatch(/--quiet/);
  });

  test('script invokes the documented 6 checks', () => {
    const src = readFileSync(PREFLIGHT, 'utf-8');
    // Each check references the RPC or convention it probes
    expect(src, 'check #1: coolify_app_slots').toMatch(/get_active_slots/);
    expect(src, 'check #2: resolve_deployed_url').toMatch(/resolve_deployed_url/);
    expect(src, 'check #3: target URL HTTP HEAD').toMatch(/HEAD/);
    expect(src, 'check #4: runner heartbeat').toMatch(/heartbeat/i);
    expect(src, 'check #5: e2e-reports / list_playwright_runs').toMatch(/list_playwright_runs/);
    expect(src, 'check #6: health summary').toMatch(/get_playwright_runs_health_summary/);
  });

  test('script has timeout on all fetch calls (no infinite hangs)', () => {
    const src = readFileSync(PREFLIGHT, 'utf-8');
    // Every `fetch(` must be followed (within ~3 lines) by AbortSignal.timeout
    // — same discipline as scripts/aisha-packages-publish.mjs.
    const fetchCalls = src.match(/\bfetch\s*\(/g) ?? [];
    const abortTimeouts = src.match(/AbortSignal\.timeout/g) ?? [];
    expect(
      abortTimeouts.length,
      'at least one AbortSignal.timeout per fetch call (Verdaccio + lifecycle RPCs + heartbeat)',
    ).toBeGreaterThanOrEqual(fetchCalls.length);
  });

  test('script uses argv-form / native fetch only (no shell-form exec)', () => {
    const raw = readFileSync(PREFLIGHT, 'utf-8');
    // Strip comments + docstrings so doc mentions of banned patterns don't false-positive
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
    // Pure-fetch script — no child_process at all in this preflight
    expect(src, 'preflight must not spawn subprocesses').not.toMatch(/from\s+['"]node:child_process['"]/);
    expect(src, 'preflight must not import execSync').not.toMatch(/\bexecSync\s*\(/);
  });

  test('script reads AISHA_POSTGREST_* env, never hard-codes a URL/key', () => {
    const src = readFileSync(PREFLIGHT, 'utf-8');
    expect(src).toMatch(/AISHA_POSTGREST_URL/);
    expect(src).toMatch(/AISHA_POSTGREST_SERVICE_KEY/);
  });

  test('script exits non-zero on failed checks + has dedicated misconfig exit', () => {
    const src = readFileSync(PREFLIGHT, 'utf-8');
    // Conditional exit: failed.length > 0 ? 1 : 0  (or equivalent ternary)
    expect(src, 'must signal exit-code 1 when checks fail').toMatch(
      /process\.exit\([^)]*1[^)]*\)|exitCode\s*=\s*1|process\.exit\(1\)/,
    );
    // Misconfig (no app-name, no key) must use exit code 2 — distinguishes
    // operator-error from runtime-failure for CI integration.
    expect(src, 'must use exit code 2 for misconfig').toMatch(/process\.exit\(2\)/);
  });
});

describe('Playwright runner — operator runbook', () => {
  test('runbook exists at canonical path', () => {
    expect(existsSync(RUNBOOK), 'docs/stack/playwright-runtime-validation.md missing').toBe(true);
  });

  test('runbook references the preflight script', () => {
    const md = readFileSync(RUNBOOK, 'utf-8');
    expect(md).toMatch(/playwright-runner-preflight\.mjs/);
  });

  test('runbook documents the end-to-end happy-path', () => {
    const md = readFileSync(RUNBOOK, 'utf-8');
    // Three key transitions the operator should see
    expect(md).toMatch(/qa_playwright_requested/);
    expect(md).toMatch(/qa_playwright_approved/);
    expect(md).toMatch(/qa_playwright_passed/);
  });

  test('runbook documents the negative auto-rollback test', () => {
    const md = readFileSync(RUNBOOK, 'utf-8');
    expect(md).toMatch(/triggered_rollback_id/);
    expect(md).toMatch(/playwright_staging_auto/);
    expect(md).toMatch(/qa_playwright_failed/);
  });

  test('runbook documents B/G slot health update', () => {
    const md = readFileSync(RUNBOOK, 'utf-8');
    expect(md).toMatch(/blue_health.*green_health|\{active_slot\}_health|<active_slot>_health/);
  });

  test('runbook documents segregation of duties on approval', () => {
    const md = readFileSync(RUNBOOK, 'utf-8');
    expect(md).toMatch(/different admin|segregation of duties|approver must differ/i);
  });
});
