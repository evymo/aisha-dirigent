/**
 * Webhook route: source-api pushes change events to svc-source-broker
 *
 * Validates:
 *   1. HMAC signature header (shared secret)
 *   2. AuthHandshake in payload (per CLAUDE.md)
 *   3. Schema of payload
 *
 * On success: INSERTs into integration_events; event-worker downstream
 * routes to Redis/n8n/audience_process_signal_audited RPC.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { errMessage, errCode } from '../errors.js';
import type { SourceAuthManager } from '../auth.js';
import type { SourceBrokerConfig } from '../config.js';
import { Client as PgClient } from 'pg';
import { createHash } from 'node:crypto';

interface WebhookPayload {
  authHandshake: string;
  event_source: string;        // e.g., 'source-api'
  event_type: string;          // e.g., 'event_attendance.recorded'
  occurred_at: string;
  metadata: Record<string, unknown>;
}

export function registerWebhookRoutes(
  app: FastifyInstance,
  auth: SourceAuthManager,
  config: SourceBrokerConfig
): void {
  // HMAC verification needs the EXACT signed bytes — re-serializing req.body
  // (key order / whitespace / unicode-escaping differences) would break it.
  // fastify-raw-body (registered globally:false in server.ts) populates
  // req.rawBody for routes that opt in via `config.rawBody: true`.
  app.post(
    '/webhook/source',
    { config: { rawBody: true } },
    async (req: FastifyRequest, reply: FastifyReply) => {
    const rawBody =
      (req as FastifyRequest & { rawBody?: string }).rawBody ??
      (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    const sigHeader = req.headers['x-source-signature'] as string | undefined;

    if (!rawBody || !sigHeader) {
      return reply.code(400).send({ error: 'missing_signature_or_body' });
    }

    if (!auth.verifyWebhookSignature(rawBody, sigHeader)) {
      req.log.warn({ sigHeader }, 'Webhook signature mismatch');
      return reply.code(401).send({ error: 'invalid_signature' });
    }

    const payload = req.body as WebhookPayload;
    if (!auth.verifyAuthHandshake(payload.authHandshake)) {
      req.log.warn('Webhook authHandshake mismatch');
      return reply.code(401).send({ error: 'invalid_authHandshake' });
    }

    // Insert into integration_events; aisha event-worker picks up.
    //
    // external_id: idempotency key for the (event_source, external_id) UNIQUE
    // index. Source-api webhooks don't carry a native delivery ID (unlike
    // github X-GitHub-Delivery or Stripe event.id), so we derive one from
    // payload content. This guarantees identical retransmissions dedupe.
    const externalId =
      (payload.metadata?.external_id as string | undefined) ??
      `${payload.event_source}:${payload.occurred_at}:${createHash('sha256').update(rawBody).digest('hex').slice(0, 16)}`;

    const pg = new PgClient({
      connectionString: config.postgresUrl,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 15_000,
    });
    try {
      await pg.connect();
      // Plain INSERT — no ON CONFLICT DO UPDATE because that requires UPDATE
      // grant on the table (broker writer is INSERT-only by least-privilege).
      // On duplicate, catch the unique violation (SQLSTATE 23505) and treat
      // as success: same payload arrived twice, no work to do.
      let eventId: string | undefined;
      try {
        const res = await pg.query(
          `INSERT INTO public.integration_events (event_source, external_id, event_type, status, metadata, created_at)
           VALUES ($1, $2, $3, 'received', $4, now())
           RETURNING id`,
          [payload.event_source, externalId, payload.event_type, JSON.stringify(payload.metadata)]
        );
        eventId = res.rows[0]?.id;
      } catch (err) {
        if (errCode(err) === '23505') {
          // Duplicate (event_source, external_id). Look up existing id.
          const lookup = await pg.query(
            `SELECT id FROM public.integration_events
             WHERE event_source = $1 AND external_id = $2`,
            [payload.event_source, externalId]
          );
          eventId = lookup.rows[0]?.id;
          req.log.info({ externalId, eventId }, 'webhook: duplicate event, returning existing id');
        } else {
          throw err;
        }
      }

      // Fire-and-forget: call audience_process_signal_audited (event-worker
      // would also trigger this via pg_notify, but doing it inline is fine)
      await pg.query(
        `SELECT public.audience_process_signal_audited($1::uuid, $2::text[])`,
        [eventId, []]
      );

      return reply.send({ status: 'accepted', event_id: eventId });
    } catch (err) {
      req.log.error({ err }, 'Webhook processing failure');
      return reply.code(500).send({ error: 'internal_error', message: errMessage(err) });
    } finally {
      await pg.end();
    }
  });
}
