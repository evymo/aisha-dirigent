import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { verifyToken, isAdminOrStaff, AuthError } from '../auth.js';
import { rpcService } from '../postgrest.js';

/** Allowed event types and reference tables for blockchain audit. */
const ALLOWED_EVENT_TYPES = [
  'token_award', 'token_transfer', 'token_burn', 'token_mint',
  'governance_vote', 'governance_proposal',
  'consent_grant', 'consent_revoke',
] as const;

const ALLOWED_REFERENCE_TABLES = [
  'token_transactions', 'governance_votes', 'governance_proposals',
  'consent_records', 'reward_claims',
] as const;

const MAX_PAYLOAD_JSON_CHARS = 50_000;

/**
 * POST /audit — Record a blockchain audit entry (admin/staff only).
 */
export async function recordAuditRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: {
      event_type: string;
      reference_table: string;
      reference_id: string;
      payload: Record<string, unknown>;
    };
  }>('/audit', async (req, reply) => {
    let user;
    try {
      user = await verifyToken(req.headers.authorization);
    } catch (err) {
      const status = err instanceof AuthError ? err.statusCode : 401;
      return reply.code(status).send({ error: 'Unauthorized' });
    }

    if (!isAdminOrStaff(user)) {
      return reply.code(403).send({ error: 'Insufficient permissions' });
    }

    const { event_type, reference_table, reference_id, payload } = req.body ?? {};

    if (!event_type || !reference_table || !reference_id || !payload) {
      return reply.code(400).send({ error: 'Missing required fields' });
    }

    if (!(ALLOWED_EVENT_TYPES as readonly string[]).includes(event_type)) {
      return reply.code(400).send({ error: 'Invalid event type' });
    }

    if (!(ALLOWED_REFERENCE_TABLES as readonly string[]).includes(reference_table)) {
      return reply.code(400).send({ error: 'Invalid reference table' });
    }

    const payloadJson = JSON.stringify(payload);
    if (payloadJson.length > MAX_PAYLOAD_JSON_CHARS) {
      return reply.code(400).send({ error: 'Payload too large' });
    }

    const payloadHash = createHash('sha256').update(payloadJson).digest('hex');

    const auditRecord = await rpcService<{ id?: string }>('edge_blockchain_audit', {
      p_action: 'insert_record',
      p_payload: {
        created_by: user.userId,
        event_type,
        payload,
        payload_hash: payloadHash,
        reference_id,
        reference_table,
      },
    });

    const auditRecordId = auditRecord?.id;
    if (!auditRecordId) {
      return reply.code(500).send({ error: 'Failed to create blockchain audit record' });
    }

    await rpcService('write_audit_journal', {
      p_action_type: 'integration',
      p_area: 'blockchain',
      p_details: { event_type, reference_table, reference_id, status: 'pending' },
      p_entity_id: auditRecordId,
      p_entity_type: 'blockchain_audit',
      p_summary: 'Blockchain audit queued',
      p_user_id: user.userId,
    });

    return reply.send({ success: true, audit_id: auditRecordId, status: 'pending' });
  });
}
