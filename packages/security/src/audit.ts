/**
 * OWASP A09 — append-only audit trail emitter.
 *
 * Bridges service-layer events into the `audit_journal` table via the
 * `log_integration_action` RPC. Never logs raw PII; metadata is redacted before
 * insertion. Designed to be fail-soft — audit emission failure must not break
 * the operation (we log a warning and continue) because losing functionality
 * to a missing audit row is worse than a missing audit row.
 *
 * Pairs with logger.ts: operational logs go to stdout/Sentry, compliance
 * events go to audit_journal.
 */

import { createSafeLogger, redact } from './logger.js';

export interface AuditEvent {
  /** Logical action name, e.g. `chat.completion.create`, `pki.cert.issue`. */
  action: string;
  /** Service emitting the event (must match its package name). */
  service: string;
  /** Subject of the action (auth.uid() or 'system' / 'anon'). */
  actorId?: string;
  /** Target entity (e.g., document id, RPC name). */
  targetType?: string;
  targetId?: string;
  /** Free-form metadata. WILL BE REDACTED — do NOT pre-redact. */
  metadata?: Record<string, unknown>;
  /** Outcome of the operation. */
  outcome: 'allow' | 'deny' | 'error';
  /** Optional reason (for deny/error). */
  reason?: string;
}

export interface AuditEmitter {
  emit(event: AuditEvent): Promise<void>;
}

export interface AuditTransportContext {
  postgrestUrl: string;
  serviceToken: string;
  /** Optional RPC name override; defaults to `log_security_event`. */
  rpcName?: string;
}

/**
 * Build an audit emitter wired to the orchestrator's PostgREST instance.
 *
 * The emitter calls the SECURITY DEFINER RPC `log_security_event` which
 * writes into `audit_journal` with area='security' and OWASP tags. We do
 * not write directly to the table — that would require service-role grants
 * and break the RPC-only invariant from CLAUDE.md.
 *
 * Migration: aisha/db/migrations/20260516131034_owasp_security_event_logging.sql
 */
export function createPostgrestAuditEmitter(ctx: AuditTransportContext): AuditEmitter {
  const log = createSafeLogger(`audit:${ctx.postgrestUrl}`);
  const rpc = ctx.rpcName ?? 'log_security_event';

  return {
    async emit(event: AuditEvent): Promise<void> {
      try {
        const body = {
          p_service: event.service,
          p_action: event.action,
          p_actor_id: event.actorId ?? null,
          p_target_type: event.targetType ?? null,
          p_target_id: event.targetId ?? null,
          p_outcome: event.outcome,
          p_reason: event.reason ?? null,
          p_metadata: event.metadata ? redact(event.metadata) : {},
        };
        const res = await fetch(`${ctx.postgrestUrl}/rpc/${rpc}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ctx.serviceToken}`,
            Accept: 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) {
          log.safeWarn('audit.emit.failed', {
            action: event.action,
            status: res.status,
          });
        }
      } catch (err) {
        log.safeWarn('audit.emit.threw', { action: event.action, err: String(err) });
      }
    },
  };
}

/** No-op emitter for tests or environments where audit is intentionally disabled. */
export const noopAuditEmitter: AuditEmitter = {
  async emit(): Promise<void> {
    /* intentionally empty */
  },
};

/**
 * Test emitter that captures events in-memory. Useful for asserting audit
 * emission in unit tests without booting PostgREST.
 */
export function createInMemoryAuditEmitter(): AuditEmitter & { events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    async emit(event: AuditEvent): Promise<void> {
      events.push(event);
    },
  };
}
