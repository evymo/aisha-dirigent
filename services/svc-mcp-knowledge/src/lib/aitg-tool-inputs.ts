/**
 * Vstupní schémata nástrojů AITG — JEDINÝ zdroj jejich rozhraní (zod v4). Validuje je dispatch
 * (aitg-tools.ts) a tools/list z nich přes z.toJSONSchema staví inputSchema (routes/mcp.ts).
 * Modul je bez vedlejších efektů, aby ho šlo importovat i tam, kde se dispatch mockuje.
 *
 * @module
 */
import { z } from 'zod/v4';
import { AITG_TEST_ID_PATTERN, aitgTriggerSchema } from '@aisha/aitg';

// ── input schemas ───────────────────────────────────────────────────────────
// JEDINÝ zdroj rozhraní nástrojů AITG: validují vstup (.parse níže) a přes z.toJSONSchema
// dávají inputSchema do tools/list (AITG_TOOL_INPUTS). Zod v4 kvůli toJSONSchema; ID testu
// a spouštěč z balíku @aisha/aitg (AITG_TEST_ID_PATTERN, aitgTriggerSchema) — žádná kopie.
const testId = () =>
  z.string().regex(AITG_TEST_ID_PATTERN, 'AITG_INVALID_TEST_ID').describe('AITG test id, e.g. AITG-APP-01.');
const automationId = () =>
  z.string().regex(/^[a-z][a-z0-9_]+$/, 'AITG_INVALID_AUTOMATION_ID').describe('Automation id (snake_case).');
const kdo = (popis: string) => z.string().default('aisha').describe(popis);

export const runTestSchema = z.object({
  testId: z.enum([
    'AITG-APP-01',
    'AITG-APP-02',
    'AITG-APP-03',
    'AITG-APP-05',
    'AITG-APP-08',
    'AITG-APP-09',
    'AITG-APP-10',
    'AITG-APP-11',
    'AITG-APP-12',
    'AITG-DAT-02',
  ]).describe('Runtime probe to execute (tests that have a probe route).'),
  payload: z.string().min(1).describe('Input the probe sends to the model under test.'),
  model: z.string().optional().describe('Model id to probe; default is the platform default.'),
  triggeredBy: z.enum(aitgTriggerSchema.options).default('self').describe('Who triggered the run.'),
});

export const coverageSchema = z.object({
  windowDays: z.number().int().min(1).max(365).default(30).describe('Sliding window in days.'),
});

export const trustScoreSchema = coverageSchema;

export const findingsSchema = z.object({
  minSeverity: z.enum(['info', 'low', 'medium', 'high', 'critical']).default('medium').describe('Lowest severity to list.'),
  limit: z.number().int().min(1).max(500).default(50).describe('Maximum number of findings.'),
});

export const remediationSchema = z.object({
  findingId: z.string().uuid().describe('Id (uuid) of the open finding.'),
  proposal: z.string().min(20).describe('Remediation proposal (min 20 chars); goes through the approval gate.'),
  proposedBy: kdo('Who proposes the remediation.'),
});

export const waiverSchema = z.object({
  testId: testId(),
  scope: z.record(z.string(), z.unknown()).describe('Scope the waiver applies to.'),
  justification: z.string().min(20).describe('Why the failing test is accepted (min 20 chars).'),
  expiresAt: z.string().datetime().describe('When the waiver expires (ISO 8601).'),
});

export const classifySchema = z.object({
  classifier: z.enum(['prompt_injection', 'toxicity', 'canary', 'hallucination']).describe('Heuristic classifier to run.'),
  text: z.string().min(1).describe('Text to classify.'),
  canary: z.string().optional().describe('Canary token to look for (classifier=canary).'),
  golden: z.string().optional().describe('Grounding reference text (classifier=hallucination).'),
});

// ── continuous-loop schemas ─────────────────────────────────────────────────
export const healthSummarySchema = z.object({
  windowHours: z.number().int().min(1).max(720).default(24).describe('Window in hours.'),
});

export const observeTrendSchema = z.object({
  limit: z.number().int().min(1).max(180).default(14).describe('Number of reflections to return.'),
  generatedBy: kdo('Whose reflections to read.'),
});

export const recordReflectionSchema = z.object({
  summary: z.string().min(10).describe('Short narrative of the reflection (min 10 chars).'),
  proposedActions: z.array(z.unknown()).default([]).describe('Actions proposed by the reflection.'),
  generatedBy: kdo('Who wrote the reflection.'),
});

export const proposePayloadSchema = z.object({
  testId: testId(),
  payload: z.record(z.string(), z.unknown()).describe('Adversarial payload to add to the corpus.'),
  expectedBlock: z.string().min(1).describe('What the guard is expected to block.'),
  justification: z.string().min(20).describe('Why the payload belongs in the corpus (min 20 chars).'),
  tags: z.array(z.string()).default([]).describe('Tags of the payload.'),
  proposedBy: kdo('Who proposes the payload.'),
});

export const nextInQueueSchema = z.object({
  limit: z.number().int().min(1).max(50).default(5).describe('Number of tests to return.'),
});

export const driftDetectSchema = z.object({
  windowHours: z.number().int().min(1).max(168).default(24).describe('Window in hours.'),
  minRuns: z.number().int().min(1).default(5).describe('Minimum runs per test to judge drift.'),
  dropThresholdPp: z.number().min(0).max(1).default(0.1).describe('Pass-rate drop that counts as drift (0–1).'),
});

export const autoCloseSchema = z.object({
  requiredConsecutivePasses: z.number().int().min(1).max(20).default(3).describe('Consecutive passes needed to close a finding.'),
});

// ── automation-control schemas ──────────────────────────────────────────────
export const listAutomationsSchema = z.object({});
export const getAutomationSchema = z.object({ automationId: automationId() });
export const triggerAutomationSchema = z.object({
  automationId: automationId(),
  initiator: kdo('Who triggers the automation.'),
});
export const updateAutomationSchema = z.object({
  automationId: automationId(),
  mode: z.enum(['automated', 'manual', 'disabled']).optional().describe('New mode.'),
  scheduleCron: z.string().nullable().optional().describe('New cron schedule (null clears it).'),
  scheduleIntervalMinutes: z.number().int().min(1).max(1440).nullable().optional().describe('New interval in minutes (null clears it).'),
  parameters: z.record(z.string(), z.unknown()).optional().describe('New automation parameters.'),
});
export const recordAutomationRunSchema = z.object({
  automationId: automationId(),
  status: z.enum(['success', 'failed', 'skipped', 'running']).describe('Outcome of the run.'),
  details: z.record(z.string(), z.unknown()).default({}).describe('Run details.'),
});

/** Rozhraní nástrojů AITG pro tools/list (z.toJSONSchema) — totéž, co validuje dispatch. */
export const AITG_TOOL_INPUTS = {
  aitg_run_test: runTestSchema,
  aitg_get_coverage: coverageSchema,
  aitg_get_trust_score: trustScoreSchema,
  vehicle_dq_status: z.object({}),
  aitg_list_open_findings: findingsSchema,
  aitg_propose_remediation: remediationSchema,
  aitg_request_waiver: waiverSchema,
  aitg_classify_response: classifySchema,
  aitg_health_summary: healthSummarySchema,
  aitg_observe_trend: observeTrendSchema,
  aitg_record_reflection: recordReflectionSchema,
  aitg_propose_payload: proposePayloadSchema,
  aitg_next_in_queue: nextInQueueSchema,
  aitg_detect_drift: driftDetectSchema,
  aitg_auto_close_findings: autoCloseSchema,
  aitg_list_automations: listAutomationsSchema,
  aitg_get_automation: getAutomationSchema,
  aitg_trigger_automation: triggerAutomationSchema,
  aitg_update_automation: updateAutomationSchema,
  aitg_record_automation_run: recordAutomationRunSchema,
} as const;
