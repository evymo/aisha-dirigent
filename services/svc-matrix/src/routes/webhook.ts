import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { constantTimeStringCompare } from '@aisha/security';
import { rpcService } from '../postgrest.js';
import { config } from '../config.js';

interface MatrixEvent {
  type: string;
  room_id: string;
  sender: string;
  event_id: string;
  origin_server_ts?: number;
  content?: Record<string, unknown>;
}

type MatrixWebhookRequest = FastifyRequest<{
  Querystring: { access_token?: string };
  Body: unknown;
}>;

/**
 * Receives Matrix appservice events from Synapse.
 * Validates via hs_token and forwards to n8n for AISHA triage.
 */
export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.put('/webhook', handleWebhook);
  app.post('/webhook', handleWebhook);
}

async function handleWebhook(
  req: MatrixWebhookRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  // Validate appservice token
  const authParam = req.query.access_token;
  const authHeader = req.headers.authorization?.replace('Bearer ', '');
  const token = authParam || authHeader;

  // Constant-time compare prevents timing attacks on matrixWebhookSecret.
  // `!==` short-circuits on first mismatched byte → leaks byte position.
  // See packages/security/src/jwt.ts::constantTimeStringCompare.
  if (!token || !constantTimeStringCompare(token, config.matrixWebhookSecret)) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  const body = typeof req.body === 'object' && req.body !== null ? req.body as { events?: unknown } : {};
  const events = Array.isArray(body.events) ? body.events as MatrixEvent[] : [];

  if (events.length === 0) {
    return reply.status(200).send({});
  }

  for (const event of events) {
    // Store bridge events in audit journal for compliance
    if (event.type === 'm.room.message') {
      await rpcService('write_audit_journal', {
        p_action_type: 'matrix.message',
        p_area: 'matrix',
        p_details: {
          sender: event.sender,
          msgtype: event.content?.msgtype,
          event_id: event.event_id,
          has_body: !!event.content?.body,
          // Do NOT log message body (PII/GDPR)
        },
        p_entity_id: event.room_id,
        p_entity_type: 'matrix_room',
        p_summary: 'Matrix message received',
        p_user_id: null,
      }).catch(() => { /* non-critical */ });
    }

    // Forward to n8n for AISHA triage
    if (config.n8nMatrixWebhookUrl && (config.n8nMatrixWebhookUrl.startsWith('https://') || config.n8nMatrixWebhookUrl.startsWith('http://localhost'))) {
      try {
        await fetch(config.n8nMatrixWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'matrix',
            event_type: event.type,
            room_id: event.room_id,
            sender: event.sender,
            event_id: event.event_id,
            timestamp: event.origin_server_ts,
            content: event.content,
          }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch { /* n8n forward non-critical */ }
    }
  }

  return reply.status(200).send({});
}
