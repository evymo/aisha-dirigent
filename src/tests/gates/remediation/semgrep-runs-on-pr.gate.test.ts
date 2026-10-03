/**
 * SEC-02 — Semgrep SAST must actually run on push/PR (executable spec).
 *
 * CONTRACT: the Semgrep SAST job in .forgejo/workflows/ci.yml must be
 * PR-eligible. Its `if:` condition must NOT be solely gated behind
 * `workflow_dispatch` (+ run_supply_chain == 'yes'), which would mean the
 * SAST scan NEVER runs on a pull_request or push — the exact state that makes
 * a "security scanner" security theatre.
 *
 * KNOWN-RED (defect at HEAD 569c5ffd):
 *   jobs.semgrep.if =
 *     "${{ github.event_name == 'workflow_dispatch'
 *          && github.event.inputs.run_supply_chain == 'yes' }}"
 *   → the job can only be triggered by a manual Actions dispatch; it is
 *     skipped on every pull_request and push, so no PR is ever SAST-scanned.
 *
 * The pre-existing gate (src/tests/gates/semgrep-sast.gate.test.ts) only
 * asserts the *workflow trigger* contains `pull_request:` — which it does at
 * the top level — but never inspects the *job's own* `if:` condition, so it
 * stays green while the job is dead on PRs. That gate is hollow; this one
 * parses the YAML and asserts the real job condition.
 *
 * POST-FIX (green): drop the `if:` (job always runs) OR rewrite it so the job
 * is enabled on pull_request / push (e.g. include `github.event_name ==
 * 'pull_request'` in an OR branch, or gate only the *host-runner-lacking-docker*
 * skip inside a step rather than the whole job).
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const ROOT = process.cwd();
const CI_WORKFLOW = resolve(ROOT, '.forgejo/workflows/ci.yml');

/**
 * Locate the Semgrep SAST job in the parsed workflow. The finding targets the
 * SAST scanner specifically; identify it by job key `semgrep` and/or a
 * `name` mentioning "Semgrep" so a rename of the key alone can't dodge us.
 */
type CiJob = { name?: unknown; if?: unknown };
function findSemgrepJob(jobs: Record<string, CiJob>): { key: string; job: CiJob } | null {
  for (const [key, job] of Object.entries(jobs ?? {})) {
    const name = String(job?.name ?? '');
    if (key === 'semgrep' || /semgrep/i.test(key) || /\bsemgrep\b/i.test(name)) {
      return { key, job };
    }
  }
  return null;
}

/**
 * A job condition is "workflow_dispatch-only" (never runs on PR/push) when it
 * *requires* the event to be workflow_dispatch and offers no PR/push branch.
 * Heuristic on the raw `if` expression string:
 *   - mentions workflow_dispatch, AND
 *   - never mentions pull_request or push (no event branch that admits a PR).
 * That is exactly the KNOWN-RED shape and the thing the fix must remove.
 */
function isWorkflowDispatchOnly(ifExpr: string): boolean {
  const expr = ifExpr.toLowerCase();
  const gatesOnDispatch = expr.includes('workflow_dispatch');
  const admitsPrOrPush = expr.includes('pull_request') || expr.includes('push');
  return gatesOnDispatch && !admitsPrOrPush;
}

describe('SEC-02 — Semgrep SAST job runs on PR (not workflow_dispatch-only)', () => {
  const raw = readFileSync(CI_WORKFLOW, 'utf8');
  const doc = parse(raw) as { on?: unknown; jobs?: Record<string, CiJob> };

  test('ci.yml has a Semgrep SAST job', () => {
    const found = findSemgrepJob(doc.jobs ?? {});
    expect(found, 'expected a `semgrep` (Semgrep SAST) job in .forgejo/workflows/ci.yml').not.toBeNull();
  });

  test('the workflow triggers on pull_request (baseline sanity)', () => {
    // The finding is NOT about the trigger — that already includes pull_request.
    // Assert it so the RED below is unambiguously about the JOB condition.
    const on = doc.on ?? {};
    const keys = Array.isArray(on) ? on : Object.keys(on as Record<string, unknown>);
    expect(keys, 'workflow must trigger on pull_request').toContain('pull_request');
  });

  test('the Semgrep job is PR-eligible — its `if:` is not solely workflow_dispatch-gated', () => {
    const found = findSemgrepJob(doc.jobs ?? {});
    expect(found).not.toBeNull();
    const { key, job } = found!;

    const ifExpr = job?.if;

    // No `if:` at all → job always runs (including on PR). That satisfies the
    // contract.
    if (ifExpr === undefined || ifExpr === null || String(ifExpr).trim() === '') {
      expect(true).toBe(true);
      return;
    }

    const exprStr = String(ifExpr);
    expect(
      isWorkflowDispatchOnly(exprStr),
      [
        `Semgrep SAST job "${key}" is gated behind a workflow_dispatch-only condition,`,
        `so it NEVER runs on pull_request/push and no PR is ever SAST-scanned.`,
        `  if: ${exprStr}`,
        `Fix: remove the if: (always run) or add a pull_request/push branch so`,
        `the SAST scan is enforced on every PR.`,
      ].join('\n'),
    ).toBe(false);
  });
});
