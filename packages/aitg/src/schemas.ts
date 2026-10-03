/**
 * Zod schemas for the AITG domain. Every cross-boundary value (DB ↔ service ↔
 * MCP tool) flows through these — never a hand-rolled `as unknown` cast.
 *
 * Mirrors `aisha/db/sql/tables/aitg_*.sql`. When the SQL changes, regenerate
 * Postgres types and adjust here; the package umbrella test asserts shape
 * parity by introspecting the SQL files.
 */

import { z } from 'zod';

export const aitgLayerSchema = z.enum(['app', 'mod', 'inf', 'dat']);
export type AitgLayer = z.infer<typeof aitgLayerSchema>;

export const aitgSeveritySchema = z.enum(['info', 'low', 'medium', 'high', 'critical']);
export type AitgSeverity = z.infer<typeof aitgSeveritySchema>;

export const aitgStatusSchema = z.enum([
  'passed',
  'failed',
  'flaky',
  'blocked',
  'waived',
  'not_applicable',
]);
export type AitgStatus = z.infer<typeof aitgStatusSchema>;

export const aitgTriggerSchema = z.enum(['pr-gate', 'nightly', 'manual', 'sentinel', 'self']);
export type AitgTrigger = z.infer<typeof aitgTriggerSchema>;

export const aitgTestIdSchema = z
  .string()
  .regex(/^AITG-(APP|MOD|INF|DAT)-\d{2}$/, 'AITG_INVALID_TEST_ID');
export type AitgTestId = z.infer<typeof aitgTestIdSchema>;

export const aitgRunRecordSchema = z.object({
  test_id: aitgTestIdSchema,
  build_sha: z.string().min(7),
  triggered_by: aitgTriggerSchema,
  status: aitgStatusSchema,
  severity: aitgSeveritySchema,
  evidence_uri: z.string().url().nullable(),
  ai_run_id: z.string().uuid().nullable(),
  details: z.record(z.unknown()),
});
export type AitgRunRecord = z.infer<typeof aitgRunRecordSchema>;

export const aitgCoverageRowSchema = z.object({
  layer: aitgLayerSchema,
  test_id: aitgTestIdSchema,
  total_runs: z.number().int().nonnegative(),
  passed_runs: z.number().int().nonnegative(),
  failed_runs: z.number().int().nonnegative(),
  pass_rate: z.number().min(0).max(1).nullable(),
  last_run: z.string().datetime().nullable(),
});
export type AitgCoverageRow = z.infer<typeof aitgCoverageRowSchema>;

export const aitgTrustScoreSchema = z.object({
  trust_score: z.number().min(0).max(100),
  weighted_total: z.number().nonnegative(),
  weighted_passed: z.number().nonnegative(),
  measured_tests: z.number().int().nonnegative(),
  failing_tests: z.number().int().nonnegative(),
  window_days: z.number().int().positive(),
});
export type AitgTrustScore = z.infer<typeof aitgTrustScoreSchema>;

/**
 * Output shape of aitg_list_open_findings_audited.
 *
 * Note: column is `finding_severity` (not `severity`) so the
 * RETURNS TABLE type checker matches `aitg_findings.severity`
 * (aitg_severity enum) instead of `audit_journal.severity` (text).
 * AISHA gate `sql-type-consistency` enforces this naming.
 */
export const aitgFindingSchema = z.object({
  finding_id: z.string().uuid(),
  run_id: z.string().uuid(),
  test_id: aitgTestIdSchema,
  finding_severity: aitgSeveritySchema,
  observed: z.record(z.unknown()),
  classifier_score: z.number().min(0).max(1).nullable(),
  remediation: z.string().nullable(),
  observed_at: z.string().datetime().nullable(),
});
export type AitgFinding = z.infer<typeof aitgFindingSchema>;

export const aitgPayloadSchema = z.object({
  payload_id: z.string().uuid(),
  test_id: aitgTestIdSchema,
  payload: z.record(z.unknown()),
  expected_block: z.string(),
  tags: z.array(z.string()),
  source: z.string(),
});
export type AitgPayload = z.infer<typeof aitgPayloadSchema>;
