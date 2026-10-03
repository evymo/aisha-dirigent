/**
 * POST /callback — n8n → chat async message push.
 * Auth: N8N_API_KEY header or service-role token.
 */
import type { FastifyInstance } from 'fastify';
import { constantTimeStringCompare } from '@aisha/security';
import { verifyServiceRole, AuthError } from '../auth.js';
import { rpcService } from '../postgrest.js';
import { config } from '../config.js';

interface CallbackBody {
  action?: 'comment' | 'escalate' | 'notify';
  content: string;
  conversation_id: string;
  metadata?: Record<string, unknown>;
  routing_category?: string;
  user_id?: string;
}

export async function callbackRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: CallbackBody }>('/callback', async (req, reply) => {
    const authHeader = req.headers.authorization ?? '';
    const n8nKey = req.headers['x-n8n-api-key'] as string | undefined;

    // Auth: service-role OR n8n API key. Use constant-time compare to
    // avoid leaking the n8nApiKey byte-by-byte through response timing.
    if (n8nKey) {
      if (!constantTimeStringCompare(n8nKey, config.n8nApiKey)) {
        return reply.code(401).send({ error: 'Invalid n8n API key' });
      }
    } else {
      try {
        verifyServiceRole(authHeader);
      } catch (err) {
        return reply.code(err instanceof AuthError ? err.statusCode : 401).send({ error: 'Unauthorized' });
      }
    }

    const { content, conversation_id, action, routing_category, user_id, metadata } = req.body ?? {};

    if (!content || typeof content !== 'string') {
      return reply.code(400).send({ error: 'content is required' });
    }
    if (!conversation_id || typeof conversation_id !== 'string') {
      return reply.code(400).send({ error: 'conversation_id is required' });
    }

    // Save assistant message
    const saved = await rpcService<{ id: string }>('save_chat_message_audited', {
      p_content: content,
      p_conversation_id: conversation_id,
      p_metadata: metadata ?? null,
      p_role: 'assistant',
      p_routing_category: routing_category ?? 'aisha_dirigent',
      p_user_id: user_id ?? null,
    });

    // Audit journal
    await rpcService('log_audit_event', {
      p_action: 'AISHA_CALLBACK',
      p_metadata: {
        action: action ?? 'comment',
        conversation_id,
        message_id: saved?.id ?? null,
        source: n8nKey ? 'n8n' : 'service',
      },
      p_user_id: user_id ?? null,
    }).catch(() => {});

    return reply.send({
      action: action ?? 'comment',
      message_id: saved?.id ?? null,
      ok: true,
    });
  });
}
