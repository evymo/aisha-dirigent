/**
 * `AitgRunner` — the PostgREST adapter that turns probe outcomes into rows
 * in `aitg_runs`. Every service (`svc-aitg-probes`, `svc-ai-chat` middleware,
 * Aisha's MCP tools) talks to the same runner so the catalog of events
 * stays canonical.
 *
 * Design rationale:
 *   - Fail-soft: a PostgREST outage MUST NOT break a chat completion.
 *     `record()` swallows transport errors (logged via @aisha/security/logger)
 *     and returns `null` for run_id instead.
 *   - Audit-leak-resistant: details payload runs through @aisha/security's
 *     `redact()` before transport (PII / tokens never reach the audit table).
 *   - Synchronous-friendly: callers can fire-and-forget by ignoring the
 *     returned promise; the runner does not maintain queues or batches.
 */

import { createSafeLogger, redact } from '@aisha/security';
import type { AitgRunRecord, AitgStatus, AitgSeverity, AitgTrigger } from './schemas.js';
import { aitgRunRecordSchema } from './schemas.js';

export interface AitgRunnerConfig {
  postgrestUrl: string;
  serviceToken: string;
  service: string;
  /** Override RPC name — defaults to `aitg_record_run_audited`. */
  rpcName?: string;
}

export interface AitgRunInput {
  testId: string;
  buildSha: string;
  triggeredBy: AitgTrigger;
  status: AitgStatus;
  severity?: AitgSeverity;
  evidenceUri?: string | null;
  aiRunId?: string | null;
  details?: Record<string, unknown>;
}

export interface AitgRunner {
  /** Persist a single AITG run. Returns the inserted run_id, or null on transport failure. */
  record(input: AitgRunInput): Promise<string | null>;
}

export function createAitgRunner(cfg: AitgRunnerConfig): AitgRunner {
  const log = createSafeLogger(`aitg:${cfg.service}`);
  const rpc = cfg.rpcName ?? 'aitg_record_run_audited';

  return {
    async record(input): Promise<string | null> {
      const record: AitgRunRecord = {
        test_id: input.testId,
        build_sha: input.buildSha,
        triggered_by: input.triggeredBy,
        status: input.status,
        severity: input.severity ?? 'info',
        evidence_uri: input.evidenceUri ?? null,
        ai_run_id: input.aiRunId ?? null,
        details: (redact(input.details ?? {}) as Record<string, unknown>),
      };

      const parsed = aitgRunRecordSchema.safeParse(record);
      if (!parsed.success) {
        log.safeWarn('aitg.record_schema_failed', {
          testId: input.testId,
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
        return null;
      }

      try {
        const res = await fetch(`${cfg.postgrestUrl}/rpc/${rpc}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cfg.serviceToken}`,
            Accept: 'application/json',
          },
          body: JSON.stringify({
            p_test_id: parsed.data.test_id,
            p_build_sha: parsed.data.build_sha,
            p_triggered_by: parsed.data.triggered_by,
            p_status: parsed.data.status,
            p_severity: parsed.data.severity,
            p_evidence_uri: parsed.data.evidence_uri,
            p_ai_run_id: parsed.data.ai_run_id,
            p_details: parsed.data.details,
          }),
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) {
          log.safeWarn('aitg.record_http_failed', {
            testId: input.testId,
            status: res.status,
          });
          return null;
        }
        const body = (await res.json()) as string | null;
        return body ?? null;
      } catch (err) {
        log.safeWarn('aitg.record_threw', { testId: input.testId, err: String(err) });
        return null;
      }
    },
  };
}

/** In-memory runner for tests — captures records without touching PostgREST. */
export function createInMemoryAitgRunner(): AitgRunner & { records: AitgRunInput[] } {
  const records: AitgRunInput[] = [];
  return {
    records,
    async record(input): Promise<string | null> {
      const parsed = aitgRunRecordSchema.safeParse({
        test_id: input.testId,
        build_sha: input.buildSha,
        triggered_by: input.triggeredBy,
        status: input.status,
        severity: input.severity ?? 'info',
        evidence_uri: input.evidenceUri ?? null,
        ai_run_id: input.aiRunId ?? null,
        details: input.details ?? {},
      });
      if (!parsed.success) return null;
      records.push(input);
      return `mem-${records.length}`;
    },
  };
}
