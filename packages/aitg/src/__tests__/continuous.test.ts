/**
 * Continuous-loop schemas + scheduler tests.
 *
 * The scheduler is a pure function, so we feed it synthetic inputs and
 * assert ordering / rationale. The schemas mirror the new DB tables; we
 * verify they accept canonical shapes AND reject obvious drift.
 */

import { describe, test, expect } from 'vitest';
import {
  aitgDriftAlertSchema,
  aitgReflectionSchema,
  aitgHealthSummarySchema,
  aitgQueueEntrySchema,
  aitgPayloadProposalSchema,
  scheduleNext,
  rankSchedule,
} from '../continuous.js';

const FIXED_NOW = new Date('2026-05-16T15:00:00Z');

describe('scheduleNext — staleness × severity', () => {
  test('never-run test gets the 7-day staleness baseline', () => {
    const r = scheduleNext(
      { testId: 'AITG-APP-01', severityWeight: 1.5, lastRunAt: null, recentFailures24h: 0, openDriftAlerts: 0 },
      FIXED_NOW,
    );
    // 168 h staleness × 1.5 / 24 = 10.5
    expect(r.priority).toBeCloseTo(10.5, 3);
    expect(r.rationale).toBe('never_run');
  });

  test('recent failures dominate staleness', () => {
    const r = scheduleNext(
      {
        testId: 'AITG-APP-01',
        severityWeight: 1.0,
        lastRunAt: new Date(FIXED_NOW.getTime() - 60 * 60 * 1000),
        recentFailures24h: 3,
        openDriftAlerts: 0,
      },
      FIXED_NOW,
    );
    // staleness 1h × 1 / 24 ≈ 0.042; failure 3 × 2 = 6
    expect(r.priority).toBeGreaterThan(6);
    expect(r.rationale).toBe('recent_failures=3');
  });

  test('open drift alerts get the highest weight per unit', () => {
    const a = scheduleNext(
      {
        testId: 'AITG-APP-01',
        severityWeight: 1.0,
        lastRunAt: new Date(FIXED_NOW.getTime() - 60 * 60 * 1000),
        recentFailures24h: 0,
        openDriftAlerts: 1,
      },
      FIXED_NOW,
    );
    const b = scheduleNext(
      {
        testId: 'AITG-APP-01',
        severityWeight: 1.0,
        lastRunAt: new Date(FIXED_NOW.getTime() - 60 * 60 * 1000),
        recentFailures24h: 1,
        openDriftAlerts: 0,
      },
      FIXED_NOW,
    );
    expect(a.priority).toBeGreaterThan(b.priority);
    expect(a.rationale).toBe('open_drifts=1');
  });

  test('zero everything still produces a finite priority', () => {
    const r = scheduleNext(
      {
        testId: 'AITG-APP-01',
        severityWeight: 1.0,
        lastRunAt: FIXED_NOW,
        recentFailures24h: 0,
        openDriftAlerts: 0,
      },
      FIXED_NOW,
    );
    expect(r.priority).toBe(0);
    expect(r.rationale).toBe('staleness');
  });
});

describe('rankSchedule — ordering', () => {
  test('orders by priority descending, highest first', () => {
    const inputs = [
      { testId: 'AITG-APP-01', severityWeight: 1, lastRunAt: FIXED_NOW, recentFailures24h: 0, openDriftAlerts: 0 },
      { testId: 'AITG-APP-03', severityWeight: 2, lastRunAt: null, recentFailures24h: 0, openDriftAlerts: 0 },
      { testId: 'AITG-APP-12', severityWeight: 1.5, lastRunAt: FIXED_NOW, recentFailures24h: 5, openDriftAlerts: 0 },
    ];
    const ranked = rankSchedule(inputs, FIXED_NOW);
    // Priorities:
    //   APP-03: never_run → 168h × 2 / 24 = 14
    //   APP-12: lastRun=now × 1.5 / 24 = 0 + 5*2 = 10
    //   APP-01: lastRun=now × 1 / 24 = 0 + 0 = 0
    expect(ranked[0].testId).toBe('AITG-APP-03');
    expect(ranked[1].testId).toBe('AITG-APP-12');
    expect(ranked[2].testId).toBe('AITG-APP-01');
  });
});

describe('aitgDriftAlertSchema', () => {
  const valid = {
    alert_id: '00000000-0000-0000-0000-000000000001',
    test_id: 'AITG-APP-01',
    window_label: '24h',
    current_pass_rate: 0.7,
    previous_pass_rate: 0.95,
    delta: -0.25,
    severity: 'high' as const,
    acknowledged_at: null,
    resolved_at: null,
    details: {},
    created_at: '2026-05-16T15:00:00Z',
  };

  test('positive: canonical row parses', () => {
    expect(aitgDriftAlertSchema.parse(valid).delta).toBe(-0.25);
  });

  test('negative: pass_rate > 1 rejected', () => {
    expect(aitgDriftAlertSchema.safeParse({ ...valid, current_pass_rate: 1.5 }).success).toBe(false);
  });
});

describe('aitgReflectionSchema', () => {
  const valid = {
    reflection_id: '00000000-0000-0000-0000-000000000001',
    reflection_date: '2026-05-16',
    trust_score_snapshot: 84.2,
    trust_score_delta: -3.4,
    total_runs_window: 124,
    failed_runs_window: 7,
    open_findings_count: 4,
    new_failures_count: 2,
    newly_fixed_count: 1,
    drift_alerts_count: 1,
    summary: 'Trust dropped 3pts on APP-01 — investigating system prompt churn from PR #4128.',
    proposed_actions: [{ action: 'retest', target: 'AITG-APP-01' }],
    generated_by: 'aisha',
    created_at: '2026-05-16T15:00:00Z',
  };

  test('positive: canonical entry parses', () => {
    expect(aitgReflectionSchema.parse(valid).trust_score_snapshot).toBe(84.2);
  });

  test('negative: short summary rejected', () => {
    expect(aitgReflectionSchema.safeParse({ ...valid, summary: 'short' }).success).toBe(false);
  });

  test('negative: trust > 100 rejected', () => {
    expect(aitgReflectionSchema.safeParse({ ...valid, trust_score_snapshot: 101 }).success).toBe(false);
  });
});

describe('aitgHealthSummarySchema', () => {
  test('positive: full summary parses', () => {
    expect(
      aitgHealthSummarySchema.parse({
        window_hours: 24,
        total_runs: 100,
        passed_runs: 95,
        failed_runs: 5,
        trust_score: 92.5,
        open_findings: 3,
        open_drift_alerts: 1,
        last_reflection: {
          date: '2026-05-15',
          trust_score: 88.0,
          summary: 'Previous day baseline.',
        },
      }).trust_score,
    ).toBe(92.5);
  });

  test('positive: empty (no runs) state parses', () => {
    expect(
      aitgHealthSummarySchema.parse({
        window_hours: 24,
        total_runs: 0,
        passed_runs: 0,
        failed_runs: 0,
        trust_score: null,
        open_findings: 0,
        open_drift_alerts: 0,
        last_reflection: null,
      }).trust_score,
    ).toBeNull();
  });
});

describe('aitgQueueEntrySchema', () => {
  test('positive: queue row parses', () => {
    expect(
      aitgQueueEntrySchema.parse({
        test_id: 'AITG-APP-01',
        priority: 12.5,
        rationale: 'recent_failures=3',
        last_run: '2026-05-16T14:00:00Z',
      }).rationale,
    ).toBe('recent_failures=3');
  });

  test('positive: null last_run (never run) accepted', () => {
    expect(
      aitgQueueEntrySchema.parse({
        test_id: 'AITG-DAT-04',
        priority: 21.0,
        rationale: 'never_run',
        last_run: null,
      }).last_run,
    ).toBeNull();
  });
});

describe('aitgPayloadProposalSchema', () => {
  const valid = {
    proposal_id: '00000000-0000-0000-0000-000000000001',
    test_id: 'AITG-APP-01',
    payload: { prompt: 'novel jailbreak' },
    expected_block: 'refusal',
    tags: ['novel'],
    justification: 'Encountered this payload in a captured chat trace; not in corpus.',
    proposed_by: 'aisha',
    status: 'pending' as const,
    reviewed_by: null,
    reviewed_at: null,
    promoted_payload_id: null,
    created_at: '2026-05-16T15:00:00Z',
  };

  test('positive: pending proposal parses', () => {
    expect(aitgPayloadProposalSchema.parse(valid).status).toBe('pending');
  });

  test('negative: short justification rejected', () => {
    expect(aitgPayloadProposalSchema.safeParse({ ...valid, justification: 'short' }).success).toBe(false);
  });
});
