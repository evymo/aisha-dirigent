/**
 * Automation-settings schema + decision-function tests.
 *
 * The pure helpers (shouldRunNow, describeSchedule) are the production
 * decision points workflows call at their trigger step. They must:
 *   - block disabled automations unconditionally
 *   - require a triggerId in manual mode
 *   - allow automated runs without trigger
 *   - describe schedules in operator-friendly strings
 */

import { describe, test, expect } from 'vitest';
import {
  aitgAutomationSettingSchema,
  aitgAutomationUpdatePatchSchema,
  aitgAutomationModeSchema,
  shouldRunNow,
  describeSchedule,
  AITG_AUTOMATION_IDS,
  type AitgAutomationSetting,
} from '../automation.js';

const BASE: AitgAutomationSetting = {
  automation_id: 'continuous_heartbeat',
  display_name: 'Continuous probe heartbeat',
  description: 'every N minutes',
  mode: 'automated',
  schedule_cron: null,
  schedule_interval_minutes: 15,
  parameters: { queue_limit: 1 },
  workflow_id: 'WF_AITG_CONTINUOUS',
  last_run_at: null,
  last_run_status: null,
  last_run_details: {},
  updated_at: '2026-05-16T15:00:00Z',
  updated_by: null,
  created_at: '2026-05-16T15:00:00Z',
};

describe('aitgAutomationSettingSchema', () => {
  test('positive: canonical row parses', () => {
    expect(aitgAutomationSettingSchema.parse(BASE).automation_id).toBe('continuous_heartbeat');
  });

  test('negative: invalid automation_id rejected', () => {
    expect(
      aitgAutomationSettingSchema.safeParse({ ...BASE, automation_id: 'Bad-Name' }).success,
    ).toBe(false);
  });

  test('negative: interval > 1440 rejected', () => {
    expect(
      aitgAutomationSettingSchema.safeParse({ ...BASE, schedule_interval_minutes: 9999 }).success,
    ).toBe(false);
  });

  test('positive: event-driven automation has both schedule fields null', () => {
    expect(
      aitgAutomationSettingSchema.parse({
        ...BASE,
        schedule_cron: null,
        schedule_interval_minutes: null,
      }).automation_id,
    ).toBe('continuous_heartbeat');
  });
});

describe('aitgAutomationUpdatePatchSchema', () => {
  test('positive: partial patch accepted', () => {
    expect(aitgAutomationUpdatePatchSchema.parse({ mode: 'manual' }).mode).toBe('manual');
  });

  test('positive: empty patch accepted (no-op)', () => {
    expect(aitgAutomationUpdatePatchSchema.parse({})).toEqual({});
  });

  test('negative: bogus mode rejected', () => {
    expect(aitgAutomationUpdatePatchSchema.safeParse({ mode: 'paused' }).success).toBe(false);
  });

  test('positive: setting schedule_interval to null is allowed (clearing it)', () => {
    expect(
      aitgAutomationUpdatePatchSchema.parse({ schedule_interval_minutes: null }).schedule_interval_minutes,
    ).toBeNull();
  });
});

describe('shouldRunNow', () => {
  test('automated mode → proceed without trigger', () => {
    const d = shouldRunNow(BASE);
    expect(d.proceed).toBe(true);
    expect(d.reason).toBe('ok');
  });

  test('disabled mode → never proceed even with trigger', () => {
    const d = shouldRunNow({ ...BASE, mode: 'disabled' }, 'trigger-uuid');
    expect(d.proceed).toBe(false);
    expect(d.reason).toBe('automation_disabled');
  });

  test('manual mode without trigger → skipped', () => {
    const d = shouldRunNow({ ...BASE, mode: 'manual' });
    expect(d.proceed).toBe(false);
    expect(d.reason).toBe('manual_mode_no_trigger');
  });

  test('manual mode with trigger → proceed', () => {
    const d = shouldRunNow({ ...BASE, mode: 'manual' }, 'trigger-uuid');
    expect(d.proceed).toBe(true);
    expect(d.reason).toBe('ok');
  });
});

describe('describeSchedule', () => {
  test('describes interval in human terms (15 min)', () => {
    expect(describeSchedule(BASE)).toBe('every 15 min');
  });

  test('rounds whole-hour intervals (60 min → 1h)', () => {
    expect(describeSchedule({ ...BASE, schedule_interval_minutes: 60 })).toBe('every 1h');
    expect(describeSchedule({ ...BASE, schedule_interval_minutes: 180 })).toBe('every 3h');
  });

  test('uses cron string when set', () => {
    expect(
      describeSchedule({ ...BASE, schedule_cron: '0 6 * * *', schedule_interval_minutes: null }),
    ).toBe('cron: 0 6 * * *');
  });

  test('event-driven (no cron, no interval) is labelled accordingly', () => {
    expect(describeSchedule({ ...BASE, schedule_interval_minutes: null })).toBe('event-driven');
  });

  test('disabled labelled', () => {
    expect(describeSchedule({ ...BASE, mode: 'disabled' })).toBe('disabled');
  });

  test('manual labelled', () => {
    expect(describeSchedule({ ...BASE, mode: 'manual' })).toBe('manual-only');
  });
});

describe('AITG_AUTOMATION_IDS', () => {
  test('contains all 8 canonical automations', () => {
    expect(AITG_AUTOMATION_IDS).toHaveLength(8);
    expect(AITG_AUTOMATION_IDS).toContain('continuous_heartbeat');
    expect(AITG_AUTOMATION_IDS).toContain('daily_reflection');
    expect(AITG_AUTOMATION_IDS).toContain('nightly_full_sweep');
    expect(AITG_AUTOMATION_IDS).toContain('drift_detection');
    expect(AITG_AUTOMATION_IDS).toContain('auto_close_findings');
    expect(AITG_AUTOMATION_IDS).toContain('runtime_sentinel');
    expect(AITG_AUTOMATION_IDS).toContain('pr_gate');
    expect(AITG_AUTOMATION_IDS).toContain('callsite_guard_default');
  });
});

describe('aitgAutomationModeSchema', () => {
  test('exactly 3 modes', () => {
    expect(aitgAutomationModeSchema.options).toEqual(['automated', 'manual', 'disabled']);
  });
});
