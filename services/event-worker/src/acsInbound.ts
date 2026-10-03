/**
 * ACS inbound middleware (IP-4) for the event-worker.
 *
 * Sits at the very start of handleNotification. Handles both transitional
 * shapes on the wire:
 *   1. inline ACS message  — payload contains { envelope, payload }
 *   2. id-only pointer     — payload contains { acs_message_id } (IP-3 NOTIFY);
 *      the row is fetched from acs_message_log (pass-by-reference transport).
 *
 * Mode ladder (ACS_MODE / ACS_MODE_OVERRIDES):
 *   off     → immediate pass-through, zero cost, zero behavioural change
 *   shadow  → validate + count violations, never blocks
 *   warn    → shadow + loud logging with rejection codes
 *   enforce → invalid traffic is dead-lettered and DROPPED
 */
import type pg from 'pg';
import {
  envTrustStore,
  parseModeConfig,
  receiveMessage,
  type ModeConfig,
  type Rejection,
} from '@aisha/acs-sdk';
import { log, safeLog } from './config.js';

export type AcsInboundOutcome = 'dispatched' | 'dropped' | 'passed_unvalidated';

export interface AcsInbound {
  handle(parsed: Record<string, unknown>): Promise<AcsInboundOutcome>;
  /** Exposed for tests/metrics. */
  violations: () => ReadonlyArray<{ code: string; detail: string }>;
}

export function createAcsInbound(deps: {
  query: <T = unknown>(sql: string, params: unknown[]) => Promise<{ rows: T[] }>;
  env?: NodeJS.ProcessEnv;
}): AcsInbound {
  const env = deps.env ?? process.env;
  const modeConfig: ModeConfig = parseModeConfig(env, (detail) =>
    safeLog.safeWarn('ACS mode config problem — failing closed to off', { detail }),
  );
  const trustStore = env['ACS_TRUSTED_KEYS'] ? envTrustStore(env) : null;
  const seenViolations: Array<{ code: string; detail: string }> = [];

  const onViolation = (rejection: Rejection, _raw: unknown): void => {
    seenViolations.push({ code: rejection.code, detail: rejection.detail });
    // OWASP A09 — rejected payloads may carry user data; log via redacted logger.
    safeLog.safeWarn('ACS violation (event-worker inbound)', { code: rejection.code, detail: rejection.detail });
  };

  return {
    violations: () => seenViolations,

    async handle(parsed: Record<string, unknown>): Promise<AcsInboundOutcome> {
      if (modeConfig.globalMode === 'off' && Object.keys(modeConfig.overrides).length === 0) {
        return 'passed_unvalidated';
      }

      // Shape 2: id-only pointer → hydrate from the append-only log.
      let candidate: unknown = parsed;
      const pointerId = typeof parsed['acs_message_id'] === 'string' ? (parsed['acs_message_id'] as string) : null;
      if (pointerId) {
        const { rows } = await deps.query<{ message: unknown }>(
          `SELECT jsonb_build_object(
             'envelope', jsonb_build_object(
               'message_id', message_id, 'schema', schema_ref, 'intent_id', intent_id,
               'correlation_id', correlation_id, 'causation_id', causation_id,
               'sender', sender, 'recipient', recipient,
               'sent_at', to_char(sent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
               'signature', signature, 'trust', trust
             ),
             'payload', payload
           ) AS message
           FROM acs_message_log WHERE message_id = $1`,
          [pointerId],
        );
        if (rows.length === 0) {
          onViolation({ code: 'envelope_invalid', detail: `pointer ${pointerId} not found in acs_message_log` }, parsed);
          return 'dropped';
        }
        candidate = rows[0].message;
      } else if (!('envelope' in parsed)) {
        // Legacy traffic without any ACS shape: shadow observes, enforce is
        // introduced per-channel later (rollout runbook krok 4).
        return 'passed_unvalidated';
      }

      return receiveMessage(
        candidate,
        { modeConfig, trustStore, selfIdentity: 'event-worker' },
        {
          isDuplicate: async (messageId) => {
            if (pointerId) return false; // pointer rows come FROM the dedup-guarded log
            const { rows } = await deps.query<{ one: number }>(
              'SELECT 1 AS one FROM acs_message_log WHERE message_id = $1',
              [messageId],
            );
            return rows.length > 0;
          },
          aclAllows: async (sender, schemaRef, recipient) => {
            const { rows } = await deps.query<{ allowed: boolean }>(
              'SELECT acs_check_acl($1, $2, $3) AS allowed',
              [sender, schemaRef, recipient],
            );
            return rows[0]?.allowed === true;
          },
          deadLetter: async (raw, rejection) => {
            await deps.query(
              'INSERT INTO acs_dead_letters (rejection_code, detail, raw, received_by) VALUES ($1, $2, $3, $4)',
              [rejection.code, rejection.detail, JSON.stringify(raw), 'event-worker'],
            );
          },
          onViolation,
          dispatch: async () => {
            /* validated — the regular worker flow continues after this gate */
          },
        },
      );
    },
  };
}

/** Lazy singleton so ACS_MODE=off costs nothing (no pool, no imports used). */
let singleton: AcsInbound | null = null;
export function acsInbound(client: pg.Client): AcsInbound {
  if (!singleton) {
    singleton = createAcsInbound({
      query: async <T = unknown>(sql: string, params: unknown[]): Promise<{ rows: T[] }> => {
        const r = await client.query(sql, params as never[]);
        return { rows: r.rows as T[] };
      },
    });
  }
  return singleton;
}
