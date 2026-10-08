/**
 * Gate test: heavy supply-chain lane — adoption + stagger contract.
 *
 * WHY (2026-07-25). A shared runner served 14 repositories across two orgs at
 * capacity 2, and every repository that adopts this platform inherits
 * `.github/workflows/supply-chain.yml` verbatim,
 * so ONE unconditional nightly cron meant N repositories firing the same ~60-job
 * matrix into 2 slots in the same minute. Measured in the runner log, not
 * assumed: a sibling repo started at 01:17:40 UTC — on our cron.
 *
 * The fix has two halves, and this gate pins the failure mode of each:
 *   1. STAGGER — one cron per declared slot, one slot per repository. If the
 *      cron list and HEAVY_LANE_SLOTS drift apart, a repository hashed to an
 *      undeclared slot never runs and nothing says so. Silent, and invisible
 *      precisely because "no run" looks identical to "nothing to do".
 *   2. ADOPTION — running the matrix unattended is a per-repository parameter
 *      (`vars.HEAVY_LANE_NIGHTLY`), never a name written into this file. A job
 *      added later that forgets the gate silently re-introduces the herd, so the
 *      assertion is a property of ALL entry jobs, not a list of today's four.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const WORKFLOW = resolve(process.cwd(), '.github/workflows/supply-chain.yml');
const GATE_JOB = 'lane-gate';

const raw = readFileSync(WORKFLOW, 'utf8');
const wf = parse(raw) as {
  on: { schedule: Array<{ cron: string }>; workflow_dispatch?: unknown };
  env: Record<string, string>;
  jobs: Record<string, { needs?: string | string[]; if?: string; outputs?: Record<string, string>; steps?: Array<{ env?: Record<string, string>; run?: string }> }>;
};

/** Hours declared in HEAVY_LANE_SLOTS, in order. */
function declaredSlots(): string[] {
  return String(wf.env.HEAVY_LANE_SLOTS ?? '').trim().split(/\s+/).filter(Boolean);
}

/** The hour field of each cron entry (minute hour dom mon dow). */
function cronHours(): string[] {
  return wf.on.schedule.map((s) => String(s.cron).trim().split(/\s+/)[1]);
}

function needsOf(job: { needs?: string | string[] }): string[] {
  return ([] as string[]).concat(job.needs ?? []);
}

describe('heavy supply-chain lane — stagger slots', () => {
  test('declares exactly one cron per slot', () => {
    // Fewer crons than slots strands every repo hashed to the missing hours.
    // More crons than slots wakes the gate for an hour no repo can ever own.
    expect(cronHours()).toHaveLength(declaredSlots().length);
  });

  test('cron hours and HEAVY_LANE_SLOTS are the same set', () => {
    expect([...cronHours()].sort()).toEqual([...declaredSlots()].sort());
  });

  test('slots stay off-peak (00:00–05:59 UTC)', () => {
    // The whole point is to miss the working day on the shared runner.
    for (const hour of declaredSlots()) {
      expect(Number(hour)).toBeGreaterThanOrEqual(0);
      expect(Number(hour)).toBeLessThanOrEqual(5);
    }
  });
});

describe('heavy supply-chain lane — every entry job is gated', () => {
  test('the gate job publishes a `run` output', () => {
    expect(wf.jobs[GATE_JOB]?.outputs?.run).toBeTruthy();
  });

  test('no job starts without going through the gate', () => {
    // An "entry job" is one the scheduler starts directly — it chains off
    // nothing. Every such job must depend on the gate, or it runs
    // unconditionally in every repository that inherited this file.
    // Asserted as a PROPERTY so a heavy job added next year is covered too.
    const ungated = Object.entries(wf.jobs)
      .filter(([name]) => name !== GATE_JOB)
      .filter(([, job]) => needsOf(job).length === 0)
      .map(([name]) => name);
    expect(ungated).toEqual([]);
  });

  test('gated jobs read the gate verdict, not merely wait for it', () => {
    // `needs: [lane-gate]` alone would run the job whenever the gate SUCCEEDS —
    // and the gate succeeds on stand-down too (a stand-down is a decision, not
    // a failure). The `if:` is what actually enforces the verdict.
    const dependents = Object.entries(wf.jobs).filter(([name, job]) =>
      name !== GATE_JOB && needsOf(job).includes(GATE_JOB),
    );
    expect(dependents.length).toBeGreaterThan(0);
    for (const [name, job] of dependents) {
      expect(`${name}: ${job.if ?? '<no if:>'}`).toContain(`needs.${GATE_JOB}.outputs.run == 'true'`);
    }
  });
});

describe('heavy supply-chain lane — stays a generic template', () => {
  const gateStep = () => wf.jobs[GATE_JOB].steps?.[0] ?? {};

  test('the decision is a repository variable', () => {
    expect(JSON.stringify(gateStep().env ?? {})).toContain('vars.HEAVY_LANE_NIGHTLY');
  });

  test('the decision does not branch on repository identity', () => {
    // No instance may be named in a file every instance inherits: a hardcoded
    // owner would hand one repo a default the others cannot see or change.
    expect(gateStep().run ?? '').not.toMatch(/\$\{?REPO\}?"?\s*=\s*"/);
    expect(Object.keys(wf.env)).not.toContain('HEAVY_LANE_OWNER');
  });

  test('manual dispatch is available everywhere as the escape hatch', () => {
    // Stand-down must never mean "unreachable" — any repo can run the lane now.
    expect(wf.on).toHaveProperty('workflow_dispatch');
    expect(gateStep().run ?? '').toContain('workflow_dispatch');
  });
});
