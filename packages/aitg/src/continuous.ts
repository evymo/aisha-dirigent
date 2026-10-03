/**
 * Continuous-loop schemas + pure scheduling helpers.
 *
 * The DB stores the canonical state (aitg_runs, aitg_drift_alerts,
 * aitg_aisha_reflections, aitg_payload_proposals). This module gives
 * services and Aisha typed access to those rows AND a pure scheduler
 * that turns "what should I probe next" into a deterministic function
 * of the time-series record.
 *
 * The scheduler is intentionally pure: caller provides current state,
 * scheduler returns ordered priority list. That lets us test it with
 * synthetic inputs and reuse the same logic in n8n (via aitg_next_in_queue
 * RPC) and Aisha's MCP tool.
 */

import { z } from 'zod';
import { aitgTestIdSchema, aitgSeveritySchema } from './schemas.js';

// ── Drift alert ─────────────────────────────────────────────────────────────
export const aitgDriftAlertSchema = z.object({
  alert_id: z.string().uuid(),
  test_id: aitgTestIdSchema,
  window_label: z.string(),
  current_pass_rate: z.number().min(0).max(1),
  previous_pass_rate: z.number().min(0).max(1),
  delta: z.number(),
  severity: aitgSeveritySchema,
  acknowledged_at: z.string().datetime().nullable(),
  resolved_at: z.string().datetime().nullable(),
  details: z.record(z.unknown()),
  created_at: z.string().datetime(),
});
export type AitgDriftAlert = z.infer<typeof aitgDriftAlertSchema>;

// ── Reflection (Aisha's diary) ──────────────────────────────────────────────
export const aitgReflectionSchema = z.object({
  reflection_id: z.string().uuid(),
  reflection_date: z.string(),
  trust_score_snapshot: z.number().min(0).max(100),
  trust_score_delta: z.number().nullable(),
  total_runs_window: z.number().int().nonnegative(),
  failed_runs_window: z.number().int().nonnegative(),
  open_findings_count: z.number().int().nonnegative(),
  new_failures_count: z.number().int().nonnegative(),
  newly_fixed_count: z.number().int().nonnegative(),
  drift_alerts_count: z.number().int().nonnegative(),
  summary: z.string().min(10),
  proposed_actions: z.array(z.unknown()),
  generated_by: z.string(),
  created_at: z.string().datetime(),
});
export type AitgReflection = z.infer<typeof aitgReflectionSchema>;

// ── Health summary ──────────────────────────────────────────────────────────
export const aitgHealthSummarySchema = z.object({
  window_hours: z.number().int().positive(),
  total_runs: z.number().int().nonnegative(),
  passed_runs: z.number().int().nonnegative(),
  failed_runs: z.number().int().nonnegative(),
  trust_score: z.number().min(0).max(100).nullable(),
  open_findings: z.number().int().nonnegative(),
  open_drift_alerts: z.number().int().nonnegative(),
  last_reflection: z
    .object({
      date: z.string(),
      trust_score: z.number(),
      summary: z.string(),
    })
    .nullable(),
});
export type AitgHealthSummary = z.infer<typeof aitgHealthSummarySchema>;

// ── Queue entry ─────────────────────────────────────────────────────────────
export const aitgQueueEntrySchema = z.object({
  test_id: aitgTestIdSchema,
  priority: z.number(),
  rationale: z.string(),
  last_run: z.string().datetime().nullable(),
});
export type AitgQueueEntry = z.infer<typeof aitgQueueEntrySchema>;

// ── Payload proposal ────────────────────────────────────────────────────────
export const aitgPayloadProposalSchema = z.object({
  proposal_id: z.string().uuid(),
  test_id: aitgTestIdSchema,
  payload: z.record(z.unknown()),
  expected_block: z.string(),
  tags: z.array(z.string()),
  justification: z.string().min(20),
  proposed_by: z.string(),
  status: z.enum(['pending', 'approved', 'rejected']),
  reviewed_by: z.string().uuid().nullable(),
  reviewed_at: z.string().datetime().nullable(),
  promoted_payload_id: z.string().uuid().nullable(),
  created_at: z.string().datetime(),
});
export type AitgPayloadProposal = z.infer<typeof aitgPayloadProposalSchema>;

// ── Pure scheduler ──────────────────────────────────────────────────────────
export interface ScheduleInput {
  testId: string;
  severityWeight: number;
  lastRunAt: Date | null;
  recentFailures24h: number;
  openDriftAlerts: number;
}

export interface ScheduleResult {
  testId: string;
  priority: number;
  rationale: string;
}

/**
 * Compute next-best-test scheduling priority. Pure function so the scheduler
 * can be tested with synthetic inputs in isolation. The same formula lives
 * in the `aitg_next_in_queue_audited` SQL RPC; the JS version below is the
 * specification and the SQL one is the production caller.
 *
 *   priority = (staleness_hours / 24) * severity_weight
 *            + recent_failures * 2.0
 *            + open_drift_alerts * 3.0
 *
 * Untested tests (lastRunAt = null) get a 7-day staleness for priority
 * computation — biases the scheduler toward filling in unmeasured coverage.
 */
export function scheduleNext(input: ScheduleInput, now: Date = new Date()): ScheduleResult {
  const stalenessHours = input.lastRunAt
    ? Math.max(0, (now.getTime() - input.lastRunAt.getTime()) / 3_600_000)
    : 168; // 7 days for never-run tests
  const stalenessPart = (stalenessHours / 24) * input.severityWeight;
  const failurePart = input.recentFailures24h * 2.0;
  const driftPart = input.openDriftAlerts * 3.0;
  const priority = Math.round((stalenessPart + failurePart + driftPart) * 1000) / 1000;

  let rationale: string;
  if (input.lastRunAt === null) rationale = 'never_run';
  else if (input.recentFailures24h > 0) rationale = `recent_failures=${input.recentFailures24h}`;
  else if (input.openDriftAlerts > 0) rationale = `open_drifts=${input.openDriftAlerts}`;
  else rationale = 'staleness';

  return { testId: input.testId, priority, rationale };
}

export function rankSchedule(inputs: ScheduleInput[], now?: Date): ScheduleResult[] {
  return inputs.map((i) => scheduleNext(i, now)).sort((a, b) => b.priority - a.priority);
}
