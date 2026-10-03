/**
 * Automation-settings schemas + helpers.
 *
 * Settings live in `aitg_automation_settings` (one row per workflow / loop
 * knob). The operator changes mode / cron / interval / parameters through
 * Appsmith → audited RPCs; workflows and Aisha read the same rows.
 *
 * Three canonical modes:
 *   - 'automated'  → workflow honours its schedule
 *   - 'manual'     → workflow only runs when triggered by operator / Aisha
 *   - 'disabled'   → workflow short-circuits, no execution
 *
 * `shouldRunNow()` is the pure decision function workflows call at their
 * trigger step — handed the setting row and a "trigger_id" (present when
 * the call came from the manual-trigger button), it returns whether to
 * proceed.
 */

import { z } from 'zod';

export const aitgAutomationModeSchema = z.enum(['automated', 'manual', 'disabled']);
export type AitgAutomationMode = z.infer<typeof aitgAutomationModeSchema>;

export const aitgAutomationStatusSchema = z.enum(['success', 'failed', 'skipped', 'running']);
export type AitgAutomationStatus = z.infer<typeof aitgAutomationStatusSchema>;

export const aitgAutomationIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]+$/, 'AITG_INVALID_AUTOMATION_ID');

export const aitgAutomationSettingSchema = z.object({
  automation_id: aitgAutomationIdSchema,
  display_name: z.string().min(1),
  description: z.string().min(1),
  mode: aitgAutomationModeSchema,
  schedule_cron: z.string().nullable(),
  schedule_interval_minutes: z.number().int().min(1).max(1440).nullable(),
  parameters: z.record(z.unknown()),
  workflow_id: z.string().nullable(),
  last_run_at: z.string().datetime().nullable(),
  last_run_status: aitgAutomationStatusSchema.nullable(),
  last_run_details: z.record(z.unknown()),
  updated_at: z.string().datetime(),
  updated_by: z.string().uuid().nullable(),
  created_at: z.string().datetime(),
});
export type AitgAutomationSetting = z.infer<typeof aitgAutomationSettingSchema>;

export const aitgAutomationUpdatePatchSchema = z.object({
  mode: aitgAutomationModeSchema.optional(),
  schedule_cron: z.string().nullable().optional(),
  schedule_interval_minutes: z.number().int().min(1).max(1440).nullable().optional(),
  parameters: z.record(z.unknown()).optional(),
});
export type AitgAutomationUpdatePatch = z.infer<typeof aitgAutomationUpdatePatchSchema>;

/** Canonical automation ids — keep in sync with the SQL seed. */
export const AITG_AUTOMATION_IDS = [
  'continuous_heartbeat',
  'daily_reflection',
  'nightly_full_sweep',
  'drift_detection',
  'auto_close_findings',
  'runtime_sentinel',
  'pr_gate',
  'callsite_guard_default',
] as const;
export type AitgAutomationId = (typeof AITG_AUTOMATION_IDS)[number];

export interface ShouldRunDecision {
  proceed: boolean;
  reason: string;
}

/**
 * Decide whether a workflow should execute now, given its setting row and
 * an optional trigger token (only present when the call is from the manual
 * "trigger" button — surfaces as last_run_details.trigger_id).
 *
 * Rules:
 *   - mode = 'disabled' → never proceed
 *   - mode = 'manual'   → proceed ONLY when triggerId is provided
 *   - mode = 'automated' → proceed (schedule already filtered by n8n trigger)
 */
export function shouldRunNow(
  setting: AitgAutomationSetting,
  triggerId?: string | null,
): ShouldRunDecision {
  if (setting.mode === 'disabled') {
    return { proceed: false, reason: 'automation_disabled' };
  }
  if (setting.mode === 'manual' && !triggerId) {
    return { proceed: false, reason: 'manual_mode_no_trigger' };
  }
  return { proceed: true, reason: 'ok' };
}

/**
 * Pretty-print the effective schedule of an automation for dashboards /
 * audit summaries. Returns null when the row has no schedule (event-driven).
 */
export function describeSchedule(setting: AitgAutomationSetting): string | null {
  if (setting.mode === 'disabled') return 'disabled';
  if (setting.mode === 'manual') return 'manual-only';
  if (setting.schedule_cron) return `cron: ${setting.schedule_cron}`;
  if (setting.schedule_interval_minutes) {
    const m = setting.schedule_interval_minutes;
    if (m % 60 === 0) return `every ${m / 60}h`;
    return `every ${m} min`;
  }
  return 'event-driven';
}
