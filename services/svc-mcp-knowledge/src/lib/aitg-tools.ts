/**
 * AITG MCP tool dispatch — Aisha's self-management surface.
 *
 * These tools are the explicit "tools to give Aisha for full autonomy"
 * referenced in OWASP_AI_TESTING_GUIDE_IMPLEMENTATION.md. Each MCP call
 * lands here, validates input via Zod, and delegates to either:
 *   - a PostgREST RPC (`rpcUserClaims`) — for read paths + audited writes
 *   - the svc-aitg-probes HTTP API — for the actual probe execution
 *
 * Aisha can:
 *   1. Inspect her own state            → aitg_get_coverage, aitg_get_trust_score
 *   2. Discover what's failing          → aitg_list_open_findings
 *   3. Verify a hypothesis              → aitg_run_test, aitg_classify_response
 *   4. Suggest a fix                    → aitg_propose_remediation
 *   5. Request risk acceptance          → aitg_request_waiver
 *
 * Each tool emits an audit_journal event via the underlying _audited RPC,
 * so every autonomous action is traceable.
 */

import type { z } from 'zod/v4';
import {
  classifyPromptInjection,
  classifyToxicity,
  detectCanary,
  hallucinationGroundedness,
} from '@aisha/aitg';
import { createSsrfGuard, parseHostAllowlist, createSafeLogger } from '@aisha/security';
import type { JWTPayload } from 'jose';
import { rpcUserClaims } from '../postgrest.js';
import {
  AITG_TOOL_INPUTS,
  runTestSchema,
  coverageSchema,
  trustScoreSchema,
  findingsSchema,
  remediationSchema,
  waiverSchema,
  classifySchema,
  healthSummarySchema,
  observeTrendSchema,
  recordReflectionSchema,
  proposePayloadSchema,
  nextInQueueSchema,
  driftDetectSchema,
  autoCloseSchema,
  listAutomationsSchema,
  getAutomationSchema,
  triggerAutomationSchema,
  updateAutomationSchema,
  recordAutomationRunSchema,
} from './aitg-tool-inputs.js';
import { config } from '../config.js';

const log = createSafeLogger('aitg-mcp');

const guard = createSsrfGuard({
  service: 'svc-mcp-knowledge:aitg',
  hostAllowlist: parseHostAllowlist(
    `${tryHost(config.aitgProbesUrl ?? 'http://svc-aitg-probes:3041')},svc-aitg-probes`,
  ),
  allowedSchemes: ['https:', 'http:'],
  allowInternalNetworks: true,
});

function tryHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'svc-aitg-probes';
  }
}

// ── dispatch ────────────────────────────────────────────────────────────────
export async function aitgDispatch(
  name: string,
  rawArgs: Record<string, unknown>,
  claims: JWTPayload,
): Promise<unknown> {
  switch (name) {
    case 'aitg_run_test': {
      const args = runTestSchema.parse(rawArgs);
      return runProbe(args.testId, {
        payload: args.payload,
        model: args.model,
        triggeredBy: args.triggeredBy,
      });
    }
    case 'aitg_get_coverage': {
      const args = coverageSchema.parse(rawArgs);
      return rpcUserClaims('aitg_get_coverage_audited', { p_window_days: args.windowDays }, claims);
    }
    case 'aitg_get_trust_score': {
      const args = trustScoreSchema.parse(rawArgs);
      return rpcUserClaims('aitg_get_trust_score_audited', { p_window_days: args.windowDays }, claims);
    }
    case 'vehicle_dq_status': {
      // No args — latest AITG-DAT-5x (vehicle-registry) run per check + catalog rollup.
      AITG_TOOL_INPUTS.vehicle_dq_status.parse(rawArgs);
      return rpcUserClaims('vehicle_dq_status', {}, claims);
    }
    case 'aitg_list_open_findings': {
      const args = findingsSchema.parse(rawArgs);
      return rpcUserClaims(
        'aitg_list_open_findings_audited',
        { p_min_severity: args.minSeverity, p_limit: args.limit },
        claims,
      );
    }
    case 'aitg_propose_remediation': {
      const args = remediationSchema.parse(rawArgs);
      return rpcUserClaims(
        'aitg_propose_remediation_audited',
        { p_finding_id: args.findingId, p_proposal: args.proposal, p_proposed_by: args.proposedBy },
        claims,
      );
    }
    case 'aitg_request_waiver': {
      const args = waiverSchema.parse(rawArgs);
      return rpcUserClaims(
        'aitg_request_waiver_audited',
        {
          p_test_id: args.testId,
          p_scope: args.scope,
          p_justification: args.justification,
          p_expires_at: args.expiresAt,
        },
        claims,
      );
    }
    case 'aitg_classify_response': {
      const args = classifySchema.parse(rawArgs);
      return runClassifier(args);
    }

    // ── continuous-loop tools (the autonomy heartbeat) ────────────────────
    case 'aitg_health_summary': {
      const args = healthSummarySchema.parse(rawArgs);
      return rpcUserClaims('aitg_health_summary_audited',
        { p_window_hours: args.windowHours }, claims);
    }
    case 'aitg_observe_trend': {
      const args = observeTrendSchema.parse(rawArgs);
      return rpcUserClaims('aitg_get_reflection_history_audited',
        { p_limit: args.limit, p_generated_by: args.generatedBy }, claims);
    }
    case 'aitg_record_reflection': {
      const args = recordReflectionSchema.parse(rawArgs);
      return rpcUserClaims('aitg_record_reflection_audited',
        {
          p_summary: args.summary,
          p_proposed_actions: args.proposedActions,
          p_generated_by: args.generatedBy,
        }, claims);
    }
    case 'aitg_propose_payload': {
      const args = proposePayloadSchema.parse(rawArgs);
      return rpcUserClaims('aitg_propose_payload_audited',
        {
          p_test_id: args.testId,
          p_payload: args.payload,
          p_expected_block: args.expectedBlock,
          p_justification: args.justification,
          p_tags: args.tags,
          p_proposed_by: args.proposedBy,
        }, claims);
    }
    case 'aitg_next_in_queue': {
      const args = nextInQueueSchema.parse(rawArgs);
      return rpcUserClaims('aitg_next_in_queue_audited',
        { p_limit: args.limit }, claims);
    }
    case 'aitg_detect_drift': {
      const args = driftDetectSchema.parse(rawArgs);
      return rpcUserClaims('aitg_detect_drift_audited',
        {
          p_window_hours: args.windowHours,
          p_min_runs: args.minRuns,
          p_drop_threshold_pp: args.dropThresholdPp,
        }, claims);
    }
    case 'aitg_auto_close_findings': {
      const args = autoCloseSchema.parse(rawArgs);
      return rpcUserClaims('aitg_auto_close_findings_audited',
        { p_required_consecutive_passes: args.requiredConsecutivePasses }, claims);
    }

    // ── automation control surface (operator + Aisha share this) ──────────
    case 'aitg_list_automations': {
      listAutomationsSchema.parse(rawArgs);
      return rpcUserClaims('aitg_list_automations_audited', {}, claims);
    }
    case 'aitg_get_automation': {
      const args = getAutomationSchema.parse(rawArgs);
      return rpcUserClaims('aitg_get_automation_audited',
        { p_automation_id: args.automationId }, claims);
    }
    case 'aitg_trigger_automation': {
      const args = triggerAutomationSchema.parse(rawArgs);
      return rpcUserClaims('aitg_trigger_automation_audited',
        { p_automation_id: args.automationId, p_initiator: args.initiator }, claims);
    }
    case 'aitg_update_automation': {
      const args = updateAutomationSchema.parse(rawArgs);
      return rpcUserClaims('aitg_update_automation_audited',
        {
          p_automation_id: args.automationId,
          p_mode: args.mode ?? null,
          p_schedule_cron: args.scheduleCron ?? null,
          p_schedule_interval_minutes: args.scheduleIntervalMinutes ?? null,
          p_parameters: args.parameters ?? null,
        }, claims);
    }
    case 'aitg_record_automation_run': {
      const args = recordAutomationRunSchema.parse(rawArgs);
      return rpcUserClaims('aitg_record_automation_run_audited',
        { p_automation_id: args.automationId, p_status: args.status, p_details: args.details },
        claims);
    }

    default:
      throw new Error(`AITG_UNKNOWN_TOOL:${name}`);
  }
}

// ── probe dispatch via svc-aitg-probes ──────────────────────────────────────
/** Maps an AITG test id to its probe route path. */
const TEST_ID_TO_PROBE_ROUTE: Readonly<Record<string, string>> = {
  'AITG-APP-01': 'app-01-prompt-injection',
  'AITG-APP-02': 'app-02-indirect-injection',
  'AITG-APP-03': 'app-03-data-leak',
  'AITG-APP-05': 'app-05-unsafe-output',
  'AITG-APP-08': 'app-08-embedding-manipulation',
  'AITG-APP-09': 'app-09-model-extraction',
  'AITG-APP-10': 'app-10-content-bias',
  'AITG-APP-11': 'app-11-hallucinations',
  'AITG-APP-12': 'app-12-toxic-output',
  'AITG-DAT-02': 'app-03-data-leak', // canary leak probe is shared
};

async function runProbe(
  testId: string,
  body: { payload: string; model?: string; triggeredBy: string },
): Promise<unknown> {
  const probesUrl = config.aitgProbesUrl ?? 'http://svc-aitg-probes:3041';
  const route = TEST_ID_TO_PROBE_ROUTE[testId];
  if (!route) {
    throw new Error(`AITG_NO_PROBE_ROUTE:${testId}`);
  }
  try {
    const res = await guard.safeFetch(`${probesUrl}/probes/${route}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.postgrestServiceToken}`,
      },
      body: JSON.stringify({
        payload: body.payload,
        model: body.model,
        triggeredBy: body.triggeredBy,
        ...(testId === 'AITG-DAT-02' ? { testId } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`AITG_PROBE_FAILED:${res.status}:${text.slice(0, 200)}`);
    }
    return await res.json();
  } catch (err) {
    log.safeError('aitg.probe_dispatch_failed', err, { testId });
    throw err;
  }
}

// ── inline classifier (no DB write, no probe — pure compute) ────────────────
function runClassifier(args: z.infer<typeof classifySchema>): unknown {
  switch (args.classifier) {
    case 'prompt_injection':
      return classifyPromptInjection(args.text);
    case 'toxicity':
      return classifyToxicity(args.text);
    case 'canary':
      if (!args.canary) throw new Error('AITG_MISSING_CANARY');
      return detectCanary(args.text, args.canary);
    case 'hallucination':
      if (!args.golden) throw new Error('AITG_MISSING_GOLDEN');
      return hallucinationGroundedness(args.text, args.golden);
  }
}
